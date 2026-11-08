/** Движок догонялок: зеркало ядра стенда (кинематическая модель, фовеальная
 *  сетчатка, контур мухи), но задача — школьная погоня «Огонёк ловит Шустрика».
 *
 *  Что честно по построению:
 *  — картинку видит ОДНУ и ту же: eyeImage() по глазам сценария;
 *  — муха управляет декодированным взглядом (decodeImage + контур brain.ts);
 *  — сеть ребёнка управляется предсказанием той же картинки (opts.predict);
 *  — «честный читер» знает истинную геометрию, которой глаз не даёт, — и игра
 *    это честно помечает;
 *  — ни один боец не получает дальность/скорость сближения в управление.
 *
 *  Детерминизм: все случайности — из rng(seed). Тот же seed — тот же погон. */

import { features, getFlyBrain, readout, sgd } from './brain'
import { CircuitState, readoutC, steerFeatures } from './connectome'
import { applyEyeExtras, applyEyeNoise, decodeImage, eyeHalfFov, eyeImage } from './eye'
import { makeRng } from './rng'
import type { BrainReadout, ChaseScenario, GameFrame, Pilot } from './types'

const G = 9.81

function add(a: number[], b: number[], s = 1): number[] {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}
function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function dot(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm(a: number[]) {
  return Math.hypot(a[0], a[1], a[2])
}
function unit(a: number[]): number[] {
  const n = norm(a) || 1e-12
  return [a[0] / n, a[1] / n, a[2] / n]
}
function perp(a: number[], v: number[]): number[] {
  const s2 = dot(v, v) + 1e-12
  const k = dot(a, v) / s2
  return sub(a, [v[0] * k, v[1] * k, v[2] * k])
}
function clip(a: number[], nMax: number): number[] {
  const mag = norm(a)
  const lim = nMax * G
  if (mag > lim && mag > 0) return [a[0] * (lim / mag), a[1] * (lim / mag), a[2] * (lim / mag)]
  return a
}

type Body = { p: number[]; v: number[] }

/** Шаг кинематической точки-массы: |v| сохраняется, ускорение поворачивает
 *  скорость, позиция — трапеция. Побитовое зеркало sim.py::integrate. */
export function integrate(b: Body, a: number[], dt: number) {
  const speed = norm(b.v)
  const aMag = norm(a)
  if (speed < 1e-9) return
  if (aMag < 1e-12) {
    b.p = add(b.p, b.v, dt)
    return
  }
  const axis = cross(b.v, a).map((x) => x / (aMag * speed))
  const theta = Math.min((aMag * dt) / speed, Math.PI)
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const axv = cross(axis, b.v)
  const axd = dot(axis, b.v) * (1 - c)
  const v1: number[] = [
    b.v[0] * c + axv[0] * s + axis[0] * axd,
    b.v[1] * c + axv[1] * s + axis[1] * axd,
    b.v[2] * c + axv[2] * s + axis[2] * axd,
  ]
  b.p = add(b.p, add(b.v, v1), dt / 2)
  b.v = v1
}

/** Межшаговая встреча: минимальное сближение и касание в радиусе осаливания.
 *  Побитовое зеркало sim.step_encounter; радиус там был «поражения», здесь он
 *  «осаливания» — лексика игры, а не стенда. */
export function stepEncounter(pM0: number[], pM1: number[], pT0: number[], pT1: number[], tagRadius: number) {
  const r0 = sub(pT0, pM0)
  const dr = sub(sub(pT1, pM1), r0)
  const a = dot(dr, dr)
  const b = 2 * dot(r0, dr)
  const c0 = dot(r0, r0)
  const r0In = c0 <= tagRadius * tagRadius
  let alphaStar = 0
  if (a > 1e-18) alphaStar = Math.min(1, Math.max(0, -b / (2 * a)))
  const rStar = add(r0, dr, alphaStar)
  const cpa = norm(rStar)
  let hit = false
  let alphaIn: number | null = null
  if (r0In) {
    hit = true
    alphaIn = 0
  } else if (a > 1e-18) {
    const disc = b * b - 4 * a * (c0 - tagRadius * tagRadius)
    if (disc >= 0) {
      const sq = Math.sqrt(disc)
      const a1 = (-b - sq) / (2 * a)
      if (a1 >= 0 && a1 <= 1) {
        hit = true
        alphaIn = a1
      }
    }
  }
  return { cpa: a > 1e-18 || cpa > 0 ? cpa : norm(r0), hit, alphaIn }
}

/** Старт погоня: Огонёк в начале, Шустрик впереди на дальности range_m, чуть
 *  сбоку (off_axis_m), оба бегут по +X. Упрощённое зеркало spawn() стенда:
 *  аспекты «в лоб / сбоку / с земли / свободная расстановка» в игре не нужны. */
/** Высота «прицела» на Шустрике, м: как у обычной расстановки (грудь). */
const PATH_Z = 0.8

/** Длины по нарисованному пути: накопленные от начала. */
function pathLengths(path: number[][]): number[] {
  const acc = [0]
  for (let i = 1; i < path.length; i += 1) acc.push(acc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  return acc
}

/** Где Шустрик на нарисованном пути в момент t: бежит со скоростью v_runner;
 *  путь кончился — бежит дальше прямо, по последнему направлению. */
export function runnerOnPath(sc: ChaseScenario, t: number, acc = pathLengths(sc.path!)): { p: number[]; v: number[] } {
  const path = sc.path!
  const s = sc.v_runner * t
  const total = acc[acc.length - 1]
  let i = 1
  while (i < acc.length - 1 && acc[i] < s) i += 1
  const a = path[i - 1]
  const b = path[i]
  const seg = Math.max(acc[i] - acc[i - 1], 1e-6)
  const dir = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg]
  const u = s > total ? seg + (s - total) : s - acc[i - 1]
  return { p: [a[0] + dir[0] * u, a[1] + dir[1] * u, PATH_Z], v: [dir[0] * sc.v_runner, dir[1] * sc.v_runner, 0] }
}

function spawn(sc: ChaseScenario) {
  const pM: number[] = [0, 0, 0]
  const vM: number[] = [sc.v_chaser, 0, 0]
  if (sc.path && sc.path.length >= 2) {
    const r = runnerOnPath(sc, 0)
    return { pM, vM, pT: r.p, vT: r.v }
  }
  const raw = [1, ((sc.mirror ? -0.5 : 0.5) * sc.off_axis_m) / Math.max(sc.range_m, 1), 0.05]
  const n = norm(raw)
  const pT = add(pM, raw, sc.range_m / n)
  const vT = [sc.v_runner, 0, 0]
  return { pM, vM, pT, vT }
}

/** Манёвр убегающего: боковое ускорение в плоскости, перпендикулярной скорости.
 *  Зеркало sim.py::target_accel: вираж, петляя, «ножницы», «нырок», комбинация. */
export function runnerAccel(vT: number[], sc: ChaseScenario, t: number): number[] {
  if (sc.maneuver === 'straight' || sc.n_runner <= 0) return [0, 0, 0]
  // зеркальная погоня: тот же манёвр, отражённый через ось бега (y → −y)
  if (sc.mirror) {
    const a = runnerAccel([vT[0], -vT[1], vT[2]], { ...sc, mirror: false }, t)
    return [a[0], -a[1], a[2]]
  }
  let lift = unit(cross(vT, [0, 0, 1]))
  if (norm(lift) < 0.2) lift = unit(cross(vT, [0, 1, 0]))
  const n = sc.n_runner * G
  const vert = [0, 0, n]
  const m = sc.maneuver
  let a: number[]
  if (m === 'turn') {
    a = [lift[0] * n, lift[1] * n, lift[2] * n]
  } else if (m === 'weave') {
    const s = Math.sin((2 * Math.PI * t) / 4)
    a = [lift[0] * n * s, lift[1] * n * s, lift[2] * n * s]
  } else if (m === 'scissors') {
    const sign = Math.floor(t / 1.6) % 2 === 0 ? 1 : -1
    const frac = t % 1.6
    const front = Math.min(1, frac / 0.35, (1.6 - frac) / 0.35)
    a = [lift[0] * n * sign * front, lift[1] * n * sign * front, lift[2] * n * sign * front]
  } else if (m === 'dive') {
    // «плавно виляет»: широкая медленная волна вбок, взятая не на всю силу.
    // У стенда это был нырок вверх-вниз, но Шустрик — бегущий ребёнок, а не
    // самолёт. Волна именно плавная: если гнать её на всю перегрузку, Шустрик
    // оказывается быстрее тела любого догоняющего (у того предел 1,35 g) и не
    // даёт осалить даже тому, кто подглядывает истинную геометрию, — а это
    // уже не «плавное виляние», а тот же вираж на полном газу.
    const s = Math.sin((2 * Math.PI * t) / 6)
    const amp = n * 0.6
    a = [lift[0] * amp * s, lift[1] * amp * s, lift[2] * amp * s]
  } else {
    // combo: петли с рывками — то круче, то положе, всё по земле
    const sH = n * (0.6 + 0.4 * Math.sin((2 * Math.PI * t) / 5)) * (Math.sin((2 * Math.PI * t) / 3 + 1) > -0.3 ? 1 : -0.6)
    a = [lift[0] * sH, lift[1] * sH, lift[2] * sH]
  }
  void vert
  // бегун не летает: ускорение только по земле, высота не меняется
  a[2] = 0
  const mag = norm(a)
  if (mag > n && n > 0) a = a.map((x) => (x * n) / mag)
  const out = perp(a, vT)
  out[2] = 0
  return out
}

/** Команда «поворачивай туда, куда смотришь»: из пеленга (азимут и угол места
 *  в скоростной системе) — желаемое направление, из него — боковое ускорение.
 *  Построена по образцу sensorPnAccel() стенда. */
export function steerFromAngles(az: number, el: number, vM: number[], nMax: number, gain = 1): number[] {
  const x = unit(vM)
  let right = cross([0, 0, 1], x)
  if (norm(right) < 0.05) right = cross([0, 1, 0], x)
  right = unit(right)
  const up = unit(cross(x, right))
  const desired = unit([
    x[0] + right[0] * Math.tan(az) * gain + up[0] * Math.tan(el) * gain,
    x[1] + right[1] * Math.tan(az) * gain + up[1] * Math.tan(el) * gain,
    x[2] + right[2] * Math.tan(az) * gain + up[2] * Math.tan(el) * gain,
  ])
  const cur = unit(vM)
  const k = nMax * G
  return clip(
    perp([(desired[0] - cur[0]) * k, (desired[1] - cur[1]) * k, (desired[2] - cur[2]) * k], vM),
    nMax,
  )
}

/** Эталонное преследование по истинной геометрии: пропорциональное управление
 *  N=4 на линейной скорости сближения. Зеркало aPn стенда; служит учителем
 *  мухе и «глазами» честного читера. */
function oraclePn(omega: number[], vM: number[], nMax: number): number[] {
  return clip(perp(cross(omega, vM).map((x) => x * 4), vM), nMax)
}

export type LocalRunOpts = {
  pilot?: Pilot
  /** обучение мухи по ходу погони (только для pilot='fly') */
  learn?: boolean
  lr?: number
  /** предсказатель сети ребёнка: картинка → куда смотреть (рад) */
  predict?: (img: number[][]) => { az: number; el: number }
  /** подстройка детского пилота: упреждение по скорости пеленга и крутизна руления */
  kidLead?: number
  kidGain?: number
  /** записывать в кадр активность всех нейронов схемы (для экрана «Мозг») */
  recordCircuit?: boolean
  /** «Побудь мухой»: руль ребёнка в этот миг, −1…1 по обеим осям
   *  (yaw > 0 — вправо, pitch > 0 — вверх) */
  manual?: () => { yaw: number; pitch: number }
}

export function* localRun(sc: ChaseScenario, opts?: LocalRunOpts): Generator<GameFrame> {
  const pilot: Pilot = opts?.pilot ?? 'fly'
  const dt = 0.02
  const rng = makeRng(sc.seed)
  const { pM, vM, pT, vT } = spawn(sc)
  const mB: Body = { p: pM, v: vM }
  const tB: Body = { p: pT, v: vT }
  let t = 0
  let cpa = 1e9
  let prevAz = 0
  let prevEl = 0
  let prevSize = 0
  let prevTheta = 0
  let thetaWin: number[] = []
  let first = true
  // для детского пилота: упреждение по разности соседних предсказаний сети
  let kidPrevAz = 0
  let kidPrevEl = 0
  let kidFirst = true
  // рекуррентные состояния readout схемы v3 — зеркало navedenie/circuit.py:
  // t4/t5 — утечка полудолей потока, lc11 — квадраты направлений, lc10 — насыщенные положения
  const tau = 0.025
  const leak = (prev: number[], x: number[], tauS: number) =>
    prev.map((v, i) => (1 - dt / tauS) * v + (dt / tauS) * x[i])
  let t4 = [0, 0, 0, 0]
  let t5 = [0, 0, 0, 0]
  let lc11 = [0, 0, 0, 0]
  let lc10 = [0, 0]
  const halfFov = eyeHalfFov(sc.eye)
  const pathAcc = sc.path && sc.path.length >= 2 ? pathLengths(sc.path) : null
  // мозг из коннектома: своё состояние на каждую погоню
  const useCircuit = pilot === 'fly' && getFlyBrain() === 'connectome'
  const cst = useCircuit ? new CircuitState() : null
  const pop = { az: 0, el: 0, first: true }

  while (t < sc.t_max) {
    const r = sub(tB.p, mB.p)
    const vM = mB.v
    const vT = tB.v
    const rngM = norm(r)
    const vRel = sub(tB.v, mB.v)
    const vc = -dot(unit(r), vRel)
    const omega = cross(r, vRel).map((x) => x / (rngM * rngM + 1e-12)) as number[]

    const fwd = unit(mB.v)
    const worldUp = [0, 0, 1]
    let right = cross(worldUp, fwd)
    if (norm(right) < 0.05) right = cross([0, 1, 0], fwd)
    right = unit(right)
    const up = unit(cross(fwd, right))
    const u = unit(r)
    const ahead = dot(u, fwd)
    const truthAz = Math.atan2(dot(u, right), ahead)
    const truthEl = Math.atan2(dot(u, up), Math.hypot(ahead, dot(u, right)))

    // изображение → шум → декодирование: единственный источник углов для бойцов.
    // Кадр честный: в поле — полное пятно, чуть за краем — приглушённое, дальше — ноль.
    const size = Math.min(0.35, 0.55 / Math.max(rngM, 0.5))
    const losAng = Math.acos(Math.min(1, Math.max(-1, ahead)))
    const img = applyEyeExtras(applyEyeNoise(eyeImage(truthAz, truthEl, size, losAng, sc.eye), sc.eye, rng), sc.eye)
    const dec = decodeImage(img, sc.eye)
    const inFov = Math.abs(truthAz) <= halfFov && Math.abs(truthEl) <= halfFov
    let lock = dec.peak_rel > 0.25 && inFov
    if (lock && sc.lock_drop_p > 0 && rng() < sc.lock_drop_p) lock = false
    const az = lock ? dec.az : 0
    const el = lock ? dec.el : 0
    const azDot = first || !lock ? 0 : (az - prevAz) / dt
    const elDot = first || !lock ? 0 : (el - prevEl) / dt
    // фаза сближения: сглаживание декодированного размера + окно θ̇ (зеркало seeker.observe)
    const thetaTau = 0.06
    const rawTheta = lock ? dec.theta : 0
    const theta = rawTheta + (prevTheta - rawTheta) * Math.exp(-dt / thetaTau)
    thetaWin = [...thetaWin.slice(-5), theta]
    const winDt = Math.max((thetaWin.length - 1) * dt, dt)
    const thetaDot = Math.max(-5, Math.min(5, (thetaWin[thetaWin.length - 1] - thetaWin[0]) / winDt))
    prevAz = az
    prevEl = el
    prevTheta = theta

    const loom = Math.max(0, first ? 0 : (dec.size - prevSize) / dt) * 40
    const rho = Math.max(-10, Math.min(30, thetaDot / Math.max(theta, 1e-4)))
    // поток полудолей сетчатки и утечка состояний — как в circuit.step
    const nh = 8
    let gxImg = 0
    let gyImg = 0
    for (let row = 0; row < 16; row += 1) {
      let rHalf = 0
      let lHalf = 0
      let bHalf = 0
      let tHalf = 0
      for (let col = 0; col < 16; col += 1) {
        const v = img[row][col]
        if (col >= nh) rHalf += v
        else lHalf += v
        if (row >= nh) bHalf += v
        else tHalf += v
      }
      gxImg += (rHalf - lHalf) / (16 * nh)
      gyImg += (bHalf - tHalf) / (16 * nh)
    }
    const flow = [Math.max(-gxImg, 0), Math.max(gxImg, 0), Math.max(-gyImg, 0), Math.max(gyImg, 0)]
    t4 = leak(t4, flow, tau)
    t5 = leak(t5, [flow[3] * 0.4, flow[2] * 0.4, flow[1] * 0.4, flow[0] * 0.4], tau * 1.2)
    const quad = [
      Math.max(0, -az) * Math.max(0, -el),
      Math.max(0, az) * Math.max(0, -el),
      Math.max(0, -az) * Math.max(0, el),
      Math.max(0, az) * Math.max(0, el),
    ]
    lc11 = leak(lc11, quad.map((q) => Math.tanh(q * 8.0)), tau)
    lc10 = leak(lc10, [Math.tanh(el * 6.0), Math.tanh(az * 6.0)], tau)
    prevSize = dec.size
    first = false

    const aOracle = oraclePn(omega, vM, sc.n_max)
    let aCmd: number[]
    let lookAz: number
    let lookEl: number
    let brain: BrainReadout | undefined
    if (pilot === 'fly') {
      const gx = lock ? Math.tanh(azDot) : 0
      const gy = lock ? Math.tanh(elDot) : 0
      const feat = features(az, el, azDot, elDot, theta, loom, rho, gx, gy, lock)
      const readoutIn = [...feat, ...t4, ...t5, ...lc11, ...lc10]
      let cf: Float32Array | null = null
      if (cst) {
        cst.step(img, sc.eye, dt)
        cf = steerFeatures(cst, pop, dt)
      }
      if (opts?.learn && lock) {
        // учитель тренировки — «пеленг + упреждение по измеренным угловым
        // скоростям». Берётся только из того, что видит глаз (азимут/угол места
        // и их конечные разности), — поэтому линейному выходу реально это
        // выучить, в отличие от истинной геометрии, недоступной бойцам.
        const lead = 0.28
        const scale = 0.55
        const tPitch = Math.max(-1, Math.min(1, (el + lead * elDot) / scale))
        const tYaw = Math.max(-1, Math.min(1, (az + lead * azDot) / scale))
        // мозг из коннектома учится не здесь, а пробами (trainLocal.ts)
        if (!cf) sgd(readoutIn, [tPitch, tYaw], opts.lr ?? 0.03)
      }
      const { pitch, yaw } = cf ? readoutC(cf) : readout(readoutIn)
      // копии: состояния t4/t5/lc переставляются на следующем шаге, а кадр
      // должен рассказать правду про тот миг, когда мозг ещё рулил
      brain = { feat: [...feat], t4: [...t4], t5: [...t5], lc11: [...lc11], lc10: [...lc10], out: [pitch, yaw] }
      if (cst && opts?.recordCircuit) brain.circuit = Float32Array.from(cst.r)
      aCmd = clip(
        perp(
          add(
            up.map((x) => x * pitch * sc.n_max * G * sc.circuit_gain) as number[],
            right.map((x) => x * yaw * sc.n_max * G * sc.circuit_gain) as number[],
          ),
          vM,
        ),
        sc.n_max,
      )
      lookAz = az
      lookEl = el
    } else if (pilot === 'kid') {
      const pred = opts?.predict ? opts.predict(img) : { az: 0, el: 0 }
      // сеть выдаёт пеленг (его видно в кадре); упреждение добавляет пилот по
      // скорости пеленга — тот же приём, что у мухи, и он одинаков для обеих
      // решёток, поэтому сравнение глаз остаётся честным
      const kidLead = opts?.kidLead ?? 0.3
      const kAzDot = kidFirst ? 0 : (pred.az - kidPrevAz) / dt
      const kElDot = kidFirst ? 0 : (pred.el - kidPrevEl) / dt
      kidPrevAz = pred.az
      kidPrevEl = pred.el
      kidFirst = false
      aCmd = steerFromAngles(pred.az + kidLead * kAzDot, pred.el + kidLead * kElDot, vM, sc.n_max, opts?.kidGain ?? 1.4)
      lookAz = pred.az
      lookEl = pred.el
    } else if (pilot === 'manual') {
      // ребёнок рулит сам: руль — это доля предельной перегрузки, как у мухи.
      // Смотрит он туда же, куда видит глаз: другого окна у него нет
      const c = opts?.manual ? opts.manual() : { yaw: 0, pitch: 0 }
      const yaw = Math.max(-1, Math.min(1, c.yaw))
      const pitch = Math.max(-1, Math.min(1, c.pitch))
      aCmd = clip(
        perp(
          add(
            up.map((x) => x * pitch * sc.n_max * G) as number[],
            right.map((x) => x * yaw * sc.n_max * G) as number[],
          ),
          vM,
        ),
        sc.n_max,
      )
      lookAz = az
      lookEl = el
    } else {
      // «честный читер»: ведёт по истинной геометрии, которой глаз не даёт
      aCmd = aOracle
      lookAz = truthAz
      lookEl = truthEl
    }

    // шаг интеграции (|v| догоняющего сохраняется) и встреча
    const pM0 = [...mB.p]
    const pT0 = [...tB.p]
    const vM0 = [...mB.v]
    const vT0 = [...tB.v]
    if (pathAcc) {
      const r = runnerOnPath(sc, t + dt, pathAcc)
      tB.p = r.p
      tB.v = r.v
    } else integrate(tB, runnerAccel(vT, sc, t), dt)
    integrate(mB, aCmd, dt)
    const enc = stepEncounter(pM0, mB.p, pT0, tB.p, sc.tag_radius_m)
    cpa = Math.min(cpa, enc.cpa)

    let event: string | null = t < dt ? 'пуск' : null
    if (enc.hit) event = 'догнал'
    else if (t > 0.6 && vc < 0 && rngM > cpa + 2) event = 'промах'
    const errDeg =
      pilot === 'cheater'
        ? 0
        : inFov && (pilot === 'fly' || pilot === 'manual' ? lock : true)
          ? (Math.hypot(lookAz - truthAz, lookEl - truthEl) * 180) / Math.PI
          : null

    yield {
      t,
      chaser: pM0,
      runner: pT0,
      chaser_v: vM0,
      runner_v: vT0,
      range_m: rngM,
      image: img,
      lock,
      truth_az: truthAz,
      truth_el: truthEl,
      look_az: lookAz,
      look_el: lookEl,
      brain,
      look_err_deg: errDeg,
      in_fov: inFov,
      event,
    }

    if (event === 'догнал' || event === 'промах') return
    t += dt
  }
}

/** Мозг Огонька из настоящего коннектома FlyWire v783.
 *
 *  Схема собрана скриптом tools/connectome/build_circuit.py: колонки
 *  зрительной доли, питающие LC10a и LC11 (T2, T3, Tm5f, Tm25, Li01, Li15…),
 *  сами LC10a (нейроны погони самца за самкой) и LC11 (детекторы маленьких
 *  целей), их прямые выходы (оптический бугорок и др.) и нисходящие нейроны,
 *  по которым мозг командует телом. Около десяти тысяч клеток и восьмидесяти
 *  тысяч связей — ровно как в данных, ни одна связь не придумана.
 *
 *  Модель клетки простая (скорость разряда с утечкой), знак связи — по
 *  медиатору пресинаптической клетки: ацетилхолин возбуждает, ГАМК и
 *  глутамат тормозят. Сила связи — число синапсов, поделённое на все входы
 *  клетки.
 *
 *  Чего в данных нет — так это пути к мышцам крыльев: он идёт через брюшную
 *  нервную цепочку, а её в этом наборе нет. Поэтому последний шаг — «руль»:
 *  поворот туда, куда смотрят активные LC10a/LC11 (вектор популяции), и
 *  набор высоты по их выходам. В руле четыре числа; врождённые — по
 *  калибровке, дальше муха подстраивает их сама, пробами (trainLocal.ts). */

import raw from './data/circuit.json'
import { EYE_N, eyeAngles } from './eye'
import { eyeFingerprint, type EyeConfig } from './types'

type RawCircuit = {
  source: string
  types: string[]
  n: number
  neurons: { type: number[]; side: number[]; sign: number[]; role: number[] }
  xyz: string
  view: string
  pre: string
  post: string
  syn: string
}

function b64(s: string): ArrayBuffer {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out.buffer
}

export const ROLE = { input: 0, lc: 1, mid: 2, dn: 3 } as const

export type Circuit = {
  n: number
  types: string[]
  type: Uint16Array
  side: Uint8Array
  sign: Int8Array
  role: Uint8Array
  xyz: Int16Array
  /** направление взгляда, рад ×1000 (азимут, угол места); −32768 — нет */
  view: Int16Array
  pre: Uint16Array
  post: Uint16Array
  syn: Uint16Array
  /** исходящие связи по пресинаптической клетке (CSR) */
  outStart: Int32Array
  outPost: Uint16Array
  outW: Float32Array
  inputs: Int32Array
  dns: Int32Array
  /** индексы DN: сначала левые, потом правые — для врождённого руля */
  dnSide: Int8Array
  edges: number
  synapses: number
}

let CIRCUIT: Circuit | null = null

/** усиление связей: подобрано так, чтобы сигнал проходил все четыре слоя,
 *  но не разгонялся в насыщение */
const GAIN = 2.2

export function circuit(): Circuit {
  if (CIRCUIT) return CIRCUIT
  const r = raw as unknown as RawCircuit
  const n = r.n
  const pre = new Uint16Array(b64(r.pre))
  const post = new Uint16Array(b64(r.post))
  const syn = new Uint16Array(b64(r.syn))
  const sign = Int8Array.from(r.neurons.sign)
  const role = Uint8Array.from(r.neurons.role)
  const side = Uint8Array.from(r.neurons.side)
  // нормировка: сила связи — доля от всех входных синапсов клетки
  const inTotal = new Float32Array(n)
  for (let k = 0; k < pre.length; k += 1) inTotal[post[k]] += syn[k]
  const outCount = new Int32Array(n + 1)
  for (let k = 0; k < pre.length; k += 1) outCount[pre[k] + 1] += 1
  for (let i = 0; i < n; i += 1) outCount[i + 1] += outCount[i]
  const outStart = Int32Array.from(outCount)
  const fill = Int32Array.from(outCount)
  const outPost = new Uint16Array(pre.length)
  const outW = new Float32Array(pre.length)
  let synapses = 0
  for (let k = 0; k < pre.length; k += 1) {
    const p = pre[k]
    const q = post[k]
    const at = fill[p]
    fill[p] += 1
    outPost[at] = q
    outW[at] = (GAIN * sign[p] * syn[k]) / Math.max(inTotal[q], 1)
    synapses += syn[k]
  }
  const inputs: number[] = []
  const dnL: number[] = []
  const dnR: number[] = []
  for (let i = 0; i < n; i += 1) {
    if (role[i] === ROLE.input) inputs.push(i)
    if (role[i] === ROLE.dn) (side[i] === 0 ? dnL : dnR).push(i)
  }
  const dns = Int32Array.from([...dnL, ...dnR])
  // Выравнивание глаз по высоте: в данных FAFB левая зрительная доля неполна
  // снизу, и её колонки «смотрят» в основном вверх (медиана около +25°, у
  // правой — около 0°). Без поправки цель слева мозгу кажется выше, и муха
  // набирала высоту. Сдвигаем угол места левой стороны так, чтобы середины
  // глаз совпали; азимут не трогаем.
  const view = new Int16Array(b64(r.view))
  const medEl = (sd: number) => {
    const v: number[] = []
    for (let i = 0; i < n; i += 1) if (role[i] === ROLE.input && side[i] === sd && view[i * 2] !== -32768) v.push(view[i * 2 + 1])
    v.sort((a, b) => a - b)
    return v.length ? v[v.length >> 1] : 0
  }
  const shift = medEl(1) - medEl(0)
  for (let i = 0; i < n; i += 1) {
    if (side[i] === 0 && view[i * 2] !== -32768 && (role[i] === ROLE.input || role[i] === ROLE.lc)) {
      view[i * 2 + 1] = Math.max(-1571, Math.min(1571, view[i * 2 + 1] + shift))
    }
  }
  const dnSide = Int8Array.from([...dnL.map(() => -1), ...dnR.map(() => 1)])
  CIRCUIT = {
    n,
    types: r.types,
    type: Uint16Array.from(r.neurons.type),
    side,
    sign,
    role,
    xyz: new Int16Array(b64(r.xyz)),
    view,
    pre,
    post,
    syn,
    outStart,
    outPost,
    outW,
    inputs: Int32Array.from(inputs),
    dns,
    dnSide,
    edges: pre.length,
    synapses,
  }
  return CIRCUIT
}

export const circuitSource = () => (raw as unknown as RawCircuit).source

/* ── как кадр глаза ложится на колонки ─────────────────────────────── */

type Sampler = { i0: Int16Array; w: Float32Array }
const samplers = new Map<string, Sampler>()

/** Для каждой входной колонки — четыре соседних клеточка кадра 16×16 и их
 *  веса: колонка видит то место кадра, куда смотрит в настоящем глазу.
 *  Смотрит за пределы поля игрового глаза — видит темноту. */
function sampler(eye: EyeConfig): Sampler {
  const key = eyeFingerprint(eye)
  const hit = samplers.get(key)
  if (hit) return hit
  const c = circuit()
  const ax = eyeAngles(eye)
  const lo = ax[0]
  const hi = ax[EYE_N - 1]
  const frac = (a: number) => {
    if (a < lo || a > hi) return -1
    let i = 0
    while (i < EYE_N - 2 && ax[i + 1] < a) i += 1
    return i + (a - ax[i]) / (ax[i + 1] - ax[i])
  }
  const m = c.inputs.length
  const i0 = new Int16Array(m * 4).fill(-1)
  const w = new Float32Array(m * 4)
  for (let k = 0; k < m; k += 1) {
    const ni = c.inputs[k]
    const az = c.view[ni * 2] / 1000
    const el = c.view[ni * 2 + 1] / 1000
    const fx = frac(az)
    const fy = frac(el)
    if (fx < 0 || fy < 0) continue
    const x0 = Math.min(EYE_N - 2, Math.floor(fx))
    const y0 = Math.min(EYE_N - 2, Math.floor(fy))
    const u = fx - x0
    const v = fy - y0
    const cells = [
      [y0 * EYE_N + x0, (1 - u) * (1 - v)],
      [y0 * EYE_N + x0 + 1, u * (1 - v)],
      [(y0 + 1) * EYE_N + x0, (1 - u) * v],
      [(y0 + 1) * EYE_N + x0 + 1, u * v],
    ]
    cells.forEach(([idx, ww], q) => {
      i0[k * 4 + q] = idx
      w[k * 4 + q] = ww
    })
  }
  const s = { i0, w }
  samplers.set(key, s)
  return s
}

/* ── сама схема: состояние одной мухи ──────────────────────────────── */

const TAU = 0.03
const SUB = 2
/** сколько яркости кадра превращается во вход колонки */
const IN_GAIN = 3

/** счётчик вычислений: сколько умножений-сложений реально сделала схема */
let OPS = 0
let STEPS = 0
export function resetOpsCounter() {
  OPS = 0
  STEPS = 0
}
export const avgOpsPerFrame = () => (STEPS ? OPS / STEPS : 0)

export class CircuitState {
  readonly c = circuit()
  v = new Float32Array(this.c.n)
  r = new Float32Array(this.c.n)
  private acc = new Float32Array(this.c.n)
  private flat = new Float32Array(EYE_N * EYE_N)

  reset() {
    this.v.fill(0)
    this.r.fill(0)
  }

  /** Один кадр игры (dt секунд): кадр глаза → колонки → … → нисходящие. */
  step(img: number[][], eye: EyeConfig, dt: number) {
    const c = this.c
    const s = sampler(eye)
    // ламина вычитает фон и шум: колонка зажигается, только если точка
    // заметно ярче своего окружения. Фон — медиана кадра, шум — её разброс
    // (медианное отклонение); без этого помехи зажигали тысячи колонок
    let k = 0
    for (let j = 0; j < EYE_N; j += 1) for (let i = 0; i < EYE_N; i += 1) this.flat[k++] = img[j][i]
    const sorted = Array.from(this.flat).sort((a, b) => a - b)
    const med = sorted[sorted.length >> 1]
    const peak = sorted[sorted.length - 1]
    // шум — по тёмной половине кадра: Шустрика там нет, только помехи
    const lowDev = sorted.slice(0, sorted.length >> 1).map((x) => med - x).sort((a, b) => a - b)
    const sigma = 1.4826 * lowDev[lowDev.length >> 1]
    const bkg = med + Math.max(0.3 * (peak - med), 3 * sigma)
    const h = dt / SUB
    for (let sub = 0; sub < SUB; sub += 1) {
      const acc = this.acc
      acc.fill(0)
      // синаптический ток: идём только по активным клеткам — их мало
      let ops = 0
      for (let p = 0; p < c.n; p += 1) {
        const rp = this.r[p]
        if (rp <= 1e-4) continue
        for (let e = c.outStart[p]; e < c.outStart[p + 1]; e += 1) acc[c.outPost[e]] += c.outW[e] * rp
        ops += c.outStart[p + 1] - c.outStart[p]
      }
      // входы колонок (4 клеточка на колонку) и обновление каждой клетки
      OPS += ops + c.inputs.length * 4 + c.n
      for (let q = 0; q < c.inputs.length; q += 1) {
        let x = 0
        for (let z = 0; z < 4; z += 1) {
          const idx = s.i0[q * 4 + z]
          if (idx >= 0) x += s.w[q * 4 + z] * Math.max(0, this.flat[idx] - bkg)
        }
        acc[c.inputs[q]] += IN_GAIN * x
      }
      const a = h / TAU
      const off = SILENT.size > 0 ? groupOf() : null
      for (let i = 0; i < c.n; i += 1) {
        this.v[i] += a * (acc[i] - this.v[i])
        const x = this.v[i]
        this.r[i] = x > 0 && !(off && SILENT.has(off[i])) ? Math.tanh(x) : 0
      }
    }
    STEPS += 1
  }

  /** активность нисходящих нейронов: сначала левые, потом правые */
  dnRates(out = new Float32Array(this.c.dns.length)) {
    for (let k = 0; k < this.c.dns.length; k += 1) out[k] = this.r[this.c.dns[k]]
    return out
  }

  /** средняя активность по ролям — для экрана «Мозг» */
  roleMeans(): [number, number, number, number] {
    const s = [0, 0, 0, 0]
    const n = [0, 0, 0, 0]
    for (let i = 0; i < this.c.n; i += 1) {
      s[this.c.role[i]] += this.r[i]
      n[this.c.role[i]] += 1
    }
    return s.map((v, i) => v / Math.max(1, n[i])) as [number, number, number, number]
  }
}

/* ── куда «смотрят» нейроны за LC ──────────────────────────────────────
 * У колонок и LC направление взгляда восстановлено по связям ещё при сборке.
 * Дальше его так же переносим по возбуждающим связям: нейрон смотрит туда,
 * куда в среднем смотрят те, кто его возбуждает. Получается карта «этот
 * нейрон отвечает за цель слева-сверху» — по ней и строится врождённый руль:
 * поворот туда, куда смотрят активные нейроны (вектор популяции). */

let VIEW_ALL: { az: Float32Array; el: Float32Array; known: Uint8Array } | null = null

export function allViews() {
  if (VIEW_ALL) return VIEW_ALL
  const c = circuit()
  const vx = new Float32Array(c.n)
  const vy = new Float32Array(c.n)
  const vz = new Float32Array(c.n)
  const known = new Uint8Array(c.n)
  for (let i = 0; i < c.n; i += 1) {
    if (c.view[i * 2] === -32768) continue
    const az = c.view[i * 2] / 1000
    const el = c.view[i * 2 + 1] / 1000
    vx[i] = Math.cos(el) * Math.cos(az)
    vy[i] = Math.cos(el) * Math.sin(az)
    vz[i] = Math.sin(el)
    known[i] = 1
  }
  for (let pass = 0; pass < 6; pass += 1) {
    const ax = new Float32Array(c.n)
    const ay = new Float32Array(c.n)
    const az = new Float32Array(c.n)
    for (let k = 0; k < c.edges; k += 1) {
      const p = c.pre[k]
      if (!known[p] || c.sign[p] <= 0) continue
      const q = c.post[k]
      const w = c.syn[k]
      ax[q] += vx[p] * w
      ay[q] += vy[p] * w
      az[q] += vz[p] * w
    }
    for (let q = 0; q < c.n; q += 1) {
      if (c.role[q] < ROLE.mid) continue
      const m = Math.hypot(ax[q], ay[q], az[q])
      if (m < 1e-6) continue
      vx[q] = ax[q] / m
      vy[q] = ay[q] / m
      vz[q] = az[q] / m
      known[q] = 1
    }
  }
  const A = new Float32Array(c.n)
  const E = new Float32Array(c.n)
  for (let i = 0; i < c.n; i += 1) {
    A[i] = Math.atan2(vy[i], vx[i])
    E[i] = Math.asin(Math.max(-1, Math.min(1, vz[i])))
  }
  VIEW_ALL = { az: A, el: E, known }
  return VIEW_ALL
}

/* ── руль: нисходящие нейроны → поворот ────────────────────────────────
 * Вход руля: «вектор популяции» (куда смотрят активные DN — азимут и угол
 * места), его изменение за кадр (так мозг замечает, куда цель уплывает), и
 * сами активности всех DN. Врождённо работает только вектор популяции —
 * поворот туда, куда смотрят активные. Остальное муха доучивает сама. */

export const POP = 4
/** Врождённая настройка руля — две константы усиления, посчитанные по
 *  калибровке, а не по поимкам: вектор популяции LC10a/LC11 показывает
 *  ~0,86 настоящего азимута (1,15 / 0,86 ≈ 1,4), выходы LC по высоте —
 *  ~0,49 (1,15 / 0,49 ≈ 2,3). 1,15 — тот же коэффициент, что у прежнего
 *  упрощённого контура. */
export const YAW_GAIN = 1.4
/** высоту держат колонки глаза: у них угол места читается точнее всего
 *  (наклон ~0,75 → 1,15 / 0,75 ≈ 1,5). Выходы LC вблизи цели метались и,
 *  проскочив над Шустриком, звали муху вверх */
export const PITCH_GAIN = 1.5
export const PITCH_ROLE: number = ROLE.input
/** поворот слушает LC10a/LC11: по Hindmarsh Sten et al., Nature 2021,
 *  удержание самки в поле зрения почти целиком объясняется сигналом LC10a */
export const YAW_ROLE: number = ROLE.lc

/** Вход руля: куда смотрят активные LC10a/LC11 (азимут) и активные колонки
 *  глаза (высота: нисходящие нейроны этого пути её почти не несут), как это
 *  меняется от кадра к кадру, и активности нисходящих нейронов (для показа). */
export type PopState = { az: number; el: number; first: boolean; dAz?: number; dEl?: number }
export function steerFeatures(st: CircuitState, prev: PopState, dt: number, out?: Float32Array) {
  const c = st.c
  const v = allViews()
  const nd = c.dns.length
  const f = out ?? new Float32Array(POP + nd + 1)
  let s = 0
  let sa = 0
  for (let k = 0; k < nd; k += 1) f[POP + k] = st.r[c.dns[k]]
  for (let i = 0; i < c.n; i += 1) {
    if (c.role[i] !== YAW_ROLE || !v.known[i]) continue
    const r = st.r[i]
    if (r <= 0) continue
    s += r
    sa += r * v.az[i]
  }
  let sm = 0
  let se = 0
  for (let i = 0; i < c.n; i += 1) {
    if (c.role[i] !== PITCH_ROLE || !v.known[i]) continue
    const r = st.r[i]
    if (r <= 0) continue
    sm += r
    se += r * v.el[i]
  }
  const live = s > 0.02
  const az = live ? sa / s : 0
  const el = sm > 0.02 ? se / sm : 0
  // скорость ухода цели — сглаженная: у живого нейрона тоже есть инерция,
  // а мгновенная разность прыгала бы, когда клетки зажигаются и гаснут
  const rawAz = prev.first || !live ? 0 : (az - prev.az) / dt
  const rawEl = prev.first || sm <= 0.02 ? 0 : (el - prev.el) / dt
  const k = 1 - Math.exp(-dt / 0.08)
  const dAz = (prev.dAz ?? 0) + k * (rawAz - (prev.dAz ?? 0))
  const dEl = (prev.dEl ?? 0) + k * (rawEl - (prev.dEl ?? 0))
  prev.dAz = dAz
  prev.dEl = dEl
  prev.az = az
  prev.el = el
  prev.first = false
  f[0] = Math.tanh(az * 3)
  f[1] = Math.tanh(el * 3)
  f[2] = Math.tanh(dAz * 0.4)
  f[3] = Math.tanh(dEl * 0.4)
  f[POP + nd] = live ? 1 : 0
  return f
}

const NF = () => POP + circuit().dns.length + 1

function innateCW(): Float32Array[] {
  const w = [new Float32Array(NF()), new Float32Array(NF())]
  // врождённо: тангаж — по углу места популяции, рыскание — по её азимуту
  w[0][1] = PITCH_GAIN
  w[1][0] = YAW_GAIN
  return w
}

let CW = innateCW()
let cTrained = false

export function resetConnectomeReadout() {
  CW = innateCW()
  cTrained = false
}
export function markConnectomeTrained() {
  cTrained = true
}
export const connectomeTrained = () => cTrained
export const connectomeW = () => CW
export const innateConnectomeW = () => innateCW()

export function readoutC(f: Float32Array): { pitch: number; yaw: number } {
  let p = 0
  let y = 0
  for (let i = 0; i < f.length; i += 1) {
    p += CW[0][i] * f[i]
    y += CW[1][i] * f[i]
  }
  return { pitch: Math.tanh(p), yaw: Math.tanh(y) }
}

/** Четыре числа руля, которые муха подстраивает пробами:
 *  [сила поворота, сила набора высоты, упреждение поворота, упреждение высоты]. */
export function getSteer(): number[] {
  return [CW[1][0], CW[0][1], CW[1][2], CW[0][3]]
}
export function setSteer(p: number[]) {
  CW[1][0] = p[0]
  CW[0][1] = p[1]
  CW[1][2] = p[2]
  CW[0][3] = p[3]
}
/** сколько чисел муха учит (остальное — связи из коннектома, их не учат) */
export const LEARNED_PARAMS = 4

/* ── группы для показа и для «Выключи нейрон» ──────────────────────── */

export type Group = { key: string; name: string; kid: string; what: string; color: [number, number, number] }

export const GROUPS: Group[] = [
  { key: 'cols', name: 'колонки глаза', kid: 'колонки глаза', what: 'клетки зрительной доли (T2, T3, Tm5f, Tm25, Li01, Li15…): каждая смотрит в свою точку и замечает маленькое пятно', color: [0.36, 0.71, 1.0] },
  { key: 'lc10a', name: 'LC10a — нейроны погони', kid: 'нейроны погони', what: 'по ним самец дрозофилы держит самку в поле зрения, когда ухаживает', color: [1.0, 0.55, 0.2] },
  { key: 'lc11', name: 'LC11 — детекторы мелочи', kid: 'детекторы мелочи', what: 'срабатывают на маленькую движущуюся цель — муху вдалеке', color: [1.0, 0.82, 0.25] },
  { key: 'mid', name: 'выходы LC', kid: 'выходы', what: 'оптический бугорок и соседи: собирают сигналы LC и передают дальше', color: [0.55, 0.85, 0.45] },
  { key: 'dn', name: 'нисходящие нейроны', kid: 'команды телу', what: 'посылают команды из мозга в тело — к крыльям и ногам', color: [0.85, 0.45, 0.95] },
]

let GROUP_OF: Uint8Array | null = null
export function groupOf(): Uint8Array {
  if (GROUP_OF) return GROUP_OF
  const c = circuit()
  const g = new Uint8Array(c.n)
  const lc10a = c.types.indexOf('LC10a')
  for (let i = 0; i < c.n; i += 1) {
    if (c.role[i] === ROLE.input) g[i] = 0
    else if (c.role[i] === ROLE.lc) g[i] = c.type[i] === lc10a ? 1 : 2
    else if (c.role[i] === ROLE.mid) g[i] = 3
    else g[i] = 4
  }
  GROUP_OF = g
  return g
}

/** «Выключи нейрон»: выключенные группы молчат, как при настоящем нокауте. */
let SILENT = new Set<number>()
export function setSilenced(groups: Set<number>) {
  SILENT = new Set(groups)
}
export const silenced = () => SILENT

/** средняя активность по группам — для подписи «что светится сейчас» */
export function groupMeans(r: Float32Array): number[] {
  const g = groupOf()
  const s = GROUPS.map(() => 0)
  const n = GROUPS.map(() => 0)
  for (let i = 0; i < r.length; i += 1) {
    s[g[i]] += r[i]
    n[g[i]] += 1
  }
  return s.map((v, k) => v / Math.max(1, n[k]))
}

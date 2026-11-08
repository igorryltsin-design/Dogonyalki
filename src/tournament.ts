/** Турнир: муха против сетей из «обычного» машинного зрения.
 *
 *  Одна кнопка делает всё по-честному и по порядку:
 *  1) собирает карточки «кадр → куда смотреть» под выбранный глаз (те же, что
 *     на экране «Глаз»);
 *  2) учит на них три сети: полносвязную, свёрточную и
 *     детектор-тепловую карту — одни и те же карточки, один и тот же пилот;
 *  3) тренирует муху на погонях — без карточек и без правильных ответов:
 *     её учитель — её же глаз (см. localRun, ветка learn);
 *  4) меряет всех одинаково.
 *
 *  Меры — не только «сколько поймал». Сила биологического решения в цене:
 *  сколько весов, сколько вычислений на решение, сколько примеров с ответом
 *  понадобилось, как держит помехи и новую, незнакомую погоню. Где сети
 *  сильнее — турнир показывает это так же прямо. */

import { localRun, type LocalRunOpts } from './localSim'
import { chaseVariant, sprintVariant } from './scenarios'
import { collectCards, loadCards, saveCards, type CardDataset } from './cards'
import { initNet, loadNet, predictAzEl, saveNet, trainOnCards, KID_HIDDEN, KID_INPUT, KID_OUTPUT, type KidNet } from './kidBrain'
import { CNN_OPS, CNN_PARAMS, DET_OPS, DET_PARAMS, cnnPredict, detPredict, initCnn, initDet, saveRival, trainCnn, trainDet, type CnnNet, type DetNet } from './rivals'
import { READOUT, getFlyBrain } from './brain'
import { LEARNED_PARAMS, avgOpsPerFrame, circuit, resetOpsCounter } from './connectome'
import { TRIAL_CHASES, TRIAL_ITERS } from './trainLocal'
import { resetFly, trainFly } from './trainLocal'
import { eyeFingerprint, type ChaseScenario, type EyeConfig, type Pilot } from './types'
import { yieldToUi } from './yield'
import { makeRng } from './rng'
import { precomputed } from './precomputed'

export type ContenderKey = 'innate' | 'trained' | 'mlp' | 'cnn' | 'det' | 'cheater'

export type ContenderInfo = {
  key: ContenderKey
  name: string
  short: string
  color: string
  /** биологическая или «обычная» сеть — для подписей и группировки */
  family: 'bio' | 'ann' | 'ref'
  how: string
}

export const CONTENDERS: ContenderInfo[] = [
  { key: 'innate', name: 'Огонёк врождённый', short: 'Муха-врожд.', color: '#0e6b46', family: 'bio', how: 'мозг из коннектома FlyWire, ничему не учился' },
  { key: 'trained', name: 'Огонёк после тренировки', short: 'Муха', color: '#3fb06c', family: 'bio', how: 'тот же мозг, сам подстроил 4 числа руля пробами' },
  { key: 'mlp', name: 'Полносвязная сеть', short: 'Полносвязная', color: '#2f6fd0', family: 'ann', how: '256 → 16 → 2, каждый клеточек к каждому' },
  { key: 'cnn', name: 'Свёрточная сеть', short: 'Свёрточная', color: '#e0662a', family: 'ann', how: 'фильтры 3×3, как в распознавании картинок' },
  { key: 'det', name: 'Сеть-детектор', short: 'Детектор', color: '#a03fb0', family: 'ann', how: 'рисует карту «где цель», как YOLO/CenterNet' },
  { key: 'cheater', name: 'Честный читер', short: 'Читер', color: '#b8860b', family: 'ref', how: 'подглядывает дальность и скорость — потолок' },
]

export const contenderInfo = (k: ContenderKey) => CONTENDERS.find((c) => c.key === k)!

/** Помехи, на которых проверяется стойкость (доля, как ручка в шапке). */
export const NOISE_LEVELS = [0, 0.3, 0.6, 0.9]
export const RUNS = 10

/** Вычисления мухи на один кадр — оценка сверху по коду localSim/eye:
 *  декодер кадра (медиана фона, очистка, поток, центроид, подгонка осей
 *  ≈ 8 проходов по 256 клеточкам) + признаки + выход 2×24. */
export const FLY_OPS = 256 * 8 + 4 * 16 * 16 + 2 * READOUT + 60
export const FLY_PARAMS = 2 * READOUT
export const MLP_PARAMS = KID_INPUT * KID_HIDDEN + KID_HIDDEN + KID_HIDDEN * KID_OUTPUT + KID_OUTPUT
export const MLP_OPS = KID_INPUT * KID_HIDDEN + KID_HIDDEN * KID_OUTPUT

export { sprintVariant }

export type ContenderResult = {
  key: ContenderKey
  catches: number
  meanErrDeg: number | null
  /** поимки на каждом уровне помех из NOISE_LEVELS */
  noise: number[]
  /** поимки в незнакомой погоне */
  transfer: number
  params: number
  /** весов, которые реально что-то делают (не ноль) */
  liveParams: number
  opsPerFrame: number
  /** примеров с правильным ответом, увиденных при обучении */
  labelled: number
  /** погонь, потраченных на учёбу (сбор карточек или тренировку) */
  trainChases: number
  /** связей, которые боец не учит, а получил готовыми (коннектом мухи) */
  fixedWeights?: number
  trainMs: number
}

export type TrainedNets = { mlp: KidNet; cnn: CnnNet; det: DetNet }

export type TournamentResult = {
  /** обученные сети — только для заранее посчитанных данных, в браузере не хранятся */
  nets?: TrainedNets
  fingerprint: string
  eye: EyeConfig
  rows: ContenderResult[]
  cards: number
  date: string
}

type Runner = { pilot: Pilot; predict?: LocalRunOpts['predict'] }

async function evalOn(r: Runner, scenarios: ChaseScenario[]) {
  let catches = 0
  let err = 0
  let errN = 0
  for (const sc of scenarios) {
    for (const fr of localRun(sc, { pilot: r.pilot, predict: r.predict })) {
      if (fr.look_err_deg !== null) {
        err += fr.look_err_deg
        errN += 1
      }
      if (fr.event === 'догнал') catches += 1
    }
    await yieldToUi()
  }
  return { catches, meanErrDeg: errN ? err / errN : null }
}

async function measure(r: Runner, eye: EyeConfig) {
  const std = await evalOn(r, Array.from({ length: RUNS }, (_, i) => chaseVariant(i, eye)))
  const noise: number[] = []
  for (const lvl of NOISE_LEVELS) {
    const e = { ...eye, noisePct: lvl }
    noise.push(lvl === eye.noisePct ? std.catches : (await evalOn(r, Array.from({ length: RUNS }, (_, i) => chaseVariant(i, e)))).catches)
  }
  const tr = await evalOn(r, Array.from({ length: RUNS }, (_, i) => sprintVariant(i, eye)))
  return { ...std, noise, transfer: tr.catches }
}

export type StageFn = (stage: string, frac: number) => void

// у всех, кто учится на карточках, одинаковый бюджет — 40 проходов, как у
// полносвязной сети; раньше свёрточной и детектору доставалось 24
export async function runTournament(eye: EyeConfig, onStage: StageFn = () => {}, epochs = 40): Promise<TournamentResult> {
  const fp = eyeFingerprint(eye)
  const rows: ContenderResult[] = []

  onStage('собираю карточки «кадр → куда смотреть»', 0.02)
  let ds: CardDataset | null = loadCards(eye)
  const CARD_EPISODES = 24
  if (!ds) {
    ds = await collectCards(eye, CARD_EPISODES, (d, t) => onStage('собираю карточки', 0.02 + 0.08 * (d / t)))
    saveCards(ds)
  }
  const cards = ds.train
  const labelled = cards.length * 1

  // ── муха врождённая
  onStage('проверяю врождённую муху', 0.12)
  resetFly()
  const conn = getFlyBrain() === 'connectome'
  resetOpsCounter()
  const mInn = await measure({ pilot: 'fly' }, eye)
  // у мозга из коннектома вычисления не оцениваются, а считаются по факту
  const flyOps = conn ? Math.round(avgOpsPerFrame()) : FLY_OPS
  const flyParams = conn ? LEARNED_PARAMS : FLY_PARAMS
  const fixedWeights = conn ? circuit().edges : undefined
  rows.push({ key: 'innate', ...mInn, params: flyParams, liveParams: conn ? LEARNED_PARAMS : 2, opsPerFrame: flyOps, labelled: 0, trainChases: 0, trainMs: 0, fixedWeights })

  // ── муха тренированная: учитель — её же глаз, правильных ответов нет
  onStage('муха тренируется на погонях', 0.2)
  let t0 = performance.now()
  const FLY_EPISODES = 30
  const pts = await trainFly(eye, FLY_EPISODES, (ep, tot) => onStage('муха тренируется на погонях', 0.2 + 0.12 * (ep / tot)))
  const flyMs = performance.now() - t0
  const lastW = pts[pts.length - 1]?.w ?? []
  onStage('проверяю тренированную муху', 0.33)
  const mTr = await measure({ pilot: 'fly' }, eye)
  rows.push({
    key: 'trained',
    ...mTr,
    params: flyParams,
    liveParams: conn ? LEARNED_PARAMS : lastW.filter((w) => Math.abs(w) > 1e-3).length,
    opsPerFrame: flyOps,
    labelled: 0,
    trainChases: conn ? TRIAL_CHASES.length * (TRIAL_ITERS + 1) : FLY_EPISODES,
    trainMs: flyMs,
    fixedWeights,
  })

  // ── полносвязная сеть
  onStage('учу полносвязную сеть', 0.4)
  t0 = performance.now()
  const mlp = initNet(7, fp)
  await trainOnCards(mlp, cards, { eye, epochs: 40, onProgress: (p) => onStage('учу полносвязную сеть', 0.4 + 0.12 * (p.epoch / p.epochs)) })
  const mlpMs = performance.now() - t0
  const kidNow = loadNet()
  if (!kidNow?.trained || kidNow.fingerprint !== fp) saveNet(mlp)
  onStage('проверяю полносвязную сеть', 0.52)
  const mMlp = await measure({ pilot: 'kid', predict: (img) => predictAzEl(mlp, img, eye) }, eye)
  rows.push({ key: 'mlp', ...mMlp, params: MLP_PARAMS, liveParams: MLP_PARAMS, opsPerFrame: MLP_OPS, labelled, trainChases: CARD_EPISODES, trainMs: mlpMs })

  // ── свёрточная
  onStage('учу свёрточную сеть', 0.58)
  t0 = performance.now()
  const cnn = initCnn()
  await trainCnn(cnn, cards, eye, { epochs, onEpoch: (ep, tot) => onStage('учу свёрточную сеть', 0.58 + 0.12 * (ep / tot)) })
  cnn.fingerprint = fp
  saveRival(cnn)
  const cnnMs = performance.now() - t0
  onStage('проверяю свёрточную сеть', 0.7)
  const mCnn = await measure({ pilot: 'kid', predict: (img) => cnnPredict(cnn, img, eye) }, eye)
  rows.push({ key: 'cnn', ...mCnn, params: CNN_PARAMS, liveParams: CNN_PARAMS, opsPerFrame: CNN_OPS, labelled, trainChases: CARD_EPISODES, trainMs: cnnMs })

  // ── детектор
  onStage('учу сеть-детектор', 0.76)
  t0 = performance.now()
  const det = initDet()
  await trainDet(det, cards, eye, { epochs, onEpoch: (ep, tot) => onStage('учу сеть-детектор', 0.76 + 0.12 * (ep / tot)) })
  det.fingerprint = fp
  saveRival(det)
  const detMs = performance.now() - t0
  onStage('проверяю сеть-детектор', 0.88)
  const mDet = await measure({ pilot: 'kid', predict: (img) => detPredict(det, img, eye) }, eye)
  rows.push({ key: 'det', ...mDet, params: DET_PARAMS, liveParams: DET_PARAMS, opsPerFrame: DET_OPS, labelled, trainChases: CARD_EPISODES, trainMs: detMs })

  // ── читер — потолок
  onStage('читер подглядывает', 0.95)
  const mCh = await measure({ pilot: 'cheater' }, eye)
  rows.push({ key: 'cheater', ...mCh, params: 0, liveParams: 0, opsPerFrame: 0, labelled: 0, trainChases: 0, trainMs: 0 })

  onStage('готово', 1)
  return { fingerprint: fp, eye, rows, cards: cards.length, date: new Date().toISOString(), nets: { mlp, cnn, det } }
}

/* ── «паутинка»: шесть осей, на каждой 0…1 и «больше — лучше» ── */

export type Axis = { key: string; name: string; hint: string; value: (r: ContenderResult) => number }

const logScore = (v: number, lo: number, hi: number) =>
  v <= lo ? 1 : Math.max(0, 1 - Math.log10(v / lo) / Math.log10(hi / lo))

export const AXES: Axis[] = [
  { key: 'catch', name: 'Ловкость', hint: 'поимки из 10 в обычной погоне', value: (r) => r.catches / RUNS },
  { key: 'transfer', name: 'Смекалка', hint: 'поимки в незнакомой погоне: Шустрик быстрее и хитрее', value: (r) => r.transfer / RUNS },
  {
    key: 'noise',
    name: 'Стойкость',
    hint: 'поимки в среднем по всем уровням помех',
    value: (r) => r.noise.reduce((s, v) => s + v, 0) / (RUNS * r.noise.length),
  },
  { key: 'params', name: 'Лёгкость', hint: 'чем меньше чисел приходится учить, тем больше балл (готовые связи из коннектома не в счёт — их не учат)', value: (r) => logScore(Math.max(r.params, 1), 20, 20000) },
  { key: 'ops', name: 'Экономность', hint: 'чем меньше вычислений на кадр, тем больше балл', value: (r) => logScore(Math.max(r.opsPerFrame, 1), 1000, 50000) },
  {
    key: 'labels',
    name: 'Сам учится',
    hint: 'учился без подсказок: меньше карточек с правильным ответом — больше балл',
    value: (r) => (r.labelled === 0 ? 1 : logScore(r.labelled, 10, 10000)),
  },
]

// v2: Шустрик бегает по земле — турниры, посчитанные раньше, устарели
// v3: свёрточная сеть с полями и равный бюджет — старые итоги не годятся
const STORE = 'dogonjalki-tournament-v3'

export function saveTournament(t: TournamentResult) {
  try {
    const { nets: _skip, ...light } = t
    void _skip
    localStorage.setItem(`${STORE}:${t.fingerprint}`, JSON.stringify(light))
  } catch {
    /* приватный режим */
  }
}

/** Свой турнир из этого браузера, а нет — заранее посчитанный (тот же
 *  движок и те же зёрна, см. tools/precompute.ts): малышам не ждать полминуты. */
export function loadTournament(eye: EyeConfig): TournamentResult | null {
  try {
    const raw = localStorage.getItem(`${STORE}:${eyeFingerprint(eye)}`)
    if (raw) return JSON.parse(raw) as TournamentResult
  } catch {
    /* приватный режим */
  }
  return precomputed().tournaments[eyeFingerprint(eye)] ?? null
}

/* ── «Сколько нужно подсказок?» ──────────────────────────────────────
 * Сети учатся на 25, 100, 400 и всех карточках с ответами; муха — ни на
 * одной. Для каждого размера — поимки из десяти в обычной погоне. Карточки
 * берутся случайной, но воспроизводимой выборкой из одной и той же учебной
 * кучи, поэтому меньшая выборка — честная часть большей. */

export const CURVE_SIZES = [25, 100, 400]

export type CurvePoint = { cards: number; catches: number }
export type ExamplesCurve = {
  fingerprint: string
  fly: number
  nets: Record<'mlp' | 'cnn' | 'det', CurvePoint[]>
}

async function catchesOf(r: Runner, eye: EyeConfig) {
  return (await evalOn(r, Array.from({ length: RUNS }, (_, i) => chaseVariant(i, eye)))).catches
}

export async function examplesCurve(eye: EyeConfig, onStage: StageFn = () => {}): Promise<ExamplesCurve> {
  const fp = eyeFingerprint(eye)
  onStage('собираю карточки', 0.02)
  let ds = loadCards(eye)
  if (!ds) {
    ds = await collectCards(eye, 24)
    saveCards(ds)
  }
  const all = ds.train
  // воспроизводимая перетасовка: первые N — выборка размера N
  const rng = makeRng(2024)
  const order = all.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const sizes = [...CURVE_SIZES.filter((n) => n < all.length), all.length]
  const nets: ExamplesCurve['nets'] = { mlp: [], cnn: [], det: [] }
  let done = 0
  const total = sizes.length * 3 + 1
  for (const n of sizes) {
    const cards = order.slice(0, n).map((i) => all[i])
    // мало карточек — больше проходов, чтобы сеть успела выучить то, что есть
    const ep = Math.min(200, Math.round(40 * Math.sqrt(all.length / n)))
    onStage(`полносвязная сеть учится на ${n} карточках`, done / total)
    const mlp = initNet(7, fp)
    await trainOnCards(mlp, cards, { eye, epochs: Math.min(200, Math.round(40 * Math.sqrt(all.length / n))) })
    nets.mlp.push({ cards: n, catches: await catchesOf({ pilot: 'kid', predict: (img) => predictAzEl(mlp, img, eye) }, eye) })
    done += 1
    onStage(`свёрточная сеть учится на ${n} карточках`, done / total)
    const cnn = initCnn()
    await trainCnn(cnn, cards, eye, { epochs: ep })
    nets.cnn.push({ cards: n, catches: await catchesOf({ pilot: 'kid', predict: (img) => cnnPredict(cnn, img, eye) }, eye) })
    done += 1
    onStage(`сеть-детектор учится на ${n} карточках`, done / total)
    const det = initDet()
    await trainDet(det, cards, eye, { epochs: ep })
    nets.det.push({ cards: n, catches: await catchesOf({ pilot: 'kid', predict: (img) => detPredict(det, img, eye) }, eye) })
    done += 1
  }
  onStage('муха тренируется без карточек', done / total)
  resetFly()
  await trainFly(eye, 30)
  const fly = await catchesOf({ pilot: 'fly' }, eye)
  onStage('готово', 1)
  return { fingerprint: fp, fly, nets }
}

const CURVE_STORE = 'dogonjalki-curve-v3'
export function saveCurve(c: ExamplesCurve) {
  try {
    localStorage.setItem(`${CURVE_STORE}:${c.fingerprint}`, JSON.stringify(c))
  } catch {
    /* приватный режим */
  }
}
export function loadCurve(eye: EyeConfig): ExamplesCurve | null {
  try {
    const raw = localStorage.getItem(`${CURVE_STORE}:${eyeFingerprint(eye)}`)
    if (raw) return JSON.parse(raw) as ExamplesCurve
  } catch {
    /* приватный режим */
  }
  return precomputed().curves[eyeFingerprint(eye)] ?? null
}

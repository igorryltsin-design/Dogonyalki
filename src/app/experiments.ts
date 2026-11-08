/** Опыты для урока: «Почини муху», «Эволюция», «Собери свой глаз»,
 *  «Научи робота сам» и «Обмани робота». Здесь только расчёты — экраны в
 *  src/screens/ExperimentsScreen.tsx. Все опыты идут по тем же десяти
 *  погоням, что доска, турнир и лаборатория (chaseVariant 0–9), поэтому
 *  цифры сравнимы между собой; учебные погони — отдельные (10 и дальше). */

import { runContest } from '../board'
import { PITCH_GAIN, YAW_GAIN, getSteer, markConnectomeTrained, setSilenced, setSteer } from '../connectome'
import { collectCards, loadCards, saveCards } from '../cards'
import { initNet, predictAzEl, trainOnCards, gazeErrorDeg, type KidNet } from '../kidBrain'
import { detPredict } from '../rivals'
import { pretrainedNets } from '../precomputed'
import { localRun } from '../localSim'
import { chaseVariant } from '../scenarios'
import { gaussOf, makeRng } from '../rng'
import { EYE_FLY, type CardRec, type EyeConfig } from '../types'
import { yieldToUi } from '../yield'

export const RUNS = 10

/* ── «Почини муху» ─────────────────────────────────────────────────────
 * Учитель (или игра) тайно ломает одну часть мухи — муха перестаёт ловить.
 * Класс проверяет догадки: «чиним» одну часть и смотрим, ловит ли снова.
 * Поломки взяты только такие, что действительно валят муху до нуля (это
 * проверено движком): выключение одной группы LC муху не ломает — соседняя
 * подстраховывает, — поэтому такой поломки в игре нет. */

export type FaultId = 'cols' | 'lc' | 'yaw' | 'pitch' | 'flip'

export const FAULTS: { id: FaultId; fix: string; icon: string; what: string }[] = [
  { id: 'cols', icon: '🔷', fix: 'оживить колонки глаза', what: 'Молчали колонки глаза: сигнал от картинки не шёл дальше — муха ослепла.' },
  { id: 'lc', icon: '🎯', fix: 'оживить нейроны погони', what: 'Молчали нейроны погони и детекторы мелочи: глаз видел, но мозг не понимал, где цель.' },
  { id: 'yaw', icon: '↔️', fix: 'починить поворот', what: 'Сломался руль поворота: муха видела Шустрика, но не могла свернуть к нему.' },
  { id: 'pitch', icon: '↕️', fix: 'починить высоту', what: 'Сломался руль высоты: муха не могла подняться к Шустрику и пролетала под ним.' },
  { id: 'flip', icon: '🔄', fix: 'развернуть руль', what: 'Руль перепутался: муха поворачивала не туда, куда видела цель.' },
]

export function randomFault(prev: FaultId | null = null): FaultId {
  const ids = FAULTS.map((f) => f.id).filter((f) => f !== prev)
  return ids[Math.floor(Math.random() * ids.length)]
}

/** Десять погонь мухи с поломкой (если её ещё не починили). Состояние мозга
 *  после опыта возвращается как было. */
export async function checkFly(fault: FaultId | null, onRun?: (d: number, t: number) => void): Promise<number> {
  const steer = getSteer()
  try {
    if (fault === 'cols') setSilenced(new Set([0]))
    if (fault === 'lc') setSilenced(new Set([1, 2]))
    if (fault === 'yaw') setSteer([0, steer[1], 0, steer[3]])
    if (fault === 'pitch') setSteer([steer[0], 0, steer[2], 0])
    if (fault === 'flip') setSteer([-steer[0], steer[1], -steer[2], steer[3]])
    const res = await runContest('fly', EYE_FLY, { runs: RUNS, onRun })
    return res.catches
  } finally {
    setSilenced(new Set())
    setSteer(steer)
  }
}

/* ── «Эволюция» ────────────────────────────────────────────────────────
 * Восемь мух с чуть разными рулями (те же четыре числа, что муха учит
 * пробами). Каждую проверяют на четырёх учебных погонях; лучшие оставляют
 * потомство — их копии с небольшими случайными изменениями. Так за несколько
 * поколений руль подбирается сам, без учителя: это и есть естественный
 * отбор. Проверка чемпиона — на десяти обычных погонях, которых при отборе
 * не было. */

export const EVO_SIZE = 8
export const EVO_KEEP = 3
export const EVO_CHASES = [10, 11, 12, 13]

export type Bug = { id: number; steer: number[]; caught: number | null; fit: number | null; parent: number | null }

let nextId = 1
const INNATE = [YAW_GAIN, PITCH_GAIN, 0, 0]

export function firstGeneration(seed = Date.now() % 100000): Bug[] {
  const rng = makeRng(seed)
  return Array.from({ length: EVO_SIZE }, () => ({
    id: nextId++,
    // первое поколение — вразнобой: от совсем неуклюжих до неплохих
    steer: INNATE.map((x) => x + gaussOf(rng) * 1.2),
    caught: null,
    fit: null,
    parent: null,
  }))
}

/** Оценить одну муху на учебных погонях; руль после — как был. */
export async function evaluateBug(bug: Bug): Promise<Bug> {
  const keep = getSteer()
  let caught = 0
  let fit = 0
  try {
    setSteer(bug.steer)
    for (const i of EVO_CHASES) {
      const sc = chaseVariant(i, EYE_FLY)
      let minR = 99
      let hit = false
      let t = 0
      let k = 0
      for (const fr of localRun(sc, { pilot: 'fly' })) {
        minR = Math.min(minR, fr.range_m)
        t = fr.t
        if (fr.event === 'догнал') hit = true
        if (++k % 60 === 0) await yieldToUi()
      }
      if (hit) caught += 1
      fit += hit ? 2 + (sc.t_max - t) / sc.t_max : -minR / 5
    }
  } finally {
    setSteer(keep)
  }
  return { ...bug, caught, fit }
}

/** Лучшие остаются, остальные места — их потомство с мутациями. */
export function nextGeneration(bugs: Bug[], seed = Date.now() % 100000): Bug[] {
  const rng = makeRng(seed)
  const best = [...bugs].sort((a, b) => (b.fit ?? -99) - (a.fit ?? -99)).slice(0, EVO_KEEP)
  const kids: Bug[] = best.map((b) => ({ ...b, caught: b.caught, fit: b.fit }))
  while (kids.length < EVO_SIZE) {
    const p = best[kids.length % best.length]
    kids.push({ id: nextId++, steer: p.steer.map((x) => x + gaussOf(rng) * 0.4), caught: null, fit: null, parent: p.id })
  }
  return kids
}

export const bestOf = (bugs: Bug[]) => [...bugs].sort((a, b) => (b.fit ?? -99) - (a.fit ?? -99))[0]

/** Проверка чемпиона на обычных десяти погонях (их при отборе не было). */
export async function examBug(bug: Bug, onRun?: (d: number, t: number) => void): Promise<number> {
  const keep = getSteer()
  try {
    setSteer(bug.steer)
    return (await runContest('fly', EYE_FLY, { runs: RUNS, onRun })).catches
  } finally {
    setSteer(keep)
  }
}

/** Взять чемпиона в игру: его руль становится рулём Огонька. */
export function adoptBug(bug: Bug) {
  setSteer(bug.steer)
  markConnectomeTrained()
}

/* ── «Собери свой глаз» ────────────────────────────────────────────────── */

export const FOV_CHOICES = [13, 40, 90, 165]
export const CELL_CHOICES = [16, 8, 4]

export function builtEye(fovDeg: number, grid: 'foveal' | 'camera', cells: number): EyeConfig {
  return { grid, fovDeg, noisePct: 0, cells: cells < 16 ? cells : undefined }
}

export async function testEye(eye: EyeConfig, onRun?: (d: number, t: number) => void): Promise<number> {
  return (await runContest('fly', eye, { runs: RUNS, onRun })).catches
}

/* ── «Научи робота сам» ────────────────────────────────────────────────
 * Ребёнок выбирает, на каких карточках «кадр → где Шустрик» учится робот
 * (та же полносвязная сеть, что в турнире). Мало карточек или все с
 * одной стороны — робот учится плохо и путается в погоне. */

export async function cardPool(eye: EyeConfig = EYE_FLY): Promise<{ pick: CardRec[]; test: CardRec[] }> {
  let ds = loadCards(eye)
  if (!ds) {
    ds = await collectCards(eye, 24)
    saveCards(ds)
  }
  // 24 карточки на выбор — равномерно по тому, где Шустрик (слева → справа)
  const sorted = [...ds.train].sort((a, b) => a.az - b.az)
  const n = 24
  const pick = Array.from({ length: n }, (_, i) => sorted[Math.floor(((i + 0.5) / n) * sorted.length)])
  return { pick, test: ds.test }
}

export async function teachRobot(cards: CardRec[], eye: EyeConfig = EYE_FLY): Promise<KidNet> {
  const net = initNet(7, '')
  // мало карточек — больше проходов, чтобы сеть успела выучить то, что есть
  const epochs = Math.max(40, Math.min(300, Math.round(2400 / Math.max(cards.length, 1))))
  await trainOnCards(net, cards, { eye, epochs })
  return net
}

export async function examRobot(net: KidNet, test: CardRec[], eye: EyeConfig = EYE_FLY, onRun?: (d: number, t: number) => void) {
  const res = await runContest('kid', eye, { runs: RUNS, predict: (img) => predictAzEl(net, img, eye), onRun })
  return { catches: res.catches, errDeg: gazeErrorDeg(net, test, eye) }
}

/* ── «Обмани робота» ───────────────────────────────────────────────────
 * Блик на линзе — яркое пятно всегда в одном месте кадра. Кто на него
 * купится: муха или роботы? Роботы — готовые, обученные в ясную погоду без
 * бликов. */

export const GLARE_CHOICES: { id: string; label: string; glare: number | undefined }[] = [
  { id: 'none', label: '✨ без блика', glare: undefined },
  { id: 'left', label: '⬅️ блик слева', glare: -0.5 },
  { id: 'center', label: '⏺ блик в центре', glare: 0 },
  { id: 'right', label: '➡️ блик справа', glare: 0.5 },
]

export type GlareRow = { fly: number; det: number; mlp: number }

export async function glareTest(glare: number | undefined, onRun?: (d: number, t: number) => void): Promise<GlareRow> {
  const eye: EyeConfig = { ...EYE_FLY, glare }
  const nets = pretrainedNets('foveal')
  const total = RUNS * 3
  let done = 0
  const step = () => onRun?.(++done, total)
  const fly = (await runContest('fly', eye, { runs: RUNS, onRun: step })).catches
  const det = nets ? (await runContest('kid', eye, { runs: RUNS, predict: (img) => detPredict(nets.det, img, eye), onRun: step })).catches : 0
  const mlp = nets ? (await runContest('kid', eye, { runs: RUNS, predict: (img) => predictAzEl(nets.mlp, img, eye), onRun: step })).catches : 0
  return { fly, det, mlp }
}

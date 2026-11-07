/** Версии и типы игры «Догонялки».
 *
 *  Мозг мухи в brain.ts наследует схему признаков от стенда-первоисточника —
 *  номера версий оставлены, чтобы веса не перепутались между схемами. */

export type EyeGrid = 'foveal' | 'camera'

/** Глаз: одна ручка на всех бойцов.
 *  grid='foveal' — мушиная решётка: 16×16 клеточков, густо в центре и редко
 *  по краям, поле fovDeg (по умолчанию 165°).
 *  grid='camera' — обычная камера: ровные квадратики, узкое поле (12–14°).
 *  noisePct — помехи в глазу: доля яркости пятна, добавляемая к каждому
 *  клеточку как случайный шум (0 — чисто, 1 — пятно тонет в шуме). */
export type EyeConfig = { grid: EyeGrid; fovDeg: number; noisePct: number }

export const EYE_FLY: EyeConfig = { grid: 'foveal', fovDeg: 165, noisePct: 0 }
export const EYE_CAMERA: EyeConfig = { grid: 'camera', fovDeg: 13, noisePct: 0 }

/** Кто догоняет: муха (контур мозга), сеть ребёнка, «честный читер». */
export type Pilot = 'fly' | 'kid' | 'cheater'

/** Манёвр убегающего Шустрика. */
export type Maneuver = 'straight' | 'weave' | 'turn' | 'scissors' | 'dive' | 'combo'

/** версия схемы readout контура — зеркало стенда (10 признаков + 14 состояний) */
export const FEATURE_SCHEMA_VERSION = 3
export type BrainKind = 'stub'

/** Сценарий догонялок: геометрия погоня в метрах и секундах. */
export type ChaseScenario = {
  v_chaser: number
  v_runner: number
  range_m: number
  off_axis_m: number
  maneuver: Maneuver
  /** боковая перегрузка убегающего, g (0 — бежит прямо) */
  n_runner: number
  /** перегрузка догоняющего, g */
  n_max: number
  circuit_gain: number
  t_max: number
  /** радиус осаливания, м */
  tag_radius_m: number
  /** вероятность потерять цель из захвата на кадре */
  lock_drop_p: number
  eye: EyeConfig
  /** зерно: один и тот же seed — один и тот же погон */
  seed: number
}

export const DEFAULT_CHASE: ChaseScenario = {
  v_chaser: 8,
  v_runner: 6.4,
  range_m: 16,
  off_axis_m: 5,
  maneuver: 'weave',
  n_runner: 1.1,
  n_max: 1.35,
  circuit_gain: 1.0,
  t_max: 16,
  tag_radius_m: 0.6,
  lock_drop_p: 0.02,
  eye: EYE_FLY,
  seed: 1,
}

/** Что в этот миг живёт в контуре мухи: 10 признаков глаза, рекуррентные
 *  состояния (T4/T5, LC11/LC10) и выход обучаемого readout — команда поворота.
 *  Вкладка «Мозг» рисует именно это, ничего другого в мозгу игры нет. */
export type BrainReadout = {
  feat: number[]
  t4: number[]
  t5: number[]
  lc11: number[]
  lc10: number[]
  /** [тангаж, рыскание] в единицах −1…1 */
  out: [number, number]
}

/** Кадр погоне — всё, что видит игра. Никаких «ракетных» слов: догоняющий и убегающий. */
export type GameFrame = {
  t: number
  chaser: number[]
  runner: number[]
  chaser_v: number[]
  runner_v: number[]
  range_m: number
  /** картинка глаза в этом кадре (16×16) */
  image: number[][]
  lock: boolean
  /** истинный пеленг убегающего, рад */
  truth_az: number
  truth_el: number
  /** куда смотрит боец (рад): муха — декодированный пеленг, сеть — предсказание */
  look_az: number
  look_el: number
  /** активность контура мухи; отсутствует, если мозг в этом кадре не рулил */
  brain?: BrainReadout
  /** ошибка взгляда этого кадра, град (null — считать нечего) */
  look_err_deg: number | null
  /** цель в поле глаза на этом кадре */
  in_fov: boolean
  event: string | null
}

/** Карточка «кадр → куда смотреть». */
export type CardRec = {
  img: number[][]
  /** истина в радусах */
  az: number
  el: number
  episode: number
  seed: number
}

/** Точка тренировки мухи: итог одного учебного погоня. */
export type TrainPointLite = {
  ep: number
  hit: boolean
  lockFrac: number
  meanErrDeg: number | null
  /** веса readout после эпизода, развёрнутые 2×READOUT */
  w: number[]
}

export const CARD_VERSION = 'dogonjalki-cards-v1'

/** Отпечаток глаза для версионирования датасета: сменил глаз — карточки старые. */
export function eyeFingerprint(e: EyeConfig): string {
  return `${e.grid}:${e.fovDeg}:${e.noisePct}`
}

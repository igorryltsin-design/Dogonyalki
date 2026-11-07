import type { TrainSessionView } from './trainSession'

export type GuideMode = 'pn' | 'bio' | 'both' | 'handover'
export type Law = 'pn' | 'tpn' | 'apn' | 'pure' | 'clos' | 'pn_gsn' | 'pn_sched_oracle' | 'pn_sched_sensor'
export type Aspect = 'head-on' | 'beam' | 'tail-chase' | 'free' | 'surface'
export type Maneuver = 'straight' | 'turn' | 'weave' | 'weave_var' | 'break' | 'scissors' | 'dive' | 'combo'
export type BrainKind = 'stub' | 'full' | 'connectome'
/** закон уклонения цели в дуэли; подписи — labels.EVADER_RU (зеркало EVADER_LABEL) */
export type EvaderLaw = 'away' | 'negpn' | 'cpa_max' | 'brain' | 'late_break'
/** профиль скорости цели внутри эпизода */
export type TargetSpeedMode = 'constant' | 'accelerate' | 'decelerate' | 'pulse' | 'sine'

/** версия схемы readout контура (v3: 10 признаков + 14 столбцов состояний t4/t5/lc11/lc10) */
export const FEATURE_SCHEMA_VERSION = 3
/** версия модели стенда */
export const MODEL_VERSION = '2.0.0'

/** Режимы работы: один клик патчит инспектор. Учёба всегда kinematic.
 *  `tip` — что именно ставит кнопка и на что смотреть в кадре: метка сама по
 *  себе подсказкой не была, она только повторяла надпись на чипе. */
export const WORK_PROFILES: { id: string; label: string; tip: string; patch: Partial<Scenario>; sceneOnly3dof?: boolean; campaign?: string }[] = [
  { id: 'air-pn', label: 'воздух · ПН', tip: 'Встречная цель, ракету ведёт классическая ПН, мозг в контуре не участвует.\nЭталон сравнения: промах единицы метров. Всё остальное меряют отсюда.', patch: { aspect: 'head-on', mode: 'pn', law: 'pn', model: 'kinematic_legacy', duel: false, v_m: 780 } },
  { id: 'air-bio', label: 'воздух · муха', tip: 'Та же геометрия, но ракету ведёт контур мухи: кадр 16×16, дистанции он не знает.\nСравнивать с «воздух · ПН»: видно, какой ценой сенсор заменяет закон.', patch: { aspect: 'head-on', mode: 'bio', law: 'pn', model: 'kinematic_legacy', duel: false, v_m: 780 }, campaign: 'full-protocol' },
  { id: 'air-handover-pn', label: 'воздух · закон → муха', tip: 'Первый участок ракету ведёт ПН, в точке смены руки — муха; обратно закон уже не возвращается.\nСмотреть момент передачи: подхватила ли муха цель или провалила промах.', patch: { aspect: 'head-on', mode: 'handover', law: 'pn', model: 'kinematic_legacy', duel: false, v_m: 780 }, campaign: 'air-long-break' },
  { id: 'sam-clos', label: 'земля · метод трёх точек → муха', tip: 'Пуск с рельса ЗРК: разгон трёхстепенной модели с тягой, тяжестью и атмосферой, командный участок методом трёх точек, затем муха.\nСцена трёхстепенная; учёба мозга при этом остаётся кинематикой.', patch: { aspect: 'surface', mode: 'handover', law: 'clos', model: 'point_mass_3dof', duel: false }, sceneOnly3dof: true, campaign: 'surf-steep' },
  { id: 'free', label: 'свободная', tip: 'Расстановка своя: панель «Расстановка» поверх сцены, цель тянется на плане, профиле и прямо в 3D (Shift — высота), курсы — за кончики стрелок.\nМозг по умолчанию — муха; геометрия сохраняется между прогонами.', patch: { aspect: 'free', mode: 'bio', law: 'pn', model: 'kinematic_legacy', duel: false, v_m: 780 } },
  { id: 'duel-school', label: 'дуэль · цель учится', tip: 'Ракету ведёт закон (ПН), цель уклоняется обучаемым мозгом.\nНаведение неизменно: растёт промах от прогона к прогону — это успех цели, а не регресс ракеты.', patch: { aspect: 'head-on', mode: 'pn', law: 'pn', model: 'kinematic_legacy', duel: true, evader_law: 'brain', v_m: 780 }, campaign: 'air-vs-away' },
  { id: 'duel-queen', label: 'дуэль · обе стороны учатся', tip: 'Обе стороны — выученные мозги: ракету ведёт муха, цель — свой эвейдер, эталонного закона в контуре нет.\nЧистый бой: видно, кто кого переживает, но не видно, чей именно контур хуже.', patch: { aspect: 'head-on', mode: 'bio', law: 'pn', model: 'kinematic_legacy', duel: true, evader_law: 'brain', v_m: 780 } },
  { id: 'hunt-evade', label: 'охота', tip: 'Патчит сцену так же, как «дуэль · обе стороны учатся»: встречные курсы, муха против обученного эвейдера.\nОтдельного режима «охоты» в стенде нет — это второй ярлык той же сборки.', patch: { aspect: 'head-on', mode: 'bio', law: 'pn', model: 'kinematic_legacy', duel: true, evader_law: 'brain', v_m: 780 } },
  { id: 'swarm-bio', label: 'рой · био', tip: 'Ставит ту же сборку, что «воздух · муха»: встречная цель, ракету ведёт муха, дуэли нет.\nСам рой (популяция и эволюция) живёт в разделе «Рой» — этой кнопкой он не запускается.', patch: { aspect: 'head-on', mode: 'bio', law: 'pn', model: 'kinematic_legacy', duel: false, v_m: 780 } },
]

/** Ответ GET /api/train/defaults — то, что стенд считает «по умолчанию».

    В клиенте эти числа не хранятся нигде: раньше «по умолчанию» жило в четырёх
    местах (протокол, модель запроса, конфиг сессии, литералы фронта) и расходилось
    — фронт держал проверку каждые 6 эпизодов против серверных 4 и сам удваивал
    горизонт учебного боя. Теперь правки оператора лежат в TrainCfgEdit, а всё
    нетронутое приходит отсюда. */
export type TrainDefaults = {
  protocol: {
    episodes: number
    lr: number
    validation_every: number
    max_checkpoints: number
    t_cap_air_s: number
    t_cap_surface_s: number
    teacher_law: string
    teacher_mode: string
    ema_beta: number
    eval_repeats: number
    judge_mode: string
    judge_n: number
    judge_seed: number
    evolve_elite_frac: number
    evolve_momentum: number
    train_engine: string
    batch_chunk: number
    sensor_tier_schedule: string[]
    seed_train_base: number
    seed_validation_base: number
    seed_heldout_base: number
    feature_schema_version: number
  }
  session: Record<string, unknown>
  evolve: {
    generations: number
    sigma: number
    pop: number
    repeats: number | null
    judge_mode: string
    init: string
  }
  choices: {
    teacher_law: { id: string; sensor: boolean }[]
    teacher_mode: string[]
    judge_mode: string[]
    init: string[]
    train_engine: string[]
    sensor_tier: string[]
    kind: string[]
    mode: string[]
  }
}

/** Правки пользователя: ключа нет (или null) — значение берётся со стенда. */
export type TrainCfgEdit = {
  mode?: 'scratch' | 'finetune' | 'result'
  lr?: number | null
  episodes?: number | null
  seed?: number | null
  validationEvery?: number | null
  checkpointEvery?: number | null
  campaignId?: string
  sensorTier?: 'auto' | 'quiet' | 'protocol' | 'hard'
  teacherMode?: 'full_command' | 'direction_only' | 'clipped_coarse' | null
  /** закон, которому учим: null — протокольный, '' — oracle-геометрия (мерить потолок) */
  teacherLaw?: string | null
  /** Polyak-среднее весов прогона: null — протокол, 0 — выключено */
  emaBeta?: number | null
  /** судья доводки: null — протокольный, дальше diverse (разнообразная сетка) или canonical */
  judgeMode?: string | null
  /** точка старта поиска доводки: null — протокол ('imitation' = текущие веса),
   *  дальше innate / default / random — мульти-рестарт */
  evolveInit?: string | null
  evolvePop?: number | null
  evolveGenerations?: number | null
  evolveSigma?: number | null
}

/** Параметры учебного прогона: режим задаёт пресет, остальное правится на экране
 *  «Обучение» и уходит на стенд в конфигурации сессии. Число здесь может быть
 *  null — это не «значение 0», а «стенд не ответил, и своего числа у фронта нет»:
 *  поле показывается пустым, а запуск требует, чтобы оператор его задал. */
export type TrainCfg = {
  mode: 'scratch' | 'finetune' | 'result'
  lr: number | null
  episodes: number | null
  /** зерно прогона; null — протокольное (train_base) */
  seed: number | null
  /** как часто проверять на неизменном наборе, в эпизодах */
  validationEvery: number | null
  /** автоконтрольная точка каждые N эпизодов; 0 — только вручную */
  checkpointEvery: number | null
  /** карточка кампании дообучения; пусто — авто (неиспользованная из колоды) */
  campaignId: string
  /** ступень сенсора: auto — учебный график (тихо → протокол → жёстко по трети
   *  эпизодов); явная ступень держится весь прогон и перекрывает график */
  sensorTier: 'auto' | 'quiet' | 'protocol' | 'hard'
  teacherMode: 'full_command' | 'direction_only' | 'clipped_coarse' | null
  teacherLaw: string | null
  emaBeta: number | null
  judgeMode: string | null
  evolveInit: string | null
  evolvePop: number | null
  /** поколений CEM в доводке: прежнее «сколько эпизодов, столько и поколений»
   *  давало 36–200 × 216 боёв; кривая поиска несётся по своему, поэтому длина
   *  вынесена в отдельный параметр (замер — tools/evolve_gen_curve.py) */
  evolveGenerations: number | null
  evolveSigma: number | null
  /** горизонт учебного боя, который стенд посчитает: своё число или протокол
   *  по аспекту; null — протокол неизвестен. Клиент его не выбирает и не шлёт. */
  tCap: number | null
  /** откуда взялся горизонт: 'правкой' его не задать — t_cap на экране только читается */
  tCapFromProtocol: boolean
}

/** Стартовое состояние ручек: ничего не выбрано, все числа — со стенда. */
export const TRAIN_CFG_UNSET: TrainCfgEdit = {
  mode: 'scratch',
  campaignId: '',
  sensorTier: 'auto',
}

/** Слияние: правка оператора поверх дефолтов стенда. Поля, которых нет ни там ни
 *  там, остаются null — фронт не имеет права выдумывать «своё» число. */
export function resolveTrainCfg(d: TrainDefaults | null, edit: TrainCfgEdit, aspect: string): TrainCfg {
  const num = (own: number | null | undefined, srv: number | undefined): number | null =>
    own !== undefined && own !== null ? own : srv ?? null
  const p = d?.protocol
  const e = d?.evolve
  const s = d?.session as { checkpoint_every?: number } | undefined
  const horizon = aspect === 'surface' ? p?.t_cap_surface_s : p?.t_cap_air_s
  return {
    mode: edit.mode ?? 'scratch',
    lr: num(edit.lr, p?.lr),
    episodes: num(edit.episodes, p?.episodes),
    seed: edit.seed ?? null,
    validationEvery: num(edit.validationEvery, p?.validation_every),
    checkpointEvery: num(edit.checkpointEvery, s?.checkpoint_every),
    campaignId: edit.campaignId ?? '',
    sensorTier: edit.sensorTier ?? 'auto',
    teacherMode: edit.teacherMode ?? (p?.teacher_mode as TrainCfg['teacherMode']) ?? null,
    teacherLaw: edit.teacherLaw ?? null,
    emaBeta: num(edit.emaBeta, p?.ema_beta),
    judgeMode: edit.judgeMode ?? (p?.judge_mode ? p.judge_mode : null),
    evolveInit: edit.evolveInit ?? (e?.init ? e.init : null),
    evolvePop: num(edit.evolvePop, e?.pop),
    evolveGenerations: num(edit.evolveGenerations, e?.generations),
    evolveSigma: num(edit.evolveSigma, e?.sigma),
    tCap: horizon ?? null,
    tCapFromProtocol: true,
  }
}

/** Пресеты: длина прогона (подражание) и длина поиска (доводка). Пресет — это
 *  явная правка оператора, поэтому его числа могут быть своими; всё, чего пресет
 *  не касается, остаётся протокольным. */
export const TRAIN_PRESETS: Record<string, { label: string; tip: string; patch: TrainCfgEdit; tune?: boolean }> = {
  quick: {
    label: 'быстрый · 36 эп.',
    tip: '36 учебных эпизодов — ровно столько, сколько в протоколе; шаг, проверки и точки остаются протокольными.\nСчитает примерно один набор кривой: годится смотреть, пошёл ли градиент, но не судить качество мозга.',
    patch: { episodes: 36 },
  },
  normal: {
    label: 'обычный · 80 эп.',
    tip: '80 эпизодов: проверка каждые 10 и автоконтрольная точка каждые 8 — длиннее, чем в протоколе, иначе проверочные бои съедают треть счёта.\nОбычный прогон для сравнения зерен.',
    patch: { episodes: 80, validationEvery: 10, checkpointEvery: 8 },
  },
  long: {
    label: 'длинный · 200 эп.',
    tip: '200 эпизодов шагом 0,03: мелкий шаг на длинной дистанции — иначе веса прыгают вокруг решения и проверка начинает дрейфовать.\nРедкие проверки (каждые 20 эп.) и точки (каждые 15) — чтобы оценка не стоила дороже учёбы.',
    patch: { episodes: 200, lr: 0.03, validationEvery: 20, checkpointEvery: 15 },
  },
  tuneFast: {
    label: 'доводка · быстрая',
    tip: '8 поколений × 6 кандидатов, судит разнообразная сетка: дешёвый поиск, чтобы проверить, двигается ли фитнес вообще.\nМаленькая популяция легко проваливается в локальный максимум — это разведка, не результат.',
    patch: { evolveGenerations: 8, evolvePop: 6, evolveSigma: 0.3, judgeMode: 'diverse' },
    tune: true,
  },
  tuneFull: {
    label: 'доводка · полная',
    tip: '24 поколения × 12 кандидатов: по замеру кривой (tools/evolve_gen_curve.py) первый скачок поражения — на 1-м поколении, второй — около 17-го, дальше поиск может не двинуться вовсе.\nСтоит дорого: поколение — сотни боёв, вкладку закрывать нельзя.',
    patch: { evolveGenerations: 24, evolvePop: 12, evolveSigma: 0.25, judgeMode: 'diverse' },
    tune: true,
  },
}

/** Пресет считается выбранным, если каждая его правка стоит в текущих значениях. */
export function presetActive(cfg: TrainCfg, patch: TrainCfgEdit): boolean {
  return Object.entries(patch).every(([key, want]) => cfg[key as keyof TrainCfg] === want)
}

export type Scenario = {
  aspect: Aspect
  v_m: number
  v_t: number
  range_m: number
  off_axis_m: number
  /** «Свободная расстановка» (aspect='free'): цель в метрах от точки пуска
   *  (X — вперёд, Y — бок, Z — абсолютная высота), курсы — азимут от +X против
   *  часовой к +Y и подъём над горизонтом, град. range_m в этой ветке не участвует. */
  free_tx: number
  free_ty: number
  free_talt: number
  free_mhdg: number
  free_mclimb: number
  free_thdg: number
  free_tclimb: number
  n_max: number
  n_target: number
  maneuver: Maneuver
  pn_n: number
  /** ПН с переменным N: N = clip(N0 + k_rho·rho, N_min, N_max) — отдельный контрольный закон */
  pn_sched_n0: number
  pn_sched_k_rho: number
  pn_sched_n_min: number
  pn_sched_n_max: number
  /** профиль скорости цели (продольное ускорение меняет модуль, не вираж) */
  target_speed_mode: TargetSpeedMode
  target_longitudinal_g: number
  target_speed_min: number
  target_speed_max: number
  target_speed_period_s: number
  target_speed_phase: number
  mode: GuideMode
  circuit_gain: number
  tau_s: number
  /** лаг рулевого привода (1-е апериодическое звено на исполнении команды), с; 0 — мгновенно */
  tau_act_s: number
  fov_deg: number
  /** физическое поле зрения БИО: фовеальная сетчатка (плотный центр, редкая периферия) */
  bio_fov_deg: number
  seeker_delay_s: number
  t_max: number
  kill_radius_m: number
  alt_m: number
  /** шумы измерителей */
  noise_az_deg: number
  noise_range_m: number
  lock_drop_p: number
  seeker_jitter_s: number
  sensor_tier: 'quiet' | 'protocol' | 'hard'
  /** постоянная карта «умерших» омматидиев + независимый дропаут на кадр */
  retina_death_p: number
  retina_dropout_p: number
  /** закон наведения для режима pn */
  law: Law
  brain: BrainKind
  /** дуэль: цель уходит реактивными законами (evader_law), а не «по нотам» */
  duel: boolean
  evader_law: EvaderLaw
  /** боевая жизнь ракеты в дуэли, с: не сбила за это время —win у цели */
  fuse_life_s: number
  /** модель движения ракеты: кинематическая (совм.) или трёхстепенная физическая (только сервер) */
  model: ModelKind
  /** трёхстепенная физика (только при model='point_mass_3dof'); имена и дефолты
   *  зеркалят Python ScenarioIn — сверка тестом tests/test_phys_fields.py */
  phys_atmos: boolean
  phys_cx_wave: number
  phys_mach_kr: number
  phys_mach_band: number
  phys_cn_max: number
  phys_wn_act: number
  phys_zeta_act: number
  phys_tau_a_s: number
  phys_thrust_n: number
  phys_burn_time_s: number
  phys_gravity: boolean
  phys_mass_kg: number
  /** handover: сколько секунд держать захват ГСН, прежде чем отдать штурвал мухе */
  handover_lock_s: number
  /** handover: запасной порог наклонной дальности, м; 0 — выключен */
  handover_range_m: number
  /** земной старт: высота рельса, м */
  rail_h_m: number
  /** земной старт: начальный подъём ракеты, град. */
  surface_climb_deg: number
}

/** Модель движения центра масс. `point_mass_3dof` недоступна в локальном окне. */
export type ModelKind = 'kinematic_legacy' | 'point_mass_3dof'

/** Режим камеры сцены: авто-следование, свободная (фиксированная), вдогон ракете
 *  или кино (BF: авто-ракурсы по фазам боя; недоступна на слабом тире устройства). */
export type CamMode = 'auto' | 'free' | 'chase' | 'cine'

/** Регион мозга в карте активности: кусок канонической склейки нейронов. */
export type BrainRegion = { name: string; start: number; n: number; mean: number }

/** Снимок контура цели-уклониста (дуэль, evader_law='brain'): компактная копия
 *  circuit-снапшота без картинки сетчатки; обучаемая схема цели (фаза 3). */
export type EvaderSnap = {
  kind: string
  t4: number[]
  lplc2: number
  dn: { pitch: number; yaw: number }
  layers: Record<string, number>
  weights: string
  n_cells: number
  n_neurons: number
  regions: BrainRegion[]
  act_b64: string
  lock: boolean
}

/** Муха роя: мозг дрозофилы (bio) или постоянный ПН (pn). */
export type FlyGenome = {
  kind: 'bio' | 'pn'
  /** Развёрнутые в строку веса 2×8 — только для bio. */
  w: number[]
  gain: number
  pn_n: number
}

export type FlyResult = {
  fly: FlyGenome
  fitness: number
  miss_m: number
  hit: boolean
  n_int: number
  traj_m: number[][]
  traj_t: number[][]
  /** телеметрия для анимации панелей (глаз/мозг/рули) */
  tel?: TelPoint[]
}

/** Точка телеметрии полёта мухи: пеленг, захват, команды, перегрузка. */
export type TelPoint = {
  t: number
  az: number
  el: number
  lock: boolean
  size: number
  sizeDot: number
  azDot: number
  elDot: number
  pitch: number
  yaw: number
  nReq: number
  miss: number
  rng: number
  v: number[]
  /** фаза сближения (если передана сервером/локальным движком) */
  theta?: number
  rho?: number
  tauContact?: number
}

export type SwarmGenResponse = {
  results: FlyResult[]
  next_population: FlyGenome[]
  stats: { best: number; avg: number; best_idx: number; worst?: number; hit_rate?: number; diversity?: number; canon_best?: number }
}

export type Frame = {
  t: number
  missile: number[]
  target: number[]
  missile_v: number[]
  target_v: number[]
  a_cmd: number[]
  a_pn: number[]
  n_req: number
  n_lim: number
  range_m: number
  v_c: number
  omega_los: number
  az: number
  el: number
  lock: boolean
  miss: number
  ghost?: number[] | null
  seeker: { image: number[][]; size: number; az_dot: number; el_dot: number }
  circuit: {
    kind: string
    photo: number[][]
    t4: number[]
    dn: { pitch: number; yaw: number }
    lplc2: number
    layers: Record<string, number>
    weights: string
    n_cells: number
    /** карта реальной активности: регионы + проекция всех нейронов в корзины */
    n_neurons: number
    regions: BrainRegion[]
    act_b64: string
  }
  layers: Record<string, number>
  event: string | null
  guide_phase?: string | null
  handover_reason?: string | null
  /** фаза сближения (декодирована из изображения) */
  theta: number
  theta_dot: number
  rho: number
  tau_contact: number
  /** диагностика N_экв (истинная геометрия — постфактум, не для управления) */
  n_eff: number | null
  n_eff_valid: boolean
  n_eff_reason: string | null
  n_eff_yaw: number | null
  n_eff_pitch: number | null
  sat: boolean
  /** DEPRECATED alias = tRadial (R/Vc, с) */
  tgo: number | null
  /** радиальная оценка оставшегося времени R/Vc, с */
  tRadial?: number | null
  t_radial?: number | null
  /** время до ближайшего сближения −r·Vотн/|Vотн|², с */
  tCpa?: number | null
  t_cpa?: number | null
  speed_mode: TargetSpeedMode
  target_speed: number
  speed_ms?: number | null
  n_act?: number | null
  n_cmd?: number | null
  mach?: number | null
  /** снимок контура цели-уклониста (дуэль, evader_law='brain'); null — цель не мозг */
  evader?: EvaderSnap | null
}

/** ─── лаборатория: метрики и история экспериментов ─── */

/** Итог прогона: честные метрики одного полёта. */
/** Метрики прогона, версия 4 (R_min/усилия/захват + h_cv/h₀/R_end + диагностика N_экв — см. справку). */
export type RunMetrics = {
  metricsVersion: 4
  /** непрерывный минимум геометрического расстояния, м */
  miss: number
  cpaM: number
  /** радиус срабатывания БЧ, м */
  triggerRangeM: number
  hit: boolean
  /** время наведения: интерполированное t входа в сферу БЧ; null — не перехватил */
  tGuide: number | null
  tEnd: number
  nPeak: number
  /** среднее нормальное ускорение, g */
  nMean: number
  /** control effort: ∫|a_cmd|/g dt, g·с */
  nInt: number
  lockFrac: number
  /** среднее отклонение от траектории призрака-ПН (эталона), м */
  refDev: number | null
  /** нормированное СКО рассогласования (к начальной дальности) */
  refNrms: number | null
  /** h_cv: прогноз промаха при неизменных скоростях на последнем шаге, м (legacy-имя terminalZem) */
  terminalZem?: number | null
  hCvM?: number | null
  /** h₀: промах при снятой команде (интегрирование модели), м */
  h0M?: number | null
  /** R_end: дальность на последнем кадре, м */
  endRangeM?: number | null
  /** η «угол встречи»: угол между векторами скоростей ракеты и цели в момент
   * наибольшего сближения, град. (180° — лоб, 0° — догон) */
  impactAngleM?: number | null
  /** ── диагностика N_экв (только валидные отсчёты) ── */
  nEffMedian: number | null
  nEffQ25: number | null
  nEffQ75: number | null
  nEffMin: number | null
  nEffMax: number | null
  /** доля шагов наведения с валидным N_экв */
  nEffValidFrac: number
  /** доля кадров с насыщением команды по n_max */
  satFrac: number
  /** корреляция N_экв с rho / t_cpa (если выборка достаточна) */
  corrNEffRho: number | null
  corrNEffTgo: number | null
  nEffCount: number
}

/** Точка диагностики N_экв одного кадра — для лабораторных графиков адаптивности. */
export type NeffPoint = {
  t: number
  tgo: number | null
  rho: number
  vc: number
  nEff: number | null
  valid: boolean
  sat: boolean
  speedMode: TargetSpeedMode
}

export type TrainPoint = {
  ep: number
  miss: number
  hit: boolean
  tGuide: number | null
  refDev: number
  /** веса DN после эпизода, развёрнутые 2×FEAT_DIM (число столбцов зависит от мозга) */
  w: number[]
  /** номер сессии обучения — для вертикальных разделителей на графиках */
  session?: number
  /** «цена» манёвра и качество наведения по эпизоду */
  nAvg?: number
  nPeak?: number
  lockFrac?: number
  nrms?: number
  /** СКО только после смены руки (для контура «закон → муха»); нет терминального участка — null */
  nrmsTerm?: number | null
  /** момент смены руки в этом эпизоде, с; null — закон так и остался рулить */
  tHandover?: number | null
  /** сколько шагов эпизода муха реально рулила и училась */
  learnedSteps?: number
  /** контур эпизода: bio (муха весь полёт) / handover (закон, затем муха) / pn */
  guideMode?: string
  /** закон наведения, которым вели ракету в этом эпизоде (pn / clos / tpn …) */
  law?: string
  /** геометрия эпизода: head-on / beam / tail-chase / surface */
  aspect?: string
  /** карточка кампании дообучения (волна U): air-tail-dive, surf-steep… */
  campaignId?: string
  /** подпись карточки по-русски — для контура на графике */
  campaignTitle?: string
  /** run_id сессии, которой принадлежит точка: два прогона одного мозга не сливаются в одну кривую */
  runId?: string
  /** режим точки: учебный эпизод / доводка по результату / обучение в окне */
  mode?: 'episode' | 'result' | 'local'
  /** проверка на неизменном наборе после этого эпизода, м (null — проверки не было) */
  vMiss?: number | null
  /** зерно эпизода из журнала сессии — по нему прогон повторяется */
  seed?: number
  /** доводка по результату: доля перехватов всей серии на этом поколении.
   *  Это НЕ факт отдельного перехвата — hit у таких точек всегда false. */
  hitRate?: number
}

export type GenPoint = {
  gen: number
  best: number
  avg: number
  worst?: number
  /** средний разброс весов биомух (разнообразие популяции) */
  diversity?: number
  /** доля перехватов в поколении, 0…1 */
  hitRate?: number
  /** наименьшее сближение на эталонном трио (валидационные поколения) */
  champ?: number
  /** поколение посчитано локальной демо-моделью (не серверной научной) */
  local?: boolean
}

export type FramePoint = { t: number; zem: number; dev: number | null; rng: number }

/** ─── дуэль: матрица «Ринг» (ответ /api/duel) ─── */

export type DuelCell = {
  row: string
  col: string
  /** вердикт ячейки: кто взял — ракета или цель */
  win: 'missile' | 'evader'
  hit_rate: number
  t_survived: number
  cpa_m: number
  n_int: number
  n_peak: number
  fuse_expired: boolean
}

export type DuelMatrix = {
  missiles: string[]
  evaders: string[]
  repeats: number
  scenario: { aspect: Aspect; fuse_life_s: number; duel: boolean; n_target: number }
  cells: DuelCell[]
}

export type RunPoint = {
  label: string
  at: number
  miss: number
  hit: boolean
  tGuide: number | null
  refDev: number | null
  nPeak: number
  lockFrac: number
  /** η — угол встречи в момент наибольшего сближения, град.; null — нет данных */
  eta?: number | null
}

export type LabData = {
  train: TrainPoint[]
  gen: GenPoint[]
  /** последний прогон: ZEM и отклонение от эталона по кадрам */
  zem: FramePoint[]
  runs: RunPoint[]
  /** диагностика N_экв последнего прогона (графики адаптивности) */
  neff: NeffPoint[]
  /** траектории последнего прогона, план X-Y: [дальность, бок] */
  traj?: {
    missile: number[][]
    ghost: number[][]
    target: number[][]
  } | null
  /** сводка последнего обучения до/после: числа берутся с проверочного набора,
   *  не с учебной кривой, а heldout — независимый контроль */
  summary?: {
    missBefore?: number
    missAfter?: number
    tGuideAfter?: number | null
    refDevBefore?: number
    refDevAfter?: number
    /** вероятность поражения цели на проверочном наборе: до первой учёбы и после
     *  последней проверки — мерило отбора, а не медиана промаха */
    hitRateBefore?: number
    hitRateAfter?: number
    /** прогон, которому принадлежит сводка: без него цифры нельзя повторить */
    runId?: string
    /** откуда посчитано: стенд или обучение в окне */
    source?: 'server' | 'window'
    /** независимый контроль текущих весов, м */
    heldoutMiss?: number
    /** то же, что heldoutMiss, но мерило отбора: доля поражений на контроле */
    heldoutHitRate?: number
    /** итоговая конфигурация прогона — сохраняется вместе с результатом,
     *  чтобы эксперимент можно было повторить по этим же числам */
    config?: {
      mode: string
      episodes: number
      lr: number
      seed: number
      validation_every: number
      checkpoint_every: number
    }
    /** версия модели и схемы признаков, на которых посчитаны цифры */
    modelVersion?: string
    schemaVersion?: number
    /** длительность прогона, с и причина его завершения */
    elapsedS?: number
    stopReason?: string | null
  } | null
  /** снимок последней сессии обучения: run_id, конфигурация, журнал, точки, где сейчас веса */
  run?: TrainSessionView | null
}

export function emptyLab(): LabData {
  return { train: [], gen: [], zem: [], runs: [], neff: [], traj: null, summary: null, run: null }
}

export const DEFAULT_SCENARIO: Scenario = {
  aspect: 'head-on',
  v_m: 780,
  v_t: 260,
  range_m: 8000,
  off_axis_m: 420,
  free_tx: 8000,
  free_ty: 0,
  free_talt: 4000,
  free_mhdg: 0,
  free_mclimb: 0,
  free_thdg: 180,
  free_tclimb: 0,
  n_max: 30,
  n_target: 0,
  maneuver: 'straight',
  pn_n: 4,
  pn_sched_n0: 3,
  pn_sched_k_rho: 0.8,
  pn_sched_n_min: 2,
  pn_sched_n_max: 6,
  target_speed_mode: 'constant',
  target_longitudinal_g: 1,
  target_speed_min: 120,
  target_speed_max: 520,
  target_speed_period_s: 6,
  target_speed_phase: 0,
  mode: 'pn',
  circuit_gain: 1.15,
  tau_s: 0.025,
  tau_act_s: 0,
  fov_deg: 14,
  seeker_delay_s: 0.02,
  t_max: 28,
  kill_radius_m: 45,
  alt_m: 4000,
  noise_az_deg: 0,
  noise_range_m: 0,
  lock_drop_p: 0,
  seeker_jitter_s: 0,
  sensor_tier: 'protocol',
  law: 'pn',
  brain: 'stub',
  duel: false,
  evader_law: 'away',
  fuse_life_s: 30,
  model: 'kinematic_legacy',
  phys_atmos: false,
  phys_cx_wave: 0,
  phys_mach_kr: 1.0,
  phys_mach_band: 0.1,
  phys_cn_max: 0,
  phys_wn_act: 0,
  phys_zeta_act: 1.0,
  phys_tau_a_s: 0.05,
  phys_thrust_n: 0,
  phys_burn_time_s: 3.0,
  phys_gravity: true,
  phys_mass_kg: 150,
  handover_lock_s: 0.1,
  handover_range_m: 0,
  rail_h_m: 2,
  surface_climb_deg: 60,
  bio_fov_deg: 165,
  retina_death_p: 0,
  retina_dropout_p: 0,
}

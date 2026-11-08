/** «Лаборатория» — экран, где ребёнок ведёт себя как учёный: берёт десять
 *  одинаковых погонь, меняет в них ровно ОДНУ вещь и смотрит, что из этого
 *  вышло. Всё остальное держится нетронутым нарочно: иначе цифры будут про
 *  что угодно, только не про причину.
 *
 *  Условия опыта собираются здесь, чистыми функциями: тот же выбор — те же
 *  десять погонь из того же набора, по которым играют доска и турнир.
 *  Поэтому строки таблицы сравнимы между собой, а контрольный опыт (когда не
 *  меняли ничего) — честная отправная точка. Глаз и погода в лаборатории
 *  свои, кнопки в шапке на неё не влияют: иначе вышло бы, что ребёнок менял
 *  две вещи, сам того не заметив. Результаты живут в браузере и стираются
 *  «Новым классом». */

import { MANEUVER_NAME, chaseVariant } from '../scenarios'
import { GROUPS } from '../connectome'
import { EYE_CAMERA, EYE_FLY } from '../types'
import type { ChaseScenario, EyeConfig, Maneuver } from '../types'

/** чем один опыт отличается от другого; 'none' — ничего не меняли */
export type KnobKey = 'eye' | 'rain' | 'speed' | 'path' | 'brain'

export type Condition = { knob: KnobKey | 'none'; choice: string }

export type Choice = {
  id: string
  /** как показать на кнопке */
  label: string
  /** короткий ярлык для строки таблицы */
  short: string
  /** что это вообще такое — подпись под кнопкой */
  note: string
}

export type Knob = { key: KnobKey; name: string; icon: string; choices: Choice[] }

/** первый вариант каждого ползунка — базовый: так играет вся игра */
export const KNOBS: Knob[] = [
  {
    key: 'eye',
    name: 'Чем смотрит Огонёк',
    icon: '👁',
    choices: [
      { id: 'fly', label: '🪰 глаз мухи', short: 'глаз мухи', note: 'фасеточная решётка, поле 165°' },
      { id: 'camera', label: '📱 глаз телефона', short: 'глаз телефона', note: 'ровные пиксели, поле 13°' },
    ],
  },
  {
    key: 'rain',
    name: 'Какая погода',
    icon: '🌦',
    choices: [
      { id: 'clear', label: '☀️ ясно', short: 'ясно', note: 'глаз чистый' },
      { id: 'drizzle', label: '🌦 дождик', short: 'дождик', note: 'помехи в глазу 30%' },
      { id: 'pour', label: '🌧 ливень', short: 'ливень', note: 'помехи в глазу 60%' },
    ],
  },
  {
    key: 'speed',
    name: 'Как быстро бежит Шустрик',
    icon: '🏃',
    choices: [
      { id: 'same', label: '🏃 как в игре', short: 'обычная скорость', note: 'Огонёк бегает быстрее Шустрика — поэтому и догоняет' },
      { id: 'faster', label: '💨 совсем быстрый', short: 'быстрый Шустрик', note: 'Шустрик почти так же быстр, как Огонёк: догонять почти нечем' },
      { id: 'slower', label: '🐢 совсем медленный', short: 'медленный Шустрик', note: 'Шустрик заметно медленнее — Огонёк добирает его на прямых' },
    ],
  },
  {
    key: 'path',
    name: 'По какому пути бежит Шустрик',
    icon: '🌀',
    choices: [
      { id: 'set', label: '🎲 как в наборе', short: 'как в наборе', note: 'десять погонь — десять разных манёвров' },
      ...(['straight', 'weave', 'scissors', 'dive', 'turn', 'combo'] as Maneuver[]).map((m) => ({
        id: m,
        label: `🌀 ${MANEUVER_NAME[m]}`,
        // «хитрит: петли с рывками» — единственное имя с двоеточием: в подписи
        // опыта оно столкнулось бы с двоеточием самого ползунка
        short: m === 'combo' ? 'петли с рывками' : MANEUVER_NAME[m],
        note: 'все десять погонь — одним манёвром',
      })),
    ],
  },
  {
    key: 'brain',
    name: 'Что в мозгу молчит',
    icon: '🧠',
    choices: [
      { id: 'whole', label: '🧠 целый мозг', short: 'целый мозг', note: 'все нейроны работают' },
      ...GROUPS.map((g, i) => ({
        id: String(i),
        label: `🔇 ${g.kid}`,
        short: `молчат ${g.kid}`,
        note: g.what,
      })),
    ],
  },
]

export const CONTROL: Condition = { knob: 'none', choice: 'none' }

export function knobOf(key: KnobKey): Knob {
  return KNOBS.find((k) => k.key === key)!
}

export function choiceOf(cond: Condition): Choice | null {
  if (cond.knob === 'none') return null
  const k = knobOf(cond.knob)
  return k.choices.find((c) => c.id === cond.choice) ?? k.choices[0]
}

/** базовая позиция ползунка = то же, что в контрольном опыте */
export function isBase(cond: Condition): boolean {
  if (cond.knob === 'none') return true
  return cond.choice === knobOf(cond.knob).choices[0].id
}

/* ── как из выбора получаются погони ─────────────────────────────────── */

/** Глаз и погода сидят в EyeConfig, остальное — в сценарии погони. */
export function eyeOf(cond: Condition): EyeConfig {
  if (cond.knob === 'eye') return cond.choice === 'camera' ? EYE_CAMERA : EYE_FLY
  if (cond.knob === 'rain') {
    const noise = cond.choice === 'pour' ? 0.6 : cond.choice === 'drizzle' ? 0.3 : 0
    return { ...EYE_FLY, noisePct: noise }
  }
  return EYE_FLY
}

/** Какие группы нейронов заставить молчать на время опыта. */
export function silencedOf(cond: Condition): number[] {
  if (cond.knob !== 'brain' || cond.choice === 'whole') return []
  return [Number(cond.choice)]
}

/** i-я погоня опыта: та же десятка, что у доски и турнира, с одной поправкой. */
export function scenarioOf(i: number, cond: Condition): ChaseScenario {
  const sc = chaseVariant(i, eyeOf(cond))
  if (cond.knob === 'speed') {
    // Прибавка и убавка нарочно разные: Огонёк бегает 8 м/с, Шустрик — около
    // 6,4. Плюс 1,2 уже почти сравнивает их (догоняет 1 погоню из десяти), а
    // чтобы поимок стало заметно больше, Шустрика надо отпустить далеко назад.
    const d = cond.choice === 'faster' ? 1.2 : cond.choice === 'slower' ? -2.4 : 0
    return { ...sc, v_runner: sc.v_runner + d }
  }
  if (cond.knob === 'path' && cond.choice !== 'set') return { ...sc, maneuver: cond.choice as Maneuver }
  return sc
}

/** строка в таблицу: «Чем смотрит Огонёк: глаз телефона» */
export function condLabel(cond: Condition): string {
  if (cond.knob === 'none') return 'Контрольный опыт: ничего не меняли'
  const k = knobOf(cond.knob)
  return `${k.name}: ${choiceOf(cond)!.short}`
}

/** то же, но коротко — как подписать строку таблицы: «глаз телефона» */
export function condShort(cond: Condition): string {
  if (cond.knob === 'none') return 'ничего не меняли'
  return choiceOf(cond)!.short
}

/* ── журнал класса ───────────────────────────────────────────────────── */

export type LabRun = {
  at: number
  knob: KnobKey | 'none'
  choice: string
  /** длинная подпись: «Чем смотрит Огонёк: глаз телефона» */
  label: string
  /** короткая, для таблицы: «глаз телефона» */
  short: string
  runs: number
  catches: number
  /** средняя ошибка взгляда, °; null — мерить было нечем */
  meanErrDeg: number | null
}

const KEY = 'dogonjalki-lab-v1'
/** больше сорока опытов урок не держит; дальше крутимся, чтобы хранилище
 *  браузера не росло бесконечно */
const MAX = 40

export function loadLab(): LabRun[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as LabRun[]) : []
  } catch {
    return []
  }
}

export function saveRun(run: LabRun): LabRun[] {
  const all = [...loadLab(), run].slice(-MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* приватный режим: таблица только на этот раз */
  }
  return all
}

export function clearLab() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* стирать нечего */
  }
}

/** последний контрольный опыт — с ним сравниваем всё остальное */
export function controlRun(runs: LabRun[]): LabRun | null {
  for (let i = runs.length - 1; i >= 0; i -= 1) if (runs[i].knob === 'none') return runs[i]
  return null
}

/** на сколько поимок опыт отличается от контроля; у самого контроля — null */
export function deltaOf(run: LabRun, control: LabRun | null): number | null {
  if (!control || run.knob === 'none') return null
  return run.catches - control.catches
}

/** как сказать про разницу ребёнку */
export function deltaWord(d: number | null): string {
  if (d === null) return 'сравним с контролем'
  if (d === 0) return 'столько же, сколько в контроле'
  const n = Math.abs(d)
  return `на ${n} ${poimki(n)} ${d > 0 ? 'больше' : 'меньше'}, чем в контроле`
}

/** словоформа к числу поимок: 1 — «поимку», 2–4 — «поимки», 5 и больше — «поимок» */
function poimki(n: number): string {
  if (n === 1) return 'поимку'
  const tail = n % 10
  if (tail >= 2 && tail <= 4) return 'поимки'
  return 'поимок'
}

/** короткая подпись строки таблицы. Берём её из сохранённых ползунка и
 *  варианта, а не из сохранённой надписи: за год формулировки в игре могут
 *  поправиться, и опыт класса не должен показаться подписью из прежней
 *  версии. Поле «short» — запасной вариант на случай, если ползунок или
 *  выбор игре уже неизвестны. */
export function rowShort(r: LabRun): string {
  if (r.knob === 'none') return 'ничего не меняли'
  const k = knobOf(r.knob)
  if (k && k.choices.some((c) => c.id === r.choice)) return condShort({ knob: r.knob, choice: r.choice })
  return r.short || r.label
}

/** вывод по одному ползунку — только факты из таблицы, без додумывания */
export function knobSummary(runs: LabRun[], key: KnobKey, control: LabRun | null): string | null {
  const rows = runs.filter((r) => r.knob === key)
  if (rows.length === 0) return null
  const best = rows.reduce((a, b) => (b.catches > a.catches ? b : a))
  const worst = rows.reduce((a, b) => (b.catches < a.catches ? b : a))
  const vs = control
    ? ` В контрольном опыте, когда ничего не меняли, — ${control.catches} из ${control.runs}.`
    : ' Сравнить пока не с чем: проведи контрольный опыт.'
  const tried = [...new Set(rows.map(rowShort))]
  if (tried.length === 1) return `${knobOf(key).name}: меняли только это — «${tried[0]}», догнал ${best.catches} из ${best.runs}.${vs}`
  if (best.catches === worst.catches) {
    // цифры ровные: врать про «лучше» и «хуже» нельзя — это как раз тот
    // случай, когда опыт честно показал, что перемена ни на что не повлияла
    return `${knobOf(key).name}: ${tried.map((s) => `«${s}»`).join(', ')} — всюду по ${best.catches} из ${best.runs}, разница не видна.${vs}`
  }
  return `${knobOf(key).name}: лучше всех — «${rowShort(best)}» (${best.catches} из ${best.runs}), хуже всех — «${rowShort(worst)}» (${worst.catches} из ${worst.runs}).${vs}`
}

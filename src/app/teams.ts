/** «Соревнование команд»: класс делится на команды, каждая рисует путь, на
 *  котором Огонёк догоняет подольше (или не догоняет вовсе), потом пути
 *  запускаются по очереди на проекторе и получается таблица очков.
 *
 *  Честность — главное в этом экране, поэтому условия для всех одинаковы и
 *  менять их нельзя: бегут врождённый Огонёк и глаз мухи, без помех, с той же
 *  скоростью Шустрика. Отличается только путь. Иначе таблица меряет
 *  не хитрость, а то, кому повезло с кнопками в шапке.
 *
 *  Мера одна и её легко объяснить детям: сколько секунд Огонёк догонял. Кто
 *  не догнал — тот выиграл, это высший результат: путь оказался хитрее.
 *  Длина пути сама по себе не помогает: муха бегает быстрее Шустрика, и
 *  просто «дальше бежать» поймку только приближает.
 *
 *  Пути с именами авторов лежат в браузере и доживают до следующего урока —
 *  это и есть галерея хитрых путей класса. «Новый класс» их стирает. */

import { runContest } from '../board'
import { pathLength, pathScenario } from '../drawPath'
import { EYE_FLY } from '../types'
import { yieldToUi } from '../yield'

export type Score = {
  /** догнал ли Огонёк; false — путь хитрее, это лучший результат */
  caught: boolean
  /** сколько секунд Огонёк догонял (для «не догнал» — сколько продержался) */
  seconds: number
  /** средняя ошибка взгляда, °; null — мерить было нечем */
  errDeg: number | null
  /** когда посчитано */
  at: number
}

export type Team = {
  id: string
  name: string
  /** путь Шустрика в метрах движка; null — команда ещё ничего не придумала */
  path: number[][] | null
  score: Score | null
  /** время команды в «Побудь мухой», с; null — не измеряли */
  befly: number | null
}

const KEY = 'dogonjalki-teams-v1'
/** больше восьми команд урок не помещается на экран, и хранилище не резиновое */
export const MAX_TEAMS = 8
/** короче метра — это не путь, а точка: считать по нему нечего */
export const MIN_PATH_M = 1

/* ── пути в хранилище: компактнее, чем голые числа ────────────────────── */

/** координаты пишутся с шагом 0,1 м — на глаз не видеть разницы, а место в
 *  хранилище экономит; путь от этого остаётся тем же путём.
 *  Отрицательный ноль («−0», выходит из округления чуть ниже нуля) хранилище
 *  превращает в обычный ноль, поэтому приводим его сразу: сохранённый путь
 *  побайтово совпадает с нарисованным. */
const tenth = (v: number) => {
  const r = Math.round(v * 10) / 10
  return Object.is(r, -0) ? 0 : r
}

export function packPath(p: number[][]): number[][] {
  return p.map(([x, y]) => [tenth(x), tenth(y)])
}

/** отличия упакованного пути от оригинала — в долях метра; дальше 0,05 м не
 *  уходит никогда */
export function pathDiff(a: number[][], b: number[][]): number {
  let m = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    m = Math.max(m, Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1]))
  }
  return m
}

/* ── журнал класса ────────────────────────────────────────────────────── */

export function loadTeams(): Team[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as Team[]) : []
    return Array.isArray(list) ? list.map(normalize) : []
  } catch {
    return []
  }
}

/** запись, пришедшая из хранилища (или из чужой версии игры), не должна
 *  уронить экран: недостающие поля становятся пустыми, лишние — неверными */
function normalize(t: Partial<Team> | null): Team {
  const raw = Array.isArray(t?.path) ? (t!.path as number[][]) : null
  // путь короче метра — не путь, а точка: экран с ним считает невозможное,
  // поэтому такие остатки из хранилища выбрасываем
  const path = raw && raw.length >= 2 && pathLength(raw) >= MIN_PATH_M ? raw : null
  const s = t?.score
  const score = s && typeof s.caught === 'boolean' && typeof s.seconds === 'number' ? { ...s, errDeg: typeof s.errDeg === 'number' ? s.errDeg : null } : null
  return {
    id: typeof t?.id === 'string' && t!.id ? t!.id : uid(),
    name: typeof t?.name === 'string' ? t!.name : '',
    path,
    score,
    befly: typeof t?.befly === 'number' && t!.befly > 0 ? t!.befly : null,
  }
}

export function saveTeams(list: Team[]): Team[] {
  const cut = list.slice(0, MAX_TEAMS)
  try {
    localStorage.setItem(KEY, JSON.stringify(cut))
  } catch {
    /* приватный режим: команды остаются только на этот урок */
  }
  return cut
}

export function clearTeams() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* стирать нечего */
  }
}

export function uid(): string {
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

/** имя для новой команды: первое свободное «Команда N» */
export function nextTeamName(list: Team[]): string {
  const taken = new Set(list.map((t) => t.name.trim().toLowerCase()))
  for (let n = 1; n <= MAX_TEAMS + 4; n += 1) {
    const name = `Команда ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
  return `Команда ${list.length + 1}`
}

export function makeTeam(name: string): Team {
  return { id: uid(), name, path: null, score: null, befly: null }
}

/* ── как считается результат ──────────────────────────────────────────── */

/** путь годен к расчёту: точек достаточно и они не слиплись в одну */
export function hasPath(t: Team): boolean {
  return !!t.path && t.path.length >= 2 && pathLength(t.path) >= MIN_PATH_M
}

/** Путь команды в погоню: глаз мухи, врождённый Огонёк, зерно одно и то же —
 *  чтобы таблицы разных уроков сходились. */
export function teamScenario(t: Team) {
  return pathScenario(t.path ?? [], EYE_FLY, 7)
}

/** Прогнать одну команду. Возвращает результат или null, если путь не
 *  задуман (команда ещё ничего не нарисовала). */
export async function runTeam(t: Team): Promise<Score | null> {
  if (!hasPath(t)) return null
  const sc = teamScenario(t)
  const res = await runContest('fly', EYE_FLY, { runs: 1, scenario: () => sc })
  const r = res.perRun[0]
  return { caught: r.hit, seconds: r.tEnd, errDeg: r.errDeg, at: Date.now() }
}

/** Прогнать все команды по очереди, показывая результат каждой, как на
 *  проекторе: ребёнку не нужно ждать, пока посчитается весь класс. */
export async function runAll(
  list: Team[],
  onTeam?: (done: number, total: number, team: Team) => void,
  shouldStop?: () => boolean
): Promise<Team[]> {
  const out: Team[] = []
  const withPath = list.filter(hasPath)
  let done = 0
  for (const t of list) {
    if (!hasPath(t)) {
      out.push(t)
      continue
    }
    if (shouldStop?.()) break
    const score = await runTeam(t)
    const next = { ...t, score }
    out.push(next)
    done += 1
    onTeam?.(done, withPath.length, next)
    await yieldToUi()
  }
  return out
}

/* ── таблица очков ────────────────────────────────────────────────────── */

/** кому принадлежит место: «не догнал» перевешивает любые секунды */
function beats(a: Score, b: Score): boolean {
  if (a.caught !== b.caught) return !a.caught
  return a.seconds > b.seconds
}

/** порядок в таблице: сначала посчитанные по силе пути, потом те, кого ещё
 *  не запускали */
export function rankTeams(list: Team[]): Team[] {
  const scored = list
    .filter((t) => t.score)
    .sort((x, y) => {
      if (beats(x.score!, y.score!)) return -1
      if (beats(y.score!, x.score!)) return 1
      return 0
    })
  const waiting = list.filter((t) => !t.score)
  return [...scored, ...waiting]
}

export function isLeaderboardReady(list: Team[]): boolean {
  return list.filter((t) => t.score).length >= 2
}

/** секунды по-русски: «8,1» — с запятой, как произносим */
export function secWord(n: number): string {
  return n.toFixed(1).replace('.', ',')
}

/** цифра в таблицу: «не догнал» или «8,1 с» */
export function scoreWord(s: Score | null): string {
  if (!s) return 'ещё не бежал'
  return s.caught ? `${secWord(s.seconds)} с` : 'не догнал!'
}

/** что сказать под таблицей про победителя — человеческими словами.
 *  Название команды не оборачиваем в «команда ...»: дефолтное имя и так
 *  звучит как «Команда 1», и получалось «команда «Команда 1»». */
export function winnerWord(list: Team[]): string | null {
  const top = rankTeams(list).find((t) => t.score)
  if (!top?.score) return null
  return top.score.caught
    ? `Хитрее всех путь «${top.name}»: Огонёк догонял ${secWord(top.score.seconds)} с.`
    : `Хитрее всех путь «${top.name}»: Огонёк так и не догнал Шустрика.`
}

/** место в таблице: 1 — 🥇, 2 — 🥈, 3 — 🥉 */
export function medal(rank: number): string {
  return rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : ''
}

/** сколько метров пробежит Шустрик по пути команды — цифра помогает классу
 *  спорить честно: длина сама по себе не делает путь хитрым */
export const teamMeters = (t: Team) => (hasPath(t) && t.path ? Math.round(pathLength(t.path)) : 0)

/** подсказка про длину: её печатать стыдно, если она расходится с мерой */
export function lengthWord(t: Team): string {
  const m = teamMeters(t)
  return m ? `${m} м пути` : 'пути ещё нет'
}

/** время «Побудь мухой» в слова: меньшее — лучшее, поэтому отдельная графа */
export function beflyWord(t: Team): string {
  return t.befly === null ? '—' : `${secWord(t.befly)} с`
}

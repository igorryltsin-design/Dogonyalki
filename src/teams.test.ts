import { beforeEach, describe, expect, it } from 'vitest'
import { PRESETS, pathLength, smoothPath } from './drawPath'
import {
  MAX_TEAMS,
  clearTeams,
  isLeaderboardReady,
  lengthWord,
  loadTeams,
  makeTeam,
  medal,
  nextTeamName,
  packPath,
  pathDiff,
  rankTeams,
  runTeam,
  saveTeams,
  scoreWord,
  teamMeters,
  winnerWord,
  type Score,
  type Team,
} from './app/teams'

/** Соревнование команд мерит одну вещь — хитрость пути. Проверено здесь:
 *  порядок в таблице, слово «не догнал», которое перевешивает любые секунды,
 *  упаковка путей в хранилище и то, что цифры настоящие: их считает движок, а
 *  не фантазия. */

const sc = (caught: boolean, seconds: number): Score => ({ caught, seconds, errDeg: 0.4, at: 1 })
const team = (name: string, score: Score | null, path: number[][] | null = null): Team => ({
  id: name,
  name,
  path,
  score,
  befly: null,
})

describe('таблица очков', () => {
  it('путь, на котором не догнали, — выше любых секунд', () => {
    const list = [team('Змей', sc(true, 24)), team('Угол', sc(false, 3.6)), team('Стрела', sc(true, 8))]
    expect(rankTeams(list).map((t) => t.name)).toEqual(['Угол', 'Змей', 'Стрела'])
  })

  it('команды без результата остаются внизу списка', () => {
    const list = [team('Новые', null), team('Старые', sc(true, 1)), team('Ждут', null)]
    const board = rankTeams(list)
    expect(board[0].name).toBe('Старые')
    expect(board.slice(1).map((t) => t.score)).toEqual([null, null])
  })

  it('первое место — золото, четвёртое — без медали, ждущие — тоже', () => {
    const board = rankTeams([
      team('a', sc(false, 1)),
      team('b', sc(true, 9)),
      team('c', sc(true, 8)),
      team('d', sc(true, 7)),
      team('e', null),
    ])
    // медали считает ранг среди посчитанных: места 0, 1, 2 — 🥇🥈🥉, дальше пусто
    expect(board.map((t, i) => medal(t.score ? i : -1))).toEqual(['🥇', '🥈', '🥉', '', ''])
  })

  it('цифра в таблицу: секунды или «не догнал!»', () => {
    expect(scoreWord(sc(true, 8.14))).toBe('8,1 с')
    expect(scoreWord(sc(false, 3.6))).toBe('не догнал!')
    expect(scoreWord(null)).toBe('ещё не бежал')
  })

  it('победителя называет по имени, а без результатов молчит', () => {
    const win = winnerWord([team('Кочки', sc(false, 4)), team('Лужки', sc(true, 20))])!
    expect(win).toContain('Кочки')
    expect(win).toContain('не догнал')
    expect(winnerWord([team('Одни', null)])).toBe(null)
    // имя «Команда 1» не должно удваиваться в фразе про победителя
    expect(winnerWord([team('Команда 1', sc(false, 4)), team('Команда 2', sc(true, 9))])).not.toMatch(/команда «Команда/i)
  })

  it('звезда даётся, только когда сравнить действительно есть с чем', () => {
    expect(isLeaderboardReady([team('a', sc(true, 5)), team('b', null)])).toBe(false)
    expect(isLeaderboardReady([team('a', sc(true, 5)), team('b', sc(false, 2))])).toBe(true)
  })

  it('метри пути читаются словами', () => {
    const t = team('a', null, Array.from({ length: 21 }, (_, i) => [10 + i, 0]))
    expect(teamMeters(t)).toBe(20)
    expect(lengthWord(t)).toBe('20 м пути')
    expect(lengthWord(team('b', null))).toBe('пути ещё нет')
  })
})

describe('пути в хранилище', () => {
  const zig = smoothPath(PRESETS[0].make())

  it('упаковка с шагом 0,1 м не портит путь', () => {
    if (!zig.ok) throw new Error('зигзаг должен рисоваться')
    const p = packPath(zig.path)
    expect(pathDiff(zig.path, p)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(pathLength(p) - pathLength(zig.path))).toBeLessThan(1)
  })

  beforeEach(() => {
    // узкий круг тестов: хранилище браузера подменяем честной памятью
    const store = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    clearTeams()
  })

  it('журнал класса переживает перезагрузку: сохранили — прочитали то же', () => {
    if (!zig.ok) throw new Error('зигзаг должен рисоваться')
    const list = [{ ...makeTeam('Кочки'), path: packPath(zig.path), score: sc(false, 3.6) }]
    saveTeams(list)
    expect(loadTeams()).toEqual(list)
  })

  it('битая запись не роняет экран: недостающее становится пустым', async () => {
    localStorage.setItem('dogonjalki-teams-v1', '[{"name":"Облом"},{"id":"x","path":[[1,2],[1.2,2]],"score":7,"befly":-1}]')
    const list = loadTeams()
    // у записи без имени имя пустое, но id игра выдаёт — иначе карточки нельзя различить
    expect(list.map((t) => t.name)).toEqual(['Облом', ''])
    expect(list[0].id).toBeTruthy()
    expect(list[1].id).toBe('x')
    // путь в двадцать сантиметров — не путь: команда остаётся «ещё без пути»
    expect(list[0].path).toBe(null)
    expect(list[1].path).toBe(null)
    expect(list[1].score).toBe(null)
    expect(list[1].befly).toBe(null)
    expect(await runTeam(list[1])).toBe(null)
  })

  it('больше восьми команд урок не держит', () => {
    saveTeams(Array.from({ length: MAX_TEAMS + 3 }, (_, i) => makeTeam(`К${i}`)))
    expect(loadTeams().length).toBe(MAX_TEAMS)
  })

  it('имя новой команды не повторяет уже занятые', () => {
    const list = [makeTeam('Команда 1'), makeTeam('Муравьи')]
    expect(nextTeamName(list)).toBe('Команда 2')
    expect(nextTeamName([])).toBe('Команда 1')
  })
})

describe('цифры соревнования настоящие', () => {
  /** берём готовый зигзаг: на нём Огонёк теряет Шустрика */
  function path(name: string): number[][] {
    const p = PRESETS.find((x) => x.name === name)
    const res = smoothPath(p!.make())
    if (!res.ok) throw new Error(`не собрался путь «${name}»`)
    return res.path
  }

  /** прямая того же метража от той же точки старта — честный эталон длины */
  function straightOf(p: number[][]): number[][] {
    const L = pathLength(p)
    const n = Math.max(2, Math.round(L / 0.5))
    return Array.from({ length: n + 1 }, (_, i) => [p[0][0] + (L * i) / n, p[0][1]])
  }

  it('на зигзаге не догоняют, а на прямой такой же длины — догоняют', async () => {
    const zig = path('зигзаг')
    const onZig = await runTeam(team('Зигзаг', null, zig))
    const onLine = await runTeam(team('Прямая', null, straightOf(zig)))
    expect(onZig!.caught).toBe(false)
    expect(onLine!.caught).toBe(true)
    // и в таблице это первое место: «не догнал» перевешивает любые секунды
    const board = rankTeams([team('Прямая', onLine), team('Зигзаг', onZig)])
    expect(board.map((t) => t.name)).toEqual(['Зигзаг', 'Прямая'])
  }, 120_000)

  it('тот же путь — те же секунды: соревнование можно пересчитать', async () => {
    const t = team('Змей', null, packPath(path('петля')))
    const a = await runTeam(t)
    const b = await runTeam(t)
    // время счёта («at») у прогонов разное — оно про часы, а не про результат
    expect({ ...a, at: 0 }).toEqual({ ...b, at: 0 })
  }, 120_000)

  it('без пути команду не считаем и не выдумываем ей результат', async () => {
    expect(await runTeam(team('Пустые', null))).toBe(null)
  })
})

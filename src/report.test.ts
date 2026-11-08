import { beforeEach, describe, expect, it } from 'vitest'
import { MISSIONS, type MissionId } from './app/missions'
import { saveRun, type LabRun } from './app/lab'
import { savePoll, type PollRecord } from './app/predict'
import { saveTeams, type Team } from './app/teams'
import { saveRecord } from './app/befly'
import { buildReport, reportSections, reportText } from './app/report'

/** Отчёт урока собирает чужие журналы и ничего не считает сам. Проверено
 *  здесь: пустой урок не порождает цифр, разделы не теряются, формулировки
 *  приходят из тех же функций, что показывают экраны, а текст страницы и
 *  экранное содержимое — одно и то же. */

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}

const lab = (knob: LabRun['knob'], choice: string, short: string, catches: number): LabRun => ({
  at: 1,
  knob,
  choice,
  label: `Опыт: ${short}`,
  short,
  runs: 10,
  catches,
  meanErrDeg: null,
})

const scored = (name: string, caught: boolean, seconds: number, path: number[][] | null): Team => ({
  id: name,
  name,
  path,
  score: { caught, seconds, errDeg: 0.4, at: 1 },
  befly: null,
})

const poll = (key: PollRecord['key'], guessed: boolean, hands: number): PollRecord => ({
  key,
  q: 'Догонит?',
  votes: [hands, 0],
  right: 'yes',
  guessed,
  hands,
  eye: 'foveal',
  rain: 0,
  at: 1,
})

beforeEach(() => {
  store.clear()
})

describe('пустой урок', () => {
  it('разделы на месте, но цифр игра не выдумывает', () => {
    const r = buildReport(new Set<MissionId>())
    const sections = reportSections(r)
    expect(sections.map((s) => s.title)).toEqual([
      `Задания: 0 звёзд из ${MISSIONS.length}`,
      'Опыты (лаборатория)',
      'Соревнование команд',
      'Побудь мухой: время ученика',
      'Прогнозы класса',
    ])
    // в пустом уроке нет ни одной цифры поимок, секунд и полей: страница
    // обязана честно сказать про каждый пустой раздел
    const text = reportText(r)
    expect(text).toContain('За урок не успели провести ни одного опыта.')
    expect(text).toContain('Команды ещё не считали')
    expect(text).toContain('никто не догнал Шустрика сам')
    expect(text).toContain('Класс ничего не прогнозировал')
    expect(text).not.toMatch(/догнал \d+ из \d+/)
    expect(text).not.toMatch(/\d+,\d+ с/)
  })

  it('ни одна звезда не засчитана без журнала звёзд', () => {
    const r = buildReport(new Set<MissionId>())
    expect(r.stars.every((s) => !s.done)).toBe(true)
    expect(r.stars.length).toBe(MISSIONS.length)
  })
})

describe('журналы попадают в страницу', () => {
  it('звёзды отмечены и склоняются по-русски', () => {
    saveRecord('easy', 5.42)
    const two = buildReport(new Set<MissionId>(['catch', 'lab']))
    expect(two.stars.filter((s) => s.done).length).toBe(2)
    expect(reportSections(two)[0].title).toBe(`Задания: 2 звезды из ${MISSIONS.length}`)
    const one = buildReport(new Set<MissionId>(['catch']))
    expect(reportSections(one)[0].title).toBe(`Задания: 1 звезда из ${MISSIONS.length}`)
    const five = buildReport(new Set<MissionId>(['catch', 'phone', 'rain', 'trick', 'befly']))
    expect(reportSections(five)[0].title).toBe(`Задания: 5 звёзд из ${MISSIONS.length}`)
    // выполненные и невыполненные различимы знаком, а не цветом: страницу печатают
    const lines = reportSections(five)[0].lines
    expect(lines.filter((l) => l.startsWith('★')).length).toBe(5)
    expect(lines.filter((l) => l.startsWith('☆')).length).toBe(MISSIONS.length - 5)
  })

  it('опыты — те же слова, что на экране лаборатории, и вывод из фактов', () => {
    saveRun(lab('none', 'none', 'ничего не меняли', 3))
    saveRun(lab('eye', 'camera', 'глаз телефона', 0))
    const r = buildReport(new Set<MissionId>())
    const lines = reportSections(r)[1].lines
    expect(lines[0]).toContain('ничего не меняли: догнал 3 из 10')
    expect(lines[0]).toContain('линейка')
    expect(lines[1]).toContain('глаз телефона: догнал 0 из 10')
    expect(lines[1]).toContain('на 3 поимки меньше, чем в контроле')
    // вывод по ползунку приходит из knobSummary, а не сочиняется здесь
    expect(lines.some((l) => l.startsWith('Вывод — Чем смотрит Огонёк'))).toBe(true)
  })

  it('равные цифры так и записаны: вывод не хвалит то, что не лучше', () => {
    saveRun(lab('none', 'none', 'ничего не меняли', 3))
    saveRun(lab('rain', 'heavy', 'ливень', 3))
    const lines = reportSections(buildReport(new Set<MissionId>()))[1].lines
    expect(lines[1]).toContain('столько же, сколько в контроле')
    expect(lines.join(' ')).not.toMatch(/лучше всех/)
  })

  it('команды идут в порядке таблицы, а не в порядке добавления', () => {
    const zig = Array.from({ length: 11 }, (_, i) => [10 + i, i % 2 ? 5 : -5])
    saveTeams([scored('Прямая', true, 4.1, [[10, 0], [80, 0]]), scored('Зигзаг', false, 3.6, zig)])
    const r = buildReport(new Set<MissionId>())
    const lines = reportSections(r)[2].lines
    expect(lines[0]).toContain('Зигзаг')
    expect(lines[0]).toContain('не догнал!')
    expect(lines[0]).toMatch(/\d+ м пути/)
    expect(lines[1]).toContain('Прямая')
    expect(lines[1]).toContain('4,1 с')
    expect(lines[2]).toContain('Хитрее всех путь «Зигзаг»')
  })

  it('рекорд «Побудь мухой» — в секундах с запятой, без рекорда — честно пусто', () => {
    saveRecord('easy', 5.42)
    saveRecord('hard', 12.05)
    const lines = reportSections(buildReport(new Set<MissionId>()))[3].lines
    expect(lines[0]).toContain('🐢 лёгкий: 5,4 с')
    expect(lines[1]).toContain('ещё не выигрывали')
    expect(lines[2]).toContain('🐆 трудный: 12,1 с')
  })

  it('прогнозы: сколько спрашивали, сколько угадали и сколько голосов', () => {
    savePoll(poll('dolet', true, 12))
    savePoll(poll('seriya', false, 9))
    const lines = reportSections(buildReport(new Set<MissionId>()))[4].lines
    expect(lines[0]).toContain('Вопросов: 2, большинство угадало: 1')
    expect(lines[1]).toContain('Голосов поднятыми руками: 21')
    expect(lines[2]).toContain('Догонит или нет — угадали 1 из 1')
    expect(lines[2]).toContain('сколько поимок — 0 из 1')
  })
})

describe('страница целиком', () => {
  it('текст для файла и для печати — ровно то, что на экране', () => {
    saveRun(lab('none', 'none', 'ничего не меняли', 3))
    saveTeams([scored('Зигзаг', false, 3.6, Array.from({ length: 11 }, (_, i) => [10 + i, i % 2 ? 5 : -5]))])
    saveRecord('mid', 8.2)
    savePoll(poll('kto', true, 7))
    const r = buildReport(new Set<MissionId>(['teams']))
    const text = reportText(r)
    for (const s of reportSections(r)) {
      expect(text).toContain(s.title)
      for (const l of s.lines) expect(text).toContain(l)
    }
    expect(text).toContain('Догонялки — отчёт урока')
    // дата и время есть — страницу нельзя перепутать с отчётом прошлого урока
    expect(text.split('\n')[1]).toMatch(/\d{1,2} \S+ в \d{2}:\d{2}/)
  })

  it('в тексте нет служебных слов движка и имён файлов', () => {
    const text = reportText(buildReport(new Set<MissionId>(['teams'])))
    expect(text).not.toMatch(/seed|localStorage|catches|errDeg|\.tsx?/)
    expect(text).not.toMatch(/перехват|ракет|поражен|боеголов|снаряд/i)
  })
})

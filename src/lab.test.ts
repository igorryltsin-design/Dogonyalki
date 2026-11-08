import { describe, expect, it } from 'vitest'
import { runContest } from './board'
import { chaseVariant } from './scenarios'
import { EYE_FLY, type ChaseScenario } from './types'
import {
  CONTROL,
  KNOBS,
  condLabel,
  condShort,
  controlRun,
  deltaOf,
  deltaWord,
  eyeOf,
  isBase,
  knobSummary,
  rowShort,
  scenarioOf,
  silencedOf,
  type Condition,
  type LabRun,
} from './app/lab'

/** Главный закон лаборатории — «меняй одно, остальное держи». Проверено так:
 *  после любого выбора опыта в сценарии отличается ровно то поле, о котором
 *  ребёнок и думал. Если правка заденет лишнее, таблица соврёт. */

const BASE = chaseVariant(0, EYE_FLY)

function changedKeys(cond: Condition): string[] {
  const a = scenarioOf(0, cond) as unknown as Record<string, unknown>
  const b = BASE as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

describe('один опыт — одна перемена', () => {
  it('у каждого ползунка первый вариант — базовый', () => {
    for (const k of KNOBS) expect(isBase({ knob: k.key, choice: k.choices[0].id })).toBe(true)
    expect(isBase(CONTROL)).toBe(true)
  })

  it('контрольный опыт не трогает ничего', () => {
    expect(changedKeys(CONTROL)).toEqual([])
    expect(silencedOf(CONTROL)).toEqual([])
  })

  it('глаз меняет только глаз', () => {
    expect(changedKeys({ knob: 'eye', choice: 'camera' })).toEqual(['eye'])
    expect(eyeOf({ knob: 'eye', choice: 'camera' }).grid).toBe('camera')
  })

  it('погода меняет только помехи в глазу', () => {
    const keys = changedKeys({ knob: 'rain', choice: 'pour' })
    expect(keys).toEqual(['eye'])
    expect(eyeOf({ knob: 'rain', choice: 'pour' })).toEqual({ ...EYE_FLY, noisePct: 0.6 })
  })

  it('скорость меняет только скорость Шустрика', () => {
    const cond: Condition = { knob: 'speed', choice: 'faster' }
    expect(changedKeys(cond)).toEqual(['v_runner'])
    expect(scenarioOf(0, cond).v_runner).toBeGreaterThan(BASE.v_runner)
    expect(scenarioOf(0, { knob: 'speed', choice: 'slower' }).v_runner).toBeLessThan(BASE.v_runner)
  })

  it('путь меняет только манёвр, а мозг — только нейроны', () => {
    expect(changedKeys({ knob: 'path', choice: 'dive' })).toEqual(['maneuver'])
    expect(silencedOf({ knob: 'brain', choice: '1' })).toEqual([1])
    expect(changedKeys({ knob: 'brain', choice: '1' })).toEqual([])
    expect(silencedOf({ knob: 'brain', choice: 'whole' })).toEqual([])
  })

  it('выбор подписан по-человечески', () => {
    expect(condLabel({ knob: 'eye', choice: 'camera' })).toContain('глаз телефона')
    expect(condLabel(CONTROL)).toContain('Контрольный')
  })

  it('в подписи опыта не встречается двух двоеточий подряд', () => {
    for (const k of KNOBS) {
      for (const c of k.choices) {
        const l = condLabel({ knob: k.key, choice: c.id })
        expect(l.split(':').length).toBeLessThanOrEqual(2)
      }
    }
  })

  it('разница со контролем склоняется правильно', () => {
    expect(deltaWord(1)).toBe('на 1 поимку больше, чем в контроле')
    expect(deltaWord(2)).toBe('на 2 поимки больше, чем в контроле')
    expect(deltaWord(5)).toBe('на 5 поимок больше, чем в контроле')
    expect(deltaWord(-10)).toBe('на 10 поимок меньше, чем в контроле')
    expect(deltaWord(0)).toBe('столько же, сколько в контроле')
  })
})

describe('цифры опыта настоящие', () => {
  it('с узким глазом телефона догонять хуже, чем с мушиным', async () => {
    const flyEye = await runContest('fly', EYE_FLY, { runs: 10, scenario: (i) => scenarioOf(i, CONTROL) })
    const camera = await runContest('fly', eyeOf({ knob: 'eye', choice: 'camera' }), {
      runs: 10,
      scenario: (i) => scenarioOf(i, { knob: 'eye', choice: 'camera' }),
    })
    expect(camera.catches).toBeLessThan(flyEye.catches)
  }, 60_000)

  it('погони опыта детерминированы: тот же выбор — тот же результат', async () => {
    const cond: Condition = { knob: 'path', choice: 'scissors' }
    const a = await runContest('fly', eyeOf(cond), { runs: 5, scenario: (i) => scenarioOf(i, cond) })
    const b = await runContest('fly', eyeOf(cond), { runs: 5, scenario: (i) => scenarioOf(i, cond) })
    expect(a.catches).toBe(b.catches)
    expect(a.perRun.map((r) => r.tEnd)).toEqual(b.perRun.map((r) => r.tEnd))
  }, 60_000)
})

describe('таблица класса', () => {
  const run = (knob: string, choice: string, short: string, catches: number): LabRun => ({
    at: short.length,
    knob: knob as LabRun['knob'],
    choice,
    label: knob === 'none' ? 'Контрольный опыт: ничего не меняли' : `${knob}: ${short}`,
    short,
    runs: 10,
    catches,
    meanErrDeg: 0.4,
  })
  const rows = [run('none', 'none', 'ничего не меняли', 3), run('eye', 'camera', 'глаз телефона', 0), run('eye', 'fly', 'глаз мухи', 5)]

  it('контроль ищет последний контрольный опыт', () => {
    expect(controlRun(rows)?.catches).toBe(3)
    expect(controlRun([rows[1]])).toBe(null)
  })

  it('разница считается от контроля, а у контроля её нет', () => {
    const c = controlRun(rows)
    expect(deltaOf(rows[1], c)).toBe(-3)
    expect(deltaOf(rows[2], c)).toBe(2)
    expect(deltaOf(rows[0], c)).toBe(null)
  })

  it('вывод по ползунку берёт крайности из таблицы', () => {
    const s = knobSummary(rows, 'eye', controlRun(rows))!
    expect(s).toContain('5 из 10')
    expect(s).toContain('0 из 10')
    expect(s).toContain('глаз мухи')
    expect(s).toContain('глаз телефона')
    expect(s).toContain('В контрольном опыте')
    // имя ползунка уже внутри строки — экрану остаётся напечатать её как есть
    expect(s.startsWith('Чем смотрит Огонёк')).toBe(true)
    expect(knobSummary(rows, 'brain', null)).toBe(null)
  })

  it('вывод про один перепробованный вариант не враньё про крайности', () => {
    const one = [rows[0], rows[1]]
    const s = knobSummary(one, 'eye', controlRun(one))!
    expect(s).toContain('меняли только это')
    expect(s).not.toContain('хуже всех')
  })

  it('равные цифры называются равными, а не «лучше всех»', () => {
    const same = [run('none', 'none', 'ничего не меняли', 3), run('rain', 'drizzle', 'дождик', 3), run('rain', 'pour', 'ливень', 3)]
    const s = knobSummary(same, 'rain', controlRun(same))!
    expect(s).toContain('разница не видна')
    expect(s).toContain('дождик')
    expect(s).toContain('ливень')
    expect(s).not.toContain('лучше всех')
  })

  it('короткая подпись есть у каждого выбора, а у контроля она про отсутствие перемен', () => {
    expect(condShort(CONTROL)).toBe('ничего не меняли')
    for (const k of KNOBS) {
      for (const c of k.choices) expect(condShort({ knob: k.key, choice: c.id })).toBe(c.short)
    }
    // старый опыт, записанный без поля «short», подпись получает из выбора
    const { short, ...old } = rows[1]
    void short
    expect(rowShort(old as unknown as LabRun)).toBe('глаз телефона')
  })

  it('подпись строки всегда та, что у игры сейчас, а не та, что полежала', () => {
    // сохранённая надпись устарела — берём свежую из ползунка и выбора
    expect(rowShort(run('eye', 'camera', 'глаз фотоаппарата', 0))).toBe('глаз телефона')
    // а если выбор игре уже неизвестен, показываем то, что записано
    expect(rowShort(run('eye', 'ultrasound', 'глаз летучей мыши', 0))).toBe('глаз летучей мыши')
  })
})

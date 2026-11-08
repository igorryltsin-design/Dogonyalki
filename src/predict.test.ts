import { describe, expect, it } from 'vitest'
import { EYE_CAMERA, EYE_FLY } from './types'
import {
  judgeOne,
  judgeRace,
  judgeSeries,
  makePoll,
  pollStats,
  savePoll,
  scoreVotes,
  type PollRecord,
} from './app/predict'

/** «Предскажи и проверь» — вся логика здесь чистая: вопрос собирается из
 *  условий урока, правильный ответ диктует исход погони, а счёт класса
 *  складывается из записей. Проверено на этих же условиях и в игре. */

describe('вопрос класса', () => {
  it('серия спрашивает про число поимок из десяти', () => {
    const p = makePoll({ kind: 'ten', who: 'fly', eye: EYE_FLY, drawn: false, kid: true })
    expect(p.key).toBe('seriya')
    expect(p.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(p.q).toContain('10 погонь')
  })

  it('гонка спрашивает, кто догонит первым, и знает обоих бойцов', () => {
    const p = makePoll({ kind: 'race', who: 'fly', rival: 'det', eye: EYE_FLY, drawn: false, kid: true })
    expect(p.key).toBe('kto')
    expect(p.q).toContain('Огонёк')
    expect(p.q).toContain('Сеть-детектор')
    expect(p.options.some((o) => o.id === 'none')).toBe(true)
  })

  it('значок ответа показывает природу бойца, а не порядок в списке', () => {
    const flyFirst = makePoll({ kind: 'race', who: 'fly', rival: 'det', eye: EYE_FLY, drawn: false, kid: true })
    expect(flyFirst.options[0].label.startsWith('🪰')).toBe(true)
    expect(flyFirst.options[1].label.startsWith('🤖')).toBe(true)
    const netFirst = makePoll({ kind: 'race', who: 'kid', rival: 'fly', eye: EYE_FLY, drawn: false, kid: true })
    expect(netFirst.options[0].label.startsWith('🤖')).toBe(true)
    expect(netFirst.options[1].label.startsWith('🪰')).toBe(true)
    expect(netFirst.q).toContain('Полносвязная сеть')
  })

  it('одна погоня спрашивает про исход и называет то, что подкручено', () => {
    const plain = makePoll({ kind: 'one', who: 'fly', eye: EYE_FLY, drawn: false, kid: true })
    expect(plain.key).toBe('dolet')
    expect(plain.q).toContain('в ясную погоду')
    const rain = makePoll({ kind: 'one', who: 'fly', eye: { ...EYE_FLY, noisePct: 0.6 }, drawn: false, kid: true })
    expect(rain.q).toContain('в ливень')
    const cam = makePoll({ kind: 'one', who: 'fly', eye: EYE_CAMERA, drawn: false, kid: true })
    expect(cam.q).toContain('с узкой камерой')
    const drawn = makePoll({ kind: 'one', who: 'fly', eye: EYE_FLY, drawn: true, kid: true })
    expect(drawn.q).toContain('по нарисованному пути')
  })
})

describe('судейство по исходу', () => {
  it('догнал — это «да», промах — «нет»', () => {
    expect(judgeOne('догнал')).toBe('yes')
    expect(judgeOne('промах')).toBe('no')
    expect(judgeOne(null)).toBe('no')
  })

  it('серия раскладывается по четвертям от нуля до десяти', () => {
    expect(judgeSeries(0)).toBe('a')
    expect(judgeSeries(2)).toBe('a')
    expect(judgeSeries(3)).toBe('b')
    expect(judgeSeries(5)).toBe('b')
    expect(judgeSeries(6)).toBe('c')
    expect(judgeSeries(8)).toBe('c')
    expect(judgeSeries(9)).toBe('d')
    expect(judgeSeries(10)).toBe('d')
  })

  it('в гонке побеждает тот, кто догнал раньше, а без поимки — «никто»', () => {
    expect(judgeRace([{ hit: true, t: 5 }, { hit: true, t: 3 }])).toBe('b')
    expect(judgeRace([{ hit: true, t: 5 }, { hit: false, t: 16 }])).toBe('a')
    expect(judgeRace([{ hit: false, t: 16 }, { hit: false, t: 16 }])).toBe('none')
  })
})

describe('счёт голосов', () => {
  const p = makePoll({ kind: 'one', who: 'fly', eye: EYE_FLY, drawn: false, kid: true })

  it('правильно ответившие — это те, кто голосовал за исход погони', () => {
    const s = scoreVotes(p, [12, 5], 'yes')
    expect(s).toEqual({ correct: 12, hands: 17, guessed: true, minority: false })
  })

  it('большинство может и не угадать', () => {
    const s = scoreVotes(p, [4, 11], 'yes')
    expect(s.correct).toBe(4)
    expect(s.guessed).toBe(false)
    expect(s.minority).toBe(true)
  })

  it('никого не посчитали — не о чем и докладывать', () => {
    const s = scoreVotes(p, [0, 0], 'no')
    expect(s.hands).toBe(0)
    expect(s.guessed).toBe(false)
  })

  it('за урок по каждому вопросу своя статистика', () => {
    const rec = (key: PollRecord['key'], guessed: boolean, hands: number): PollRecord => ({
      key,
      q: '—',
      votes: [hands, 0],
      right: 'yes',
      guessed,
      hands,
      eye: 'foveal',
      rain: 0,
      at: 0,
    })
    const st = pollStats([rec('dolet', true, 10), rec('dolet', false, 9), rec('seriya', true, 12)])
    expect(st.asked).toBe(3)
    expect(st.guessed).toBe(2)
    expect(st.hands).toBe(31)
    expect(st.byKey.dolet).toEqual({ asked: 2, guessed: 1 })
    expect(st.byKey.kto).toEqual({ asked: 0, guessed: 0 })
  })

  it('пустое голосование в историю урока не попадает', () => {
    const kept = savePoll({ key: 'dolet', q: '—', votes: [0, 0], right: 'yes', guessed: false, hands: 0, eye: 'foveal', rain: 0, at: 0 })
    expect(kept.filter((r) => r.hands === 0)).toHaveLength(0)
  })
})

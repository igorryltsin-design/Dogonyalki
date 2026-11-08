/** «Предскажи и проверь» — главный приём научного мышления в игре: перед
 *  погоней класс отвечает на вопрос целиком (поднятыми руками, их считает
 *  учитель на этом же экране), погоня идёт, и становится видно, сколько
 *  человек угадало. Никакого сервера и телефонов: на уроке один экран,
 *  голоса считываются руками, счёт живёт в браузере и стирается «Новым
 *  классом» вместе со звёздами.
 *
 *  Правильный ответ всегда берётся из исхода самой погони, а не из головы:
 *  движок сказал «догнал» — значит правильным было «догонит». Поэтому тут
 *  только чистые функции: собрать вопрос, судить по исходу, посчитать счёт
 *  класса. Картинкой заведует ui-kid/PollCard.tsx. */

import type { EyeConfig } from '../types'

export type PollOption = { id: string; label: string }

export type Poll = {
  /** о чём спрашиваем: по исход одной погони, серии или гонки */
  key: 'dolet' | 'seriya' | 'kto'
  q: string
  /** короткая подсказка под вопросом — что именно сейчас под контролем */
  hint: string
  options: PollOption[]
}

export type PollRecord = {
  key: Poll['key']
  q: string
  /** голоса по порядку опций */
  votes: number[]
  /** id правильной опции — её знает только исход погони */
  right: string
  /** угадало ли большинство класса */
  guessed: boolean
  hands: number
  eye: EyeConfig['grid']
  rain: number
  at: number
}

const KEY = 'dogonjalki-predict-v1'
/** урока хватает с запасом; дальше крутимся, чтобы localStorage не рос бесконечно */
const MAX = 60

export function loadPolls(): PollRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PollRecord[]) : []
  } catch {
    return []
  }
}

/** Записать исход голосования. Пустое голосование (никто не поднял руку) не
 *  пишем: это не прогноз, а так и не состоявшийся опыт. */
export function savePoll(rec: PollRecord): PollRecord[] {
  if (rec.hands <= 0) return loadPolls()
  const all = [...loadPolls(), rec]
  const keep = all.slice(-MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(keep))
  } catch {
    /* приватный режим: счёт только на этот раз */
  }
  return keep
}

export function clearPolls() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* стирать нечего */
  }
}

/* ── вопросы ─────────────────────────────────────────────────────────── */

const YES_NO: PollOption[] = [
  { id: 'yes', label: '🪰 Догонит' },
  { id: 'no', label: '🏃 Не догонит' },
]

const BINS: PollOption[] = [
  { id: 'a', label: '0–2' },
  { id: 'b', label: '3–5' },
  { id: 'c', label: '6–8' },
  { id: 'd', label: '9–10' },
]

/** Как назвать бойца в вопросе: малышам — коротко, учителю — как он заван в движке. */
export function pollName(fighter: string, kid: boolean): string {
  if (fighter === 'fly') return 'Огонёк'
  if (fighter === 'cheater') return kid ? 'Робот-читер' : 'Честный читер'
  if (fighter === 'kid') return 'Полносвязная сеть'
  if (fighter === 'cnn') return 'Свёрточная сеть'
  if (fighter === 'det') return 'Сеть-детектор'
  return kid ? 'Робот' : 'Сеть'
}

/** Значок бойца в списке ответов: муха — крылатая, все сети — железные. */
export function pollIcon(fighter: string): string {
  return fighter === 'fly' ? '🪰' : '🤖'
}

export type PollContext = {
  /** один «Пуск», серия из десяти или гонка двух мозгов */
  kind: 'one' | 'ten' | 'race'
  who: string
  rival?: string
  eye: EyeConfig
  drawn: boolean
  /** малышам имена короче и мягче */
  kid: boolean
}

/** Собрать вопрос под текущие условия урока. Выбор неслучайный: то, о чём
 *  честно спросить, диктуют сами условия — какая кнопка нажата, какой глаз
 *  включён, нарисован ли путь. */
export function makePoll(ctx: PollContext): Poll {
  const who = pollName(ctx.who, ctx.kid)
  const weather = ctx.eye.noisePct >= 0.5 ? 'в ливень' : ctx.eye.noisePct > 0 ? 'в дождь' : 'в ясную погоду'
  const narrow = ctx.eye.grid === 'camera'
  const path = ctx.drawn ? 'по нарисованному пути' : ''

  if (ctx.kind === 'ten') {
    return {
      key: 'seriya',
      q: `Сколько раз ${who} догонит Шустрика за 10 погонь?`,
      hint: `глаз ${narrow ? 'камера 13°' : 'мушиный 165°'} · ${weather}`,
      options: BINS,
    }
  }

  if (ctx.kind === 'race' && ctx.rival) {
    const other = pollName(ctx.rival, ctx.kid)
    return {
      key: 'kto',
      q: `Кто догонит первым: ${who} или ${other}?`,
      hint: `один и тот же Шустрик, ${weather}${path ? ' · ' + path : ''}`,
      options: [
        { id: 'a', label: `${pollIcon(ctx.who)} ${who}` },
        { id: 'b', label: `${pollIcon(ctx.rival)} ${other}` },
        { id: 'none', label: '🚫 Никто' },
      ],
    }
  }

  // одна погоня: спрашиваем про исход, а формулировка зависит от того,
  // что на этот раз подкручено — глаз, погода или руки ребёнка
  const how = narrow ? 'с узкой камерой вместо фасеток' : weather
  const tail = path ? `${path}, ${how}` : how
  return {
    key: 'dolet',
    q: `${who} догонит Шустрика ${tail}?`,
    hint: ctx.drawn ? 'путь нарисован руками — по нему Шустрик и побежит' : 'погонь из набора много: какая выпадет — решит «Пуск»',
    options: YES_NO,
  }
}

/* ── судейство: правильный ответ знает только исход ──────────────────── */

export function judgeOne(event: string | null): string {
  return event === 'догнал' ? 'yes' : 'no'
}

export function judgeSeries(catches: number): string {
  if (catches <= 2) return 'a'
  if (catches <= 5) return 'b'
  if (catches <= 8) return 'c'
  return 'd'
}

/** Кто догнал первым: сравнение двух финишей. Не догнал никто — 'none'. */
export function judgeRace(finish: { hit: boolean; t: number }[]): string {
  const winners = finish.filter((f) => f.hit).sort((a, b) => a.t - b.t)
  if (winners.length === 0) return 'none'
  return finish.indexOf(winners[0]) === 0 ? 'a' : 'b'
}

/* ── счёт класса ─────────────────────────────────────────────────────── */

export type PollStats = {
  /** сколько опытов с голосованием проведено */
  asked: number
  /** где большинство класса ответило правильно */
  guessed: number
  hands: number
  /** по каждому вопросу: угадывали ли */
  byKey: Record<Poll['key'], { asked: number; guessed: number }>
}

export function pollStats(recs: PollRecord[]): PollStats {
  const byKey = {
    dolet: { asked: 0, guessed: 0 },
    seriya: { asked: 0, guessed: 0 },
    kto: { asked: 0, guessed: 0 },
  }
  let guessed = 0
  let hands = 0
  for (const r of recs) {
    hands += r.hands
    byKey[r.key].asked += 1
    if (r.guessed) {
      guessed += 1
      byKey[r.key].guessed += 1
    }
  }
  return { asked: recs.length, guessed, hands, byKey }
}

/** Сколько человек ответило правильно и угадало ли большинство. */
export function scoreVotes(poll: Poll, votes: number[], right: string) {
  const correct = votes[poll.options.findIndex((o) => o.id === right)] ?? 0
  const hands = votes.reduce((a, b) => a + b, 0)
  return {
    correct,
    hands,
    guessed: correct > 0 && correct > hands - correct,
    /** правильный ответ в меньшинстве — самый вкусный момент урока */
    minority: correct > 0 && correct * 2 < hands,
  }
}

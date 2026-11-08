/** Режим «Побудь мухой»: три уровня и рекорд на каждом. Ребёнок рулит сам,
 *  поэтому мера тут обратная таблице команд — не «сколько догонял», а «за
 *  сколько секунд ты сам удержал Огонька на цели»: меньше — лучше.
 *
 *  Рекорды лежат в браузере и доживают до следующего урока; «Новый класс»
 *  стирает их вместе со всем остальным. */

export const BEFLY_LEVELS = [
  { key: 'easy', name: '🐢 лёгкий', slow: 0.45 },
  { key: 'mid', name: '🐇 средний', slow: 0.65 },
  { key: 'hard', name: '🐆 трудный', slow: 0.9 },
] as const

export type BeFlyLevel = (typeof BEFLY_LEVELS)[number]['key']

const recKey = (l: BeFlyLevel) => `dogonjalki-befly-record-${l}`

/** рекорд уровня в секундах; null — на этом уровне ещё не выигрывали */
export function loadRecord(l: BeFlyLevel): number | null {
  try {
    const v = localStorage.getItem(recKey(l))
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function saveRecord(l: BeFlyLevel, t: number) {
  try {
    localStorage.setItem(recKey(l), String(t))
  } catch {
    /* приватный режим */
  }
}

/** все три рекорда разом — для отчёта урока */
export function beflyRecords(): { name: string; record: number | null }[] {
  return BEFLY_LEVELS.map((l) => ({ name: l.name, record: loadRecord(l.key) }))
}

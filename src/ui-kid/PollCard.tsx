import type { Poll, PollStats } from '../app/predict'

/** Карточка «Предскажи и проверь»: вопрос классу, руки, счёт.
 *
 *  Учитель держит пульт на своём экране: поднимает руку весь класс, он считает
 *  и нажимает «+1» (или «+5», «+10», если рядов много). Голоса лежат у того,
 *  кто карточку открыл, — сама она ничего не помнит и потому спокойно
 *  закрывается на время погони и возвращается уже с ответом: кто угадал и
 *  сколько человек. Сервера и телефонов тут нет нарочно: урок должен работать
 *  от двойного клика по файлу. */

export type PollResult = {
  /** id и название правильного варианта — их выбрал исход погони */
  rightId: string
  rightLabel: string
  correct: number
  hands: number
  guessed: boolean
  minority: boolean
  /** что сказал движок: «Догнал за 3,4 с» / «не догнал» / «5 из 10» */
  outcome: string
  stats: PollStats
}

export function PollCard({
  poll,
  kid,
  votes,
  result,
  onVote,
  onRun,
  onClear,
  onClose,
}: {
  poll: Poll
  kid: boolean
  votes: number[]
  result: PollResult | null
  onVote: (i: number, d: number) => void
  onRun: () => void
  onClear: () => void
  onClose: () => void
}) {
  const hands = votes.reduce((a, b) => a + b, 0)

  if (result) {
    const s = result.stats
    return (
      <div className="poll poll--result" role="dialog" aria-label="Проверка предсказания">
        <div className="poll__q">
          <b>{result.guessed ? 'Класс угадал! 🎯' : result.minority ? 'Правильно ответил меньшинство 🤔' : 'Мимо 🤷'}</b>
          <span className="hint">{poll.q}</span>
        </div>
        <p className="poll__outcome">{result.outcome}</p>
        <div className="poll__bars">
          {poll.options.map((o, i) => {
            const right = o.id === result.rightId
            return (
              <div key={o.id} className={right ? 'poll__opt poll__opt--right' : 'poll__opt'}>
                <span className="poll__lbl">{o.label}</span>
                <i
                  className="poll__fill"
                  style={{ width: `${result.hands ? Math.round(((votes[i] ?? 0) / result.hands) * 100) : 0}%` }}
                />
                <b className="poll__num">{votes[i] ?? 0}</b>
                {right && <em className="poll__tag">правильно</em>}
              </div>
            )
          })}
        </div>
        <p className="poll__tally">
          Правильно ответили <b>{result.correct}</b> из <b>{result.hands}</b>. Прогнозов за урок: <b>{s.asked}</b>, угадано
          большинством: <b>{s.guessed}</b>.
        </p>
        <div className="hud-line">
          <button className="big big--sm" onClick={onClose}>
            Дальше ▶
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="poll" role="dialog" aria-label="Голосование класса">
      <div className="poll__q">
        <b>{poll.q}</b>
        <span className="hint">{poll.hint}</span>
      </div>
      <div className="poll__opts">
        {poll.options.map((o, i) => (
          <div key={o.id} className="poll__row">
            <span className="poll__lbl">{o.label}</span>
            <div className="poll__count">
              <button type="button" className="poll__minus" aria-label={`убавить: ${o.label}`} onClick={() => onVote(i, -1)}>
                −
              </button>
              <b className="poll__num">{votes[i]}</b>
              <button type="button" className="poll__plus" aria-label={`плюс один: ${o.label}`} onClick={() => onVote(i, 1)}>
                +1
              </button>
              {!kid && (
                <>
                  <button type="button" className="poll__plus" onClick={() => onVote(i, 5)}>
                    +5
                  </button>
                  <button type="button" className="poll__plus" onClick={() => onVote(i, 10)}>
                    +10
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="hud-line">
        <button className="big big--sm" disabled={hands === 0} onClick={onRun}>
          🔮 Проголосовали {hands} — Пуск!
        </button>
        <button className="big big--ghost big--sm" onClick={onClear}>
          Стереть руки
        </button>
        <button className="big big--ghost big--sm" onClick={onClose}>
          Отмена
        </button>
      </div>
      <span className="hint poll__note">
        {kid
          ? 'Кто за этот ответ — подними руку! Считает руки и жмёт «+1» тот, кто за пультом.'
          : 'Подними руку тот, кого касается этот ответ; учитель считает и нажимает «+1».'}
      </span>
    </div>
  )
}

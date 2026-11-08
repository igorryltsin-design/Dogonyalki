import { useState } from 'react'
import type { Place } from '../app/place'

/** Знакомство: три коротких карточки перед игрой — кто такой Огонёк, кто
 *  такой Шустрик и с кем они соревнуются, — и карта игры «где что» с кнопкой
 *  «покажи». Видно при первом входе; потом его открывает кнопка «?» в шапке. */

const SLIDES = [
  {
    pic: '🪰',
    title: 'Это Огонёк — муха-дрозофила',
    text:
      'Её мозг меньше макового зёрнышка, но муха ловко гоняется за другими мухами — настоящие самцы дрозофилы так ухаживают за самками. Учёные нарисовали полную карту мозга мухи: все её нервные клетки и связи. По этой карте собран мозг Огонька — та его часть, что ведёт погоню: десять тысяч настоящих нейронов.',
  },
  {
    pic: '🏃‍♀️',
    title: 'Это Шустрик — убегает и хитрит',
    text:
      'Шустрик петляет, разворачивается и хитрит. Огонёк замечает Шустрика только глазом — фасеточным, из множества маленьких глазков, почти на полкруга вокруг. Никто не подсказывает мухе, где Шустрик и как быстро бежит.',
  },
  {
    pic: '🤖',
    title: 'А это обычные нейросети',
    text:
      'Такие стоят в телефонах и компьютерах. Чтобы научиться, им нужны тысячи картинок с правильными ответами. Муха учится сама. Кто догонит лучше — природа или компьютер? Давай проверим!',
  },
]

/** Карта игры: что где лежит. «Покажи» закрывает знакомство, переводит на
 *  нужный экран и подсвечивает главную кнопку. */
const MAP: { icon: string; name: string; what: string; place: Place }[] = [
  { icon: '🎯', name: 'Играть', what: 'погоня: нажми «▶ Пуск»; нарисуй путь Шустрика; побудь мухой сам', place: { tab: 'arena', spot: 'arena-go' } },
  { icon: '🔬', name: 'Внутри мухи', what: 'что видит глаз, как думает мозг и 🏋️ учёба — здесь тренируется Огонёк и учится робот', place: { tab: 'inside', sub: 'learn', spot: 'learn-fly' } },
  { icon: '🏆', name: 'Турнир', what: 'муха против трёх роботов; «Бойцы» — кто есть кто', place: { tab: 'tour', sub: 'tour', spot: 'tour-go' } },
  { icon: '🧪', name: 'Опыты', what: 'меняешь одно — смотришь, что изменилось; почини муху; эволюция', place: { tab: 'lab', sub: 'lab', spot: 'lab-run' } },
  { icon: '🤝', name: 'Команды', what: 'каждая команда рисует путь — чей хитрее?', place: { tab: 'teams', spot: 'teams-add' } },
]

export function Intro({ onClose, onShow, onTeacher }: { onClose: () => void; onShow: (p: Place) => void; onTeacher?: () => void }) {
  const [i, setI] = useState(0)
  const last = i === SLIDES.length
  return (
    <div className="drawer-modal" role="dialog" aria-label="Знакомство">
      <div className="intro">
        {!last ? (
          <>
            <div className="intro__pic" aria-hidden>
              {SLIDES[i].pic}
            </div>
            <h2>{SLIDES[i].title}</h2>
            <p>{SLIDES[i].text}</p>
          </>
        ) : (
          <>
            <h2>Где что</h2>
            <ul className="intro__map">
              {MAP.map((m) => (
                <li key={m.name}>
                  <span className="intro__mapicon" aria-hidden>{m.icon}</span>
                  <span>
                    <b>{m.name}</b> — {m.what}
                  </span>
                  <button type="button" className="big big--ghost big--sm" onClick={() => onShow(m.place)}>
                    покажи
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint">
              Вверху — чей глаз (🪰 мухи или 📱 телефона) и погода. ⭐ — задания: собери все звёзды! «?» откроет это снова.
            </p>
            {onTeacher && (
              <button type="button" className="linklike" onClick={onTeacher}>
                👩‍🏫 Что есть для учителя
              </button>
            )}
          </>
        )}
        <div className="intro__dots" aria-hidden>
          {[...SLIDES, null].map((_, k) => (
            <i key={k} className={k === i ? 'is-on' : ''} />
          ))}
        </div>
        <div className="hud-line intro__nav">
          {i > 0 && (
            <button className="big big--ghost big--sm" onClick={() => setI(i - 1)}>
              ← назад
            </button>
          )}
          {!last ? (
            <button className="big big--sm" onClick={() => setI(i + 1)}>
              дальше →
            </button>
          ) : (
            <button className="big" onClick={onClose}>
              Поехали!
            </button>
          )}
          {!last && (
            <button className="big big--ghost big--sm" onClick={onClose}>
              пропустить
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

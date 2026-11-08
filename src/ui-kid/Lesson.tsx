import { useEffect, useRef, useState } from 'react'
import type { Place } from '../app/place'

/** «Урок по шагам» для учителя: что показать, куда нажать и что спросить у
 *  класса. Плавающая карточка: учитель ведёт урок, не вспоминая сценарий. */

export type Tab = 'arena' | 'inside' | 'tour' | 'lab' | 'teams'

/** Шаги урока: куда перейти (вкладка, подвкладка) и какую кнопку
 *  подсветить — учитель жмёт «показать», и класс видит, куда смотреть. */
const STEPS: (Place & { title: string; do: string; ask: string })[] = [
  { tab: 'arena', spot: 'help', title: 'Знакомство', do: 'Покажите знакомство (кнопка «?»): Огонёк, Шустрик и роботы-нейросети.', ask: 'Как думаете, кто лучше догоняет — муха или компьютер?' },
  { tab: 'arena', spot: 'arena-go', title: 'Первая погоня', do: 'Нажмите «▶ Пуск» с мухой. Покажите голубой веер — это поле зрения.', ask: 'Куда смотрит муха? Почему веер такой широкий?' },
  {
    tab: 'arena',
    spot: 'arena-poll',
    title: 'Предскажи и проверь',
    do: 'Кнопка 🔮 «спросить класс»: поднимите руки за каждый ответ, посчитайте «+1» и нажмите «Пуск» прямо в карточке. После погони она вернётся с проверкой.',
    ask: 'Сколько человек угадало? Почему в этот раз угадали больше (или меньше), чем в прошлый?',
  },
  { tab: 'arena', spot: 'eye-control', title: 'Глаз телефона', do: 'Переключите вверху на «глаз телефона» и повторите погоню.', ask: 'Почему муха стала промахиваться? Мозг ведь тот же!' },
  { tab: 'inside', sub: 'eye', spot: 'eye-field', title: 'Что видит глаз', do: '«Внутри мухи» → «Что видит глаз». Дайте ученику потаскать Шустрика пальцем.', ask: 'Какой глаз видит больше? А какой — точнее?' },
  { tab: 'arena', spot: 'eye-control', title: 'Дождь', do: 'Включите «ливень». Сыграйте мухой, потом роботом (призрак — второй боец).', ask: 'Кому дождь мешает сильнее?' },
  { tab: 'arena', spot: 'arena-draw', title: 'Обмани муху', do: '«Нарисовать путь»: пусть класс придумает путь, на котором муха не догонит.', ask: 'Какой путь самый хитрый? Почему?' },
  { tab: 'arena', spot: 'arena-befly', title: 'Побудь мухой', do: '«Побудь мухой»: ученик рулит сам, видя только кадр глаза.', ask: 'Легко ли быть мухой? Кто быстрее — ты или Огонёк?' },
  { tab: 'inside', sub: 'brain', spot: 'brain-ko', title: 'Мозг', do: '«Как думает мозг»: выключите нейроны погони и нажмите «▶ 10 погонь».', ask: 'Что сломалось? Значит, зачем нужны эти нейроны?' },
  {
    tab: 'inside',
    sub: 'learn',
    spot: 'learn-fly',
    title: 'Учёба',
    do: '«Учёба»: запустите тренировку Огонька. Пока она идёт (минуту-другую), можно продолжать урок — значок 🏋️ в шапке вернёт сюда.',
    ask: 'Огонёк учится без подсказок — как он понимает, что стал лучше? А как учатся нейросети?',
  },
  { tab: 'lab', sub: 'lab', spot: 'lab-run', title: 'Опыт', do: 'Вкладка «Опыты»: сначала контрольный опыт (ничего не меняем), потом меняем одну вещь — глаз, погоду, путь, скорость Шустрика или часть мозга. Смотрите на полоски.', ask: 'Что изменилось и почему? Почему опыт, где поменяли две вещи сразу, ничего не докажет?' },
  { tab: 'teams', spot: 'teams-add', title: 'Команды', do: 'Вкладка «Команды»: каждая команда рисует путь, потом «▶ Запустить все пути по очереди». Таблица и медали появятся сами.', ask: 'Чей путь оказался хитрее и почему? Почему длинный путь сам по себе ещё не хитрый?' },
  { tab: 'tour', sub: 'who', spot: 'who-try', title: 'Бойцы', do: '«Турнир» → «Бойцы»: кто участвует и как каждый смотрит. Нажмите «далеко» и подвигайте Шустрика.', ask: 'Кто из роботов ошибается, когда Шустрик далеко? Почему?' },
  { tab: 'tour', sub: 'tour', spot: 'tour-go', title: 'Турнир', do: 'Откройте «Турнир» и пьедестал.', ask: 'Кто учится без подсказок? Кто считает больше? Кто победил в дождь?' },
  { tab: 'arena', spot: 'teacher-menu', title: 'Вывод', do: 'Раздайте листок (меню 📋 «Учителю» → «Листок для класса»), в конце — «Отчёт урока».', ask: 'Чем природа решает задачу иначе, чем компьютер?' },
]

export function Lesson({ onGo, onClose }: { onGo: (p: Place) => void; onClose: () => void }) {
  const [i, setI] = useState(0)
  const s = STEPS[i]
  // карточка висит внизу поверх страницы: даём странице запас снизу, чтобы
  // любую подсвеченную кнопку можно было прокрутить выше карточки
  // высота карточки — в переменную: на телефоне прилипающие кнопки (опыт в
  // лаборатории) встают над карточкой, а не под неё
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    document.body.classList.add('has-lesson')
    const el = ref.current
    const ro = el ? new ResizeObserver(() => document.body.style.setProperty('--lesson-h', `${el.offsetHeight + 12}px`)) : null
    if (el && ro) ro.observe(el)
    return () => {
      ro?.disconnect()
      document.body.classList.remove('has-lesson')
      document.body.style.removeProperty('--lesson-h')
    }
  }, [])
  return (
    <aside ref={ref} className="lesson" aria-label="Урок по шагам">
      <div className="lesson__top">
        <b>
          Шаг {i + 1} из {STEPS.length}: {s.title}
        </b>
        <button type="button" className="lesson__x" onClick={onClose} aria-label="закрыть">
          ✕
        </button>
      </div>
      <p>{s.do}</p>
      <p className="lesson__ask">
        <span aria-hidden>💬</span> {s.ask}
      </p>
      <div className="hud-line">
        <button type="button" className="big big--ghost big--sm" disabled={i === 0} onClick={() => setI(i - 1)}>
          ←
        </button>
        <button type="button" className="big big--sm" onClick={() => onGo(s)}>
          показать
        </button>
        <button
          type="button"
          className="big big--alt big--sm"
          disabled={i === STEPS.length - 1}
          onClick={() => {
            setI(i + 1)
            onGo(STEPS[i + 1])
          }}
        >
          дальше →
        </button>
      </div>
    </aside>
  )
}

/** Листок для класса: прогноз до опыта, наблюдения, вывод. Печатается
 *  отдельно от игры (window.print), на одном листе A4. */
export function Worksheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="drawer-modal worksheet-modal" role="dialog" aria-label="Листок для класса">
      <div className="worksheet">
        <div className="worksheet__tools">
          <button type="button" className="big big--sm" onClick={() => window.print()}>
            🖨 Печать
          </button>
          <button type="button" className="big big--ghost big--sm" onClick={onClose}>
            закрыть
          </button>
        </div>
        <h1>Юный нейробиолог: муха против компьютера</h1>
        <p>Имя: ______________________ Класс: ______</p>
        <h2>1. Мой прогноз</h2>
        <p>Кто лучше догонит Шустрика? Обведи: <b>муха Огонёк</b> / <b>робот-нейросеть</b> / <b>поровну</b></p>
        <h2>2. Что я увидел</h2>
        <table>
          <thead>
            <tr>
              <th />
              <th>☀️ ясно</th>
              <th>🌧 ливень</th>
              <th>📱 глаз телефона</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>🪰 Огонёк догнал (из 10)</td>
              <td />
              <td />
              <td />
            </tr>
            <tr>
              <td>🤖 Робот догнал (из 10)</td>
              <td />
              <td />
              <td />
            </tr>
          </tbody>
        </table>
        <h2>3. Побудь мухой</h2>
        <p>Я догнал за ______ секунд. Огонёк — за ______ секунд.</p>
        <h2>4. Опыт с мозгом</h2>
        <p>Когда выключили _______________________, муха ______________________________.</p>
        <h2>5. Мой вывод</h2>
        <p>Муха учится ________________________, а робот-нейросеть учится ________________________.</p>
        <p>Самое интересное сегодня: ____________________________________________</p>
        <div className="worksheet__draw">Нарисуй хитрый путь Шустрика 👇</div>
      </div>
    </div>
  )
}

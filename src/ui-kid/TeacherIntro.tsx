import type { Place } from '../app/place'

/** Первое включение режима учителя: что здесь есть и где. Показывается один
 *  раз; потом — из знакомства («?» → «Что есть для учителя»). */

const ROWS: { icon: string; name: string; what: string; place: Place }[] = [
  { icon: '📋', name: 'Меню «Учителю»', what: 'урок по шагам с подсказками, листок для класса, отчёт урока, «Новый класс» для следующей группы', place: { tab: 'arena', spot: 'teacher-menu' } },
  { icon: '🏋️', name: 'Внутри мухи → Учёба', what: 'тренировка Огонька пробами, «Научи робота сам» и обучение нейросети по карточкам с графиками; учёба мухи идёт в фоне', place: { tab: 'inside', sub: 'learn', spot: 'learn-fly' } },
  { icon: '🧠', name: 'Внутри мухи → Мозг', what: '10 133 нейрона из карты FlyWire; выключите группу и проверьте муху на 10 погонях', place: { tab: 'inside', sub: 'brain', spot: 'brain-ko' } },
  { icon: '🤖', name: 'Турнир → Бойцы', what: 'как устроена каждая сеть: схема слоёв, числа, выученные веса', place: { tab: 'tour', sub: 'who', spot: 'who-try' } },
  { icon: '🏆', name: 'Турнир', what: 'все бойцы на одних погонях: поимки, помехи, цена мозга, «сколько нужно подсказок»', place: { tab: 'tour', sub: 'tour', spot: 'tour-go' } },
  { icon: '🧪', name: 'Опыты', what: 'опыт с одной переменной, почини муху, эволюция, собери глаз, блик на линзе', place: { tab: 'lab', sub: 'lab', spot: 'lab-run' } },
]

export function TeacherIntro({ onClose, onShow, onLesson }: { onClose: () => void; onShow: (p: Place) => void; onLesson: () => void }) {
  return (
    <div className="drawer-modal" role="dialog" aria-label="Режим учителя">
      <div className="intro">
        <div className="intro__pic" aria-hidden>
          👩‍🏫
        </div>
        <h2>Режим учителя: что здесь есть</h2>
        <p className="hint">Здесь видны все цифры, графики и бойцы. Детям на уроке удобнее режим «малыши» (⚙) — меню «Учителю» есть в обоих.</p>
        <ul className="intro__map">
          {ROWS.map((r) => (
            <li key={r.name}>
              <span className="intro__mapicon" aria-hidden>{r.icon}</span>
              <span>
                <b>{r.name}</b> — {r.what}
              </span>
              <button type="button" className="big big--ghost big--sm" onClick={() => onShow(r.place)}>
                покажи
              </button>
            </li>
          ))}
        </ul>
        <div className="hud-line intro__nav">
          <button className="big" onClick={onLesson}>
            📋 Начать урок по шагам
          </button>
          <button className="big big--ghost big--sm" onClick={onClose}>
            понятно
          </button>
        </div>
      </div>
    </div>
  )
}

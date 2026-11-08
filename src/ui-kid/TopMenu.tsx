import { useEffect, useRef, useState, type ReactNode } from 'react'
import { resetClass, useSettings } from '../app/settings'
import { MISSIONS, useStars } from '../app/missions'

/** Звёзды заданий и меню настроек в шапке. */

export function StarsButton({ onOpen }: { onOpen: () => void }) {
  const { done } = useStars()
  return (
    <button type="button" className="stars-btn" data-guide="stars" onClick={onOpen} title="Задания">
      ⭐ {done.size}/{MISSIONS.length}
    </button>
  )
}

export function MissionsPanel({ onClose, onGo }: { onClose: () => void; onGo: (id: string) => void }) {
  const { done } = useStars()
  return (
    <div className="drawer-modal" role="dialog" aria-label="Задания" onClick={onClose}>
      <div className="missions" onClick={(e) => e.stopPropagation()}>
        <h2>Задания</h2>
        <p className="hint">За каждое — звезда. Собери все {MISSIONS.length}!</p>
        <ul>
          {MISSIONS.map((m) => (
            <li key={m.id} className={done.has(m.id) ? 'is-done' : ''}>
              <span className="missions__icon" aria-hidden>{done.has(m.id) ? '⭐' : m.icon}</span>
              <span>
                <b>{m.title}</b>
                <small>{m.why}</small>
              </span>
              {!done.has(m.id) && (
                <button type="button" className="big big--sm" onClick={() => onGo(m.id)}>
                  туда
                </button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="big big--ghost big--sm" onClick={onClose}>
          закрыть
        </button>
      </div>
    </div>
  )
}

export function StarToast() {
  const { fresh, dismiss } = useStars()
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(dismiss, 3200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh])
  if (!fresh) return null
  const m = MISSIONS.find((x) => x.id === fresh)!
  return (
    <div className="star-toast" role="status" onClick={dismiss}>
      <span aria-hidden>⭐</span>
      <span>
        <b>Задание выполнено!</b>
        <small>{m.title}</small>
      </span>
    </div>
  )
}

/** Выпадающее меню у кнопки в шапке. Закрывается само: щелчком мимо, по Esc
 *  и при смене вкладки (шапка пересоздаёт меню). Раньше оно висело, пока
 *  кнопку не нажмут ещё раз, — и мешало. Открывается всегда внутри экрана:
 *  на средних ширинах шапка переносится и кнопка оказывается слева. */
function PopMenu({ icon, label, guide, children }: { icon: string; label: string; guide?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 60, left: 12 })
  const close = () => setOpen(false)
  const toggle = () => {
    const r = btn.current?.getBoundingClientRect()
    if (r) {
      const w = Math.min(320, window.innerWidth - 24)
      const left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))
      setAt({ top: r.bottom + 6, left })
    }
    setOpen((o) => !o)
  }
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (pop.current?.contains(t) || btn.current?.contains(t)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div className="menu">
      <button ref={btn} type="button" data-guide={guide} className={open ? 'menu__btn is-on' : 'menu__btn'} onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={label}>
        {icon}
      </button>
      {open && (
        <div ref={pop} className="menu__pop" role="menu" style={{ top: at.top, left: at.left }}>
          {children(close)}
        </div>
      )}
    </div>
  )
}

/** ⚙ — только настройки самой программы. */
export function SettingsMenu() {
  const s = useSettings()
  return (
    <PopMenu icon="⚙" label="Настройки">
      {(close) => (
        <>
          <div className="menu__row">
            <span>Режим</span>
            <div className="eyebar__seg">
              <button type="button" className={s.mode === 'kid' ? 'is-on' : ''} onClick={() => { s.set({ mode: 'kid' }); close() }}>
                🧒 малыши
              </button>
              <button type="button" className={s.mode === 'teacher' ? 'is-on' : ''} onClick={() => { s.set({ mode: 'teacher' }); close() }}>
                👩‍🏫 учитель
              </button>
            </div>
          </div>
          <label className="menu__row">
            <span>Звук</span>
            <input type="checkbox" checked={s.sound} onChange={(e) => s.set({ sound: e.target.checked })} />
          </label>
          <label className="menu__row">
            <span>Проектор (всё крупнее)</span>
            <input type="checkbox" checked={s.projector} onChange={(e) => s.set({ projector: e.target.checked })} />
          </label>
        </>
      )}
    </PopMenu>
  )
}

/** 📋 — инструменты учителя для урока. Видна в обоих режимах: урок обычно
 *  идёт в режиме малыша, а вести его учитель должен не переключаясь. */
export function TeacherMenu({ onLesson, onWorksheet, onReport }: { onLesson: () => void; onWorksheet: () => void; onReport: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <PopMenu icon="📋" label="Учителю" guide="teacher-menu">
      {(close) => (
        <>
          <div className="menu__title">Учителю</div>
          <button type="button" className="menu__item" onClick={() => { close(); onLesson() }}>
            📋 Урок по шагам
          </button>
          <button type="button" className="menu__item" onClick={() => { close(); onWorksheet() }}>
            🖨 Листок для класса
          </button>
          <button type="button" className="menu__item" onClick={() => { close(); onReport() }}>
            🧾 Отчёт урока
          </button>
          {!confirm ? (
            <button type="button" className="menu__item menu__item--warn" onClick={() => setConfirm(true)}>
              🔄 Новый класс
            </button>
          ) : (
            <div className="menu__confirm">
              <span>Стереть звёзды, обученную муху, сети, рисунки, опыты и пути команд?</span>
              <button type="button" className="big big--warn big--sm" onClick={() => { resetClass(); close() }}>
                да, стереть
              </button>
              <button type="button" className="big big--ghost big--sm" onClick={() => setConfirm(false)}>
                нет
              </button>
            </div>
          )}
        </>
      )}
    </PopMenu>
  )
}

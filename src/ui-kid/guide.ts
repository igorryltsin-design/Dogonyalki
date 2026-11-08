/** Подсветка «вот эта кнопка»: гид, урок по шагам и задания переводят на
 *  нужный экран и на несколько секунд обводят главную кнопку пульсирующей
 *  рамкой. Кнопки помечены data-guide="…"; экран может открыться не сразу
 *  (смена вкладки, загрузка), поэтому ищем несколько кадров подряд.
 *  Светится всегда одна цель: новая подсветка гасит прежнюю, а таймер
 *  прежней не может погасить новую на том же элементе. Если внизу открыта
 *  карточка «Урок по шагам», цель прокручивается так, чтобы карточка её не
 *  закрывала. */

export type Spot =
  | 'help'
  | 'arena-go'
  | 'arena-draw'
  | 'arena-befly'
  | 'arena-poll'
  | 'eye-field'
  | 'brain-ko'
  | 'learn-fly'
  | 'learn-net'
  | 'learn-robot'
  | 'tour-go'
  | 'who-try'
  | 'lab-run'
  | 'lab-control'
  | 'teams-add'
  | 'eye-control'
  | 'stars'
  | 'teacher-menu'

const timers = new WeakMap<HTMLElement, number>()

function clearAll() {
  for (const e of document.querySelectorAll<HTMLElement>('.guide-glow')) {
    e.classList.remove('guide-glow')
    const t = timers.get(e)
    if (t) clearTimeout(t)
  }
}

export function glow(spot: Spot, ms = 4500) {
  clearAll()
  let tries = 0
  const find = () => {
    const els = [...document.querySelectorAll<HTMLElement>(`[data-guide="${spot}"]`)].filter((e) => e.offsetParent !== null)
    if (!els.length) {
      if (++tries < 40) requestAnimationFrame(find)
      return
    }
    const el = els[0]
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const a = el.getBoundingClientRect()
    const lesson = document.querySelector('.lesson')?.getBoundingClientRect()
    // свободная полоса экрана: от шапки до карточки урока (если она внизу)
    const bottom = lesson && lesson.top > innerHeight * 0.3 ? lesson.top - 12 : innerHeight - 12
    const top = 12
    if (a.top < top || a.bottom > bottom) {
      const want = Math.max(top, Math.min((bottom - a.height) / 2, bottom - a.height))
      window.scrollBy({ top: a.top - want, behavior: reduce ? 'auto' : 'smooth' })
    }
    for (const e of els) {
      e.classList.add('guide-glow')
      timers.set(
        e,
        window.setTimeout(() => e.classList.remove('guide-glow'), ms),
      )
    }
  }
  requestAnimationFrame(find)
}

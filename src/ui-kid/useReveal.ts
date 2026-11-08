import { useEffect, useRef } from 'react'

/** Показать результат, если он появился ниже экрана: кнопка вверху, а ответ
 *  дописывается внизу карточки — без прокрутки ребёнок думает, что ничего не
 *  произошло. Срабатывает, когда dep меняется ПОСЛЕ открытия экрана (то,
 *  что уже было сохранено, не листает страницу при входе) и не пустой; если
 *  элемент и так виден — экран не дёргается. */
export function useReveal<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (dep === null || dep === undefined || dep === false) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight || document.documentElement.clientHeight
    if (r.top >= 0 && r.bottom <= vh) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: r.height > vh ? 'start' : 'nearest' })
  }, [dep])
  return ref
}

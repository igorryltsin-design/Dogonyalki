import { useEffect, useRef } from 'react'
import { DRAW_BOX } from '../drawPath'

/** Мини-рисунок пути для таблицы и галереи: то же поле, что и в окне
 *  рисования, только мелко — чтобы класс узнал свою каракулю и на следующем
 *  уроке. Муха слева, точка старта Шустрика — тёмным пятном; mark подсвечивает
 *  команду, которую считают прямо сейчас. */

const W = DRAW_BOX.x1 - DRAW_BOX.x0
const H = DRAW_BOX.y1 - DRAW_BOX.y0

export function PathThumb({ path, width = 220, mark = false }: { path: number[][] | null; width?: number; mark?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cw = c.clientWidth
    const ch = c.clientHeight
    if (c.width !== Math.round(cw * dpr)) {
      c.width = Math.round(cw * dpr)
      c.height = Math.round(ch * dpr)
    }
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#f3f6ec'
    g.fillRect(0, 0, cw, ch)
    const k = cw / W
    const px = (x: number, y: number) => [(x - DRAW_BOX.x0) * k, (DRAW_BOX.y1 - y) * k] as const
    const [fx, fy] = px(0, 0)
    // муха и направление её взгляда
    g.fillStyle = mark ? '#2e9e5b' : 'rgba(46,158,91,0.55)'
    g.beginPath()
    g.arc(fx, fy, 5, 0, Math.PI * 2)
    g.fill()

    if (!path || path.length < 2) {
      g.fillStyle = '#8a8a7a'
      g.font = '600 12px system-ui, sans-serif'
      g.fillText('пути ещё нет', 10, ch / 2)
      return
    }
    g.strokeStyle = mark ? '#d95a3d' : 'rgba(217,90,61,0.75)'
    g.lineWidth = mark ? 3 : 2
    g.lineJoin = 'round'
    g.lineCap = 'round'
    g.beginPath()
    path.forEach((q, i) => {
      const [sx, sy] = px(q[0], q[1])
      if (i === 0) g.moveTo(sx, sy)
      else g.lineTo(sx, sy)
    })
    g.stroke()
    const [sx, sy] = px(path[0][0], path[0][1])
    g.fillStyle = '#7a2a18'
    g.beginPath()
    g.arc(sx, sy, 4, 0, Math.PI * 2)
    g.fill()
  }, [path, mark])

  return <canvas ref={ref} className="thumb" style={{ width, aspectRatio: `${W} / ${H}` }} aria-hidden />
}

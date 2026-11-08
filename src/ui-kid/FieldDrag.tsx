import { useEffect, useRef } from 'react'

/** Поле сверху, по которому ребёнок пальцем таскает Шустрика. Муха стоит
 *  слева и смотрит вправо; на поле нарисованы оба поля зрения — широкий
 *  полукруг мухи и узкий луч телефона, — так видно, кто кого видит.
 *  Координаты — метры движка: x вперёд, y вбок (вниз по экрану — вправо от
 *  мухи, как и в её глазу: Шустрик справа — пятно справа). */

export const FIELD = { x0: -4, x1: 30, y0: -15, y1: 15 }

export function FieldDrag({ pos, onMove, flyHalf, camHalf }: {
  pos: { x: number; y: number }
  onMove: (p: { x: number; y: number }) => void
  flyHalf: number
  camHalf: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)
  const W = FIELD.x1 - FIELD.x0
  const H = FIELD.y1 - FIELD.y0

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')
    if (!g) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cw = c.clientWidth
    const ch = c.clientHeight
    c.width = Math.round(cw * dpr)
    c.height = Math.round(ch * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const k = cw / W
    const px = (x: number, y: number) => [(x - FIELD.x0) * k, (y - FIELD.y0) * k] as const
    g.fillStyle = '#dff0cf'
    g.fillRect(0, 0, cw, ch)
    const [fx, fy] = px(0, 0)
    const fan = (half: number, col: string) => {
      g.fillStyle = col
      g.beginPath()
      g.moveTo(fx, fy)
      g.arc(fx, fy, 40 * k, -half, half)
      g.closePath()
      g.fill()
    }
    fan(flyHalf, 'rgba(46,158,91,0.18)')
    fan(camHalf, 'rgba(47,111,208,0.35)')
    g.font = '600 13px system-ui, sans-serif'
    g.fillStyle = '#1c6e3f'
    g.fillText('видит муха', fx + 16, fy - 0.42 * ch)
    g.fillStyle = '#2f6fd0'
    g.fillText('видит телефон', fx + 9 * k, fy - 4)
    g.font = '28px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('🪰', fx, fy)
    const [rx, ry] = px(pos.x, pos.y)
    g.font = '34px system-ui, sans-serif'
    g.fillText('🏃‍♀️', rx, ry)
    g.strokeStyle = 'rgba(217,90,61,0.8)'
    g.lineWidth = 3
    g.setLineDash([6, 5])
    g.beginPath()
    g.arc(rx, ry, 24, 0, Math.PI * 2)
    g.stroke()
  }, [pos, flyHalf, camHalf, W])

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = FIELD.x0 + ((e.clientX - r.left) / r.width) * W
    const y = FIELD.y0 + ((e.clientY - r.top) / r.height) * H
    // вплотную к мухе не подпускаем: там пятно на весь глаз, ничего не понять
    const d = Math.hypot(x, y)
    if (d < 2) return { x: (x / Math.max(d, 1e-6)) * 2, y: (y / Math.max(d, 1e-6)) * 2 }
    return { x, y }
  }

  return (
    <canvas
      ref={ref}
      className="field-drag"
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        onMove(at(e))
      }}
      onPointerMove={(e) => dragging.current && onMove(at(e))}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      aria-label="Поле: потаскай Шустрика пальцем"
    />
  )
}

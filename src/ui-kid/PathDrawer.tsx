import { useEffect, useRef, useState } from 'react'
import { DRAW_BOX, MIN_START_M, PRESETS, smoothPath } from '../drawPath'

/** Холст «Нарисуй, как убегать»: поле сверху, муха стоит слева и смотрит
 *  вправо, ребёнок ведёт пальцем или мышью — это путь Шустрика. Отпустил —
 *  каракули сглаживаются до пути, по которому можно пробежать, и видно
 *  сразу, что получилось. Можно взять готовую фигуру. */

const W = DRAW_BOX.x1 - DRAW_BOX.x0
const H = DRAW_BOX.y1 - DRAW_BOX.y0

export function PathDrawer({
  initial,
  onDone,
  onCancel,
}: {
  initial: number[][] | null
  onDone: (path: number[][]) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const raw = useRef<number[][]>([])
  const [path, setPath] = useState<number[][] | null>(initial)
  const [why, setWhy] = useState<string | null>(null)
  const drawingRef = useRef(false)

  const toWorld = (e: React.PointerEvent) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    const u = (e.clientX - r.left) / r.width
    const v = (e.clientY - r.top) / r.height
    return [DRAW_BOX.x0 + u * W, DRAW_BOX.y1 - v * H]
  }

  function draw() {
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
    const k = cw / W
    const px = (x: number, y: number) => [(x - DRAW_BOX.x0) * k, (DRAW_BOX.y1 - y) * k] as const
    // луг и клетки по 10 метров — чтобы было видно, далеко ли бежать
    const grd = g.createLinearGradient(0, 0, 0, ch)
    grd.addColorStop(0, '#dff0cf')
    grd.addColorStop(1, '#cfe6bc')
    g.fillStyle = grd
    g.fillRect(0, 0, cw, ch)
    g.strokeStyle = 'rgba(80,120,70,0.16)'
    g.lineWidth = 1
    for (let x = Math.ceil(DRAW_BOX.x0 / 10) * 10; x <= DRAW_BOX.x1; x += 10) {
      const [sx] = px(x, 0)
      g.beginPath()
      g.moveTo(sx, 0)
      g.lineTo(sx, ch)
      g.stroke()
    }
    for (let y = Math.ceil(DRAW_BOX.y0 / 10) * 10; y <= DRAW_BOX.y1; y += 10) {
      const [, sy] = px(0, y)
      g.beginPath()
      g.moveTo(0, sy)
      g.lineTo(cw, sy)
      g.stroke()
    }
    // запретный круг у мухи: отсюда Шустрику стартовать нельзя. Его видно
    // сразу (пунктир и подпись), а не только сообщением после неудачи; если
    // линию начали внутри — круг краснеет прямо во время рисования
    const [fx, fy] = px(0, 0)
    const r0 = MIN_START_M * k
    const first = raw.current[0]
    const bad = !!first && Math.hypot(first[0], first[1]) < MIN_START_M
    g.fillStyle = bad ? 'rgba(217,90,61,0.2)' : 'rgba(46,158,91,0.12)'
    g.beginPath()
    g.arc(fx, fy, r0, 0, Math.PI * 2)
    g.fill()
    g.save()
    g.setLineDash([6, 5])
    g.strokeStyle = bad ? '#d95a3d' : 'rgba(30,110,63,0.55)'
    g.lineWidth = 2
    g.beginPath()
    g.arc(fx, fy, r0, 0, Math.PI * 2)
    g.stroke()
    g.restore()
    if (!path) {
      g.fillStyle = bad ? '#a33b22' : 'rgba(30,110,63,0.85)'
      g.font = '700 13px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText(bad ? 'отсюда нельзя — за круг!' : 'старт Шустрика — за кругом', Math.max(fx, 100), Math.max(14, fy - r0 - 8))
      g.textAlign = 'start'
    }
    // муха и её взгляд
    g.fillStyle = '#2e9e5b'
    g.beginPath()
    g.arc(fx, fy, 9, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#1c6e3f'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(fx + 9, fy)
    g.lineTo(fx + 26, fy)
    g.lineTo(fx + 20, fy - 5)
    g.moveTo(fx + 26, fy)
    g.lineTo(fx + 20, fy + 5)
    g.stroke()
    g.fillStyle = '#1c6e3f'
    g.font = '600 13px system-ui, sans-serif'
    g.fillText('Огонёк', fx - 22, fy + 26)

    const stroke = (pts: number[][], color: string, width: number, dash: number[] = []) => {
      if (pts.length < 2) return
      g.save()
      g.setLineDash(dash)
      g.strokeStyle = color
      g.lineWidth = width
      g.lineJoin = 'round'
      g.lineCap = 'round'
      g.beginPath()
      pts.forEach((q, i) => {
        const [sx, sy] = px(q[0], q[1])
        if (i === 0) g.moveTo(sx, sy)
        else g.lineTo(sx, sy)
      })
      g.stroke()
      g.restore()
    }
    stroke(raw.current, 'rgba(217,90,61,0.35)', 6)
    if (path) {
      stroke(path, '#d95a3d', 4)
      const [sx, sy] = px(path[0][0], path[0][1])
      g.fillStyle = '#d95a3d'
      g.beginPath()
      g.arc(sx, sy, 8, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#7a2a18'
      g.fillText('старт Шустрика', sx + 10, sy - 10)
      const e = path[path.length - 1]
      const p2 = path[path.length - 2]
      const [ex, ey] = px(e[0], e[1])
      const a = Math.atan2(-(e[1] - p2[1]), e[0] - p2[0])
      g.strokeStyle = '#d95a3d'
      g.lineWidth = 4
      g.beginPath()
      g.moveTo(ex - Math.cos(a - 0.5) * 12, ey - Math.sin(a - 0.5) * 12)
      g.lineTo(ex, ey)
      g.lineTo(ex - Math.cos(a + 0.5) * 12, ey - Math.sin(a + 0.5) * 12)
      g.stroke()
    }
  }

  useEffect(() => {
    draw()
    const ro = new ResizeObserver(draw)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const down = (e: React.PointerEvent) => {
    drawingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    raw.current = [toWorld(e)]
    setWhy(null)
    setPath(null)
    draw()
  }
  const move = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const p = toWorld(e)
    const last = raw.current[raw.current.length - 1]
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.4) {
      raw.current.push(p)
      draw()
    }
  }
  const up = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const res = smoothPath(raw.current)
    if (res.ok) {
      setPath(res.path)
      setWhy(null)
    } else {
      setPath(null)
      setWhy(res.why)
    }
  }

  function preset(make: () => number[][]) {
    raw.current = []
    const res = smoothPath(make())
    if (res.ok) {
      setPath(res.path)
      setWhy(null)
    }
  }

  return (
    <div className="drawer">
      <div className="drawer__head">
        <b>Нарисуй, как будет убегать Шустрик</b>
        <span className="hint">Веди пальцем или мышью — начни за пунктирным кругом. Муха стартует слева и смотрит вправо.</span>
      </div>
      <canvas
        ref={ref}
        className="drawer__canvas"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {why && <div className="drawer__why">{why}</div>}
      <div className="drawer__row">
        <span className="chips__cap">или готовый:</span>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => preset(p.make)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="hud-line">
        <button className="big big--sm" disabled={!path} onClick={() => path && onDone(path)}>
          Бежать по этому пути!
        </button>
        <button
          className="big big--ghost big--sm"
          onClick={() => {
            raw.current = []
            setPath(null)
            setWhy(null)
          }}
        >
          Стереть
        </button>
        <button className="big big--ghost big--sm" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  )
}

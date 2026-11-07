import { useEffect, useRef } from 'react'
import { eyeAngles } from './eye'
import type { EyeConfig } from './types'

/** Картинка глаза на canvas: решётка рисуется на своих УГЛОВЫХ позициях —
 *  у мушиного глаза густой центр и редкая периферия, у камеры клеточки ровные.
 *  Порт SeekerView стенда с пропом eye: какая решётка показывается, решает
 *  EyeConfig, а не вызывающий код. Портрет тёмный — как настоящий фасеточный
 *  глаз ночью: светлое пятно = цель, рамка = захват, без захвата — полоса поиска. */

export function SeekerView({
  img,
  eye,
  lock,
  size = 220,
}: {
  img: number[][] | null
  eye: EyeConfig
  lock?: boolean
  size?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef(img)
  const eyeRef = useRef(eye)
  const lockRef = useRef(lock ?? false)
  imgRef.current = img
  eyeRef.current = eye
  lockRef.current = lock ?? false

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.floor(size * dpr)
    canvas.height = Math.floor(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let raf = 0
    const draw = () => {
      const w = size
      const h = size
      const t = performance.now() / 1000
      const image = imgRef.current
      ctx.fillStyle = '#05080a'
      ctx.fillRect(0, 0, w, h)
      const n = image?.length ?? 16
      const pad = 6
      const ax = eyeAngles(eyeRef.current, n)
      const axMin = ax[0]
      const axMax = ax[n - 1]
      const cx = (i: number) => {
        const a = i === 0 ? axMin : i === n ? axMax : (ax[i - 1] + ax[i]) / 2
        return pad + ((a - axMin) / (axMax - axMin)) * (w - pad * 2)
      }
      const cy = (j: number) => {
        const a = j === 0 ? axMin : j === n ? axMax : (ax[j - 1] + ax[j]) / 2
        return pad + ((a - axMin) / (axMax - axMin)) * (h - pad * 2)
      }
      let hot = { i: -1, j: -1, v: 0 }
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const v = Number(image?.[j]?.[i] ?? 0)
          if (v > hot.v) hot = { i, j, v }
          const g = Math.round(16 + v * 230)
          ctx.fillStyle = `rgb(${Math.round(g * 0.32)}, ${g}, ${Math.round(g * 0.66)})`
          const x0 = cx(i)
          const x1 = cx(i + 1)
          const y0 = cy(j)
          const y1 = cy(j + 1)
          ctx.fillRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0 - 1), Math.max(1, y1 - y0 - 1))
        }
      }
      ctx.strokeStyle = 'rgba(125,255,200,0.25)'
      ctx.lineWidth = 1
      ctx.strokeRect(pad + 0.5, pad + 0.5, w - pad * 2 - 1, h - pad * 2 - 1)
      if (lockRef.current && hot.v > 0.25) {
        const bx = cx(hot.i)
        const by = cy(hot.j)
        const cw = cx(hot.i + 1) - bx
        const ch = cy(hot.j + 1) - by
        ctx.strokeStyle = '#e7c15a'
        ctx.lineWidth = 1.4
        const c = 4
        ;[
          [bx, by, 1, 1],
          [bx + cw, by, -1, 1],
          [bx, by + ch, 1, -1],
          [bx + cw, by + ch, -1, -1],
        ].forEach(([x, y, sx, sy]) => {
          ctx.beginPath()
          ctx.moveTo(x + sx * c, y)
          ctx.lineTo(x, y)
          ctx.lineTo(x, y + sy * c)
          ctx.stroke()
        })
      } else {
        const sy = pad + ((t * 40) % (h - pad * 2))
        ctx.fillStyle = 'rgba(125,255,200,0.07)'
        ctx.fillRect(pad, sy, w - pad * 2, 5)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return <canvas className="viewport viewport--seeker" ref={ref} style={{ width: size, height: size }} />
}

import { useEffect, useRef } from 'react'
import { EYE_N, eyeAngles } from '../eye'
import { detHeatmap } from '../rivals'
import { pretrainedNets } from '../precomputed'
import { EYE_FLY } from '../types'

/** «Что видит робот»: тепловая карта робота-искателя (сети-детектора) на том
 *  же кадре, что видит глаз мухи. Чем ярче клеточка, тем увереннее робот, что
 *  Шустрик там. Крестик — куда робот в итоге смотрит, кружок — где Шустрик на
 *  самом деле. Так видно, как робот «думает», и когда он ошибается. */

const frac = (ax: number[], a: number) => {
  if (a <= ax[0]) return 0
  if (a >= ax[ax.length - 1]) return ax.length - 1
  let i = 0
  while (i < ax.length - 2 && ax[i + 1] < a) i += 1
  return i + (a - ax[i]) / (ax[i + 1] - ax[i])
}

export function RobotView({ img, truth, size = 220 }: { img: number[][] | null; truth: { az: number; el: number } | null; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const det = pretrainedNets('foveal')?.det ?? null

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')
    if (!g) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(size * dpr)
    c.height = Math.round(size * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#120a1c'
    g.fillRect(0, 0, size, size)
    if (!img || !det) return
    const heat = detHeatmap(det, img)
    let max = 1e-9
    for (const v of heat) max = Math.max(max, v)
    const cell = size / EYE_N
    let fx = 0
    let fy = 0
    for (let p = 0; p < heat.length; p += 1) {
      const x = p % EYE_N
      const y = Math.floor(p / EYE_N)
      const v = Math.sqrt(heat[p] / max)
      g.fillStyle = `rgba(${Math.round(160 + 95 * v)}, ${Math.round(60 + 120 * v)}, ${Math.round(200 * v + 30)}, ${0.08 + 0.92 * v})`
      g.fillRect(x * cell, y * cell, cell - 1, cell - 1)
      fx += heat[p] * x
      fy += heat[p] * y
    }
    // крестик — куда смотрит робот (центр тяжести карты)
    const cx = (fx + 0.5) * cell
    const cy = (fy + 0.5) * cell
    g.strokeStyle = '#ffffff'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(cx - 9, cy - 9)
    g.lineTo(cx + 9, cy + 9)
    g.moveTo(cx + 9, cy - 9)
    g.lineTo(cx - 9, cy + 9)
    g.stroke()
    // кружок — где Шустрик на самом деле
    if (truth) {
      const ax = eyeAngles(EYE_FLY)
      const tx = (frac(ax, truth.az) + 0.5) * cell
      const ty = (frac(ax, truth.el) + 0.5) * cell
      g.strokeStyle = '#7dff9a'
      g.lineWidth = 3
      g.beginPath()
      g.arc(tx, ty, 13, 0, Math.PI * 2)
      g.stroke()
    }
  }, [img, truth?.az, truth?.el, size, det])

  return <canvas ref={ref} className="robot-view" style={{ width: size, height: size }} aria-label="Тепловая карта робота-искателя" />
}

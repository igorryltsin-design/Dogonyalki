import { useEffect, useRef } from 'react'

/* ── веса картинкой: синее — минус, оранжевое — плюс ──────────────────── */
export function WeightGrid({ w, n, px = 6, title }: { w: ArrayLike<number>; n: number; px?: number; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    c.width = n
    c.height = n
    let m = 1e-9
    for (let i = 0; i < n * n; i += 1) m = Math.max(m, Math.abs(w[i]))
    const im = g.createImageData(n, n)
    for (let i = 0; i < n * n; i += 1) {
      const v = w[i] / m
      const a = Math.abs(v)
      const [r, gg, b] = v >= 0 ? [255, 160, 60] : [60, 120, 230]
      im.data[i * 4] = Math.round(250 - (250 - r) * a)
      im.data[i * 4 + 1] = Math.round(248 - (248 - gg) * a)
      im.data[i * 4 + 2] = Math.round(240 - (240 - b) * a)
      im.data[i * 4 + 3] = 255
    }
    g.putImageData(im, 0, 0)
  }, [w, n])
  return <canvas ref={ref} className="wgrid" title={title} style={{ width: n * px, height: n * px }} />
}


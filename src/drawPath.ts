/** «Нарисуй, как убегать»: из каракулей пальцем — путь, по которому Шустрик
 *  может пробежать. Рука дрожит и ставит точки неровно, поэтому путь
 *  прореживается до шага в полметра и сглаживается (Чайкин): острые углы
 *  превращаются в крутые, но проходимые повороты.
 *
 *  Всё в координатах движка: x — вперёд (откуда начинает муха — с нуля,
 *  носом по +x), y — вбок. */

import { DEFAULT_CHASE, type ChaseScenario, type EyeConfig } from './types'

/** Окно рисования, м: муха стоит в (0, 0) и смотрит вправо. */
export const DRAW_BOX = { x0: -8, x1: 92, y0: -30, y1: 30 }
/** Шустрик не может стартовать вплотную к мухе — иначе погони нет. */
export const MIN_START_M = 7
const STEP = 0.5

function resample(pts: number[][], step: number): number[][] {
  if (pts.length < 2) return pts.slice()
  const out = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    let d = step - carry
    while (d <= seg) {
      const u = d / seg
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u])
      d += step
    }
    carry = seg - (d - step)
  }
  const last = pts[pts.length - 1]
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step * 0.3) out.push(last)
  return out
}

function chaikin(pts: number[][], iterations: number): number[][] {
  let p = pts
  for (let k = 0; k < iterations; k += 1) {
    if (p.length < 3) return p
    const q = [p[0]]
    for (let i = 0; i < p.length - 1; i += 1) {
      const a = p[i]
      const b = p[i + 1]
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    q.push(p[p.length - 1])
    p = q
  }
  return p
}

export const pathLength = (p: number[][]) =>
  p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0)

export type PathCheck = { ok: true; path: number[][] } | { ok: false; why: string }

/** Каракули → проходимый путь, или объяснение, почему так нельзя. */
export function smoothPath(raw: number[][]): PathCheck {
  if (raw.length < 2) return { ok: false, why: 'Нарисуй линию подлиннее' }
  let p = resample(raw, 1.2)
  p = chaikin(p, 3)
  p = resample(p, STEP)
  if (pathLength(p) < 12) return { ok: false, why: 'Путь слишком короткий — Шустрик сразу попадётся' }
  if (Math.hypot(p[0][0], p[0][1]) < MIN_START_M)
    return { ok: false, why: 'Начни подальше от мухи — хотя бы на семь метров' }
  return { ok: true, path: p }
}

/** Готовые фигуры — для тех, кто не хочет рисовать сам. */
export const PRESETS: { key: string; name: string; make: () => number[][] }[] = [
  {
    key: 'zigzag',
    name: 'зигзаг',
    make: () => Array.from({ length: 9 }, (_, i) => [12 + i * 9, i % 2 ? 7 : -7]),
  },
  {
    key: 'loop',
    name: 'петля',
    make: () => {
      const pts: number[][] = []
      for (let i = 0; i <= 40; i += 1) pts.push([12 + i * 0.9, 3])
      for (let i = 0; i <= 60; i += 1) {
        const a = -Math.PI / 2 + (i / 60) * Math.PI * 2
        pts.push([48 + Math.cos(a) * 10, 13 + Math.sin(a) * 10])
      }
      for (let i = 0; i <= 30; i += 1) pts.push([48 + i * 1.2, 3])
      return pts
    },
  },
  {
    key: 'snake',
    name: 'змейка',
    make: () => Array.from({ length: 160 }, (_, i) => [12 + i * 0.5, Math.sin(i / 9) * 12]),
  },
  {
    key: 'back',
    name: 'разворот',
    make: () => {
      const pts: number[][] = []
      for (let i = 0; i <= 30; i += 1) pts.push([14 + i, 4])
      for (let i = 0; i <= 40; i += 1) {
        const a = -Math.PI / 2 + (i / 40) * Math.PI
        pts.push([44 + Math.cos(a) * 9, 13 + Math.sin(a) * 9])
      }
      for (let i = 0; i <= 40; i += 1) pts.push([44 - i, 22])
      return pts
    },
  },
]

/** Погоня по нарисованному пути: всё как обычно, только Шустрик бежит по
 *  линии. Время — сколько нужно, чтобы пробежать путь, плюс запас. */
export function pathScenario(path: number[][], eye: EyeConfig, seed = 1): ChaseScenario {
  const L = pathLength(path)
  return {
    ...DEFAULT_CHASE,
    eye,
    seed,
    maneuver: 'straight',
    n_runner: 0,
    path,
    t_max: Math.max(6, Math.min(25, L / DEFAULT_CHASE.v_runner + 2)),
  }
}

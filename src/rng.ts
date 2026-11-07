/** seeded RNG: один и тот же seed — тот же погон, та же доска, те же карточки.
 *  mulberry32 + Box–Muller поверх него. */

export type Rng = () => number

export function makeRng(seed: number): Rng {
  let a = (seed >>> 0) || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** нормальный шум разброса (Box–Muller), зеркало gauss() стенда */
export function gaussOf(rng: Rng): number {
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

export function hashSeed(...parts: number[]): number {
  let h = 2166136261
  for (const p of parts) {
    let x = Math.round(p * 1000) | 0
    for (let i = 0; i < 4; i += 1) {
      h ^= x & 0xff
      h = Math.imul(h, 16777619)
      x >>>= 8
    }
  }
  return h >>> 0
}

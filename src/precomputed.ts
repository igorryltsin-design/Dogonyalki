/** Заранее посчитанные турниры, графики «сколько подсказок» и обученные
 *  роботы-нейросети — чтобы малышам не ждать. Считает их tools/precompute.ts
 *  тем же движком и с теми же зёрнами, что и кнопка «посчитать заново». */

import raw from './data/precomputed.json'
import type { KidNet } from './kidBrain'
import type { CnnNet, DetNet } from './rivals'
import type { ExamplesCurve, TournamentResult } from './tournament'

type StoredNet = { kind?: string; fingerprint: string; trained: boolean; [k: string]: unknown }
type Raw = {
  tournaments: Record<string, TournamentResult>
  curves: Record<string, ExamplesCurve>
  nets: Record<string, { mlp: KidNet; cnn: StoredNet; det: StoredNet }>
}

export const precomputed = () => raw as unknown as Raw

const toF32 = (n: StoredNet) => {
  const out: Record<string, unknown> = { ...n }
  for (const [k, v] of Object.entries(n)) if (Array.isArray(v) && typeof v[0] === 'number') out[k] = Float32Array.from(v as number[])
  return out
}

/** готовые роботы для решётки глаза (обучены в ясную погоду) */
export function pretrainedNets(grid: 'foveal' | 'camera'): { mlp: KidNet; cnn: CnnNet; det: DetNet } | null {
  const n = precomputed().nets[grid]
  if (!n) return null
  return { mlp: n.mlp, cnn: toF32(n.cnn) as unknown as CnnNet, det: toF32(n.det) as unknown as DetNet }
}

/** Считает заранее турниры, графики «сколько подсказок» и обученных роботов
 *  для обоих глаз и трёх погод. Запуск: npx vite-node tools/precompute.ts
 *  Результат — src/data/precomputed.json; игра берёт его, пока в браузере не
 *  посчитали своё. Тот же движок и те же зёрна — цифры совпадут. */

import { writeFileSync } from 'node:fs'
import { examplesCurve, runTournament } from '../src/tournament'
import { EYE_CAMERA, EYE_FLY, eyeFingerprint } from '../src/types'

const round = (x: number) => Math.round(x * 1e4) / 1e4
const plain = (net: object) => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(net)) {
    if (v instanceof Float32Array) out[k] = Array.from(v, round)
    else if (Array.isArray(v)) out[k] = JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'number' ? round(x) : x)))
    else out[k] = v
  }
  return out
}

const out = { tournaments: {} as Record<string, unknown>, curves: {} as Record<string, unknown>, nets: {} as Record<string, unknown> }
for (const base of [EYE_FLY, EYE_CAMERA]) {
  for (const noise of [0, 0.3, 0.6]) {
    const eye = { ...base, noisePct: noise }
    const fp = eyeFingerprint(eye)
    const t0 = Date.now()
    const t = await runTournament(eye)
    const { nets, ...light } = t
    out.tournaments[fp] = light
    if (noise === 0 && nets) out.nets[base.grid] = { mlp: plain(nets.mlp), cnn: plain(nets.cnn), det: plain(nets.det) }
    out.curves[fp] = await examplesCurve(eye)
    console.log(fp, 'готово за', Math.round((Date.now() - t0) / 1000), 'с')
  }
}
writeFileSync(new URL('../src/data/precomputed.json', import.meta.url), JSON.stringify(out))
console.log('записано src/data/precomputed.json')
// vite-node не завершается сам: его держат открытые каналы уступки потока
process.exit(0)

/** Разовая мерка: сколько стоит прогнать сценарии заранее, чтобы поле
 *  построить вокруг настоящего пути, и как далеко этот путь уводит вбок.
 *  Запуск: npx vite-node tools/measure-lane.ts */
import { localRun } from '../src/localSim'
import { chaseVariant } from '../src/scenarios'
import { DEFAULT_CHASE, EYE_FLY } from '../src/types'

function runOne(sc: ReturnType<typeof chaseVariant>) {
  let maxAbs = 0
  let n = 0
  for (const fr of localRun(sc, { pilot: 'fly' })) {
    n += 1
    maxAbs = Math.max(maxAbs, Math.abs(fr.runner[1]), Math.abs(fr.chaser[1]))
  }
  return { maxAbs, n }
}

const t0 = performance.now()
let worst = 0
let frames = 0
for (let i = 0; i < 10; i += 1) {
  const r = runOne(chaseVariant(i, EYE_FLY))
  worst = Math.max(worst, r.maxAbs)
  frames += r.n
}
const t1 = performance.now()
console.log('×10 вбок максимум, м:', worst.toFixed(1), 'кадров:', frames, 'время серии:', (t1 - t0).toFixed(0), 'мс')

const s0 = performance.now()
const single = runOne({ ...DEFAULT_CHASE, eye: EYE_FLY, seed: 1 })
console.log('×1 вбок максимум, м:', single.maxAbs.toFixed(1), 'кадров:', single.n, 'время:', (performance.now() - s0).toFixed(0), 'мс')

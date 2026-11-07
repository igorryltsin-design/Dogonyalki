/** Тренировка мухи в игре: она рождается с врождённым рефлексом (defaultW) и
 *  доучивается догонять прямо здесь, на погонях из scenarios.ts. Тот же
 *  дельта-шаг, что в стенде (brain.sgd), только задача — догонялки.
 *  Цикл асинхронный и уступает браузеру: прогресс и «Стоп» работают во время учёбы. */

import { getW, isTrained, markTrained, resetBrain } from './brain'
import { localRun } from './localSim'
import { chaseVariant } from './scenarios'
import type { EyeConfig, TrainPointLite } from './types'
import { yieldToUi } from './yield'

/** Врождённая ли ещё муха (никто её не тренировал в этой сессии). */
export function flyIsInnate(): boolean {
  return !isTrained()
}

export async function trainFly(
  eye: EyeConfig,
  episodes = 30,
  onProgress?: (ep: number, total: number, point: TrainPointLite) => void,
  lr = 0.04,
  shouldStop?: () => boolean,
): Promise<TrainPointLite[]> {
  const points: TrainPointLite[] = []
  for (let ep = 0; ep < episodes; ep += 1) {
    if (shouldStop?.()) break
    const sc = chaseVariant(ep, eye)
    let hit = false
    let locks = 0
    let frames = 0
    let errSum = 0
    let errN = 0
    let i = 0
    let interrupted = false
    for (const fr of localRun(sc, { pilot: 'fly', learn: true, lr })) {
      frames += 1
      if (fr.lock) locks += 1
      if (fr.look_err_deg !== null) {
        errSum += fr.look_err_deg
        errN += 1
      }
      if (fr.event === 'догнал') hit = true
      i += 1
      if (i % 16 === 0) {
        await yieldToUi()
        if (shouldStop?.()) {
          interrupted = true
          break
        }
      }
    }
    if (interrupted) break
    const W = getW()
    const point: TrainPointLite = {
      ep: ep + 1,
      hit,
      lockFrac: frames ? locks / frames : 0,
      meanErrDeg: errN ? errSum / errN : null,
      w: [...W[0], ...W[1]],
    }
    points.push(point)
    onProgress?.(ep + 1, episodes, point)
    await yieldToUi()
  }
  if (points.length > 0) markTrained()
  return points
}

/** Вернуть муху в врождённое состояние: доска должна уметь показывать «до тренировки». */
export function resetFly() {
  resetBrain()
}

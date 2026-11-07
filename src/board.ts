/** Доска результатов: серия из десяти одинаковых погонев для каждого бойца.
 *
 *  Две меры, ровно как в курсе:
 *  — поимки из десяти — сколько погонев закончились касанием;
 *  — ошибка взгляда, ° — средняя разница «куда смотрю» против «где на самом
 *    деле», по кадрам, где глазу было на что смотреть.
 *
 *  Детерминизм: погони берутся из chaseVariant(i) с их зерном — тот же
 *  запуск доски даёт те же цифры. */

import { localRun } from './localSim'
import { chaseVariant } from './scenarios'
import type { EyeConfig, Pilot } from './types'
import { yieldToUi } from './yield'

export type ContestResult = {
  pilot: Pilot
  eye: EyeConfig
  runs: number
  catches: number
  /** средняя ошибка взгляда по всем результативным кадрам, °; null — мерить нечем */
  meanErrDeg: number | null
  perRun: { seed: number; hit: boolean; errDeg: number | null; tEnd: number }[]
}

export type ContestOpts = {
  runs?: number
  predict?: (img: number[][]) => { az: number; el: number }
  onRun?: (done: number, total: number) => void
  shouldStop?: () => boolean
}

export async function runContest(pilot: Pilot, eye: EyeConfig, opts?: ContestOpts): Promise<ContestResult> {
  const runs = opts?.runs ?? 10
  const perRun: ContestResult['perRun'] = []
  let catches = 0
  let errSum = 0
  let errFrames = 0
  for (let i = 0; i < runs; i += 1) {
    if (opts?.shouldStop?.()) break
    const sc = chaseVariant(i, eye)
    let hit = false
    let errRun = 0
    let nRun = 0
    let tEnd = 0
    for (const fr of localRun(sc, { pilot, predict: opts?.predict })) {
      tEnd = fr.t
      if (fr.look_err_deg !== null) {
        errRun += fr.look_err_deg
        nRun += 1
      }
      if (fr.event === 'догнал') hit = true
    }
    if (hit) catches += 1
    if (nRun > 0) {
      errSum += errRun
      errFrames += nRun
    }
    perRun.push({ seed: sc.seed, hit, errDeg: nRun ? errRun / nRun : null, tEnd })
    opts?.onRun?.(i + 1, runs)
    await yieldToUi()
  }
  return {
    pilot,
    eye,
    runs,
    catches,
    meanErrDeg: errFrames ? errSum / errFrames : null,
    perRun,
  }
}

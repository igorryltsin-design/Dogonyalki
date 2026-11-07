/** Набор погон-сценариев: один и тот же ChaseVariant получает и доска, и
 *  генератор карточек, и арена — чтобы цифры были про одну и ту же игру. */

import type { ChaseScenario, EyeConfig, Maneuver } from './types'
import { DEFAULT_CHASE } from './types'

/** кроме «прямо»: убегающий в игре всегда петляет, straight — редкий гость */
export const MANEUVERS: Maneuver[] = ['weave', 'scissors', 'dive', 'turn', 'combo', 'straight']

/** Вариант погоня №i: манёвр, сбоку, дальность и скорость Шустрика меняются
 *  по кругу, зерно — своё. Детерминировано: тот же i — тот же погон. */
export function chaseVariant(i: number, eye: EyeConfig): ChaseScenario {
  const maneuver = MANEUVERS[i % MANEUVERS.length]
  return {
    ...DEFAULT_CHASE,
    eye,
    maneuver,
    n_runner: maneuver === 'straight' ? 0 : 1 + (i % 3) * 0.2,
    off_axis_m: 2 + (i % 4) * 2.2,
    range_m: 13 + (i % 3) * 3.5,
    v_runner: 6.2 + (i % 4) * 0.3,
    seed: 1000 + i * 7,
  }
}

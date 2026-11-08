/** Тренировка Огонька — общая на всё приложение. Раньше она жила внутри
 *  экрана мозга и обрывалась, стоило перейти на другую вкладку, а учится муха
 *  минуту-другую: кто-нибудь в классе обязательно уйдёт смотреть арену. Теперь
 *  учёба идёт сама по себе, экраны только подписываются на её ход, а в шапке
 *  висит значок «Огонёк учится», по которому можно вернуться. */

import { useSyncExternalStore } from 'react'
import { getSteer } from '../connectome'
import { trainFly, type TrialReport } from '../trainLocal'
import type { EyeConfig } from '../types'
import { play } from './sound'

export type TrainingState = {
  running: boolean
  /** учёба закончилась (не прервана) — можно похвалить */
  finished: boolean
  iter: number
  total: number
  /** все пробы по порядку: для графика */
  tries: { iter: number; hits: number; accepted: boolean; bestHits: number }[]
  /** последняя проба целиком: следы погонь для карты */
  last: TrialReport | null
  /** лучшая проба: её следы показываем рядом */
  best: TrialReport | null
  /** руль сейчас (лучший найденный) */
  steer: number[]
  startedAt: number
}

const idle = (): TrainingState => ({ running: false, finished: false, iter: 0, total: 0, tries: [], last: null, best: null, steer: getSteer(), startedAt: 0 })

let state: TrainingState = idle()
let stop = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const set = (patch: Partial<TrainingState>) => {
  state = { ...state, ...patch }
  emit()
}

export function trainingState() {
  return state
}

export function useFlyTraining(): TrainingState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
}

export function isTraining() {
  return state.running
}

export async function startTraining(eye: EyeConfig) {
  if (state.running) return
  stop = false
  set({ ...idle(), running: true, startedAt: performance.now() })
  await trainFly(
    eye,
    30,
    undefined,
    0.04,
    () => stop,
    (r) => {
      const tries = [...state.tries, { iter: r.iter, hits: r.hits, accepted: r.accepted, bestHits: r.bestHits }]
      const best = r.accepted ? r : state.best
      if (r.accepted && r.iter > 0) play('star')
      set({ iter: r.iter, total: r.total, tries, last: r, best, steer: getSteer() })
    },
  )
  set({ running: false, finished: !stop, steer: getSteer() })
  if (!stop) play('catch')
}

export function stopTraining() {
  stop = true
}

/** Забыть показ прошлой учёбы (сама муха остаётся обученной). */
export function clearTraining() {
  if (!state.running) set(idle())
}

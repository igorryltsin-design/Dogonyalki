/** Тренировка мухи в игре: она рождается с врождённым рефлексом (defaultW) и
 *  доучивается догонять прямо здесь, на погонях из scenarios.ts. Тот же
 *  дельта-шаг, что в стенде (brain.sgd), только задача — догонялки.
 *  Цикл асинхронный и уступает браузеру: прогресс и «Стоп» работают во время учёбы. */

import { getFlyBrain, getW, isTrained, markTrained, resetBrain } from './brain'
import { getSteer, markConnectomeTrained, resetConnectomeReadout, setSilenced, setSteer, silenced } from './connectome'
import { gaussOf, makeRng } from './rng'
import { localRun } from './localSim'
import { chaseVariant } from './scenarios'
import type { EyeConfig, TrainPointLite } from './types'
import { yieldToUi } from './yield'

/** Врождённая ли ещё муха (никто её не тренировал в этой сессии). */
export function flyIsInnate(): boolean {
  return !isTrained()
}

/* ── учёба пробами (мозг из коннектома) ──────────────────────────────
 * Муха чуть меняет руль — четыре числа: сила поворота, сила набора высоты и
 * два упреждения, — пробует погони и оставляет изменение, если стало лучше:
 * догнала, догнала быстрее или подобралась ближе. Правильных ответов ей
 * никто не даёт. Учится на своих погонях (№ 10–15), а проверяют её на других
 * (№ 0–9 и «незнакомая погоня») — иначе это была бы не учёба, а зубрёжка. */

export const TRIAL_CHASES = [10, 11, 12, 13, 14, 15]
// 48 раундов проб (было 16): опыт показал, что с теми же четырьмя числами муха
// ловит на обычных погонях столько же (7 из 10), а в незнакомых — 4 вместо 1:
// руль становится не точнее, а общее. Больше чисел, наоборот, вредит — муха
// подгоняет руль под свои шесть учебных погонь и хуже ловит на остальных.
export const TRIAL_ITERS = 48

/** Одна попытка: как прошли шесть учебных погонь с пробным рулём. Следы
 *  прорежены (каждый пятый кадр) — их рисует панель обучения. */
export type TrialChase = { hit: boolean; t: number; fly: number[][]; run: number[][] }
export type TrialReport = {
  /** 0 — проверка исходного руля, дальше — номер пробы */
  iter: number
  total: number
  hits: number
  f: number
  /** проба оказалась лучше и муха её оставила */
  accepted: boolean
  /** лучший результат на сейчас */
  bestHits: number
  bestF: number
  /** руль, который проверяли в этой пробе */
  steer: number[]
  chases: TrialChase[]
}

/** Учёба идёт в тех же кадрах браузера, что игра: пока муха «думает», между
 *  кусочками счёта на экране может бежать другая погоня. Поэтому в каждом
 *  кусочке учёба ставит свой пробный руль и снимает выключатели нейронов, а
 *  перед паузой возвращает всё как было — чужие погони видят лучший руль на
 *  сейчас и свои выключатели, а не случайную пробу. */
async function trialFitness(
  eye: EyeConfig,
  cand: number[],
  home: () => number[],
  shouldStop?: () => boolean,
): Promise<{ f: number; hits: number; chases: TrialChase[] }> {
  let f = 0
  let hits = 0
  const chases: TrialChase[] = []
  let ui = silenced()
  const enter = () => {
    ui = silenced()
    setSilenced(new Set())
    setSteer(cand)
  }
  const leave = () => {
    setSteer(home())
    setSilenced(ui)
  }
  enter()
  try {
    for (const i of TRIAL_CHASES) {
      const sc = chaseVariant(i, eye)
      let minR = 99
      let hit = false
      let t = 0
      let k = 0
      const fly: number[][] = []
      const run: number[][] = []
      for (const fr of localRun(sc, { pilot: 'fly' })) {
        minR = Math.min(minR, fr.range_m)
        t = fr.t
        if (fr.event === 'догнал') hit = true
        if (k % 5 === 0) {
          fly.push([fr.chaser[0], fr.chaser[1]])
          run.push([fr.runner[0], fr.runner[1]])
        }
        k += 1
        if (k % 40 === 0) {
          leave()
          await yieldToUi()
          if (shouldStop?.()) return { f: -1e9, hits, chases }
          enter()
        }
      }
      if (hit) hits += 1
      f += hit ? 2 + (sc.t_max - t) / sc.t_max : -minR / 5
      chases.push({ hit, t, fly, run })
    }
  } finally {
    leave()
  }
  return { f, hits, chases }
}

async function trainByTrials(
  eye: EyeConfig,
  iters: number,
  onProgress?: (ep: number, total: number, point: TrainPointLite) => void,
  shouldStop?: () => boolean,
  onTry?: (r: TrialReport) => void,
): Promise<TrainPointLite[]> {
  const rng = makeRng(5)
  let p = getSteer()
  const home = () => p
  const first = await trialFitness(eye, p, home, shouldStop)
  let best = first
  onTry?.({ iter: 0, total: iters, hits: first.hits, f: first.f, accepted: true, bestHits: first.hits, bestF: first.f, steer: [...p], chases: first.chases })
  const points: TrainPointLite[] = []
  for (let it = 0; it < iters; it += 1) {
    if (shouldStop?.()) break
    const q = p.map((x) => x + gaussOf(rng) * 0.4)
    const r = await trialFitness(eye, q, home, shouldStop)
    if (shouldStop?.()) break
    const accepted = r.f > best.f
    if (accepted) {
      best = r
      p = q
    }
    setSteer(p)
    onTry?.({ iter: it + 1, total: iters, hits: r.hits, f: r.f, accepted, bestHits: best.hits, bestF: best.f, steer: [...q], chases: r.chases })
    const point: TrainPointLite = {
      ep: it + 1,
      hit: best.hits > 0,
      lockFrac: best.hits / TRIAL_CHASES.length,
      meanErrDeg: null,
      w: [...p],
    }
    points.push(point)
    onProgress?.(it + 1, iters, point)
    await yieldToUi()
  }
  return points
}

export async function trainFly(
  eye: EyeConfig,
  episodes = 30,
  onProgress?: (ep: number, total: number, point: TrainPointLite) => void,
  lr = 0.04,
  shouldStop?: () => boolean,
  onTry?: (r: TrialReport) => void,
): Promise<TrainPointLite[]> {
  if (getFlyBrain() === 'connectome') {
    // у мозга из коннектома число проб своё: episodes относится к компактному мозгу
    const pts = await trainByTrials(eye, TRIAL_ITERS, onProgress, shouldStop, onTry)
    if (pts.length > 0) {
      markTrained()
      markConnectomeTrained()
    }
    return pts
  }
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
  if (points.length > 0) {
    markTrained()
    markConnectomeTrained()
  }
  return points
}

/** Вернуть муху в врождённое состояние: доска должна уметь показывать «до тренировки». */
export function resetFly() {
  resetBrain()
  resetConnectomeReadout()
}

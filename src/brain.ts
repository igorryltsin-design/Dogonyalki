/** Обучаемый выход контура в окне, если сервер молчит. Схема v3: 10 признаков
 * + 14 столбцов рекуррентных состояний (t4/t5/lc11/lc10) в readout.
 *
 * Миграция: старые веса 2×8 (без theta/rho) и 2×10 (без состояний) дополняются
 * нулями на новых столбцах — выученная политика не меняется до дообучения. */

import { FEATURE_SCHEMA_VERSION, type BrainKind } from './types'

export const FEAT = 10
const LEGACY_FEAT = 8
/** столбцы состояний схемы v3: t4 (4) + t5 (4) + lc11 (4) + lc10 (2) — зеркало navedenie/circuit.py */
export const STATE_COLUMNS = 14
export const READOUT = FEAT + STATE_COLUMNS
/** старые столбцы v1 (az, el, ωβ, ωλ, loom, Φx, Φy, захват) → позиции в v2 */
const LEGACY_COLUMN_MAP = [0, 1, 2, 3, 5, 7, 8, 9]
/** новые столбцы v2: 4 = theta, 6 = rho */
export const IDX_THETA = 4
export const IDX_RHO = 6
/** нормировка фазовых признаков (зеркало navedenie/circuit.py) */
export const K_THETA = 4.0
export const K_RHO = 0.4

function migrateW(matrix: number[][]): number[][] {
  const width = matrix[0]?.length ?? 0
  if (width === READOUT) return matrix.map((row) => row.slice())
  if (width !== LEGACY_FEAT && width !== FEAT) {
    // чужая ширина: приводим к READOUT без переосмысления столбцов
    return matrix.map((row) => Array.from({ length: READOUT }, (_, i) => row[i] ?? 0))
  }
  const base =
    width === LEGACY_FEAT
      ? matrix.map((row) => {
          const out = Array(FEAT).fill(0)
          LEGACY_COLUMN_MAP.forEach((newIdx, oldIdx) => {
            out[newIdx] = row[oldIdx] ?? 0
          })
          return out
        })
      : matrix.map((row) => row.slice())
  return base.map((row) => row.concat(Array(STATE_COLUMNS).fill(0)))
}

function defaultW(): number[][] {
  const w = Array.from({ length: 2 }, () => Array(READOUT).fill(0))
  // врождённый рефлекс: разворот туда, куда смотрит глаз, — и больше ничего.
  // Упреждения, «набегания» и потока в нём нет: этим врождённая муха и
  // проигрывает тренированной, которая всё это выучивает на погонях
  w[0][1] = 1.15
  w[1][0] = 1.15
  return w
}

let W = defaultW()
let trained = false
let kind: BrainKind = 'stub'
export const featureSchemaVersion = FEATURE_SCHEMA_VERSION

export function brainKind() {
  return kind
}
export function setBrainKind(next: BrainKind) {
  kind = next
}
export function isTrained() {
  return trained
}
export function nCells() {
  // stub: 16×16 сетчатка + 23 служебных (зеркало navedenie/circuit.py)
  return 279
}
export function getW() {
  return W
}

/** Врождённая проводка тем же шрифтом: чтобы на экране «Мозг» показать, что
 *  именно изменила тренировка, не сбрасывая саму муху. */
export function innateW() {
  return defaultW()
}

export function features(
  az: number,
  el: number,
  azDot: number,
  elDot: number,
  theta: number,
  loom: number,
  rho: number,
  flowX: number,
  flowY: number,
  lock: boolean,
): number[] {
  const L = lock ? 1 : 0
  const tanh = Math.tanh
  return [
    tanh(az * 3 * L),
    tanh(el * 3 * L),
    tanh(azDot * 0.4 * L),
    tanh(elDot * 0.4 * L),
    tanh(theta * K_THETA * L),
    tanh(loom),
    tanh(rho * K_RHO * L),
    tanh(flowX * 4),
    tanh(flowY * 4),
    L,
  ]
}

export function readout(input: number[]): { pitch: number; yaw: number } {
  const pitch = Math.tanh(W[0].reduce((s, v, i) => s + v * (input[i] ?? 0), 0))
  const yaw = Math.tanh(W[1].reduce((s, v, i) => s + v * (input[i] ?? 0), 0))
  return { pitch, yaw }
}

export function sgd(input: number[], teacher: number[], lr = 0.04) {
  const pred = readout(input)
  const err = [teacher[0] - pred.pitch, teacher[1] - pred.yaw]
  for (let i = 0; i < input.length; i += 1) {
    W[0][i] = Math.max(-4, Math.min(4, W[0][i] + lr * err[0] * (input[i] ?? 0)))
    W[1][i] = Math.max(-4, Math.min(4, W[1][i] + lr * err[1] * (input[i] ?? 0)))
  }
}

export function markTrained() {
  trained = true
}

/** Сброс в врождённый рефлекс: игре нужно показывать доску «до тренировки». */
export function resetBrain() {
  W = defaultW()
  trained = false
}

export function applyServerW(matrix: number[][] | undefined) {
  if (!matrix || matrix.length !== 2) return
  W = migrateW(matrix)
  trained = true
}

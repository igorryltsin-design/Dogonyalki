/** Глаз игры: две решётки, один декодер.
 *
 *  «foveal» — мушиный глаз: 16×16 клеточков, густо в центре и редко по краям
 *  (sinh-искажение), поле до 165°. Числа побитово совпадают со стендом-
 *  первоисточником (fixtures/orig/localSim.ts), проверка — eye.test.ts.
 *  «camera» — обычная камера: те же 16×16, но ровные квадратики и узкое поле.
 *  Обе решётки читаются ОДНИМ декодером: декодирование не подделано под глаз,
 *  сравнение мухи и детской сети остаётся честным. */

import type { EyeConfig } from './types'
import { gaussOf, type Rng } from './rng'

export const EYE_N = 16
export const FOVEA_K = 3.5
/** нормировка size-признака пришита к сетчатке 16×16 (зеркало seeker.SIZE_REF_CELLS) */
const SIZE_REF_CELLS = 256

export function eyeHalfFov(e: EyeConfig): number {
  return ((Math.max(e.fovDeg, 2) * Math.PI) / 180) / 2
}

/** нормировка sinh: крайняя ячейка стоит ровно на границе поля (зеркало _fovea_norm) */
function foveaNorm(k: number, n: number): number {
  return Math.sinh(k * (1 - 1 / n))
}

/** Угловые позиции клеточков по оси. Фовеальная ветка — дословное зеркало
 *  foveaAngles(); камерная — равномерная сетка центров ячеек. */
export function eyeAngles(e: EyeConfig, n = EYE_N): number[] {
  const halfFov = eyeHalfFov(e)
  const out: number[] = []
  if (e.grid === 'camera') {
    for (let i = 0; i < n; i += 1) {
      const q = -1 + (2 * (i + 0.5)) / n
      out.push(halfFov * q)
    }
    return out
  }
  for (let i = 0; i < n; i += 1) {
    const q = -1 + (2 * (i + 0.5)) / n
    out.push((halfFov * Math.sinh(FOVEA_K * q)) / foveaNorm(FOVEA_K, n))
  }
  return out
}

/** Угловая ширина клеточка. Фовеальная ветка — зеркало foveaCellWidth(). */
export function eyeCellWidth(e: EyeConfig, n = EYE_N): number[] {
  const halfFov = eyeHalfFov(e)
  const out: number[] = []
  if (e.grid === 'camera') {
    for (let i = 0; i < n; i += 1) out.push((2 * halfFov) / n)
    return out
  }
  for (let i = 0; i < n; i += 1) {
    const q = -1 + (2 * (i + 0.5)) / n
    out.push(((halfFov * FOVEA_K * Math.cosh(FOVEA_K * q)) / foveaNorm(FOVEA_K, n)) * (2 / n))
  }
  return out
}

/** Изображение цели на глазу. Одна формула для обеих решёток: пятно гауссится
 *  с sig = max(0.7·ширина клеточка, угловой размер цели) — в фовеа клеточки
 *  узкие, на камере все одинаковые. Зеркало rasterFoveal() на фовеальном пути. */
export function rasterEye(az: number, el: number, size: number, eye: EyeConfig, n = EYE_N): number[][] {
  const halfFov = eyeHalfFov(eye)
  const ax = eyeAngles(eye, n)
  const wx = eyeCellWidth(eye, n)
  const sig = wx.map((w) => Math.max(0.7 * w, size * halfFov * 0.9))
  const maxA = ax[ax.length - 1]
  const azC = Math.max(-maxA, Math.min(maxA, az))
  const elC = Math.max(-maxA, Math.min(maxA, el))
  const gx = ax.map((a, i) => Math.exp(-0.5 * ((a - azC) / sig[i]) ** 2))
  const gy = ax.map((a, i) => Math.exp(-0.5 * ((a - elC) / sig[i]) ** 2))
  const img: number[][] = []
  for (let j = 0; j < n; j += 1) img.push(gx.map((g, i) => gy[j] * g))
  return img
}

/** Честный кадр глаза: полное пятно в поле, приглушённое чуть за краем,
 *  ноль далеко за ним. Логика зеркала localRun стенда, поле — из eye. */
export function eyeImage(truthAz: number, truthEl: number, size: number, losAng: number, eye: EyeConfig): number[][] {
  const halfFov = eyeHalfFov(eye)
  const inFov = Math.abs(truthAz) <= halfFov && Math.abs(truthEl) <= halfFov
  if (!inFov && !(losAng < 2 * halfFov * 1.05)) {
    return Array.from({ length: EYE_N }, () => Array(EYE_N).fill(0))
  }
  const img = rasterEye(truthAz, truthEl, size, eye)
  return inFov ? img : img.map((row) => row.map((v) => v * 0.35))
}

/** Помехи в глазу: аддитивный gaussian с тем же правилом для обеих решёток —
 *  std = noisePct от доли яркости пятна. 0 — выключено. */
export function applyEyeNoise(img: number[][], eye: EyeConfig, rng: Rng): number[][] {
  if (eye.noisePct <= 0) return img
  const s = eye.noisePct * 0.2
  return img.map((row) => row.map((v) => Math.max(0, v + gaussOf(rng) * s)))
}

// ── декодер: единственные «зрение→углы» для обоих бойцов ────────────────────

/** Суммарная яркость пятна с ядром sigma — для θ-решателя (зеркало blobTotal). */
function blobTotal(az: number, el: number, sigma: number, ax: number[], wx: number[]): number {
  const sig = wx.map((w) => Math.max(0.7 * w, sigma))
  const maxA = ax[ax.length - 1]
  const azC = Math.max(-maxA, Math.min(maxA, az))
  const elC = Math.max(-maxA, Math.min(maxA, el))
  let sum = 0
  const gx = ax.map((a, i) => Math.exp(-0.5 * ((a - azC) / sig[i]) ** 2))
  const gy = ax.map((a, i) => Math.exp(-0.5 * ((a - elC) / sig[i]) ** 2))
  for (let j = 0; j < ax.length; j += 1) for (let i = 0; i < ax.length; i += 1) sum += gy[j] * gx[i]
  return sum
}

/** Измеренный угловой размер цели (рад): обратная задача оптики бисекцией по σ.
 *  Зеркало measure_theta; на фовеальном пути числа побитово прежние. */
export function measureTheta(total: number, az: number, el: number, eye: EyeConfig, n = EYE_N): number {
  const ax = eyeAngles(eye, n)
  const wx = eyeCellWidth(eye, n)
  if (total <= 0) return 0
  const tLo = blobTotal(az, el, 0, ax, wx)
  if (total <= tLo * 1.01) return 0
  let lo = 0
  let hi = eyeHalfFov(eye)
  for (let i = 0; i < 14; i += 1) {
    const mid = 0.5 * (lo + hi)
    if (blobTotal(az, el, mid, ax, wx) < total) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** Угол, при котором собственная модель оптики лучше всего объясняет профиль
 *  (зеркало seeker._axis_fit). */
function axisFit(profile: number[], ax: number[], wx: number[], sig: number[], a0: number, theta: number): number {
  let loc = wx[0]
  for (let i = 0; i < ax.length - 1; i += 1) {
    if ((a0 >= ax[i] && a0 <= ax[i + 1]) || i === ax.length - 2) {
      const t = (a0 - ax[i]) / (ax[i + 1] - ax[i])
      loc = wx[i] + (wx[i + 1] - wx[i]) * Math.max(0, Math.min(1, t))
      break
    }
  }
  const span = 1.5 * loc + theta
  const lo = Math.max(ax[0], a0 - span)
  const hi = Math.min(ax[ax.length - 1], a0 + span)
  if (hi - lo < 1e-12) return a0
  const nc = 21
  const cand: number[] = []
  for (let c = 0; c < nc; c += 1) cand.push(lo + ((hi - lo) * c) / (nc - 1))
  const scores: number[] = []
  let bestI = 0
  let bestScore = -1
  for (let c = 0; c < nc; c += 1) {
    let num = 0
    let den = 0
    for (let i = 0; i < ax.length; i += 1) {
      const m = Math.exp(-0.5 * ((ax[i] - cand[c]) / sig[i]) ** 2)
      num += m * profile[i]
      den += m * m
    }
    const score = (num * num) / Math.max(den, 1e-12)
    scores.push(score)
    if (score > bestScore) {
      bestScore = score
      bestI = c
    }
  }
  if (bestI > 0 && bestI < nc - 1) {
    const y0 = scores[bestI - 1]
    const y1 = scores[bestI]
    const y2 = scores[bestI + 1]
    const d = y0 - 2 * y1 + y2
    if (Math.abs(d) > 1e-18) {
      const step = Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / d))
      const h = cand[1] - cand[0]
      return Math.max(lo, Math.min(hi, cand[bestI] + h * step))
    }
  }
  return cand[bestI]
}

/** Пик пятна точечной цели — калибровка собственной оптики (зеркало psf_reference). */
function psfPeak(az: number, el: number, eye: EyeConfig, n = EYE_N): number {
  const ax = eyeAngles(eye, n)
  const wx = eyeCellWidth(eye, n)
  const maxA = ax[ax.length - 1]
  const azC = Math.max(-maxA, Math.min(maxA, az))
  const elC = Math.max(-maxA, Math.min(maxA, el))
  let gx = 0
  let gy = 0
  for (let i = 0; i < n; i += 1) {
    const v = Math.exp(-0.5 * ((ax[i] - azC) / (0.7 * wx[i])) ** 2)
    if (v > gx) gx = v
    const w = Math.exp(-0.5 * ((ax[i] - elC) / (0.7 * wx[i])) ** 2)
    if (w > gy) gy = w
  }
  return gx * gy
}

/** Грубый пеленг: центроид по окну ±win клеток вокруг ярчайшей (зеркало _window_centroid). */
function windowCentroid(clean: number[][], ax: number[], win = 3): [number, number] {
  let iy = 0
  let ix = 0
  let top = 0
  for (let j = 0; j < clean.length; j += 1)
    for (let i = 0; i < clean.length; i += 1)
      if (clean[j][i] > top) {
        top = clean[j][i]
        iy = j
        ix = i
      }
  const loY = Math.max(0, iy - win)
  const hiY = Math.min(clean.length, iy + win + 1)
  const loX = Math.max(0, ix - win)
  const hiX = Math.min(clean.length, ix + win + 1)
  const col: number[] = []
  const row: number[] = []
  for (let i = loX; i < hiX; i += 1) col.push(0)
  for (let j = loY; j < hiY; j += 1) row.push(0)
  for (let j = loY; j < hiY; j += 1)
    for (let i = loX; i < hiX; i += 1) {
      col[i - loX] += clean[j][i]
      row[j - loY] += clean[j][i]
    }
  const sCol = col.reduce((s, v) => s + v, 0)
  if (sCol <= 1e-9) return [0, 0]
  let a0 = 0
  let e0 = 0
  for (let i = 0; i < col.length; i += 1) a0 += col[i] * ax[loX + i]
  for (let j = 0; j < row.length; j += 1) e0 += row[j] * ax[loY + j]
  return [a0 / sCol, e0 / sCol]
}

function medianOf(vals: number[]): number {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m])
}

/** Декодирование признаков из изображения — единственный источник углов.
 *  Боевой декодер (зеркало seeker.decode_image): фон вычтен медианой, пеленг —
 *  инверсией собственной оптики по осям, захват судится по высоте пика над PSF.
 *  На фовеальном глазу числа побитово совпадают со стендом. */
export function decodeImage(img: number[][], eye: EyeConfig, n = EYE_N) {
  const ax = eyeAngles(eye, n)
  const wx = eyeCellWidth(eye, n)
  let rawPeak = 0
  const live: number[] = []
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const v = img[j][i]
      live.push(v)
      if (v > rawPeak) rawPeak = v
    }
  const bkg = medianOf(live)
  const clean: number[][] = img.map((row) => row.map((v) => Math.max(0, v - bkg)))
  let flux = 0
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) flux += clean[j][i]
  if (flux < 0.15) return { az: 0, el: 0, size: 0, peak: rawPeak, peak_rel: 0, theta: 0, flux: 0 }
  let [a0, e0] = windowCentroid(clean, ax)
  const size = Math.max(0, Math.min(0.35, flux / (SIZE_REF_CELLS * 0.08)))
  const theta = measureTheta(flux, a0, e0, eye, n)
  const sig = wx.map((w) => Math.max(0.7 * w, theta))
  for (let it = 0; it < 2; it += 1) {
    const colP: number[] = new Array(n).fill(0)
    const rowP: number[] = new Array(n).fill(0)
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1) {
        colP[i] += clean[j][i]
        rowP[j] += clean[j][i]
      }
    a0 = axisFit(colP, ax, wx, sig, a0, theta)
    e0 = axisFit(rowP, ax, wx, sig, e0, theta)
  }
  const peak = Math.max(...clean.flat())
  return {
    az: a0,
    el: e0,
    size,
    peak: rawPeak,
    peak_rel: peak / Math.max(psfPeak(a0, e0, eye, n), 1e-9),
    theta,
    flux,
  }
}

/** Особые глаза для опытов: блик на линзе и крупные клеточки.
 *  Блик — яркое пятно в одном и том же месте кадра, как капля или солнечный
 *  зайчик на стекле: Шустрик двигается, а блик стоит. Крупные клеточки —
 *  кадр усредняется квадратами cells×cells: так выглядит глаз, у которого
 *  клеточек меньше. Обе правки — после шума: шум живёт в каждом клеточке. */
export function applyEyeExtras(img: number[][], eye: EyeConfig): number[][] {
  let out = img
  if (eye.glare !== undefined) {
    const halfFov = eyeHalfFov(eye)
    const spot = rasterEye(eye.glare * halfFov * 0.8, 0, 0.05, eye)
    out = out.map((row, j) => row.map((v, i) => Math.min(1.5, v + spot[j][i] * 0.9)))
  }
  if (eye.cells && eye.cells < EYE_N) {
    const k = Math.max(1, Math.round(EYE_N / eye.cells))
    const pooled = out.map((row) => row.slice())
    for (let by = 0; by < EYE_N; by += k)
      for (let bx = 0; bx < EYE_N; bx += k) {
        let sum = 0
        let n = 0
        for (let y = by; y < Math.min(EYE_N, by + k); y += 1)
          for (let x = bx; x < Math.min(EYE_N, bx + k); x += 1) {
            sum += out[y][x]
            n += 1
          }
        const m = sum / n
        for (let y = by; y < Math.min(EYE_N, by + k); y += 1) for (let x = bx; x < Math.min(EYE_N, bx + k); x += 1) pooled[y][x] = m
      }
    out = pooled
  }
  return out
}

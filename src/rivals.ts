/** Соперники мухи из мира «обычного» машинного зрения. Обе сети учатся на тех
 *  же карточках «кадр → куда смотреть», что и полносвязная сеть, и рулят тем же
 *  пилотом (упреждение по скорости взгляда, одинаковая крутизна) — разница
 *  только в том, КАК сеть читает картинку.
 *
 *  • Свёрточная сеть (CNN) — как в классификаторах картинок: фильтры 3×3
 *    бегут по кадру, потом сжатие 2×2 и маленький полносвязный слой.
 *    Свёртка с полями: без них крайние клеточки глаза видел один ряд
 *    фильтров из четырнадцати, сеть почти не училась на краях и на цели
 *    сбоку отвечала «почти прямо» — муха теряла Шустрика на повороте.
 *  • Детектор-тепловая карта — так устроены детекторы объектов вроде
 *    CenterNet и современных YOLO: сеть рисует карту «где вероятнее всего
 *    цель», а ответ — центр тяжести этой карты.
 *
 *  Всё на чистом JS, плоские Float32Array, без библиотек: файл игры остаётся
 *  одним файлом, а обучение идёт за секунды на школьном ноутбуке. */

import { EYE_N, eyeAngles, eyeHalfFov } from './eye'
import { gaussOf, makeRng } from './rng'
import type { CardRec, EyeConfig } from './types'
import { yieldToUi } from './yield'

const N = EYE_N
const NN = N * N

export type Gaze = { az: number; el: number }

export type TrainOpts = {
  epochs?: number
  lr?: number
  seed?: number
  onEpoch?: (ep: number, epochs: number, loss: number) => void
  shouldStop?: () => boolean
}

function flat(img: number[][]): Float32Array {
  const x = new Float32Array(NN)
  for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) x[j * N + i] = img[j][i]
  return x
}

function shuffle(idx: number[], rng: () => number) {
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const t = idx[i]
    idx[i] = idx[j]
    idx[j] = t
  }
}

const clampUnit = (v: number) => Math.max(-1, Math.min(1, v))

/* ───────────────────────── свёрточная сеть ───────────────────────── */

const C_K = 6 // фильтров
const C_O = N // 16: свёртка с полями — крайние клеточки глаза не теряются
const C_P = C_O / 2 // 8: после сжатия 2×2
const C_F = C_K * C_P * C_P // 384
const C_H = 16

export type CnnNet = {
  kind: 'cnn'
  wc: Float32Array // C_K×9
  bc: Float32Array // C_K
  w1: Float32Array // C_H×C_F
  b1: Float32Array // C_H
  w2: Float32Array // 2×C_H
  b2: Float32Array // 2
  fingerprint: string
  trained: boolean
}

export const CNN_PARAMS = C_K * 9 + C_K + C_H * C_F + C_H + 2 * C_H + 2
/** умножений-сложений на один кадр: свёртка + полносвязные слои */
export const CNN_OPS = C_O * C_O * C_K * 9 + C_H * C_F + 2 * C_H

export function initCnn(seed = 21): CnnNet {
  const rng = makeRng(seed)
  const g = (s: number) => () => gaussOf(rng) * s
  const fill = (n: number, f: () => number) => Float32Array.from({ length: n }, f)
  return {
    kind: 'cnn',
    wc: fill(C_K * 9, g(0.4)),
    bc: new Float32Array(C_K).fill(0.01),
    w1: fill(C_H * C_F, g(1 / Math.sqrt(C_F))),
    b1: new Float32Array(C_H),
    w2: fill(2 * C_H, g(1 / Math.sqrt(C_H))),
    b2: new Float32Array(2),
    fingerprint: '',
    trained: false,
  }
}

type CnnCache = { conv: Float32Array; pool: Float32Array; arg: Int32Array; h: Float32Array; y: Float32Array }

function cnnForward(net: CnnNet, x: Float32Array, c?: CnnCache): CnnCache {
  const conv = c?.conv ?? new Float32Array(C_K * C_O * C_O)
  const pool = c?.pool ?? new Float32Array(C_F)
  const arg = c?.arg ?? new Int32Array(C_F)
  const h = c?.h ?? new Float32Array(C_H)
  const y = c?.y ?? new Float32Array(2)
  for (let k = 0; k < C_K; k += 1) {
    const wk = k * 9
    for (let oy = 0; oy < C_O; oy += 1)
      for (let ox = 0; ox < C_O; ox += 1) {
        let s = net.bc[k]
        for (let dy = 0; dy < 3; dy += 1) {
          const iy = oy + dy - 1
          if (iy < 0 || iy >= N) continue
          for (let dx = 0; dx < 3; dx += 1) {
            const ix = ox + dx - 1
            if (ix < 0 || ix >= N) continue
            s += net.wc[wk + dy * 3 + dx] * x[iy * N + ix]
          }
        }
        conv[(k * C_O + oy) * C_O + ox] = s > 0 ? s : 0
      }
  }
  for (let k = 0; k < C_K; k += 1)
    for (let py = 0; py < C_P; py += 1)
      for (let px = 0; px < C_P; px += 1) {
        let best = -1
        let bi = 0
        for (let dy = 0; dy < 2; dy += 1)
          for (let dx = 0; dx < 2; dx += 1) {
            const idx = (k * C_O + py * 2 + dy) * C_O + px * 2 + dx
            if (conv[idx] > best) {
              best = conv[idx]
              bi = idx
            }
          }
        const pi = (k * C_P + py) * C_P + px
        pool[pi] = best
        arg[pi] = bi
      }
  for (let u = 0; u < C_H; u += 1) {
    let s = net.b1[u]
    const o = u * C_F
    for (let i = 0; i < C_F; i += 1) s += net.w1[o + i] * pool[i]
    h[u] = Math.tanh(s)
  }
  for (let o = 0; o < 2; o += 1) {
    let s = net.b2[o]
    for (let u = 0; u < C_H; u += 1) s += net.w2[o * C_H + u] * h[u]
    y[o] = Math.tanh(s)
  }
  return { conv, pool, arg, h, y }
}

export function cnnPredict(net: CnnNet, img: number[][], eye: EyeConfig): Gaze {
  const { y } = cnnForward(net, flat(img))
  const hf = eyeHalfFov(eye)
  return { az: y[0] * hf, el: y[1] * hf }
}

export async function trainCnn(net: CnnNet, cards: CardRec[], eye: EyeConfig, opts: TrainOpts = {}): Promise<CnnNet> {
  const epochs = opts.epochs ?? 24
  const lr = opts.lr ?? 0.05
  const rng = makeRng(opts.seed ?? 31)
  const hf = eyeHalfFov(eye)
  const xs = cards.map((c) => flat(c.img))
  const ts = cards.map((c) => [clampUnit(c.az / hf), clampUnit(c.el / hf)])
  const idx = xs.map((_, i) => i)
  const cache = cnnForward(net, xs[0] ?? new Float32Array(NN))
  const gh = new Float32Array(C_H)
  const gp = new Float32Array(C_F)
  const gconv = new Float32Array(C_K * C_O * C_O)
  for (let ep = 0; ep < epochs; ep += 1) {
    if (opts.shouldStop?.()) break
    shuffle(idx, rng)
    let loss = 0
    let seen = 0
    for (const ci of idx) {
      const x = xs[ci]
      const t = ts[ci]
      const { conv, pool, arg, h, y } = cnnForward(net, x, cache)
      const go = [(y[0] - t[0]) * (1 - y[0] * y[0]), (y[1] - t[1]) * (1 - y[1] * y[1])]
      loss += (y[0] - t[0]) ** 2 + (y[1] - t[1]) ** 2
      for (let u = 0; u < C_H; u += 1) gh[u] = (go[0] * net.w2[u] + go[1] * net.w2[C_H + u]) * (1 - h[u] * h[u])
      for (let o = 0; o < 2; o += 1) {
        net.b2[o] -= lr * go[o]
        for (let u = 0; u < C_H; u += 1) net.w2[o * C_H + u] -= lr * go[o] * h[u]
      }
      gp.fill(0)
      for (let u = 0; u < C_H; u += 1) {
        const g = gh[u]
        if (g === 0) continue
        const o = u * C_F
        for (let i = 0; i < C_F; i += 1) {
          gp[i] += g * net.w1[o + i]
          net.w1[o + i] -= lr * g * pool[i]
        }
        net.b1[u] -= lr * g
      }
      gconv.fill(0)
      for (let i = 0; i < C_F; i += 1) if (pool[i] > 0) gconv[arg[i]] = gp[i]
      for (let k = 0; k < C_K; k += 1) {
        let gb = 0
        const gw = [0, 0, 0, 0, 0, 0, 0, 0, 0]
        for (let oy = 0; oy < C_O; oy += 1)
          for (let ox = 0; ox < C_O; ox += 1) {
            const g = gconv[(k * C_O + oy) * C_O + ox]
            if (g === 0 || conv[(k * C_O + oy) * C_O + ox] <= 0) continue
            gb += g
            for (let dy = 0; dy < 3; dy += 1) {
              const iy = oy + dy - 1
              if (iy < 0 || iy >= N) continue
              for (let dx = 0; dx < 3; dx += 1) {
                const ix = ox + dx - 1
                if (ix < 0 || ix >= N) continue
                gw[dy * 3 + dx] += g * x[iy * N + ix]
              }
            }
          }
        net.bc[k] -= lr * gb
        for (let q = 0; q < 9; q += 1) net.wc[k * 9 + q] -= lr * gw[q]
      }
      seen += 1
      if (seen % 200 === 0) await yieldToUi()
    }
    net.trained = true
    opts.onEpoch?.(ep + 1, epochs, loss / Math.max(seen, 1))
    await yieldToUi()
  }
  return net
}

/* ─────────────────────── детектор-тепловая карта ─────────────────────── */

const D_C = 8 // каналов признаков

export type DetNet = {
  kind: 'det'
  wc: Float32Array // D_C×9 — свёртка 3×3 с полями, кадр не сжимается
  bc: Float32Array
  wh: Float32Array // D_C — «голова» 1×1: признаки → балл «тут цель»
  bh: Float32Array // 1
  fingerprint: string
  trained: boolean
}

export const DET_PARAMS = D_C * 9 + D_C + D_C + 1
export const DET_OPS = NN * (D_C * 9 + D_C) + NN * 3 // свёртка + голова + soft-argmax

export function initDet(seed = 41): DetNet {
  const rng = makeRng(seed)
  return {
    kind: 'det',
    wc: Float32Array.from({ length: D_C * 9 }, () => gaussOf(rng) * 0.4 + 0.05),
    bc: new Float32Array(D_C),
    wh: Float32Array.from({ length: D_C }, () => gaussOf(rng) * 0.3 + 0.3),
    bh: new Float32Array(1),
    fingerprint: '',
    trained: false,
  }
}

/** «Резкость» карты: логиты умножаются на неё перед softmax. */
const DET_GAIN = 6

type DetCache = { feat: Float32Array; prob: Float32Array }

function detForward(net: DetNet, x: Float32Array, c?: DetCache): DetCache {
  const feat = c?.feat ?? new Float32Array(D_C * NN)
  const prob = c?.prob ?? new Float32Array(NN)
  let mx = -1e9
  for (let p = 0; p < NN; p += 1) prob[p] = net.bh[0]
  for (let k = 0; k < D_C; k += 1) {
    const wk = k * 9
    for (let yy = 0; yy < N; yy += 1)
      for (let xx = 0; xx < N; xx += 1) {
        let s = net.bc[k]
        for (let dy = -1; dy <= 1; dy += 1) {
          const ry = yy + dy
          if (ry < 0 || ry >= N) continue
          for (let dx = -1; dx <= 1; dx += 1) {
            const rx = xx + dx
            if (rx < 0 || rx >= N) continue
            s += net.wc[wk + (dy + 1) * 3 + dx + 1] * x[ry * N + rx]
          }
        }
        const a = s > 0 ? s : 0
        const p = yy * N + xx
        feat[k * NN + p] = a
        prob[p] += net.wh[k] * a
      }
  }
  for (let p = 0; p < NN; p += 1) {
    prob[p] *= DET_GAIN
    if (prob[p] > mx) mx = prob[p]
  }
  let z = 0
  for (let p = 0; p < NN; p += 1) {
    prob[p] = Math.exp(prob[p] - mx)
    z += prob[p]
  }
  for (let p = 0; p < NN; p += 1) prob[p] /= z
  return { feat, prob }
}

/** дробный номер клеточка → угол по той же оптике глаза (линейно между центрами) */
function idxToAngle(ax: number[], f: number): number {
  const fc = Math.max(0, Math.min(ax.length - 1, f))
  const i0 = Math.min(ax.length - 2, Math.floor(fc))
  const u = fc - i0
  return ax[i0] * (1 - u) + ax[i0 + 1] * u
}
/** угол → дробный номер клеточка (обратное к idxToAngle) */
function angleToIdx(ax: number[], a: number): number {
  if (a <= ax[0]) return 0
  if (a >= ax[ax.length - 1]) return ax.length - 1
  for (let i = 0; i < ax.length - 1; i += 1) {
    if (a <= ax[i + 1]) return i + (a - ax[i]) / (ax[i + 1] - ax[i])
  }
  return ax.length - 1
}

/** Карта «тут цель» 16×16 — для показа на экране и для soft-argmax. */
export function detHeatmap(net: DetNet, img: number[][]): Float32Array {
  return detForward(net, flat(img)).prob
}

export function detPredict(net: DetNet, img: number[][], eye: EyeConfig): Gaze {
  const { prob } = detForward(net, flat(img))
  let fx = 0
  let fy = 0
  for (let p = 0; p < NN; p += 1) {
    fx += prob[p] * (p % N)
    fy += prob[p] * Math.floor(p / N)
  }
  const ax = eyeAngles(eye)
  return { az: idxToAngle(ax, fx), el: idxToAngle(ax, fy) }
}

export async function trainDet(net: DetNet, cards: CardRec[], eye: EyeConfig, opts: TrainOpts = {}): Promise<DetNet> {
  const epochs = opts.epochs ?? 24
  const lr = opts.lr ?? 0.02
  const rng = makeRng(opts.seed ?? 51)
  const ax = eyeAngles(eye)
  const xs = cards.map((c) => flat(c.img))
  // метка: мягкое пятно σ≈0.8 клеточка вокруг истинного центра цели
  const ts = cards.map((c) => {
    const cx = angleToIdx(ax, c.az)
    const cy = angleToIdx(ax, c.el)
    const t = new Float32Array(NN)
    let s = 0
    for (let p = 0; p < NN; p += 1) {
      const v = Math.exp(-(((p % N) - cx) ** 2 + (Math.floor(p / N) - cy) ** 2) / (2 * 0.8 * 0.8))
      t[p] = v
      s += v
    }
    for (let p = 0; p < NN; p += 1) t[p] /= s
    return t
  })
  const idx = cards.map((_, i) => i)
  const cache = detForward(net, xs[0] ?? new Float32Array(NN))
  const gl = new Float32Array(NN)
  for (let ep = 0; ep < epochs; ep += 1) {
    if (opts.shouldStop?.()) break
    shuffle(idx, rng)
    let loss = 0
    let seen = 0
    for (const ci of idx) {
      const x = xs[ci]
      const t = ts[ci]
      const { feat, prob } = detForward(net, x, cache)
      // кросс-энтропия по карте: градиент по логиту = (p − t)·усиление
      for (let p = 0; p < NN; p += 1) {
        gl[p] = (prob[p] - t[p]) * DET_GAIN
        if (t[p] > 1e-6) loss -= t[p] * Math.log(prob[p] + 1e-9)
      }
      let gbh = 0
      for (let p = 0; p < NN; p += 1) gbh += gl[p]
      net.bh[0] -= lr * gbh
      for (let k = 0; k < D_C; k += 1) {
        const wk = k * 9
        const whk = net.wh[k]
        let gwh = 0
        let gb = 0
        const gw = [0, 0, 0, 0, 0, 0, 0, 0, 0]
        for (let yy = 0; yy < N; yy += 1)
          for (let xx = 0; xx < N; xx += 1) {
            const p = yy * N + xx
            const a = feat[k * NN + p]
            gwh += gl[p] * a
            if (a <= 0) continue
            const g = gl[p] * whk
            gb += g
            for (let dy = -1; dy <= 1; dy += 1) {
              const ry = yy + dy
              if (ry < 0 || ry >= N) continue
              for (let dx = -1; dx <= 1; dx += 1) {
                const rx = xx + dx
                if (rx < 0 || rx >= N) continue
                gw[(dy + 1) * 3 + dx + 1] += g * x[ry * N + rx]
              }
            }
          }
        net.wh[k] -= lr * gwh
        net.bc[k] -= lr * gb
        for (let q = 0; q < 9; q += 1) net.wc[wk + q] -= lr * gw[q]
      }
      seen += 1
      if (seen % 200 === 0) await yieldToUi()
    }
    net.trained = true
    opts.onEpoch?.(ep + 1, epochs, loss / Math.max(seen, 1))
    await yieldToUi()
  }
  return net
}

/* ───────────────────────── хранение ───────────────────────── */

type Stored = { kind: string; fingerprint: string; trained: boolean; [k: string]: unknown }

const KEY = (kind: string) => `dogonjalki-rival-${kind}-v3`

export function saveRival(net: CnnNet | DetNet) {
  try {
    const out: Stored = { kind: net.kind, fingerprint: net.fingerprint, trained: net.trained }
    for (const [k, v] of Object.entries(net)) if (v instanceof Float32Array) out[k] = Array.from(v)
    localStorage.setItem(KEY(net.kind), JSON.stringify(out))
  } catch {
    /* приватный режим — сеть живёт до перезагрузки */
  }
}

function revive<T extends CnnNet | DetNet>(kind: T['kind'], template: T): T | null {
  try {
    const raw = localStorage.getItem(KEY(kind))
    if (!raw) return null
    const s = JSON.parse(raw) as Stored
    const out = { ...template, fingerprint: s.fingerprint, trained: s.trained } as T
    for (const [k, v] of Object.entries(template)) {
      if (v instanceof Float32Array) {
        const arr = s[k] as number[] | undefined
        if (!arr || arr.length !== v.length) return null
        ;(out as Record<string, unknown>)[k] = Float32Array.from(arr)
      }
    }
    return out
  } catch {
    return null
  }
}

export const loadCnn = () => revive('cnn', initCnn())
export const loadDet = () => revive('det', initDet())

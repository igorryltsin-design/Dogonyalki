/** Сеть ребёнка: те же умножения и сложения, что в блоках NNTrack, только
 *  совсем маленькая — картинка 16×16 → 16 скрытых клеточков (tanh) → 2 выхода
 *  (азимут и угол места). ~4000 весов, чистый JS, без библиотек.
 *
 *  Честность по построению: на вход подаётся ТА ЖЕ САМАЯ картинка, что видит муха
 *  (frame.image из глаза сценария) — ни дальности, ни скорости сближения.
 *  Метки карточек нормированы на полуполе того глаза, под который датасет
 *  собран; сменил глаз — отпечаток не совпал, сеть обязана переучиваться. */

import { eyeHalfFov } from './eye'
import { makeRng } from './rng'
import { eyeFingerprint, type CardRec, type EyeConfig } from './types'
import { yieldToUi } from './yield'

export const KID_INPUT = 256
export const KID_HIDDEN = 16
export const KID_OUTPUT = 2

export type KidNet = {
  /** w1[h][i] — вход i → скрытый h */
  w1: number[][]
  b1: number[]
  /** w2[o][h] — скрытый h → выход o */
  w2: number[][]
  b2: number[]
  /** отпечаток глаза, под который выучена сеть */
  fingerprint: string
  trained: boolean
}

export function initNet(seed = 7, fingerprint = ''): KidNet {
  const rng = makeRng(seed)
  const gauss = () => (rng() + rng() + rng() + rng() - 2) * 0.5
  const s1 = 1.2 / Math.sqrt(KID_INPUT)
  const s2 = 1.2 / Math.sqrt(KID_HIDDEN)
  return {
    w1: Array.from({ length: KID_HIDDEN }, () => Array.from({ length: KID_INPUT }, () => gauss() * s1)),
    b1: Array.from({ length: KID_HIDDEN }, () => 0),
    w2: Array.from({ length: KID_OUTPUT }, () => Array.from({ length: KID_HIDDEN }, () => gauss() * s2)),
    b2: [0, 0],
    fingerprint,
    trained: false,
  }
}

function forward(net: KidNet, x: number[]): { h: number[]; y: number[] } {
  const h = net.w1.map((row, k) => {
    let s = net.b1[k]
    for (let i = 0; i < row.length; i += 1) s += row[i] * x[i]
    return Math.tanh(s)
  })
  const y = net.w2.map((row, o) => {
    let s = net.b2[o]
    for (let k = 0; k < KID_HIDDEN; k += 1) s += row[k] * h[k]
    return Math.tanh(s)
  })
  return { h, y }
}

function flatten(img: number[][]): number[] {
  const x: number[] = []
  for (let j = 0; j < img.length; j += 1) for (let i = 0; i < img[j].length; i += 1) x.push(img[j][i])
  return x
}

const clampUnit = (v: number) => Math.max(-1, Math.min(1, v))

/** Пеленг по картинке: куда смотрит сеть, в радиусах данного глаза. */
export function predictAzEl(net: KidNet, img: number[][], eye: EyeConfig): { az: number; el: number } {
  const { y } = forward(net, flatten(img))
  const halfFov = eyeHalfFov(eye)
  return { az: y[0] * halfFov, el: y[1] * halfFov }
}

/** Метка карточки в тех же единицах, что и выход сети (−1…1 по полуполю глаза). */
function labelOf(c: CardRec, eye: EyeConfig): [number, number] {
  const halfFov = eyeHalfFov(eye)
  return [clampUnit(c.az / halfFov), clampUnit(c.el / halfFov)]
}

export type TrainProgress = { epoch: number; epochs: number; loss: number; holdLoss: number | null }

/** Обучение: эпохами по всему списку карточек, SGD по MSE, перемешивание
 *  своим зерном — прогон воспроизводим. Асинхронный: уступает браузеру
 *  каждую сотню карточек, поэтому прогресс и «Стоп» живые. */
export async function trainOnCards(
  net: KidNet,
  cards: CardRec[],
  opts: {
    eye: EyeConfig
    epochs?: number
    lr?: number
    holdout?: CardRec[]
    seed?: number
    onProgress?: (p: TrainProgress) => void
    shouldStop?: () => boolean
    /** пауза после каждого прохода, мс: чтобы учитель видел, как растёт график */
    pauseMs?: number
  },
): Promise<KidNet> {
  const epochs = opts.epochs ?? 40
  const lr = opts.lr ?? 0.25
  const rng = makeRng(opts.seed ?? 11)
  if (!cards.length) return net
  const idx = cards.map((_, i) => i)
  for (let ep = 0; ep < epochs; ep += 1) {
    if (opts.shouldStop?.()) break
    for (let i = idx.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = idx[i]
      idx[i] = idx[j]
      idx[j] = tmp
    }
    let loss = 0
    let seen = 0
    for (const ci of idx) {
      const c = cards[ci]
      const x = flatten(c.img)
      const { h, y } = forward(net, x)
      const t = labelOf(c, opts.eye)
      const dOut = [y[0] - t[0], y[1] - t[1]]
      loss += dOut[0] * dOut[0] + dOut[1] * dOut[1]
      seen += 1
      // backprop через tanh
      const gh = new Array<number>(KID_HIDDEN)
      for (let k = 0; k < KID_HIDDEN; k += 1) {
        gh[k] = (1 - h[k] * h[k]) * (dOut[0] * net.w2[0][k] + dOut[1] * net.w2[1][k])
      }
      for (let o = 0; o < KID_OUTPUT; o += 1) {
        const go = dOut[o] * (1 - y[o] * y[o])
        net.b2[o] -= lr * go
        for (let k = 0; k < KID_HIDDEN; k += 1) net.w2[o][k] -= lr * go * h[k]
      }
      for (let k = 0; k < KID_HIDDEN; k += 1) {
        net.b1[k] -= lr * gh[k]
        const row = net.w1[k]
        for (let i = 0; i < KID_INPUT; i += 1) row[i] -= lr * gh[k] * x[i]
      }
      if (seen % 100 === 0) await yieldToUi()
    }
    const holdLoss = opts.holdout?.length ? evalLoss(net, opts.holdout, opts.eye) : null
    net.trained = true
    net.fingerprint = eyeFingerprint(opts.eye)
    opts.onProgress?.({ epoch: ep + 1, epochs, loss: loss / Math.max(seen, 1), holdLoss })
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs))
    else await yieldToUi()
  }
  return net
}

/** Средний squared loss в нормированных единицах. */
export function evalLoss(net: KidNet, cards: CardRec[], eye: EyeConfig): number {
  let s = 0
  for (const c of cards) {
    const { y } = forward(net, flatten(c.img))
    const t = labelOf(c, eye)
    s += (y[0] - t[0]) ** 2 + (y[1] - t[1]) ** 2
  }
  return s / Math.max(cards.length, 1)
}

/** Ошибка взгляда сети на карточках, градусы: |предсказание − истина|. */
export function gazeErrorDeg(net: KidNet, cards: CardRec[], eye: EyeConfig): number | null {
  if (!cards.length) return null
  const halfFov = eyeHalfFov(eye)
  let s = 0
  for (const c of cards) {
    const { y } = forward(net, flatten(c.img))
    s += Math.hypot((y[0] - t0(c, halfFov)) * halfFov, (y[1] - t1(c, halfFov)) * halfFov)
  }
  return (s / cards.length) * (180 / Math.PI)
}

function t0(c: CardRec, halfFov: number): number {
  return clampUnit(c.az / halfFov)
}
function t1(c: CardRec, halfFov: number): number {
  return clampUnit(c.el / halfFov)
}

// v2: сети, обученные до того, как Шустрик перестал летать, не подхватываем
const NET_KEY = 'dogonjalki-kidnet-v2'

export function saveNet(net: KidNet) {
  try {
    localStorage.setItem(NET_KEY, JSON.stringify(net))
  } catch {
    /* приватный режим */
  }
}

export function loadNet(): KidNet | null {
  try {
    const raw = localStorage.getItem(NET_KEY)
    if (!raw) return null
    const net = JSON.parse(raw) as KidNet
    if (!net.w1 || net.w1.length !== KID_HIDDEN || net.w1[0].length !== KID_INPUT) return null
    return net
  } catch {
    return null
  }
}

export function dropNet() {
  try {
    localStorage.removeItem(NET_KEY)
  } catch {
    /* приватный режим */
  }
}

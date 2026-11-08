import { describe, expect, it } from 'vitest'
import { collectCards } from './cards'
import { cnnPredict, detPredict, initCnn, initDet, trainCnn, trainDet, CNN_PARAMS, DET_PARAMS } from './rivals'
import { AXES, FLY_PARAMS, MLP_PARAMS, runTournament, sprintVariant } from './tournament'
import { chaseVariant } from './scenarios'
import { EYE_FLY, eyeFingerprint } from './types'
import { precomputed } from './precomputed'

/** Турнир обязан быть честным: сети учатся по-настоящему, муха не видит
 *  правильных ответов, а цифры воспроизводятся с тем же зерном. */

const errDeg = (pred: (img: number[][]) => { az: number; el: number }, cards: { img: number[][]; az: number; el: number }[]) =>
  (cards.reduce((s, c) => {
    const p = pred(c.img)
    return s + Math.hypot(p.az - c.az, p.el - c.el)
  }, 0) /
    cards.length) *
  (180 / Math.PI)

describe('соперники мухи', () => {
  it('свёрточная сеть и детектор действительно учатся: ошибка на проверочных карточках падает', async () => {
    const ds = await collectCards(EYE_FLY, 15)
    const cnn = initCnn()
    const det = initDet()
    const before = [errDeg((i) => cnnPredict(cnn, i, EYE_FLY), ds.test), errDeg((i) => detPredict(det, i, EYE_FLY), ds.test)]
    await trainCnn(cnn, ds.train, EYE_FLY, { epochs: 10 })
    await trainDet(det, ds.train, EYE_FLY, { epochs: 10 })
    const after = [errDeg((i) => cnnPredict(cnn, i, EYE_FLY), ds.test), errDeg((i) => detPredict(det, i, EYE_FLY), ds.test)]
    expect(after[0]).toBeLessThan(before[0] * 0.5)
    expect(after[1]).toBeLessThan(before[1] * 0.5)
    expect(after[0]).toBeLessThan(4)
    expect(after[1]).toBeLessThan(4)
  }, 60000)

  it('веса посчитаны по устройству сетей', () => {
    expect(FLY_PARAMS).toBe(48)
    expect(MLP_PARAMS).toBe(256 * 16 + 16 + 16 * 2 + 2)
    expect(CNN_PARAMS).toBe(6 * 9 + 6 + 16 * 384 + 16 + 2 * 16 + 2)
    expect(DET_PARAMS).toBe(8 * 9 + 8 + 8 + 1)
  })
})

describe('турнир', () => {
  it('незнакомая погоня действительно новая: другие зёрна и Шустрик быстрее', () => {
    for (let i = 0; i < 10; i += 1) {
      const s = sprintVariant(i, EYE_FLY)
      expect(s.seed).toBeGreaterThanOrEqual(5000)
      expect(s.v_runner).toBeGreaterThan(chaseVariant(i + 3, EYE_FLY).v_runner)
    }
  })

  it('честный и воспроизводимый: муха без карточек, сети с карточками, цифры повторяются', async () => {
    const a = await runTournament(EYE_FLY)
    const b = await runTournament(EYE_FLY)
    const pick = (r: typeof a) => r.rows.map((x) => [x.key, x.catches, x.transfer, ...x.noise])
    expect(pick(a)).toEqual(pick(b))
    // заранее посчитанный турнир, который видят малыши, — ровно этот же
    const pre = precomputed().tournaments[eyeFingerprint(EYE_FLY)]
    expect(pre, 'нет заранее посчитанного турнира — запусти tools/precompute.ts').toBeTruthy()
    expect(pick(pre)).toEqual(pick(a))
    const by = (k: string) => a.rows.find((r) => r.key === k)!
    expect(by('innate').labelled).toBe(0)
    expect(by('trained').labelled).toBe(0)
    for (const k of ['mlp', 'cnn', 'det']) expect(by(k).labelled).toBe(a.cards)
    // читер — потолок: ловит не меньше всех остальных
    for (const r of a.rows) expect(by('cheater').catches).toBeGreaterThanOrEqual(r.catches)
    // все оси паутинки — в пределах 0…1
    for (const r of a.rows) for (const ax of AXES) {
      const v = ax.value(r)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  // 120 с хватало на машине автора, но в чистом контейнере те же два
  // турнира подряд взяли 123 с — не из-за математики, а из-за медленных
  // ядер. Ценность проверки в точном совпадении цифр, а не в секундомере.
  }, 300000)
})

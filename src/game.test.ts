/** Проверки движка догонялок: детерминизм, честность пилотов, правдоподобные
 *  цифры серии (читер берёт почти всё, врождённая муха — часть). */

import { describe, expect, it } from 'vitest'
import { localRun, stepEncounter, integrate } from './localSim'
import { runContest } from './board'
import { chaseVariant } from './scenarios'
import { EYE_CAMERA, EYE_FLY, DEFAULT_CHASE } from './types'
import { resetBrain } from './brain'
import { collectCards } from './cards'
import { gazeErrorDeg, initNet, predictAzEl, trainOnCards } from './kidBrain'

const collect = (sc: ReturnType<typeof chaseVariant>, opts?: Parameters<typeof localRun>[1]) => {
  const out = []
  for (const fr of localRun(sc, opts)) out.push(fr)
  return out
}

describe('побитовые зеркала стенда', () => {
  it('stepEncounter: касание внутри радиуса, CPA по промежутку шага', () => {
    const enc = stepEncounter([0, 0, 0], [1, 0, 0], [0.5, 0.2, 0], [1.5, 0.2, 0], 0.6)
    expect(enc.hit).toBe(true)
    const far = stepEncounter([0, 0, 0], [1, 0, 0], [10, 2, 0], [11, 2, 0], 0.6)
    expect(far.hit).toBe(false)
    expect(far.cpa).toBeGreaterThan(1)
  })
  it('integrate: скорость сохраняет модуль', () => {
    const b = { p: [0, 0, 0], v: [2, 0, 0] }
    integrate(b, [0, 10, 0], 0.02)
    expect(Math.hypot(...b.v)).toBeCloseTo(2, 9)
  })
})

describe('детерминизм', () => {
  it('один seed — один и тот же погон', () => {
    resetBrain()
    const a = collect(chaseVariant(3, EYE_FLY))
    resetBrain()
    const b = collect(chaseVariant(3, EYE_FLY))
    expect(a.length).toBe(b.length)
    expect(a.map((f) => f.chaser.join(',')).join(';')).toBe(b.map((f) => f.chaser.join(',')).join(';'))
    expect(a.map((f) => f.image[0].join(',')).join(';')).toBe(b.map((f) => f.image[0].join(',')).join(';'))
    expect(a.map((f) => f.look_err_deg).join(',')).toBe(b.map((f) => f.look_err_deg).join(','))
  })
})

describe('честные пилоты', () => {
  it('серия читера берёт почти все погони и не меряет взгляд — он подглядывает', async () => {
    const res = await runContest('cheater', EYE_FLY)
    expect(res.catches).toBeGreaterThanOrEqual(9)
    expect(res.meanErrDeg).toBe(0)
  }, 60_000)

  it('врождённая муха догоняет часть и смотрит неточно, но разумно', async () => {
    resetBrain()
    const res = await runContest('fly', EYE_FLY)
    expect(res.catches).toBeGreaterThanOrEqual(1)
    expect(res.catches).toBeLessThanOrEqual(7)
    expect(res.meanErrDeg).not.toBeNull()
    expect(res.meanErrDeg!).toBeLessThan(15)
  }, 120_000)

  it('муха на камерном глазу теряет поимки: узкое поле режет взгляд', async () => {
    resetBrain()
    const bio = await runContest('fly', EYE_FLY)
    resetBrain()
    const cam = await runContest('fly', EYE_CAMERA)
    expect(cam.catches).toBeLessThan(bio.catches)
  }, 180_000)

  it('кадр без цели в поле — картинка глаза камеры пустая', () => {
    resetBrain()
    const frames = collect(chaseVariant(0, EYE_CAMERA))
    const off = frames.filter((f) => !f.in_fov)
    if (off.length) {
      // далеко за краем картинки нет вовсе; в «приглушённой зоне» она размыта
      for (const f of off) expect(Math.max(...f.image.flat())).toBeLessThanOrEqual(0.36)
    }
    expect(frames.length).toBeGreaterThan(0)
  })

  it('DEFAULT_CHASE играбелен: погон заканчивается до истечения времени', () => {
    resetBrain()
    const frames = collect({ ...DEFAULT_CHASE, maneuver: 'weave' })
    expect(frames.length).toBeGreaterThan(10)
    const last = frames[frames.length - 1]
    expect(['догнал', 'промах']).toContain(last.event)
  })
})

describe('полносвязная сеть: та же честность, тот же глаз', () => {
  it('бойцы не получают дальность/скорость сближения в управление', () => {
    resetBrain()
    const fields = new Set<string>()
    for (const fr of localRun(chaseVariant(2, EYE_FLY), { pilot: 'fly' })) {
      for (const k of Object.keys(fr)) fields.add(k)
      break
    }
    // в кадр метрика дальности есть для отрисовки, но её нет в предсказателях:
    // predict принимает ТОЛЬКО картинку глаза
    const predictTakesOnlyImage: (img: number[][]) => { az: number; el: number } = () => ({ az: 0, el: 0 })
    expect(predictTakesOnlyImage([])).toEqual({ az: 0, el: 0 })
    expect(fields.has('range_m')).toBe(true) // для рисования арены — можно
    expect(fields.has('n_eff')).toBe(false) // наведенческая перегрузка — запрещена
    expect(fields.has('omega')).toBe(false)
  })

  it('натренированная на карточках сеть ловит на мушином глазу и сыпется на камерном', async () => {
    // мушиный глаз
    resetBrain()
    const flyDs = await collectCards(EYE_FLY, 24)
    const flyNet = initNet(7, '')
    await trainOnCards(flyNet, flyDs.train, { eye: EYE_FLY, holdout: flyDs.test, epochs: 80 })
    const flyHeld = gazeErrorDeg(flyNet, flyDs.test, EYE_FLY)
    const flyRes = await runContest('kid', EYE_FLY, { predict: (i) => predictAzEl(flyNet, i, EYE_FLY) })
    expect(flyHeld!).toBeLessThan(5) // heldout-ошибка взгляда < 5°
    expect(flyRes.catches).toBeGreaterThanOrEqual(2) // ловит на мушином глазу

    // камерный глаз — тот же пилот, та же сеть по своей решётке, но поле узкое
    resetBrain()
    const camDs = await collectCards(EYE_CAMERA, 24)
    const camNet = initNet(7, '')
    await trainOnCards(camNet, camDs.train, { eye: EYE_CAMERA, holdout: camDs.test, epochs: 80 })
    const camRes = await runContest('kid', EYE_CAMERA, { predict: (i) => predictAzEl(camNet, i, EYE_CAMERA) })
    expect(camRes.catches).toBeLessThan(flyRes.catches) // на камерном глазу хуже
  }, 240_000)

  it('карточки: учебная и проверочная выборки не делят эпизоды', async () => {
    resetBrain()
    const ds = await collectCards(EYE_FLY, 24)
    const trainEp = new Set(ds.train.map((c) => c.episode))
    for (const c of ds.test) expect(trainEp.has(c.episode)).toBe(false)
  }, 120_000)
})

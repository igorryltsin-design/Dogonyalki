/** Глаз игры: фовеальный путь обязан побитово совпадать со стендом-эталоном
 *  (fixtures/orig/localSim.ts), камерный — честно видеть только своё поле. */

import { describe, expect, it } from 'vitest'
import { decodeImage, eyeAngles, eyeCellWidth, eyeHalfFov, eyeImage, measureTheta, rasterEye } from './eye'
import * as orig from '../fixtures/orig/localSim'
import { EYE_CAMERA, EYE_FLY, type EyeConfig } from './types'

const HALF165 = ((165 / 2) * Math.PI) / 180
const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

describe('фовеальная решётка — побитовое совпадение с эталоном', () => {
  it('углы клеточков совпадают с foveaAngles()', () => {
    expect(eyeAngles(EYE_FLY)).toEqual(orig.foveaAngles(HALF165))
    // другая ширина поля тоже обязана совпадать
    const eye40: EyeConfig = { grid: 'foveal', fovDeg: 40, noisePct: 0 }
    expect(eyeAngles(eye40)).toEqual(orig.foveaAngles(eyeHalfFov(eye40)))
  })

  it('картинка цели совпадает с rasterFoveal()', () => {
    const cases: [number, number, number][] = [
      [rad(3), rad(-2), 0.02],
      [rad(40), rad(35), 0.1],
      [rad(-80), rad(0.2), 0.3],
      [0, 0, 0],
      [rad(5), rad(5), 0.35],
    ]
    for (const [az, el, size] of cases) {
      expect(rasterEye(az, el, size, EYE_FLY)).toEqual(orig.rasterFoveal(az, el, size, HALF165))
    }
  })

  it('декодирование совпадает с decodeImage() эталона', () => {
    const targets: [number, number][] = [
      [rad(0.4), rad(-0.3)],
      [rad(12), rad(9)],
      [rad(-60), rad(45)],
      [rad(2.2), rad(0)],
    ]
    for (const [az, el] of targets) {
      for (const size of [0.015, 0.06, 0.2]) {
        const img = orig.rasterFoveal(az, el, size, HALF165)
        expect(decodeImage(img, EYE_FLY)).toEqual(orig.decodeImage(img, HALF165))
      }
    }
  })

  it('измерение углового размера совпадает с measureTheta()', () => {
    const az = rad(7)
    const el = rad(-5)
    const img = orig.rasterFoveal(az, el, 0.08, HALF165)
    const total = img.flat().reduce((s, v) => s + v, 0)
    expect(measureTheta(total, az, el, EYE_FLY)).toBe(orig.measureTheta(total, az, el, HALF165))
    // ноль и мелочь — тоже граничные случаи
    expect(measureTheta(0, az, el, EYE_FLY)).toBe(orig.measureTheta(0, az, el, HALF165))
    const tiny = orig.rasterFoveal(az, el, 0.001, HALF165).flat().reduce((s, v) => s + v, 0)
    expect(measureTheta(tiny, az, el, EYE_FLY)).toBe(orig.measureTheta(tiny, az, el, HALF165))
  })
})

describe('камерная решётка — узкое поле без обмана', () => {
  it('сетка равномерна: все клеточки одной ширины', () => {
    const wx = eyeCellWidth(EYE_CAMERA)
    expect(Math.max(...wx) - Math.min(...wx)).toBeLessThan(1e-12)
  })

  it('цель в поле: декодер целится ближе чем на градус', () => {
    for (const az of [2, 4, -5.2, 6]) {
      for (const el of [-3, 0, 4.5]) {
        const img = rasterEye(rad(az), rad(el), 0.03, EYE_CAMERA)
        const dec = decodeImage(img, EYE_CAMERA)
        expect(Math.abs(deg(dec.az - rad(az)))).toBeLessThan(1)
        expect(Math.abs(deg(dec.el - rad(el)))).toBeLessThan(1)
        expect(dec.peak_rel).toBeGreaterThan(0.25)
      }
    }
  })

  it('цель вне поля 13° — камерный глаз её не видит вовсе', () => {
    const img = eyeImage(rad(35), rad(0), 0.03, 0.6, EYE_CAMERA)
    expect(img.flat().reduce((s, v) => s + v, 0)).toBe(0)
    const dec = decodeImage(img, EYE_CAMERA)
    expect(dec.peak_rel).toBeLessThanOrEqual(0.25)
    // а мушиный глаз ту же цель видит: она у него в поле 165°
    const flyImg = eyeImage(rad(35), rad(0), 0.03, 0.6, EYE_FLY)
    expect(flyImg.flat().reduce((s, v) => s + v, 0)).toBeGreaterThan(0.5)
    expect(decodeImage(flyImg, EYE_FLY).peak_rel).toBeGreaterThan(0.25)
  })
})

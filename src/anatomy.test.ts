/** Анатомия обязана совпадать с расчётом: ни одного канала без хозяина и ни
 *  одного региона, который игра не освещает ничем реальным. */

import { describe, expect, it } from 'vitest'
import { CHANNELS, DRAWN_NEURONS, LINKS, REAL_NEURONS, REGIONS, channelValue, linkWeight, regionActivity } from './anatomy'
import { getW } from './brain'
import { localRun } from './localSim'
import { chaseVariant } from './scenarios'
import { EYE_CAMERA, EYE_FLY, type EyeConfig } from './types'

describe('анатомия против контура', () => {
  it('каждый канал readout принадлежит ровно одному региону', () => {
    const seen = new Map<number, string[]>()
    for (const r of REGIONS) for (const c of r.cols) seen.set(c, [...(seen.get(c) ?? []), r.name])
    for (let c = 0; c < CHANNELS; c += 1) {
      expect(seen.get(c)?.length, `канал ${c}`).toBe(1)
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: CHANNELS }, (_, i) => i))
  })

  it('имена регионов уникальны, пути ведут в существующие регионы', () => {
    const names = new Set(REGIONS.map((r) => r.name))
    expect(names.size).toBe(REGIONS.length)
    for (const l of LINKS) {
      expect(names.has(l.from), `откуда: ${l.from}`).toBe(true)
      expect(names.has(l.to), `куда: ${l.to}`).toBe(true)
    }
  })

  it('входы «решения» покрыты: у каждого чувствительного региона есть свой путь', () => {
    const feeders = REGIONS.filter((r) => r.cols.length).map((r) => r.name)
    for (const name of feeders) {
      expect(LINKS.some((l) => l.from === name && l.to === 'решение'), name).toBe(true)
    }
  })

  it('в живом кадре есть чем светить: активность nonzero, веса читаются', () => {
    const gen = localRun(chaseVariant(2, EYE_FLY), { pilot: 'fly' })
    let lit = 0
    let checked = 0
    for (const fr of gen) {
      if (!fr.brain) continue
      checked += 1
      expect(fr.brain.feat.length + fr.brain.t4.length + fr.brain.t5.length + fr.brain.lc11.length + fr.brain.lc10.length).toBe(CHANNELS)
      for (const r of REGIONS) {
        const a = regionActivity(r.name, fr.brain)
        expect(Number.isFinite(a), r.name).toBe(true)
        if (a > 0.01) lit += 1
      }
      expect(channelValue(0, fr.brain)).toBeGreaterThanOrEqual(0)
      if (checked > 40) break
    }
    expect(checked).toBeGreaterThan(10)
    expect(lit).toBeGreaterThan(0)
    const w = getW()
    expect(linkWeight(LINKS.find((l) => l.to === 'решение')!, w)).toBeGreaterThanOrEqual(0)
  })

  it('честность популяций: рисуем не больше клеток, чем в живом мозге', () => {
    for (const r of REGIONS) {
      expect(r.n, r.name).toBeGreaterThan(0)
      expect(r.n, `нарисовано против реальности: ${r.name}`).toBeLessThanOrEqual(r.real)
    }
    // картина обязана быть густой: иначе вкладка выглядит набором точек, а не мозгом
    expect(DRAWN_NEURONS).toBeGreaterThan(10000)
    // и честной по сумме: реальный мозг заметно больше картинки
    expect(REAL_NEURONS).toBeGreaterThan(DRAWN_NEURONS)
    expect(DRAWN_NEURONS).toBe(REGIONS.reduce((s, r) => s + r.n, 0))
  })

  it('камера гасит контур: на узком глазу светиться почти нечему', () => {
    // средняя активность по всем регионам и кадрам — то, что рисует вкладка
    const meanWith = (eye: EyeConfig) => {
      let sum = 0
      let n = 0
      let frames = 0
      for (const fr of localRun(chaseVariant(4, eye), { pilot: 'fly' })) {
        if (!fr.brain) continue
        frames += 1
        for (const r of REGIONS) {
          sum += regionActivity(r.name, fr.brain)
          n += 1
        }
        if (frames > 120) break
      }
      return n ? sum / n : 0
    }
    const fly = meanWith(EYE_FLY)
    const cam = meanWith(EYE_CAMERA)
    expect(fly).toBeGreaterThan(0.02)
    expect(cam, `мушиный ${fly.toFixed(3)} против камерного ${cam.toFixed(3)}`).toBeLessThan(fly)
  })
})

import { describe, expect, it } from 'vitest'
import { PRESETS, pathScenario, smoothPath } from './drawPath'
import { localRun } from './localSim'
import { EYE_FLY } from './types'

/** «Нарисуй, как убегать» и «Побудь мухой»: нарисованный путь честно
 *  проходится, а ручной руль честно рулит — через тот же движок. */

describe('нарисованный путь', () => {
  it('каракули сглаживаются, слишком близкий старт отклоняется', () => {
    expect(smoothPath([[1, 0], [30, 5]]).ok).toBe(false)
    const ok = smoothPath([[10, 0], [20, 6], [30, -6], [40, 0]])
    expect(ok.ok).toBe(true)
  })

  it('Шустрик бежит по линии, а не по старому манёвру', () => {
    for (const pr of PRESETS) {
      const res = smoothPath(pr.make())
      expect(res.ok, pr.name).toBe(true)
      if (!res.ok) continue
      const sc = pathScenario(res.path, EYE_FLY)
      let worst = 0
      for (const fr of localRun(sc, { pilot: 'cheater' })) {
        // расстояние от Шустрика до ближайшей точки пути
        let d = Infinity
        for (const q of res.path) d = Math.min(d, Math.hypot(fr.runner[0] - q[0], fr.runner[1] - q[1]))
        // за концом пути он бежит дальше прямо — это не ошибка
        const s = fr.t * sc.v_runner
        if (s < 0.95 * res.path.length * 0.5) worst = Math.max(worst, d)
      }
      expect(worst, pr.name).toBeLessThan(0.6)
    }
  })

  it('читер догоняет на готовых фигурах — путь проходимый', () => {
    let caught = 0
    for (const pr of PRESETS) {
      const res = smoothPath(pr.make())
      if (!res.ok) continue
      for (const fr of localRun(pathScenario(res.path, EYE_FLY), { pilot: 'cheater' })) if (fr.event === 'догнал') caught += 1
    }
    expect(caught).toBeGreaterThanOrEqual(PRESETS.length - 1)
  })
})

describe('побудь мухой', () => {
  const res = smoothPath(PRESETS[0].make())
  if (!res.ok) throw new Error('пресет не прошёл')
  const sc = pathScenario(res.path, EYE_FLY)

  it('без руля муха летит прямо', () => {
    let maxY = 0
    for (const fr of localRun(sc, { pilot: 'manual', manual: () => ({ yaw: 0, pitch: 0 }) })) maxY = Math.max(maxY, Math.abs(fr.chaser[1]))
    expect(maxY).toBeLessThan(0.01)
  })

  it('простой игрок «держи пятно в центре» догоняет — руль работает', () => {
    let look = 0
    let lookEl = 0
    let hit = false
    // игрок видит только кадр: поворачивает туда, где пятно; высоту держит
    // автопилот по тому же кадру — как в игре
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    for (const fr of localRun(sc, { pilot: 'manual', manual: () => ({ yaw: clamp(look * 8), pitch: clamp(lookEl * 6) }) })) {
      if (fr.lock) {
        look = fr.look_az
        lookEl = fr.look_el
      }
      if (fr.event === 'догнал') hit = true
    }
    expect(hit).toBe(true)
  })
})

import { ARENA_POOL, arenaVariant, nextArenaVariant } from './scenarios'

describe('«Пуск» каждый раз — новая погоня', () => {
  const endOf = (i: number) => {
    let last: number[] = [0, 0]
    for (const fr of localRun(arenaVariant(i, EYE_FLY), { pilot: 'cheater' })) last = fr.runner
    return last
  }

  it('Шустрик бежит по разным путям, и влево, и вправо', () => {
    const ends = Array.from({ length: 12 }, (_, i) => endOf(i))
    const distinct = new Set(ends.map((p) => `${Math.round(p[0] / 3)}:${Math.round(p[1] / 3)}`))
    expect(distinct.size).toBeGreaterThanOrEqual(8)
    // зеркальные варианты уходят в другую сторону
    expect(ends.some((p) => p[1] > 2)).toBe(true)
    expect(ends.some((p) => p[1] < -2)).toBe(true)
  })

  it('зеркальная погоня — точное отражение обычной', () => {
    const a = { ...arenaVariant(2, EYE_FLY), mirror: false }
    const b = { ...a, mirror: true }
    const ra = [...localRun(a, { pilot: 'cheater' })].map((f) => f.runner)
    const rb = [...localRun(b, { pilot: 'cheater' })].map((f) => f.runner)
    const n = Math.min(ra.length, rb.length, 200)
    for (let i = 0; i < n; i += 20) {
      expect(rb[i][0]).toBeCloseTo(ra[i][0], 3)
      expect(rb[i][1]).toBeCloseTo(-ra[i][1], 3)
    }
  })

  it('новая погоня не повторяет прошлую и все попадают в набор', () => {
    let prev: number | null = null
    for (let i = 0; i < 200; i += 1) {
      const k = nextArenaVariant(prev)
      expect(k).not.toBe(prev)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(ARENA_POOL)
      prev = k
    }
  })

  it('в наборе есть и погони, где муха догоняет, и где нет', () => {
    let hits = 0
    const N = 16
    for (let i = 0; i < N; i += 1) for (const fr of localRun(arenaVariant(i, EYE_FLY), { pilot: 'fly' })) if (fr.event === 'догнал') hits += 1
    expect(hits).toBeGreaterThan(0)
    expect(hits).toBeLessThan(N)
  }, 120000)
})

import { describe, expect, it } from 'vitest'
import {
  EVO_KEEP,
  EVO_SIZE,
  FAULTS,
  builtEye,
  cardPool,
  checkFly,
  evaluateBug,
  examRobot,
  firstGeneration,
  nextGeneration,
  randomFault,
  teachRobot,
} from './app/experiments'
import { getSteer } from './connectome'
import { applyEyeExtras, rasterEye } from './eye'
import { resetFly } from './trainLocal'
import { EYE_FLY, eyeFingerprint } from './types'

/** Опыты для урока честны: поломки «Почини муху» правда валят муху, а верная
 *  починка её оживляет; эволюция оставляет лучших и не портит руль Огонька;
 *  блик и крупные клеточки правда меняют кадр; робот на немногих карточках
 *  учится хуже, чем на всех. */

describe('«Почини муху»', () => {
  it('каждая поломка валит муху до нуля, здоровая ловит', async () => {
    resetFly()
    const healthy = await checkFly(null)
    expect(healthy).toBeGreaterThan(0)
    for (const f of FAULTS) expect(await checkFly(f.id), f.id).toBe(0)
  }, 300000)

  it('после опыта мозг и руль — как были', async () => {
    resetFly()
    const before = getSteer()
    await checkFly('flip')
    expect(getSteer()).toEqual(before)
    expect(await checkFly(null)).toBeGreaterThan(0)
  }, 120000)

  it('новая болезнь не повторяет прошлую', () => {
    for (const f of FAULTS) for (let i = 0; i < 20; i += 1) expect(randomFault(f.id)).not.toBe(f.id)
  })
})

describe('«Эволюция»', () => {
  it('лучшие остаются, остальные — их потомки', async () => {
    resetFly()
    const keep = getSteer()
    let gen = firstGeneration(42)
    expect(gen).toHaveLength(EVO_SIZE)
    const out = []
    for (const b of gen) out.push(await evaluateBug(b))
    gen = out
    // проверки по очереди не трогают руль самого Огонька
    expect(getSteer()).toEqual(keep)
    const next = nextGeneration(gen, 1)
    expect(next).toHaveLength(EVO_SIZE)
    const bestIds = [...gen].sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0)).slice(0, EVO_KEEP).map((b) => b.id)
    expect(next.slice(0, EVO_KEEP).map((b) => b.id)).toEqual(bestIds)
    expect(next.slice(EVO_KEEP).every((b) => b.parent !== null && bestIds.includes(b.parent))).toBe(true)
  }, 300000)
})

describe('особые глаза', () => {
  it('блик зажигает одно и то же место кадра, крупные клеточки — квадратами', () => {
    const base = rasterEye(0.3, 0, 0.05, EYE_FLY)
    const glared = applyEyeExtras(base, { ...EYE_FLY, glare: -0.5 })
    const sum = (m: number[][]) => m.flat().reduce((s, v) => s + v, 0)
    expect(sum(glared)).toBeGreaterThan(sum(base) + 0.5)
    const pooled = applyEyeExtras(base, builtEye(165, 'foveal', 4))
    // клеточки 4×4: внутри каждого квадрата 4×4 одно и то же значение
    expect(pooled[0][0]).toBe(pooled[3][3])
    expect(pooled[4][4]).toBe(pooled[7][7])
    // у разных глаз разные отпечатки — данные и сети не перепутаются
    expect(eyeFingerprint(builtEye(165, 'foveal', 4))).not.toBe(eyeFingerprint(EYE_FLY))
    expect(eyeFingerprint({ ...EYE_FLY, glare: 0 })).not.toBe(eyeFingerprint(EYE_FLY))
  })
})

describe('«Научи робота сам»', () => {
  it('на пяти карточках робот смотрит хуже, чем на всех', async () => {
    const { pick, test } = await cardPool()
    expect(pick).toHaveLength(24)
    const all = await examRobot(await teachRobot(pick), test)
    const few = await examRobot(await teachRobot(pick.filter((_, i) => i % 5 === 0)), test)
    expect(few.errDeg!).toBeGreaterThan(all.errDeg! * 1.5)
  }, 300000)
})

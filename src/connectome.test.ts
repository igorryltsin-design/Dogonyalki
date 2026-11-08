import { describe, expect, it } from 'vitest'
import { setFlyBrain } from './brain'
import { CircuitState, GROUPS, ROLE, circuit, getSteer, innateConnectomeW, setSilenced } from './connectome'
import { localRun } from './localSim'
import { chaseVariant } from './scenarios'
import { TRIAL_CHASES, resetFly, trainFly } from './trainLocal'
import { EYE_FLY } from './types'

/** Мозг Огонька из коннектома FlyWire: схема настоящая и целая, сигнал
 *  проходит от глаза до нисходящих нейронов, а поимки держатся там, где их
 *  намерили, — и без колонок глаза муха слепнет. */

const catches = (ids: number[]) => {
  let c = 0
  for (const i of ids) for (const fr of localRun(chaseVariant(i, EYE_FLY), { pilot: 'fly' })) if (fr.event === 'догнал') c += 1
  return c
}
const EVAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

describe('схема из коннектома', () => {
  it('целая: десять тысяч нейронов, все четыре слоя, связи из данных', () => {
    const c = circuit()
    expect(c.n).toBeGreaterThan(10000)
    expect(c.edges).toBeGreaterThan(70000)
    expect(c.synapses).toBeGreaterThan(900000)
    for (const r of [ROLE.input, ROLE.lc, ROLE.mid, ROLE.dn]) expect(c.role.some((x) => x === r)).toBe(true)
    expect(c.types).toContain('LC10a')
    expect(c.types).toContain('LC11')
  })

  it('ретинотопия: колонки правого глаза смотрят вправо, левого — влево', () => {
    const c = circuit()
    let ok = 0
    let all = 0
    for (let i = 0; i < c.n; i += 1) {
      if (c.role[i] !== ROLE.input || c.side[i] > 1) continue
      all += 1
      const az = c.view[i * 2]
      if ((c.side[i] === 1 && az > 0) || (c.side[i] === 0 && az < 0)) ok += 1
    }
    expect(ok / all).toBeGreaterThan(0.9)
  })

  it('сигнал доходит до нисходящих нейронов, а в темноте схема молчит', () => {
    const c = circuit()
    const dark = Array.from({ length: 16 }, () => Array(16).fill(0))
    const st = new CircuitState()
    for (let k = 0; k < 20; k += 1) st.step(dark, EYE_FLY, 0.02)
    expect(st.dnRates().reduce((s, v) => s + v, 0)).toBeLessThan(1e-6)
    let dn = 0
    for (const fr of localRun(chaseVariant(0, EYE_FLY), { pilot: 'cheater' })) {
      st.step(fr.image, EYE_FLY, 0.02)
      dn = Math.max(dn, st.dnRates().reduce((s, v) => s + v, 0))
    }
    expect(dn).toBeGreaterThan(0.5)
    expect(c.dns.length).toBeGreaterThan(300)
  })
})

describe('Огонёк на мозге из коннектома', () => {
  it('врождённый ловит, без колонок глаза — слепнет', () => {
    setFlyBrain('connectome')
    resetFly()
    expect(catches(EVAL)).toBeGreaterThanOrEqual(2)
    setSilenced(new Set([0]))
    expect(catches(EVAL)).toBe(0)
    setSilenced(new Set())
    expect(GROUPS.length).toBe(5)
  }, 120000)

  it('учится пробами на своих погонях и после учёбы ловит не хуже', async () => {
    setFlyBrain('connectome')
    resetFly()
    const before = catches(EVAL)
    // проверочные погони не пересекаются с учебными — иначе это зубрёжка
    for (const i of TRIAL_CHASES) expect(EVAL).not.toContain(i)
    await trainFly(EYE_FLY, 30)
    const after = catches(EVAL)
    expect(after).toBeGreaterThanOrEqual(before)
    const w = innateConnectomeW()
    expect(getSteer()).not.toEqual([w[1][0], w[0][1], w[1][2], w[0][3]])
    resetFly()
  }, 300000)
})

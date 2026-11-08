import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeScenery } from './Arena3D'
import { allScenarios, isClear } from './field'
import { localRun } from './localSim'
import { decodeImage } from './eye'
import { resetFly } from './trainLocal'

/** Никто не бегает сквозь деревья: настоящие бойцы на всех сценариях игры
 *  обходят стволы, кусты и камни — и в объёме, и на виде сверху. */

function realPaths() {
  resetFly()
  const pts: [number, number][] = []
  for (const sc of allScenarios()) {
    const predict = (img: number[][]) => {
      const d = decodeImage(img, sc.eye)
      return { az: d.az, el: d.el }
    }
    for (const pilot of ['fly', 'cheater', 'kid'] as const) {
      let i = 0
      for (const fr of localRun(sc, { pilot, predict })) {
        if (i % 3 === 0) {
          pts.push([fr.chaser[0], fr.chaser[1]])
          pts.push([fr.runner[0], fr.runner[1]])
        }
        i += 1
      }
    }
  }
  return pts
}

describe('поле без деревьев на пути', () => {
  const pts = realPaths()

  it('путей обсчитано много: все сценарии и три бойца', () => {
    expect(pts.length).toBeGreaterThan(10000)
  })

  it('в объёме ни один боец не проходит сквозь дерево, куст или камень', () => {
    const scenery = makeScenery()
    // какой след каждой массы считается «внутри предмета», м на единицу роста
    const body: Record<string, (s: number) => number> = {
      trunks: (s) => 1.2 * s + 0.4,
      pineTrunks: (s) => 1.0 * s + 0.4,
      bushes: (s) => 0.85 * s + 0.3,
      rocks: (s) => 0.45 * s + 0.3,
    }
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    for (const [name, rad] of Object.entries(body)) {
      const mesh = scenery.obj.getObjectByName(name) as THREE.InstancedMesh
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, sc)
        const r = rad(sc.x)
        // мир three (x, z) = движок (x, −y)
        let worst = Infinity
        for (const [x, y] of pts) worst = Math.min(worst, Math.hypot(x - p.x, -y - p.z))
        expect(worst, `${name} №${i} стоит на пути`).toBeGreaterThan(r)
      }
    }
  }, 120000)

  it('на виде сверху деревья и кусты тоже обходят тропинки', () => {
    // все точки настоящих путей — на тропинке: значит, предмет, чей след её
    // не задевает, стоит в стороне от бегущих
    let off = 0
    for (const [x, y] of pts) if (isClear(x, y)) off += 1
    expect(off).toBe(0)
  }, 60000)
})

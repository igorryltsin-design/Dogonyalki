import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CORRIDOR_HALF_M, DECOR_X0, DECOR_X1, THEME, flyModel, kidModel, makeScenery } from './Arena3D'

/** Проверки арены без единого пикселя: что модель собрана как существо, а не
 *  как шарик, и что приметы поля стоят там, где должны, — вне дорожки бегунов
 *  и ровно на земле. Рендер в браузере эти инварианты не проверяет: картинка
 *  красивая и с разъехавшейся кроной, и с деревом посреди беговой полосы. */

const meshes = (o: THREE.Object3D) => {
  const list: THREE.Mesh[] = []
  o.traverse((x) => {
    if ((x as THREE.Mesh).isMesh) list.push(x as THREE.Mesh)
  })
  return list
}

const boxOf = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(o)
}

describe('модель мухи', () => {
  it('собрана из частей, а не из одного тела', () => {
    const fly = flyModel(0x2e9e5b)
    const parts = meshes(fly.obj)
    // брюшко 3 + грудь 1 + голова 1 + глаза 2 + усики 2 + хоботок 1 +
    // крылья 2 + лапы 18 = 30 деталей
    expect(parts.length).toBeGreaterThanOrEqual(25)
    expect(fly.obj.getObjectByName('wingR')).toBeInstanceOf(THREE.Group)
    expect(fly.obj.getObjectByName('wingL')).toBeInstanceOf(THREE.Group)
    // фасеточные глаза — то, ради чего весь урок: они красные и свои, не тело
    expect(fly.eyeMat.color.getHex()).not.toBe(fly.bodyMat.color.getHex())
  })

  it('длинная вперёд-назад и выше ножками, чем крыльями вниз', () => {
    const fly = flyModel(0x2e9e5b)
    const b = boxOf(fly.obj)
    const size = b.getSize(new THREE.Vector3())
    // насекомое вытянуто по оси бега, а не круглое: x заметно больше y
    expect(size.x).toBeGreaterThan(size.y * 1.6)
    // лапы свешиваются под корпус — иначе это игрушка на проволоке
    expect(b.min.y).toBeLessThan(-0.2)
  })

  it('крыло качается вокруг основания, а не вокруг середины', () => {
    const fly = flyModel(0x2e9e5b)
    const sheet = fly.wingR.children[0] as THREE.Mesh
    // геометрия сдвинута так, что конец крыла дальше от опоры, чем основание:
    // у листа с центром в опоре взмах складывал бы крыло пополам
    const v = new THREE.Vector3()
    const pos = sheet.geometry.getAttribute('position')
    let max = 0
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i)
      max = Math.max(max, Math.hypot(v.x, v.y))
    }
    expect(max).toBeGreaterThan(0.5)
    expect(fly.wingR.position.distanceTo(new THREE.Vector3(0.06, 0.3, 0.12))).toBeLessThan(1e-6)
  })
  it('ни одна кисть мухи не забыта при перекраске', () => {
    const fly = flyModel(0x2e9e5b)
    // смена пилота и смена неба красят материалы по списку fly.skin. Если в
    // модели появится кисть вне списка, она останется и зелёной у
    // полносвязной сети, и несветящейся ночью — ровно так лапы и оставались
    // мушино-зелёными, пока их не вынесли в список
    const used = new Set<THREE.Material>()
    for (const m of meshes(fly.obj)) {
      const mat = m.material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((x) => used.add(x))
      else used.add(mat)
    }
    for (const mat of used) {
      // крылья — полупрозрачные пластинки без собственного свечения, они вне
      // списка намеренно; всё остальное обязано быть в fly.skin
      if (mat instanceof THREE.MeshLambertMaterial) {
        expect(fly.skin, `кисть ${mat.type} не перекрашивается`).toContain(mat)
      }
    }
    expect(fly.skin).toContain(fly.legMat)
  })
})

describe('модель Шустрика', () => {
  it('не однорукая: две руки и две ноги на суставах', () => {
    const kid = kidModel()
    for (const name of ['armR', 'armL', 'legR', 'legL']) {
      const pivot = kid.obj.getObjectByName(name)
      expect(pivot, `нет сустава ${name}`).toBeInstanceOf(THREE.Group)
      expect(pivot!.children.length, `у ${name} нет собственной конечности`).toBeGreaterThanOrEqual(2)
    }
    // плечи выше пояса, бёдра ниже — иначе конечности растут из живота
    expect(kid.armR.position.y).toBeGreaterThan(kid.legR.position.y)
    expect(meshes(kid.obj).length).toBeGreaterThanOrEqual(14)
  })

  it('ростом вдвое выше мухи и стоит на ногах', () => {
    const kid = boxOf(kidModel().obj)
    const fly = boxOf(flyModel(0x2e9e5b).obj)
    const kh = kid.max.y - kid.min.y
    const fh = fly.max.y - fly.min.y
    expect(kh).toBeGreaterThan(fh * 2)
    // ногами вниз до земли: минимальная высота модели — почти ноль
    expect(kid.min.y).toBeLessThan(0.25)
  })
})

describe('приметы поля', () => {
  const scenery = makeScenery()
  const masses = scenery.obj.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[]
  const byName = (n: string) => masses.find((m) => m.name === n)!
  const [trunks, crowns, bushes, tufts] = ['trunks', 'crowns', 'bushes', 'tufts'].map(byName)
  const [pineTrunks, pines, flowers, rocks] = ['pineTrunks', 'pines', 'flowers', 'rocks'].map(byName)
  const at = (m: THREE.InstancedMesh, i: number) => {
    const mat = new THREE.Matrix4()
    m.getMatrixAt(i, mat)
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    mat.decompose(p, q, s)
    return { p, s }
  }

  it('собраны в восемь масс — сцена не дорожает с числом деревьев', () => {
    expect(masses.length).toBe(8)
    expect([trunks.count, crowns.count, bushes.count, tufts.count]).toEqual([84, 84, 150, 420])
    expect([pineTrunks.count, pines.count, flowers.count, rocks.count]).toEqual([60, 60, 320, 45])
  })

  it('дерево не распадается: ствол и крона делят один рост и поворот', () => {
    for (const [tr, cr] of [[trunks, crowns], [pineTrunks, pines]]) {
      for (let i = 0; i < tr.count; i += 1) {
        const a = at(tr, i)
        const b = at(cr, i)
        expect(b.p.distanceTo(a.p), `ствол и крона разошлись, №${i}`).toBeLessThan(1e-6)
        expect(b.s.equals(a.s), `ствол и крона разного роста, №${i}`).toBe(true)
      }
    }
  })

  it('лес разноцветный: у крон свои оттенки, есть и осенние', () => {
    const c = new THREE.Color()
    const hexes = new Set<number>()
    let warm = 0
    for (let i = 0; i < crowns.count; i += 1) {
      crowns.getColorAt(i, c)
      hexes.add(c.getHex())
      if (c.r > c.g) warm += 1
    }
    expect(hexes.size).toBeGreaterThanOrEqual(5)
    expect(warm).toBeGreaterThan(3)
  })

  it('ни одного дерева и куста на беговой дорожке', () => {
    for (const m of [trunks, crowns, bushes, pineTrunks, pines, flowers, rocks]) {
      for (let i = 0; i < m.count; i += 1) {
        const { p } = at(m, i)
        expect(Math.abs(p.z), 'прятает модель').toBeGreaterThan(CORRIDOR_HALF_M)
        expect(p.x).toBeGreaterThanOrEqual(DECOR_X0 - 1)
        expect(p.x).toBeLessThanOrEqual(DECOR_X1 + 1)
        expect(p.y, 'не на земле').toBeCloseTo(0, 6)
      }
    }
  })

  it('травинки лежат и в дорожке: под ногами видно, что поле бежит', () => {
    let inside = 0
    for (let i = 0; i < tufts.count; i += 1) {
      const { p } = at(tufts, i)
      if (Math.abs(p.z) <= CORRIDOR_HALF_M) inside += 1
    }
    expect(inside).toBeGreaterThan(tufts.count / 2)
  })
})

describe('живые модели', () => {
  it('у мухи шесть лап на тазиках, шагают двумя треножниками', () => {
    const fly = flyModel(0x2e9e5b)
    expect(fly.legs.length).toBe(6)
    for (const l of fly.legs) expect(l.pivot.children.length).toBeGreaterThanOrEqual(3)
    const phases = fly.legs.map((l) => Math.round(l.phase * 100))
    // ровно по три лапы в каждой фазе — иначе муха хромает
    expect(phases.filter((p) => p === 0).length).toBe(3)
    // в каждом треножнике лапы с обеих сторон
    const tripod = fly.legs.filter((l) => l.phase === 0).map((l) => Math.sign(l.pivot.position.z))
    expect(new Set(tripod).size).toBe(2)
  })

  it('у Шустрика есть лицо, и оно смотрит вперёд', () => {
    const kid = kidModel()
    expect(kid.faceMats.length).toBeGreaterThanOrEqual(3)
    // все детали лица лежат на передней (+z) половине головы
    const faceMeshes = meshes(kid.obj).filter((m) => kid.faceMats.includes(m.material as THREE.MeshLambertMaterial))
    expect(faceMeshes.length).toBeGreaterThanOrEqual(6)
    for (const m of faceMeshes) expect(m.position.z).toBeGreaterThan(0.15)
  })
})

describe('ночь', () => {
  // относительная яркость цвета по sRGB — грубая, но честная мерка
  const lum = (hex: number) => {
    const c = new THREE.Color(hex)
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  }
  it('не чёрная: небо и луг видно и на проекторе в светлом классе', () => {
    expect(lum(THEME.night.sky)).toBeGreaterThan(0.025)
    expect(lum(THEME.night.grass)).toBeGreaterThan(0.06)
    // но всё-таки ночь: темнее дня
    expect(lum(THEME.night.sky)).toBeLessThan(lum(THEME.day.sky) * 0.3)
    expect(THEME.night.hemiI).toBeGreaterThanOrEqual(0.9)
  })
})

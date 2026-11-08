import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { makeRng } from './rng'
import { CLEAR_BUSH, CLEAR_TREE, CLEAR_TUFT, clearOfPath, type PathPoint } from './field'
import type { GameFrame, Pilot } from './types'

/** Трёхмерная арена: та же погоня, что рисовалась видом сверху, но в объёме —
 *  земля, небо, муха и Шустрик модельками, трассы и камера, которая летит за
 *  парой. Движок ни при чём: он отдаёт кадры, здесь их только показывают.
 *
 *  Специально аскетично, без постобработки стенда (тяжёлая сцена на школьных
 *  машинах и на замерах давала ~2 кадра/с): примитивы, два-три источника
 *  света, никаких теней, пиксельная плотность ограничена.
 *
 *  Кадры приходят через frameSink — экран складывает их сюда напрямую, минуя
 *  React: иначе 50 раз в секунду перерисовывалось бы всё дерево, и на слабом
 *  ноутбуке погоня начала бы тормозить не из-за сцены, а из-за интерфейса.
 *
 *  Оси: у движка x — вперёд, y — вбок, z — вверх; в three по умолчанию y —
 *  вверх, поэтому мир перекладывается один раз: world = (x, z, −y). Внутри
 *  моделей дальше свои договорённости: у мухи морда смотрит вдоль местного x,
 *  у Шустрика — вдоль местного z, вверх у обеих по y. */

const PILOT_COLOR: Record<Pilot, number> = { fly: 0x2e9e5b, kid: 0x3a7bd5, cheater: 0xe0a12a }
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
/** верх сцены: у движка вверх — это z, в three он всегда (0,1,0) */
const UP = new THREE.Vector3(0, 1, 0)
/** вверх модели: у мухи и Шустрика он местный y */
const MODEL_UP = new THREE.Vector3(0, 1, 0)

/** Мультяшный масштаб: настоящая муха в сантиметр на этих дальностях просто
 *  не разглядеть, а Шустрик ростом 1,4 м на камере в 15 метрах был бы пылинкой.
 *  Поэтому обе модели крупнее жизни — но в ОДНОМ отношении друг к другу, чтобы
 *  ребёнок видел: это муха догоняет человека, а не два одинаковых шарика. */
const FLY_SCALE = 0.62
const KID_SCALE = 1.4

const TRAIL_MAX = 900

/** Палитры сцены. Ночные цвета взяты из стенда-первоисточника (THEME_NIGHT):
 *  там ночную читаемость держало не освещение, а собственное свечение
 *  моделей — тот же приём повторяем здесь через emissive. */
const THEME = {
  day: {
    sky: 0xd9eefb, fog: 0xd9eefb, fogNear: 40, fogFar: 150,
    grass: 0xbfe0ab, grid: 0x8ec07e,
    hemiSky: 0xeaf6ff, hemiGround: 0xbfe0ab, hemiI: 1.05,
    sun: 0xfff2d0, sunI: 0.85, sunPos: new THREE.Vector3(20, 40, 25),
    rimI: 0,
    trailT: 0x8a7f70, trailOpM: 0.8, trailOpT: 0.55,
    beam: 0x1f2a1a, beamOp: 0.85,
    trunk: 0x7a5a3a, crown: 0x4f8f5a, bush: 0x69a86f, tuft: 0x8fc98a,
  },
  night: {
    sky: 0x0c1418, fog: 0x1b2833, fogNear: 45, fogFar: 175,
    grass: 0x1c3d34, grid: 0x2f5b52,
    hemiSky: 0x2b3d55, hemiGround: 0x0d1a16, hemiI: 0.5,
    sun: 0xbfd4ee, sunI: 0.55, sunPos: new THREE.Vector3(-26, 40, -34),
    rimI: 0.5,
    trailT: 0xff7a55, trailOpM: 1, trailOpT: 0.75,
    beam: 0xe7c15a, beamOp: 1,
    trunk: 0x2e2116, crown: 0x1d4436, bush: 0x215247, tuft: 0x2c6b5a,
  },
} as const

/** мир движка → мир three */
const W = (p: number[], o: THREE.Vector3) => o.set(p[0], p[2], -p[1])
const darker = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k).getHex()

/** Лапа или рука: цилиндр единичной длины с опорой в основании, натянутый
 *  между двумя точками. Приём прямо из донорской модели мухи — суставы
 *  остаются на своих местах, когда меняешь только концы. */
const boneGeo = (r: number) => {
  const g = new THREE.CylinderGeometry(r, r * 0.78, 1, 6)
  g.translate(0, 0.5, 0)
  return g
}
function stretch(seg: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const dir = b.clone().sub(a)
  const len = Math.max(dir.length(), 1e-4)
  seg.scale.set(1, len, 1)
  seg.position.copy(a)
  seg.quaternion.setFromUnitVectors(MODEL_UP, dir.divideScalar(len))
}

/* ── муха: голова с фасеточными глазами, хоботком и усиками, грудь,
      полосатое брюшко, два крыла на общих опорах, шесть лап ─────────────
   Анатомия взята из модели стенда: там насекомое было живым именно за счёт
   сегментов брюшка, больших глаз и лап с двумя костями, а не шарика. */
type Fly = {
  obj: THREE.Group
  wingR: THREE.Group
  wingL: THREE.Group
  bodyMat: THREE.MeshLambertMaterial
  bandMat: THREE.MeshLambertMaterial
  eyeMat: THREE.MeshLambertMaterial
  legMat: THREE.MeshLambertMaterial
  wingMat: THREE.MeshBasicMaterial
  skin: THREE.MeshLambertMaterial[]
}

export function flyModel(color: number): Fly {
  const g = new THREE.Group()
  // цвет пилота — опознавательный: муха, сеть школьника и читер различаются
  // именно телом, поэтому брюшко и грудь красятся одной кистью
  const bodyMat = new THREE.MeshLambertMaterial({ color })
  const bandMat = new THREE.MeshLambertMaterial({ color: darker(color, 0.45) })
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b, emissive: 0x7a2015 })
  const legMat = new THREE.MeshLambertMaterial({ color: darker(color, 0.4) })
  const skin: THREE.MeshLambertMaterial[] = [bodyMat, bandMat, eyeMat, legMat]

  // брюшко: три последовательных сегмента, каждый меньше предыдущего, —
  // полосатость читается силуэтом даже издалека
  for (let i = 0; i < 3; i += 1) {
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.34 - i * 0.07, 12, 10), i % 2 ? bandMat : bodyMat)
    seg.scale.set(1.25, 0.9, 1)
    seg.position.set(-0.52 - i * 0.34, 0.02, 0)
    g.add(seg)
  }
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), bodyMat)
  thorax.scale.set(1.1, 0.95, 1)
  thorax.position.set(-0.02, 0.04, 0)
  g.add(thorax)

  // голова: сама поменьше, зато глаза — добрая половина лица, как у мухи
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), bodyMat)
  head.scale.set(0.9, 0.95, 1.05)
  head.position.set(0.44, 0.06, 0)
  g.add(head)
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), eyeMat)
    eye.scale.set(0.85, 1.05, 1)
    eye.position.set(0.56, 0.12, 0.14 * side)
    g.add(eye)
    // усик: тонкая палочка вперёд и вверх — по ней видно, что голова живая
    const feeler = new THREE.Mesh(boneGeo(0.022), legMat)
    stretch(feeler, new THREE.Vector3(0.62, 0.2, 0.08 * side), new THREE.Vector3(0.82, 0.34, 0.16 * side))
    g.add(feeler)
  }
  // хоботок: короткий конус вперёд и вниз — жвалы мухи смотрят на землю,
  // куда она летит, а не в небо
  const proboscis = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 8), bandMat)
  proboscis.position.set(0.62, -0.12, 0)
  proboscis.rotation.z = -Math.PI / 2 - 0.5
  g.add(proboscis)

  // крылья: пластинка с опорой в основании, посаженная на группу-плечо.
  // Пока геометрия сдвинута к концу крыла, взмах группы поднимает весь лист,
  // а не поворачивает его вокруг середины — крыло не «складывается пополам»
  const wingMat = new THREE.MeshBasicMaterial({
    color: 0xeaf6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
  })
  const wingGeo = new THREE.CircleGeometry(0.42, 12)
  wingGeo.scale(1.85, 0.8, 1)
  wingGeo.translate(-0.62, 0, 0)
  const mkWing = (side: 1 | -1, name: string) => {
    const wrap = new THREE.Group()
    wrap.position.set(0.06, 0.3, 0.12 * side)
    const sheet = new THREE.Mesh(wingGeo, wingMat)
    // раскладываем лист горизонтально: плоскость круга (местные x,y) — в x,z модели
    sheet.rotation.x = -Math.PI / 2
    // разворот наружу и немного назад: крыло мухи сложено «домиком»
    wrap.rotation.z = 0.18 * side
    wrap.rotation.y = 0.35 * side
    wrap.add(sheet)
    wrap.name = name
    g.add(wrap)
    return wrap
  }
  const wingR = mkWing(1, 'wingR')
  const wingL = mkWing(-1, 'wingL')

  // лапы: шесть, каждая на две кости с коленом выше бедра — насекомое
  // стоит на согнутых лапках, а не на торчащих палках
  for (const side of [1, -1]) {
    for (const [hipX, footX, k] of [[0.16, 0.42, 1], [-0.06, 0.02, 1.05], [-0.26, -0.5, 1.15]] as const) {
      const hip = new THREE.Vector3(hipX, -0.06, 0.16 * side)
      const knee = new THREE.Vector3(hipX + 0.04, 0.3 * k, 0.42 * side)
      const foot = new THREE.Vector3(footX, -0.5, 0.5 * side)
      const upper = new THREE.Mesh(boneGeo(0.035), legMat)
      const lower = new THREE.Mesh(boneGeo(0.028), legMat)
      stretch(upper, hip, knee)
      stretch(lower, knee, foot)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), legMat)
      tip.position.copy(foot)
      g.add(upper, lower, tip)
    }
  }

  g.scale.setScalar(FLY_SCALE)
  return { obj: g, wingR, wingL, bodyMat, bandMat, eyeMat, legMat, wingMat, skin }
}

/* ── Шустрик: голова с причёской и двумя косичками, туловище-майка,
      две руки, две ноги в ботинках. Прежняя версия была однорукой
      куклой — по ней нельзя было понять, что ребёнок бежит. */
type Kid = {
  obj: THREE.Group
  armR: THREE.Group
  armL: THREE.Group
  legR: THREE.Group
  legL: THREE.Group
  shirtMat: THREE.MeshLambertMaterial
  skinMat: THREE.MeshLambertMaterial
  hairMat: THREE.MeshLambertMaterial
  pantsMat: THREE.MeshLambertMaterial
  shoeMat: THREE.MeshLambertMaterial
}

export function kidModel(): Kid {
  const g = new THREE.Group()
  const shirtMat = new THREE.MeshLambertMaterial({ color: 0xd95a3d })
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xf3c9a0 })
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x6a3a1e })
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x3b4a63 })
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x243043 })

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.56, 6, 12), shirtMat)
  torso.position.y = 1.02
  g.add(torso)
  // юбка-шорты: темнее майки, отделяет ноги от туловища
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.22, 12), pantsMat)
  skirt.position.y = 0.66
  g.add(skirt)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), skinMat)
  head.position.y = 1.72
  g.add(head)
  // причёска: шапка волос чуть больше головы — силуэтом видно, где верх
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 10), hairMat)
  hair.scale.set(1.02, 0.78, 1.04)
  hair.position.set(0, 1.82, -0.02)
  g.add(hair)
  // две косички по бокам с бантиками: по ним видно, куда Шустрик повернул
  for (const side of [1, -1]) {
    const braid = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 4, 8), hairMat)
    braid.position.set(0.28 * side, 1.5, -0.12)
    braid.rotation.z = 0.45 * side
    braid.rotation.x = 0.4
    g.add(braid)
    const bow = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), shirtMat)
    bow.position.set(0.34 * side, 1.66, -0.06)
    g.add(bow)
  }

  // руки: группа-плечо с опорой в суставе, внутри — предплечье и кисть.
  // Взмах живёт в rotation.x группы, поэтому кисть всегда остаётся на конце
  const mkArm = (side: 1 | -1, name: string) => {
    const wrap = new THREE.Group()
    wrap.position.set(0.36 * side, 1.3, 0)
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.44, 4, 8), shirtMat)
    upper.position.y = -0.3
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), skinMat)
    hand.position.y = -0.62
    wrap.add(upper, hand)
    wrap.name = name
    g.add(wrap)
    return wrap
  }
  const armR = mkArm(1, 'armR')
  const armL = mkArm(-1, 'armL')

  const mkLeg = (side: 1 | -1, name: string) => {
    const wrap = new THREE.Group()
    wrap.position.set(0.15 * side, 0.62, 0)
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 4, 8), pantsMat)
    thigh.position.y = -0.28
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.34), shoeMat)
    shoe.position.set(0, -0.56, 0.08)
    wrap.add(thigh, shoe)
    wrap.name = name
    g.add(wrap)
    return wrap
  }
  const legR = mkLeg(1, 'legR')
  const legL = mkLeg(-1, 'legL')

  g.scale.setScalar(KID_SCALE)
  return { obj: g, armR, armL, legR, legL, shirtMat, skinMat, hairMat, pantsMat, shoeMat }
}

/** Поле: приметы стоят там, где по ним никто не бегает. Неподвижные приметы —
 *  единственное, что выдаёт скорость и направление на ровном лугу: без них
 *  погоня выглядит бегущими по столу. Но дерево, посаженное на тропу, даёт
 *  ровно противоположный эффект — и муха, и Шустрик проходят сквозь ствол.
 *  Поэтому поле раскладывают по настоящему пути этого погоня (см. ./field.ts),
 *  а не по дорожке, прикинутой на глаз.
 *  Всё собрано в четыре массы, поэтому на школьном ноутбуке цена сцены —
 *  четыре вызова отрисовки, сколько бы деревьев ни росло. */
export const DECOR_X0 = -70
export const DECOR_X1 = 330
/** насколько вбок от стартовой линии распускается поле */
export const DECOR_Y = 58

type Scenery = {
  obj: THREE.Group
  mats: {
    trunk: THREE.MeshLambertMaterial
    crown: THREE.MeshLambertMaterial
    bush: THREE.MeshLambertMaterial
    tuft: THREE.MeshLambertMaterial
  }
  /** переложить поле под новый путь — те же массы, только матрицы экземпляров */
  lay: (path: PathPoint[]) => void
}

export function makeScenery(path: PathPoint[] = []): Scenery {
  const group = new THREE.Group()
  const trunkMat = new THREE.MeshLambertMaterial({ color: THEME.day.trunk })
  const crownMat = new THREE.MeshLambertMaterial({ color: THEME.day.crown })
  const bushMat = new THREE.MeshLambertMaterial({ color: THEME.day.bush })
  const tuftMat = new THREE.MeshLambertMaterial({ color: THEME.day.tuft })
  const mats = { trunk: trunkMat, crown: crownMat, bush: bushMat, tuft: tuftMat }

  /** Ставит экземпляр в точку поля (x — вперёд, y — вбок) с поворотом ry и
   *  масштабом (s, s·sy, s). Координаты движковы, а world здесь берут один раз:
   *  z сцены — это −y поля, иначе поле и бойцы смотрели бы в разные стороны.
   *  Высота сидит в самой геометрии (она поднята вверх наполовину), поэтому
   *  любой масштаб оставляет предмет прижатым к земле. */
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, s: number, sy: number, ry: number) => {
    mesh.setMatrixAt(
      i,
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, -y),
        new THREE.Quaternion().setFromAxisAngle(UP, ry),
        new THREE.Vector3(s, s * sy, s),
      ),
    )
  }

  /** Ищет свободное место: не ближе `clear` метров к тропе погони. */
  const spot = (rng: () => number, pts: PathPoint[], yMin: number, clear: number) => {
    for (let tries = 0; tries < 30; tries += 1) {
      const x = DECOR_X0 + rng() * (DECOR_X1 - DECOR_X0)
      const y = (rng() > 0.5 ? 1 : -1) * (yMin + rng() * (DECOR_Y - yMin))
      if (clearOfPath(pts, x, y, clear)) return { x, y }
    }
    return null
  }

  const N_TREE = 84
  const N_BUSH = 150
  const N_TUFT = 420
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.36, 2.6, 6)
  trunkGeo.translate(0, 1.3, 0)
  const crownGeo = new THREE.SphereGeometry(1.7, 10, 8)
  crownGeo.translate(0, 3.4, 0)
  const bushGeo = new THREE.SphereGeometry(0.85, 8, 6)
  bushGeo.translate(0, 0.45, 0)
  const tuftGeo = new THREE.ConeGeometry(0.16, 0.55, 4)
  tuftGeo.translate(0, 0.27, 0)
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N_TREE)
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, N_TREE)
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, N_BUSH)
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, N_TUFT)
  group.add(trunks, crowns, bushes, tufts)

  /** Раскладка: у кого не нашлось свободного места — тот просто не посажен,
   *  зато ни одно дерево не стоит на тропе. Массы от этого не дорожают:
   *  вызовов отрисовки всё равно четыре. */
  const lay = (pts: PathPoint[]) => {
    const rng = makeRng(20260517)

    let n = 0
    for (let i = 0; i < N_TREE; i += 1) {
      const at = spot(rng, pts, 4, CLEAR_TREE)
      if (!at) continue
      const s = 0.8 + rng() * 1.5
      // рост и поворот — ОДНИ на ствол и крону: иначе ствол и крона разъехались
      // бы разными масштабами, и дерево распалось бы на две половинки
      const sy = 0.75 + rng() * 0.55
      const ry = rng() * Math.PI
      place(trunks, n, at.x, at.y, s, sy, ry)
      place(crowns, n, at.x, at.y, s, sy, ry)
      n += 1
    }
    trunks.count = n
    crowns.count = n

    let b = 0
    for (let i = 0; i < N_BUSH; i += 1) {
      const at = spot(rng, pts, 2.5, CLEAR_BUSH)
      if (!at) continue
      place(bushes, b, at.x, at.y, 0.7 + rng() * 1.1, 0.6 + rng() * 0.6, rng() * Math.PI)
      b += 1
    }
    bushes.count = b

    // травинки сажают ВДОЛЬ тропы, а не по всему полю: два-шесть метров в
    // стороне от бегущих — самый сильный признак скорости, а в самом следе
    // трава только торчала бы сквозь модель
    let t = 0
    for (let i = 0; i < N_TUFT; i += 1) {
      let at: { x: number; y: number } | null = null
      if (pts.length > 0) {
        const a = pts[Math.floor(rng() * pts.length)]
        const ang = rng() * Math.PI * 2
        const d = 1.3 + rng() * 5
        const cand = { x: a[0] + Math.cos(ang) * d, y: a[1] + Math.sin(ang) * d }
        if (clearOfPath(pts, cand.x, cand.y, CLEAR_TUFT)) at = cand
      } else {
        at = spot(rng, pts, 0, CLEAR_TUFT)
      }
      if (!at) continue
      place(tufts, t, at.x, at.y, 0.7 + rng() * 0.9, 0.7 + rng() * 0.9, rng() * Math.PI)
      t += 1
    }
    tufts.count = t

    trunks.instanceMatrix.needsUpdate = true
    crowns.instanceMatrix.needsUpdate = true
    bushes.instanceMatrix.needsUpdate = true
    tufts.instanceMatrix.needsUpdate = true
  }
  lay(path)

  return { obj: group, mats, lay }
}

/** Сетка поля: свои линии вместо GridHelper — у того цвета зашиты в вершины
 *  и перекрасить под ночную палитру нельзя, а сетка должна темнеть вместе со
 *  всем полем. Опорный шаг 10 м: сетка переезжает вместе с камерой, но
 *  прыжками по шагу, чтобы линии не «плыли» под ногами. */
function makeGrid(size: number, step: number, color: number) {
  const pts: number[] = []
  const half = size / 2
  for (let p = -half; p <= half; p += step) {
    pts.push(p, 0, -half, p, 0, half)
    pts.push(-half, 0, p, half, 0, p)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
  return { line: new THREE.LineSegments(geom, mat), mat, step }
}

function makeTrail(color: number, opacity: number) {
  const geom = new THREE.BufferGeometry()
  const attr = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3)
  attr.setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('position', attr)
  geom.setDrawRange(0, 0)
  const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
  return { geom, attr, line, mat: line.material as THREE.LineBasicMaterial }
}

/** Звёздное небо: одна масса точек в верхней полусфере небесной сферы,
 *  посадка детерминирована. Дневного неба не касается — звёзды просто
 *  выключены. */
function makeStars() {
  const rng = makeRng(424242)
  const N = 620
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i += 1) {
    const az = rng() * Math.PI * 2
    const el = Math.asin(Math.min(1, 0.05 + rng() * 0.95))
    const r = 168
    pos[i * 3] = Math.cos(el) * Math.cos(az) * r
    pos[i * 3 + 1] = Math.sin(el) * r
    pos[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xc8d8ea, size: 1.4, sizeAttenuation: false,
    transparent: true, opacity: 0.85, depthWrite: false, fog: false,
  })
  return { obj: new THREE.Points(geom, mat), mat }
}

/** Луна: мягкий диск на спрайте — текстура рисуется на canvas, внешних
 *  картинок в игре по-прежнему нет. */
function makeMoon() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g2 = c.getContext('2d')
  if (g2) {
    const grd = g2.createRadialGradient(32, 32, 5, 32, 32, 30)
    grd.addColorStop(0, 'rgba(236,244,250,1)')
    grd.addColorStop(0.55, 'rgba(212,228,240,0.9)')
    grd.addColorStop(1, 'rgba(212,228,240,0)')
    g2.fillStyle = grd
    g2.fillRect(0, 0, 64, 64)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.setScalar(16)
  sprite.position.set(-98, 76, -112)
  return { obj: sprite, mat, tex }
}

export type Arena3DProps = {
  /** экран складывает сюда каждый кадр погони */
  frameSink: React.MutableRefObject<((fr: GameFrame | null) => void) | null>
  pilot: Pilot
  /** радиус осаливания, м — им рисуется кольцо под Шустриком */
  tagRadius: number
  /** меняется с каждым пуском: трассы обнуляются */
  runKey: number
  /** день или ночь: меняется на месте, без перестройки сцены */
  night: boolean
  /** тропа этого погоня: по ней раскладывают поле, чтобы ни одно дерево не
   *  встало на дорогу бегущим */
  path: PathPoint[]
  /** что наложить поверх сцены (итог погони); в 2D-виде то же самое лежит
   *  внутри той же .stage — иначе плашка уезжала бы под картинку */
  children?: React.ReactNode
}

export function Arena3D({ frameSink, pilot, tagRadius, runKey, night, path, children }: Arena3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<{ setPilot: (p: Pilot) => void; reset: () => void; setNight: (n: boolean) => void; setField: (pts: PathPoint[]) => void } | null>(null)
  // радиус осаливания читаем через ref: сцена строится один раз на монтаж,
  // а prop приходит из сценария и пересобирать из-за него весь мир незачем
  const tagRef = useRef(tagRadius)
  tagRef.current = tagRadius
  // небо читаем так же через ref: сцена строится один раз на монтаж, а смена
  // пилота должна перекрасить модель уже под текущим небом
  const nightRef = useRef(night)
  nightRef.current = night

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(THEME.day.sky)
    scene.fog = new THREE.Fog(THEME.day.fog, THEME.day.fogNear, THEME.day.fogFar)

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 420)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    wrap.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'

    const hemi = new THREE.HemisphereLight(THEME.day.hemiSky, THEME.day.hemiGround, THEME.day.hemiI)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(THEME.day.sun, THEME.day.sunI)
    sun.position.copy(THEME.day.sunPos)
    scene.add(sun)
    // контровой: ночью модель терялась не потому, что тёмная, а потому что
    // тёмным был фон вместе с ней. Холодный кант по ребру силуэта отделяет
    // обоих и от неба, и от грунта
    const rim = new THREE.DirectionalLight(0x9ec6e8, THEME.day.rimI)
    rim.position.set(-sun.position.x, sun.position.y * 0.4, -sun.position.z)
    scene.add(rim)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: THEME.day.grass }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    const grid = makeGrid(600, 10, THEME.day.grid)
    grid.line.position.y = 0.02
    scene.add(grid.line)

    const scenery = makeScenery(path)
    scene.add(scenery.obj)

    const sky = new THREE.Group()
    const stars = makeStars()
    const moon = makeMoon()
    sky.add(stars.obj, moon.obj)
    stars.obj.visible = false
    moon.obj.visible = false
    scene.add(sky)

    const fly = flyModel(PILOT_COLOR[pilot])
    scene.add(fly.obj)
    const kid = kidModel()
    scene.add(kid.obj)

    // кольцо осаливания: коснулись внутри него — значит догнал
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 28),
      new THREE.MeshBasicMaterial({ color: 0x2e9e5b, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    scene.add(ring)

    // куда смотрит глаз: луч по пеленгу, а не по скорости
    const lookGeom = new THREE.BufferGeometry()
    const lookAttr = new THREE.BufferAttribute(new Float32Array(6), 3)
    lookAttr.setUsage(THREE.DynamicDrawUsage)
    lookGeom.setAttribute('position', lookAttr)
    const lookMat = new THREE.LineBasicMaterial({ color: THEME.day.beam, transparent: true, opacity: THEME.day.beamOp })
    scene.add(new THREE.Line(lookGeom, lookMat))

    const trailM = makeTrail(PILOT_COLOR[pilot], THEME.day.trailOpM)
    const trailT = makeTrail(THEME.day.trailT, THEME.day.trailOpT)
    scene.add(trailM.line, trailT.line)

    let last: GameFrame | null = null
    let trailN = 0
    let trailTick = 0
    const camPos = new THREE.Vector3(-12, 7, 0)
    const camAim = new THREE.Vector3(0, 1.2, 0)
    const mid = new THREE.Vector3()
    const want = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    const wp = new THREE.Vector3()
    const dirV = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const aim = new THREE.Vector3()

    function clearTrails() {
      trailN = 0
      trailTick = 0
      trailM.geom.setDrawRange(0, 0)
      trailT.geom.setDrawRange(0, 0)
    }

    frameSink.current = (fr) => {
      if (!fr) return
      // новый погон (время потекло сначала) — трассы с чистого листа
      if (last === null || fr.t < last.t) clearTrails()
      last = fr
      trailTick += 1
      if (trailTick % 3 === 0 && trailN < TRAIL_MAX) {
        W(fr.chaser, wp)
        trailM.attr.setXYZ(trailN, wp.x, Math.max(wp.y, 0.2), wp.z)
        W(fr.runner, wp)
        trailT.attr.setXYZ(trailN, wp.x, Math.max(wp.y, 0.2), wp.z)
        trailN += 1
        trailM.geom.setDrawRange(0, trailN)
        trailT.geom.setDrawRange(0, trailN)
        trailM.attr.needsUpdate = true
        trailT.attr.needsUpdate = true
      }
    }

    /** день ↔ ночь: перекрашиваем всё на месте. Ночной свет не вытягивает
     *  силуэты — поэтому у ночных материалов включаем собственное свечение,
     *  как в донорской сцене. */
    function setNight(on: boolean) {
      const t = on ? THEME.night : THEME.day
      ;(scene.background as THREE.Color).setHex(t.sky)
      const fog = scene.fog as THREE.Fog
      fog.color.setHex(t.fog)
      fog.near = t.fogNear
      fog.far = t.fogFar
      hemi.color.setHex(t.hemiSky)
      hemi.groundColor.setHex(t.hemiGround)
      hemi.intensity = t.hemiI
      sun.color.setHex(t.sun)
      sun.intensity = t.sunI
      sun.position.copy(t.sunPos)
      // контровой всегда сидит напротив источника света — иначе кант шёл бы
      // по той же стороне, что и свет, и силуэт не отделялся бы от фона
      rim.intensity = t.rimI
      rim.position.set(-t.sunPos.x, t.sunPos.y * 0.4, -t.sunPos.z)
      ;(ground.material as THREE.MeshLambertMaterial).color.setHex(t.grass)
      grid.mat.color.setHex(t.grid)
      scenery.mats.trunk.color.setHex(t.trunk)
      scenery.mats.crown.color.setHex(t.crown)
      scenery.mats.bush.color.setHex(t.bush)
      scenery.mats.tuft.color.setHex(t.tuft)
      stars.obj.visible = on
      moon.obj.visible = on
      trailT.mat.color.setHex(t.trailT)
      trailM.mat.opacity = t.trailOpM
      trailT.mat.opacity = t.trailOpT
      lookMat.color.setHex(t.beam)
      lookMat.opacity = t.beamOp
      ;(ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.85 : 0.6
      // крылья сами по себе не светятся — это просто полупрозрачные
      // пластинки, и ночью их надо приглушить, иначе два белых листа висели
      // бы ярче самих бойцов
      fly.wingMat.opacity = on ? 0.28 : 0.5
      // собственное свечение моделей: ночью оно заменяет экспозицию, иначе
      // силуэты слились бы с тёмным грунтом. Яркость берётся в доле собственной
      // краски — так муха любого пилота и Шустрик светятся одинаково умеренно
      const k = on ? 0.3 : 0
      for (const m of fly.skin) m.emissive.copy(m.color).multiplyScalar(k)
      for (const m of [kid.shirtMat, kid.skinMat, kid.hairMat, kid.pantsMat, kid.shoeMat]) {
        m.emissive.copy(m.color).multiplyScalar(k)
      }
    }
    setNight(night)

    apiRef.current = {
      reset: clearTrails,
      setPilot: (p) => {
        fly.bodyMat.color.setHex(PILOT_COLOR[p])
        fly.bandMat.color.setHex(darker(PILOT_COLOR[p], 0.45))
        fly.legMat.color.setHex(darker(PILOT_COLOR[p], 0.4))
        trailM.mat.color.setHex(PILOT_COLOR[p])
        // смена пилота не должна отменять ночь: краски теперь другие, а
        // собственное свечение считаю от нового цвета
        setNight(nightRef.current)
      },
      setNight,
      setField: (pts) => scenery.lay(pts),
    }

    const resize = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // рукав камеры: тянем мышью или пальцем — взгляд отворачивается и возвращается
    let dragging = false
    let px = 0
    let py = 0
    let yaw = 0
    let pitch = 0
    const el = renderer.domElement
    const down = (e: PointerEvent) => {
      dragging = true
      px = e.clientX
      py = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      yaw += (e.clientX - px) * 0.006
      pitch = THREE.MathUtils.clamp(pitch + (e.clientY - py) * 0.005, -0.6, 1.2)
      px = e.clientX
      py = e.clientY
    }
    const end = () => {
      dragging = false
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)

    const t0 = performance.now()
    let raf = 0
    let runPhase = 0
    let lastNow = t0
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now
      const fr = last
      if (fr) {
        W(fr.chaser, wp)
        fly.obj.position.set(wp.x, Math.max(wp.y, 0.5), wp.z)
        W(fr.runner, wp)
        kid.obj.position.set(wp.x, Math.max(wp.y, 0), wp.z)

        W(fr.chaser_v, dirV)
        if (dirV.lengthSq() > 1e-9) {
          dirV.normalize()
          fly.obj.quaternion.setFromUnitVectors(AXIS_X, dirV)
        }
        W(fr.runner_v, dirV)
        if (dirV.lengthSq() > 1e-9) {
          dirV.normalize()
          kid.obj.quaternion.setFromUnitVectors(AXIS_Z, dirV)
        }

        // трепет крыльев: частота не зависит от погони, это просто жизнь модели.
        // Крылья сидят на группах-плечах, поэтому взмах — это обычный наклон
        // вокруг продольной оси мухи, а не поворот пластинки вокруг середины
        const flap = Math.sin(((now - t0) / 1000) * 44) * 0.55
        fly.wingR.rotation.z = 0.18 + flap
        fly.wingL.rotation.z = -0.18 - flap
        // лёгкое покачивание корпуса в полёте: муха не висит на рельсе
        fly.obj.position.y += Math.sin(((now - t0) / 1000) * 9) * 0.06

        // бег Шустрика: шаги тем чаще, чем быстрее он бежит; руки и ноги
        // противофазны, как у настоящего бегуна
        const speed = Math.hypot(fr.runner_v[0], fr.runner_v[1])
        runPhase += dt * (2.4 + speed * 1.15)
        const swing = Math.sin(runPhase) * Math.min(0.85, 0.22 + speed * 0.07)
        kid.armR.rotation.x = swing
        kid.armL.rotation.x = -swing
        kid.legR.rotation.x = -swing
        kid.legL.rotation.x = swing

        ring.position.set(kid.obj.position.x, 0.05, kid.obj.position.z)
        ring.scale.setScalar(Math.max(0.5, tagRef.current))

        // луч взгляда: пеленг (азимут, угол места) в системе скорости — в мир.
        // Нормализуем НАПРАВЛЕНИЕ, а не точку: иначе луч смотрел бы не туда,
        // куда смотрит глаз, а «на начало координат» поля. Длина — почти до
        // самого Шустрика, чтобы ребёнок видел: куда луч, туда и взгляд.
        const vch = new THREE.Vector3(fr.chaser_v[0], fr.chaser_v[2], -fr.chaser_v[1])
        if (vch.lengthSq() > 1e-9) vch.normalize()
        fwd.copy(vch)
        right.crossVectors(UP, fwd)
        if (right.lengthSq() < 0.0025) right.set(1, 0, 0)
        right.normalize()
        up.crossVectors(fwd, right).normalize()
        const len = Math.max(1.5, fr.range_m * 0.95)
        aim.copy(fwd)
          .addScaledVector(right, Math.tan(fr.look_az))
          .addScaledVector(up, Math.tan(fr.look_el))
          .normalize()
          .multiplyScalar(len)
          .add(fly.obj.position)
        lookAttr.setXYZ(0, fly.obj.position.x, fly.obj.position.y, fly.obj.position.z)
        lookAttr.setXYZ(1, aim.x, aim.y, aim.z)
        lookAttr.needsUpdate = true

        // камера: сбоку и чуть сверху, смотрит на середину пары. Сбоку — не
        // из красоты: если встать позади бегущих, Шустрик в 16 метрах впереди
        // мельчает вдвое против Огонька, и погоня превращается в две точки на
        // одной линии. Стоим почти строго сбоку (чуть-чуть позади, чтобы модель
        // не была плоским силуэтом): с такого места оба бегут по экрану слева
        // направо, как читается строчка.
        mid.set(
          (fly.obj.position.x + kid.obj.position.x) / 2,
          (fly.obj.position.y + kid.obj.position.y) / 2 + 1.2,
          (fly.obj.position.z + kid.obj.position.z) / 2,
        )
        const dist = THREE.MathUtils.clamp(6.5 + fr.range_m * 0.55, 8.5, 18) * (camera.aspect < 1 ? 1.55 : 1)
        want.copy(mid)
          .addScaledVector(right, -dist * 0.94)
          .addScaledVector(fwd, -dist * 0.16)
        want.y = fly.obj.position.y + dist * 0.34 + 1.4
        // ручной доворот применяется к плечу камеры, а не к готовой позиции:
        // иначе автокамера перетягивала бы её обратно каждый кадр
        const off = want.clone().sub(mid)
        const r = Math.hypot(off.x, off.z)
        const a = Math.atan2(off.z, off.x) + yaw
        off.x = Math.cos(a) * r
        off.z = Math.sin(a) * r
        off.y = THREE.MathUtils.clamp(off.y + r * pitch, 1.2, 90)
        camPos.lerp(mid.clone().add(off), 0.08)
        camAim.lerp(mid, 0.14)
        camera.position.copy(camPos)
        camera.lookAt(camAim)
        if (!dragging) {
          yaw *= 0.9
          pitch *= 0.9
        }

        // небо идёт за камерой, иначе звёзды остались бы над началом поля,
        // а сетку двигаем шагами — иначе её линии плыли бы под ногами
        sky.position.copy(camera.position)
        grid.line.position.x = Math.round(camera.position.x / grid.step) * grid.step
        grid.line.position.z = Math.round(camera.position.z / grid.step) * grid.step
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      frameSink.current = null
      apiRef.current = null
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat) mat.dispose()
      })
      moon.tex.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSink])

  useEffect(() => {
    apiRef.current?.setPilot(pilot)
  }, [pilot])

  useEffect(() => {
    apiRef.current?.reset()
  }, [runKey])

  useEffect(() => {
    apiRef.current?.setNight(night)
  }, [night])

  // тропа меняется с каждым пуском — вместе с ней поле перекладывают: деревья
  // и кусты уходят в стороны, чтобы никто не бежал сквозь ствол
  useEffect(() => {
    apiRef.current?.setField(path)
  }, [path])

  return (
    <div className="stage" ref={wrapRef}>
      {children}
    </div>
  )
}

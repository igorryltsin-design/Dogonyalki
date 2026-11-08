import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeRng } from './rng'
import { isClear } from './field'
import type { GameFrame } from './types'

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
export const THEME = {
  day: {
    sky: 0xd9eefb, fog: 0xd9eefb, fogNear: 40, fogFar: 150,
    grass: 0xbfe0ab, grid: 0x8ec07e,
    hemiSky: 0xeaf6ff, hemiGround: 0xbfe0ab, hemiI: 1.05,
    sun: 0xfff2d0, sunI: 0.85, sunPos: new THREE.Vector3(20, 40, 25),
    rimI: 0,
    trailT: 0x8a7f70, trailOpM: 0.8, trailOpT: 0.55,
    beam: 0x1f2a1a, beamOp: 0.85,
    trunk: 0x7a5a3a, leafTint: 0xffffff, tuft: 0x8fc98a, rock: 0x9a9a8c,
    fireflies: false, glow: 0,
    zenith: 0x5aa6e6, track: 0xd4ebb8, clouds: 0.95,
  },
  night: {
    // лунная ночь, а не чёрная: небо глубоко-синее, луг читается, деревья
    // — синеватые силуэты. Прежняя ночь была почти чёрной, и на проекторе в
    // светлом классе не было видно ничего, кроме трасс
    sky: 0x223761, fog: 0x324a72, fogNear: 45, fogFar: 185,
    grass: 0x3d6e62, grid: 0x5a8c82,
    hemiSky: 0xa9c2ee, hemiGround: 0x35584a, hemiI: 1.25,
    sun: 0xd2e2ff, sunI: 0.95, sunPos: new THREE.Vector3(-26, 40, -34),
    rimI: 0.75,
    trailT: 0xff7a55, trailOpM: 1, trailOpT: 0.8,
    beam: 0xffd866, beamOp: 1,
    trunk: 0x5c4936, leafTint: 0xb4c6e6, tuft: 0x5f9f88, rock: 0x8f9ab0,
    fireflies: true, glow: 0.22,
    zenith: 0x0d1830, track: 0x4a7d6c, clouds: 0.18,
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
  /** лапы-тазики с фазой шага для походки «треножником» */
  legs: { pivot: THREE.Group; phase: number }[]
}

export function flyModel(color: number): Fly {
  const g = new THREE.Group()
  // цвет пилота — опознавательный: муха, нейросети и читер различаются
  // именно телом, поэтому брюшко и грудь красятся одной кистью
  const bodyMat = new THREE.MeshLambertMaterial({ color })
  const bandMat = new THREE.MeshLambertMaterial({ color: darker(color, 0.45) })
  // фасеточные глаза — грани видно глазом: та самая «сеточка» урока
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0xe8453c, emissive: 0x5a120c, flatShading: true })
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
    const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 2), eyeMat)
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
  // стоит на согнутых лапках, а не на торчащих палках. Каждая лапа живёт в
  // своей группе-тазике с опорой в бедре: так её можно качать на бегу, а
  // колено и стопа остаются на своих местах. Походка — «треножник», как у
  // настоящих насекомых: передняя и задняя лапа одной стороны шагают вместе
  // со средней лапой другой.
  const legs: { pivot: THREE.Group; phase: number }[] = []
  for (const side of [1, -1]) {
    ;([[0.16, 0.42, 1], [-0.06, 0.02, 1.05], [-0.26, -0.5, 1.15]] as const).forEach(([hipX, footX, k], li) => {
      const hip = new THREE.Vector3(hipX, -0.06, 0.16 * side)
      const pivot = new THREE.Group()
      pivot.position.copy(hip)
      const knee = new THREE.Vector3(0.04, 0.22 * k + 0.06, 0.24 * side)
      const foot = new THREE.Vector3((footX - hipX) * 0.8, -0.36, 0.3 * side)
      const zero = new THREE.Vector3()
      const upper = new THREE.Mesh(boneGeo(0.035), legMat)
      const lower = new THREE.Mesh(boneGeo(0.028), legMat)
      stretch(upper, zero, knee)
      stretch(lower, knee, foot)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), legMat)
      tip.position.copy(foot)
      pivot.add(upper, lower, tip)
      pivot.name = `leg${side > 0 ? 'R' : 'L'}${li + 1}`
      g.add(pivot)
      // треножник: (R1, L2, R3) против (L1, R2, L3)
      legs.push({ pivot, phase: ((li + (side > 0 ? 0 : 1)) % 2) * Math.PI })
    })
  }

  g.scale.setScalar(FLY_SCALE)
  return { obj: g, wingR, wingL, bodyMat, bandMat, eyeMat, legMat, wingMat, skin, legs }
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
  /** кисти лица: ночью и они светятся, иначе лицо тонет в темноте */
  faceMats: THREE.MeshLambertMaterial[]
  bowMat: THREE.MeshLambertMaterial
}

export function kidModel(): Kid {
  const g = new THREE.Group()
  const shirtMat = new THREE.MeshLambertMaterial({ color: 0xe8574a })
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xffdcbf })
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x7a3f1d })
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x3d5a8a })
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 })
  // кисти лица: тёмные блестящие глаза, румянец, улыбка, бант
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x2b1a14 })
  const glintMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 })
  const cheekMat = new THREE.MeshLambertMaterial({ color: 0xffa6a0 })
  const mouthMat = new THREE.MeshLambertMaterial({ color: 0x8a3a2a })
  const bowMat = new THREE.MeshLambertMaterial({ color: 0xffd23f })

  // Пропорции мультяшные: голова крупная, тело маленькое — так персонаж
  // читается «ребёнком» и издалека, и вблизи, а лицо помещается в кадр.
  const HEAD_Y = 1.7
  const HEAD_R = 0.34

  // платье-трапеция и короткая кофточка сверху
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.34, 6, 14), shirtMat)
  torso.position.y = 1.12
  g.add(torso)
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.46, 0.42, 18), shirtMat)
  skirt.position.y = 0.8
  g.add(skirt)
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.035, 6, 24), bowMat)
  hem.rotation.x = Math.PI / 2
  hem.position.y = 0.6
  g.add(hem)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.16, 10), skinMat)
  neck.position.y = 1.4
  g.add(neck)

  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 24, 18), skinMat)
  head.position.y = HEAD_Y
  g.add(head)

  // шапка волос: сферический купол, наклонённый назад, — лоб открыт,
  // затылок закрыт; поверх — три пряди чёлки
  const cap = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 0.03, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), hairMat)
  cap.position.set(0, HEAD_Y + 0.02, -0.02)
  cap.rotation.x = -0.42
  g.add(cap)
  for (const [x, r] of [[-0.14, 0.4], [0, 0], [0.14, -0.4]] as const) {
    const lock = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), hairMat)
    lock.scale.set(1.15, 0.7, 0.6)
    lock.position.set(x, HEAD_Y + 0.22, 0.24)
    lock.rotation.z = r
    g.add(lock)
  }
  // два хвостика-пучка по бокам и жёлтые банты на них: по ним видно, куда
  // Шустрик повернула голову
  for (const side of [1, -1]) {
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), hairMat)
    tail.scale.set(0.9, 1.25, 0.9)
    tail.position.set(0.4 * side, HEAD_Y + 0.02, -0.08)
    tail.rotation.z = -0.35 * side
    g.add(tail)
    for (const wing of [1, -1]) {
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.14, 8), bowMat)
      bow.rotation.z = (Math.PI / 2) * wing
      bow.position.set(0.33 * side, HEAD_Y + 0.17, -0.06 + 0.07 * wing)
      bow.rotation.y = Math.PI / 2
      g.add(bow)
    }
  }

  // лицо смотрит вперёд по местному +z. Глаза — тёмные овалы с двумя
  // бликами, как у мультяшных героев: живые и добрые. Детали сидят прямо на
  // поверхности головы (z посчитан по её радиусу), поэтому не торчат
  const onHead = (x: number, y: number, inset = 0.01) =>
    Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - (y - HEAD_Y) ** 2)) - inset
  for (const side of [1, -1]) {
    const ex = 0.12 * side
    const ey = HEAD_Y - 0.02
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 12), eyeMat)
    eye.scale.set(0.8, 1.15, 0.45)
    eye.position.set(ex, ey, onHead(ex, ey))
    g.add(eye)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), glintMat)
    glint.position.set(ex + 0.018 * side, ey + 0.028, onHead(ex, ey) + 0.025)
    g.add(glint)
    const glint2 = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), glintMat)
    glint2.position.set(ex - 0.016 * side, ey - 0.03, onHead(ex, ey) + 0.022)
    g.add(glint2)
    const cx = 0.2 * side
    const cy = HEAD_Y - 0.1
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), cheekMat)
    cheek.scale.set(1, 0.6, 0.3)
    cheek.position.set(cx, cy, onHead(cx, cy))
    g.add(cheek)
  }
  const my = HEAD_Y - 0.12
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.01, 6, 14, Math.PI), mouthMat)
  smile.rotation.z = Math.PI
  smile.rotation.x = -0.35
  smile.position.set(0, my, onHead(0, my) + 0.004)
  g.add(smile)

  // руки: группа-плечо с опорой в суставе, внутри — рукав и ладошка.
  // Взмах живёт в rotation.x группы, поэтому кисть всегда остаётся на конце
  const mkArm = (side: 1 | -1, name: string) => {
    const wrap = new THREE.Group()
    wrap.position.set(0.3 * side, 1.3, 0)
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.18, 4, 10), shirtMat)
    sleeve.position.y = -0.14
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 4, 10), skinMat)
    arm.position.y = -0.36
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), skinMat)
    hand.position.y = -0.52
    wrap.add(sleeve, arm, hand)
    wrap.rotation.z = 0.12 * side
    wrap.name = name
    g.add(wrap)
    return wrap
  }
  const armR = mkArm(1, 'armR')
  const armL = mkArm(-1, 'armL')

  const mkLeg = (side: 1 | -1, name: string) => {
    const wrap = new THREE.Group()
    wrap.position.set(0.13 * side, 0.64, 0)
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.36, 4, 10), pantsMat)
    leg.position.y = -0.26
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), shoeMat)
    shoe.scale.set(0.9, 0.6, 1.35)
    shoe.position.set(0, -0.56, 0.05)
    wrap.add(leg, shoe)
    wrap.name = name
    g.add(wrap)
    return wrap
  }
  const legR = mkLeg(1, 'legR')
  const legL = mkLeg(-1, 'legL')

  g.scale.setScalar(KID_SCALE)
  return {
    obj: g, armR, armL, legR, legL, shirtMat, skinMat, hairMat, pantsMat, shoeMat,
    faceMats: [eyeMat, glintMat, cheekMat, mouthMat],
    bowMat,
  }
}

/** Поле: деревья по обеим сторонам коридора, кусты и травинки в самом
 *  коридоре. Неподвижные приметы — единственное, что выдаёт скорость и
 *  направление на ровном лугу: без них погоня выглядит бегущими по столу.
 *  Всё собрано в четыре массы (instanced), поэтому на школьном ноутбуке цена
 *  сцены — четыре вызова отрисовки, сколько бы деревьев ни росло. */
export const DECOR_X0 = -70
export const DECOR_X1 = 330
/** коридор, в котором никто не садит деревья и кусты: там бегут, и
 *  модель пропала бы за стволом */
export const CORRIDOR_HALF_M = 3

export type Scenery = {
  obj: THREE.Group
  /** перепроверить, где можно стоять: после нарисованного пути деревья,
   *  кусты и камни на его тропинке прячутся, а при отмене — возвращаются */
  refit: () => void
  /** перекрашиваемые кисти. У масс с собственными цветами экземпляров
   *  (кроны, ели, кусты, цветы) кисть — это общий множитель: днём белый,
   *  ночью — лунный синеватый, поэтому одна ручка перекрашивает весь лес */
  mats: {
    trunk: THREE.MeshLambertMaterial
    crown: THREE.MeshLambertMaterial
    bush: THREE.MeshLambertMaterial
    tuft: THREE.MeshLambertMaterial
    pine: THREE.MeshLambertMaterial
    flower: THREE.MeshLambertMaterial
    rock: THREE.MeshLambertMaterial
  }
}

/** Пышная крона: три-четыре сплюснутых многогранника вместо одного шара —
 *  низкополигональный «мультяшный» лес, грани ловят свет по-разному. */
function lumpyCrown(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const blobs: [number, number, number, number][] = [
    [0, 3.3, 0, 1.55],
    [0.85, 2.95, 0.35, 1.05],
    [-0.8, 3.05, -0.25, 1.1],
    [0.1, 4.25, -0.1, 1.0],
  ]
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1)
    g.translate(x, y, z)
    parts.push(g)
  }
  return mergeGeometries(parts)!
}

/** Ель: три конуса друг на друге, каждый уже предыдущего. */
function pineCrown(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i += 1) {
    const g = new THREE.ConeGeometry(1.5 - i * 0.38, 1.9 - i * 0.2, 7)
    g.translate(0, 1.7 + i * 1.05, 0)
    parts.push(g)
  }
  return mergeGeometries(parts)!
}

const CROWN_COLORS = [0x4f8f5a, 0x5e9d4c, 0x3f7f4f, 0x6aa84f, 0x4a8a3e, 0x79a843]
const AUTUMN_COLORS = [0xe0a12a, 0xd9762b, 0xc9b23a]
const PINE_COLORS = [0x2f6b4a, 0x2a5f45, 0x3a7652]
const BUSH_COLORS = [0x69a86f, 0x5a9a60, 0x7cb46a]
const FLOWER_COLORS = [0xffffff, 0xffe066, 0xff8fb1, 0xb69cff, 0xff6b5a]

export function makeScenery(): Scenery {
  const rng = makeRng(20260517)
  const group = new THREE.Group()
  const trunkMat = new THREE.MeshLambertMaterial({ color: THEME.day.trunk })
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })
  const bushMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })
  const tuftMat = new THREE.MeshLambertMaterial({ color: THEME.day.tuft })
  const pineMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })
  const flowerMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9a9a8c, flatShading: true })
  const tint = new THREE.Color()
  const pick = (list: number[]) => list[Math.floor(rng() * list.length)]

  /** Ставит экземпляр в точку (x, z) с поворотом ry и масштабом (s, s·sy, s).
   *  Координаты здесь уже мировые: x — вдоль поля, z — поперёк. Высота сидит
   *  в самой геометрии (она поднята вверх наполовину), поэтому любой масштаб
   *  оставляет предмет прижатым к земле. */
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, z: number, s: number, sy: number, ry: number) => {
    mesh.setMatrixAt(
      i,
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(UP, ry),
        new THREE.Vector3(s, s * sy, s),
      ),
    )
  }
  const side = () => (rng() > 0.5 ? 1 : -1)
  /** Ищет место под предмет: вне беговой дорожки и вне всех тропинок, по
   *  которым в игре кто-либо бегает (field.ts). След предмета — radius(s). */
  const spot = (zMin: number, zSpan: number, radius: (s: number) => number, sMin: number, sSpan: number) => {
    for (let k = 0; k < 400; k += 1) {
      const x = DECOR_X0 + rng() * (DECOR_X1 - DECOR_X0)
      const z = side() * (zMin + rng() * zSpan)
      const s = sMin + rng() * sSpan
      // мир three: z = −y движка
      if (isClear(x, -z, radius(s))) return { x, z, s }
    }
    // поле узкое не бывает, но на всякий случай — далеко за краем
    return { x: DECOR_X0 + rng() * (DECOR_X1 - DECOR_X0), z: side() * (zMin + zSpan + 20), s: sMin }
  }

  // лиственные деревья: ствол и пышная крона — две отдельные массы, чтобы
  // не смешивать два цвета в одной геометрии; каждое шестое — осеннее
  const N_TREE = 84
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.36, 2.6, 6)
  trunkGeo.translate(0, 1.3, 0)
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N_TREE)
  const crowns = new THREE.InstancedMesh(lumpyCrown(), crownMat, N_TREE)
  for (let i = 0; i < N_TREE; i += 1) {
    const { x, z, s } = spot(CORRIDOR_HALF_M + 1.5, 55, (k) => 1.9 * k, 0.8, 1.5)
    // рост и поворот — ОДНИ на ствол и крону: иначе ствол и крона разъехались
    // бы разными масштабами, и дерево распалось бы на две половинки
    const sy = 0.75 + rng() * 0.55
    const ry = rng() * Math.PI
    place(trunks, i, x, z, s, sy, ry)
    place(crowns, i, x, z, s, sy, ry)
    crowns.setColorAt(i, tint.setHex(rng() < 0.17 ? pick(AUTUMN_COLORS) : pick(CROWN_COLORS)))
  }
  trunks.instanceMatrix.needsUpdate = true
  crowns.instanceMatrix.needsUpdate = true

  const N_BUSH = 150
  const bushGeo = new THREE.IcosahedronGeometry(0.85, 1)
  bushGeo.translate(0, 0.45, 0)
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, N_BUSH)
  for (let i = 0; i < N_BUSH; i += 1) {
    const { x, z, s } = spot(CORRIDOR_HALF_M + 0.6, 62, (k) => 0.9 * k, 0.7, 1.1)
    place(bushes, i, x, z, s, 0.6 + rng() * 0.6, rng() * Math.PI)
    bushes.setColorAt(i, tint.setHex(pick(BUSH_COLORS)))
  }
  bushes.instanceMatrix.needsUpdate = true

  // травинки уже в самом коридоре: под ногами тоже должно быть видно, что
  // поле бежит, а не стоит вместе с камерой
  const N_TUFT = 420
  const tuftGeo = new THREE.ConeGeometry(0.16, 0.55, 4)
  tuftGeo.translate(0, 0.27, 0)
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, N_TUFT)
  for (let i = 0; i < N_TUFT; i += 1) {
    const x = DECOR_X0 + rng() * (DECOR_X1 - DECOR_X0)
    const z = -(CORRIDOR_HALF_M + 1.5) + rng() * (CORRIDOR_HALF_M + 1.5) * 2
    place(tufts, i, x, z, 0.7 + rng() * 0.9, 0.7 + rng() * 0.9, rng() * Math.PI)
  }
  tufts.instanceMatrix.needsUpdate = true

  // ели — дальше от дорожки, высокие тёмные силуэты на горизонте
  const N_PINE = 60
  const pineTrunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.4, 6)
  pineTrunkGeo.translate(0, 0.7, 0)
  const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, trunkMat, N_PINE)
  const pines = new THREE.InstancedMesh(pineCrown(), pineMat, N_PINE)
  for (let i = 0; i < N_PINE; i += 1) {
    const { x, z, s } = spot(CORRIDOR_HALF_M + 12, 60, (k) => 1.5 * k, 1, 1.3)
    const sy = 1 + rng() * 0.5
    const ry = rng() * Math.PI
    place(pineTrunks, i, x, z, s, sy, ry)
    place(pines, i, x, z, s, sy, ry)
    pines.setColorAt(i, tint.setHex(pick(PINE_COLORS)))
  }
  pineTrunks.instanceMatrix.needsUpdate = true
  pines.instanceMatrix.needsUpdate = true

  // цветы: яркие точки на лугу по краям дорожки — поле живое, а не пустое
  const N_FLOWER = 320
  const flowerGeo = new THREE.IcosahedronGeometry(0.11, 0)
  flowerGeo.translate(0, 0.28, 0)
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, N_FLOWER)
  for (let i = 0; i < N_FLOWER; i += 1) {
    const x = DECOR_X0 + rng() * (DECOR_X1 - DECOR_X0)
    const z = side() * (CORRIDOR_HALF_M + 0.4 + rng() * 22)
    place(flowers, i, x, z, 0.8 + rng() * 0.8, 1, rng() * Math.PI)
    flowers.setColorAt(i, tint.setHex(pick(FLOWER_COLORS)))
  }
  flowers.instanceMatrix.needsUpdate = true

  // камни: серые многогранники, лежат вразброс
  const N_ROCK = 45
  const rockGeo = new THREE.DodecahedronGeometry(0.45, 0)
  rockGeo.translate(0, 0.2, 0)
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, N_ROCK)
  for (let i = 0; i < N_ROCK; i += 1) {
    const { x, z, s } = spot(CORRIDOR_HALF_M + 1, 40, (k) => 0.5 * k, 0.5, 1.2)
    place(rocks, i, x, z, s, 0.5 + rng() * 0.4, rng() * Math.PI)
  }
  rocks.instanceMatrix.needsUpdate = true

  trunks.name = 'trunks'
  crowns.name = 'crowns'
  bushes.name = 'bushes'
  tufts.name = 'tufts'
  pineTrunks.name = 'pineTrunks'
  pines.name = 'pines'
  flowers.name = 'flowers'
  rocks.name = 'rocks'
  group.add(trunks, crowns, bushes, tufts, pineTrunks, pines, flowers, rocks)

  // запоминаем исходную посадку: refit прячет экземпляр (масштаб 0) и
  // возвращает его ровно на старое место
  const groups: { meshes: THREE.InstancedMesh[]; fp: (s: number) => number }[] = [
    { meshes: [trunks, crowns], fp: (k) => 1.9 * k },
    { meshes: [pineTrunks, pines], fp: (k) => 1.5 * k },
    { meshes: [bushes], fp: (k) => 0.9 * k },
    { meshes: [rocks], fp: (k) => 0.5 * k },
  ]
  const orig = new Map<THREE.InstancedMesh, THREE.Matrix4[]>()
  for (const g of groups)
    for (const m of g.meshes)
      orig.set(m, Array.from({ length: m.count }, (_, i) => {
        const mm = new THREE.Matrix4()
        m.getMatrixAt(i, mm)
        return mm
      }))
  const zero = new THREE.Matrix4().makeScale(0, 0, 0)
  const pp = new THREE.Vector3()
  const pq = new THREE.Quaternion()
  const ps = new THREE.Vector3()
  const refit = () => {
    for (const g of groups) {
      const base = orig.get(g.meshes[0])!
      for (let i = 0; i < base.length; i += 1) {
        base[i].decompose(pp, pq, ps)
        const clear = isClear(pp.x, -pp.z, g.fp(ps.x))
        for (const m of g.meshes) m.setMatrixAt(i, clear ? orig.get(m)![i] : zero)
      }
      for (const m of g.meshes) m.instanceMatrix.needsUpdate = true
    }
  }

  return {
    obj: group,
    refit,
    mats: { trunk: trunkMat, crown: crownMat, bush: bushMat, tuft: tuftMat, pine: pineMat, flower: flowerMat, rock: rockMat },
  }
}

/** Светлячки: ночью над лугом мерцают тёплые точки. Днём выключены. */
function makeFireflies() {
  const rng = makeRng(777)
  const N = 160
  const base = new Float32Array(N * 3)
  const phase = new Float32Array(N)
  for (let i = 0; i < N; i += 1) {
    base[i * 3] = DECOR_X0 + rng() * (DECOR_X1 - DECOR_X0)
    base[i * 3 + 1] = 0.6 + rng() * 2.6
    base[i * 3 + 2] = (rng() > 0.5 ? 1 : -1) * (CORRIDOR_HALF_M + 0.5 + rng() * 18)
    phase[i] = rng() * Math.PI * 2
  }
  const pos = new Float32Array(base)
  const geom = new THREE.BufferGeometry()
  const attr = new THREE.BufferAttribute(pos, 3)
  attr.setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('position', attr)
  const mat = new THREE.PointsMaterial({
    color: 0xfff1a0, size: 0.28, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  })
  const obj = new THREE.Points(geom, mat)
  obj.visible = false
  const update = (t: number) => {
    for (let i = 0; i < N; i += 1) {
      pos[i * 3] = base[i * 3] + Math.sin(t * 0.7 + phase[i]) * 0.6
      pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 1.3 + phase[i] * 2) * 0.35
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.6 + phase[i]) * 0.6
    }
    attr.needsUpdate = true
    mat.opacity = 0.65 + Math.sin(t * 3) * 0.25
  }
  return { obj, mat, update }
}

/** Салют поимки: горсть искр разлетается из точки касания и осыпается. */
function makeBurst() {
  const N = 90
  const pos = new Float32Array(N * 3)
  const vel = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  const geom = new THREE.BufferGeometry()
  const attr = new THREE.BufferAttribute(pos, 3)
  attr.setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('position', attr)
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, opacity: 1, depthWrite: false })
  const obj = new THREE.Points(geom, mat)
  obj.visible = false
  obj.frustumCulled = false
  let life = 0
  const rng = makeRng(99)
  const palette = [new THREE.Color(0xffd23f), new THREE.Color(0xff6b5a), new THREE.Color(0x3fb06c), new THREE.Color(0xffffff)]
  const fire = (at: THREE.Vector3, tint: number) => {
    palette[2].setHex(tint)
    for (let i = 0; i < N; i += 1) {
      pos[i * 3] = at.x
      pos[i * 3 + 1] = at.y
      pos[i * 3 + 2] = at.z
      const a = rng() * Math.PI * 2
      const up = 0.3 + rng() * 0.9
      const sp = 3 + rng() * 5
      vel[i * 3] = Math.cos(a) * sp * (1 - up * 0.5)
      vel[i * 3 + 1] = up * sp
      vel[i * 3 + 2] = Math.sin(a) * sp * (1 - up * 0.5)
      const c = palette[i % palette.length]
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    ;(geom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    life = 1.6
    obj.visible = true
  }
  const update = (dt: number) => {
    if (life <= 0) return
    life -= dt
    for (let i = 0; i < N; i += 1) {
      vel[i * 3 + 1] -= 7 * dt
      pos[i * 3] += vel[i * 3] * dt
      pos[i * 3 + 1] = Math.max(0.05, pos[i * 3 + 1] + vel[i * 3 + 1] * dt)
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt
    }
    attr.needsUpdate = true
    mat.opacity = Math.max(0, Math.min(1, life / 0.8))
    if (life <= 0) obj.visible = false
  }
  return { obj, mat, fire, update, reset: () => { life = 0; obj.visible = false } }
}

/** Веер поля зрения на земле под догоняющим: широкий у мушиного глаза
 *  (165°), узкий луч у камеры (13°). Мягко гаснет к краю — радиальная
 *  текстура рисуется на canvas, внешних картинок нет. */
const FAN_R = 24
function makeFan() {
  // текстура считается по пикселям, а не градиентом на canvas: Safari рисует
  // canvas-градиент с цветным дизерингом, и при загрузке в WebGL почти
  // прозрачные пиксели «раздуваются» обратно из домноженной альфы — веер
  // покрывался цветными пятнами. Здесь цвет всегда белый, плавная только альфа.
  const S = 128
  const px = new Uint8Array(S * S * 4)
  for (let y = 0; y < S; y += 1)
    for (let x = 0; x < S; x += 1) {
      const r = Math.min(1, Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2))
      const a = r < 0.5 ? 0.75 - (0.4 * r) / 0.5 : 0.35 * (1 - (r - 0.5) / 0.5)
      const i = (y * S + x) * 4
      px[i] = 255
      px[i + 1] = 255
      px[i + 2] = 255
      px[i + 3] = Math.round(Math.max(0, a) * 255)
    }
  const tex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  const mat = new THREE.MeshBasicMaterial({
    color: 0x7cc4ff, map: tex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
  })
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.7 })
  const obj = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(FAN_R, 48, -0.5, 1), mat)
  mesh.rotation.x = -Math.PI / 2
  const edges = new THREE.LineSegments(new THREE.BufferGeometry(), edgeMat)
  edges.rotation.x = -Math.PI / 2
  obj.add(mesh, edges)
  let half = -1
  const setHalf = (h: number) => {
    if (Math.abs(h - half) < 1e-6) return
    half = h
    mesh.geometry.dispose()
    mesh.geometry = new THREE.CircleGeometry(FAN_R, 48, -h, 2 * h)
    const L = FAN_R * 0.92
    edges.geometry.dispose()
    edges.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(h) * L, Math.sin(h) * L, 0),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(-h) * L, Math.sin(-h) * L, 0),
    ])
  }
  return { obj, mat, edgeMat, tex, setHalf }
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

/** Небо-купол: градиент от светлого горизонта к густому зениту. Цвет
 *  горизонта совпадает с туманом — земля уходит в небо без шва. */
function makeSkyDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(0x6fb2ec) }, bottom: { value: new THREE.Color(THEME.day.fog) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0); }',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const obj = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), mat)
  obj.renderOrder = -1
  return { obj, mat }
}

/** Облака: пушистые спрайты, нарисованные на canvas из нескольких кругов. */
function makeClouds() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g2 = c.getContext('2d')
  if (g2) {
    for (const [x, y, r] of [[70, 80, 40], [120, 60, 52], [175, 78, 40], [100, 92, 34], [150, 95, 32]]) {
      const grd = g2.createRadialGradient(x, y, r * 0.2, x, y, r)
      grd.addColorStop(0, 'rgba(255,255,255,0.95)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g2.fillStyle = grd
      g2.beginPath()
      g2.arc(x, y, r, 0, Math.PI * 2)
      g2.fill()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.95 })
  const obj = new THREE.Group()
  const rng = makeRng(31337)
  for (let i = 0; i < 16; i += 1) {
    const sp = new THREE.Sprite(mat)
    const a = rng() * Math.PI * 2
    const r = 170 + rng() * 80
    sp.position.set(Math.cos(a) * r, 38 + rng() * 45, Math.sin(a) * r)
    const k = 40 + rng() * 40
    sp.scale.set(k, k * 0.5, 1)
    obj.add(sp)
  }
  return { obj, mat, tex }
}

/** Фактура травы: мелкие пятна светлее и темнее на белом — материал
 *  умножает её на свой цвет, поэтому та же фактура годится днём и ночью. */
function grassTexture() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g2 = c.getContext('2d')
  if (g2) {
    g2.fillStyle = '#ffffff'
    g2.fillRect(0, 0, 128, 128)
    const rng = makeRng(4242)
    for (let i = 0; i < 900; i += 1) {
      const v = 200 + Math.floor(rng() * 55)
      g2.fillStyle = `rgba(${v - 20},${v},${v - 30},0.55)`
      g2.fillRect(rng() * 128, rng() * 128, 1 + rng() * 2.5, 1 + rng() * 2.5)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

/** Скошенная беговая дорожка: светлые и тёмные полосы поперёк бега, как на
 *  стадионе, — по ним сразу видно, как быстро бегут оба. */
function trackTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 8
  const g2 = c.getContext('2d')
  if (g2) {
    g2.fillStyle = '#ffffff'
    g2.fillRect(0, 0, 64, 8)
    g2.fillStyle = '#e4ecd8'
    g2.fillRect(32, 0, 32, 8)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** Мягкая круглая тень: тёмное пятно с размытым краем. Тени по-настоящему
 *  не считаются (дорого), но пятно под ногами «ставит» героя на землю. */
function shadowTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g2 = c.getContext('2d')
  if (g2) {
    const grd = g2.createRadialGradient(32, 32, 2, 32, 32, 31)
    grd.addColorStop(0, 'rgba(0,0,0,0.55)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g2.fillStyle = grd
    g2.fillRect(0, 0, 64, 64)
  }
  return new THREE.CanvasTexture(c)
}

/** Дождь: штрихи капель в коробке вокруг камеры. Сколько видно — зависит
 *  от погоды (0 — ясно, 0,3 — дождик, 0,6 — ливень). Одна масса линий. */
function makeRain() {
  const N = 1400
  const pos = new Float32Array(N * 6)
  const rng = makeRng(808)
  const base = new Float32Array(N * 3)
  for (let i = 0; i < N; i += 1) {
    base[i * 3] = (rng() - 0.5) * 60
    base[i * 3 + 1] = rng() * 22
    base[i * 3 + 2] = (rng() - 0.5) * 60
  }
  const geo = new THREE.BufferGeometry()
  const attr = new THREE.BufferAttribute(pos, 3)
  attr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('position', attr)
  const mat = new THREE.LineBasicMaterial({ color: 0x9fb8d0, transparent: true, opacity: 0.55, depthWrite: false })
  const obj = new THREE.LineSegments(geo, mat)
  obj.frustumCulled = false
  obj.visible = false
  let fall = 0
  /** днём светло-голубые капли сливались с небом и травой — дождь было не
   *  видно, хотя в глазу помехи те же. Днём капли тёмно-серые, плотнее и
   *  длиннее, ночью — светлые, как были. Это только картинка сцены. */
  let len = 0.7
  const update = (dt: number, at: THREE.Vector3, amount: number, night = false) => {
    obj.visible = amount > 0.01
    if (!obj.visible) return
    mat.color.setHex(night ? 0xbfd3e6 : 0x3f5468)
    mat.opacity = night ? 0.55 : 0.5 + 0.25 * Math.min(1, amount / 0.6)
    len = night ? 0.7 : 1.0
    fall = (fall + dt * 16) % 22
    const shown = Math.floor(N * Math.min(1, amount / 0.6))
    geo.setDrawRange(0, shown * 2)
    for (let i = 0; i < shown; i += 1) {
      const x = at.x + base[i * 3]
      const z = at.z + base[i * 3 + 2]
      let y = base[i * 3 + 1] - fall
      if (y < 0) y += 22
      pos[i * 6] = x
      pos[i * 6 + 1] = y
      pos[i * 6 + 2] = z
      pos[i * 6 + 3] = x + 0.08
      pos[i * 6 + 4] = y + len
      pos[i * 6 + 5] = z
    }
    attr.needsUpdate = true
  }
  return { obj, mat, update }
}

export type Arena3DProps = {
  /** экран складывает сюда каждый кадр погони */
  frameSink: React.MutableRefObject<((fr: GameFrame | null) => void) | null>
  /** кадры соперника-призрака: тот же Шустрик, другой догоняющий */
  ghostSink?: React.MutableRefObject<((fr: GameFrame | null) => void) | null>
  /** цвет догоняющего (опознавательный цвет бойца) */
  color: number
  /** цвет призрака; null — бежит один */
  ghostColor: number | null
  /** полуполе глаза, рад: им рисуется веер поля зрения */
  halfFov: number
  /** нарисованный путь Шустрика (точки движка) — пунктир на земле; null — нет */
  drawnPath?: number[][] | null
  /** погода: 0 — ясно, 0,3 — дождик, 0,6 — ливень (те же помехи в глазу) */
  rain?: number
  /** радиус осаливания, м — им рисуется кольцо под Шустриком */
  tagRadius: number
  /** меняется с каждым пуском: трассы обнуляются */
  runKey: number
  /** день или ночь: меняется на месте, без перестройки сцены */
  night: boolean
  /** что наложить поверх сцены (итог погони); в 2D-виде то же самое лежит
   *  внутри той же .stage — иначе плашка уезжала бы под картинку */
  children?: React.ReactNode
}

export function Arena3D({ frameSink, ghostSink, color, ghostColor, halfFov, drawnPath = null, rain = 0, tagRadius, runKey, night, children }: Arena3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<{
    setColor: (c: number) => void
    setGhost: (c: number | null) => void
    setFov: (h: number) => void
    setPath: (p: number[][] | null) => void
    reset: () => void
    setNight: (n: boolean) => void
  } | null>(null)
  const colorRef = useRef(color)
  colorRef.current = color
  const ghostRef = useRef(ghostColor)
  ghostRef.current = ghostColor
  const fovRef = useRef(halfFov)
  fovRef.current = halfFov
  const pathRef = useRef(drawnPath)
  pathRef.current = drawnPath
  const rainRef = useRef(rain)
  rainRef.current = rain
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
    // мягкий заполняющий свет со стороны камеры: лица и бока героев,
    // повёрнутые к зрителю, не уходят в серую тень
    const fill = new THREE.DirectionalLight(0xfff4e6, 0.35)
    fill.position.set(0, 12, 30)
    scene.add(fill)

    const grassTex = grassTexture()
    grassTex.repeat.set(150, 150)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: THEME.day.grass, map: grassTex }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    // скошенная дорожка вдоль всего поля: полоса шириной с коридор бега
    const trackTex = trackTexture()
    const trackLen = DECOR_X1 - DECOR_X0 + 260
    trackTex.repeat.set(trackLen / 8, 1)
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(trackLen, CORRIDOR_HALF_M * 2 + 1),
      new THREE.MeshLambertMaterial({ color: THEME.day.track, map: trackTex }),
    )
    track.rotation.x = -Math.PI / 2
    track.position.set((DECOR_X0 + DECOR_X1) / 2, 0.012, 0)
    scene.add(track)
    const grid = makeGrid(600, 10, THEME.day.grid)
    grid.line.position.y = 0.02
    grid.mat.opacity = 0.12
    scene.add(grid.line)

    const scenery = makeScenery()
    scene.add(scenery.obj)

    const sky = new THREE.Group()
    const dome = makeSkyDome()
    const clouds = makeClouds()
    const stars = makeStars()
    const moon = makeMoon()
    sky.add(dome.obj, clouds.obj, stars.obj, moon.obj)
    stars.obj.visible = false
    moon.obj.visible = false
    scene.add(sky)

    const fly = flyModel(colorRef.current)
    scene.add(fly.obj)
    // призрак: такая же муха, но полупрозрачная и в цвете соперника
    const ghost = flyModel(ghostRef.current ?? 0x999999)
    for (const m of ghost.skin) {
      m.transparent = true
      m.opacity = 0.55
    }
    ghost.wingMat.opacity = 0.25
    ghost.obj.visible = false
    scene.add(ghost.obj)
    const fireflies = makeFireflies()
    scene.add(fireflies.obj)
    const rainFx = makeRain()
    scene.add(rainFx.obj)
    const burst = makeBurst()
    scene.add(burst.obj)
    const fan = makeFan()
    fan.setHalf(fovRef.current)
    scene.add(fan.obj)
    const kid = kidModel()
    scene.add(kid.obj)

    // тени-пятна под героями
    const shadowTex = shadowTexture()
    const shadowGeo = new THREE.PlaneGeometry(1, 1)
    shadowGeo.rotateX(-Math.PI / 2)
    const mkShadow = (size: number) => {
      const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 1 }))
      m.scale.set(size, 1, size)
      m.renderOrder = 1
      scene.add(m)
      return m
    }
    const flyShadow = mkShadow(1.5)
    const ghostShadow = mkShadow(1.5)
    const kidShadow = mkShadow(1.9)

    // нарисованный путь Шустрика: пунктир по земле — видно, куда он побежит
    // плоская лента из штрихов: линии WebGL толщиной в пиксель, издалека
    // их не видно
    const pathMat = new THREE.MeshBasicMaterial({ color: 0xd95a3d, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })
    const pathLine = new THREE.Mesh(new THREE.BufferGeometry(), pathMat)
    pathLine.visible = false
    scene.add(pathLine)

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

    const trailM = makeTrail(colorRef.current, THEME.day.trailOpM)
    const trailT = makeTrail(THEME.day.trailT, THEME.day.trailOpT)
    const ghostTrail = makeTrail(ghostRef.current ?? 0x999999, 0.7)
    scene.add(trailM.line, trailT.line, ghostTrail.line)

    /* Плавность: кадры движка приходят неровно (у самой поимки — раз в три
     * кадра экрана, это замедление), и если ставить модели прямо в точку
     * последнего кадра, они два кадра стоят, а на третий прыгают — погоня
     * дёргается вперёд-назад. Поэтому каждая модель едет между двумя
     * последними кадрами движка за то время, что прошло между ними. */
    type Track = { prev: THREE.Vector3; cur: THREE.Vector3; at: number; iv: number; live: boolean }
    const mkTrack = (): Track => ({ prev: new THREE.Vector3(), cur: new THREE.Vector3(), at: 0, iv: 33, live: false })
    const chaserT = mkTrack()
    const ghostT = mkTrack()
    const runnerT = mkTrack()
    let runnerTime = -1
    const push = (tr: Track, p: number[]) => {
      const now = performance.now()
      if (!tr.live) {
        W(p, tr.cur)
        tr.prev.copy(tr.cur)
        tr.live = true
        tr.at = now
        return
      }
      tr.prev.copy(tr.cur)
      W(p, tr.cur)
      tr.iv = THREE.MathUtils.clamp(now - tr.at, 8, 120)
      tr.at = now
    }
    const sample = (tr: Track, out: THREE.Vector3, now: number) =>
      out.lerpVectors(tr.prev, tr.cur, THREE.MathUtils.clamp((now - tr.at) / tr.iv, 0, 1))
    const pushRunner = (fr: GameFrame) => {
      if (fr.t <= runnerTime) return
      runnerTime = fr.t
      push(runnerT, fr.runner)
    }

    let last: GameFrame | null = null
    let ghostLast: GameFrame | null = null
    let ghostN = 0
    let ringFlash = 0
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
    const camFwd = new THREE.Vector3(1, 0, 0)
    const camRight = new THREE.Vector3(0, 0, 1)
    let camDist = 12

    function clearTrails() {
      trailN = 0
      trailTick = 0
      ghostN = 0
      trailM.geom.setDrawRange(0, 0)
      trailT.geom.setDrawRange(0, 0)
      ghostTrail.geom.setDrawRange(0, 0)
      ghostLast = null
      ghost.obj.visible = false
      burst.reset()
      ringFlash = 0
      chaserT.live = false
      ghostT.live = false
      runnerT.live = false
      runnerTime = -1
    }

    const celebrate = (fr: GameFrame, tint: number) => {
      W(fr.chaser, wp)
      wp.y = Math.max(wp.y, 0.6)
      burst.fire(wp, tint)
      ringFlash = 1
    }

    if (ghostSink) {
      ghostSink.current = (fr) => {
        if (!fr || ghostRef.current === null) {
          ghost.obj.visible = false
          return
        }
        if (ghostLast === null || fr.t < ghostLast.t) {
          ghostN = 0
          ghostTrail.geom.setDrawRange(0, 0)
          ghostT.live = false
        }
        ghostLast = fr
        push(ghostT, fr.chaser)
        pushRunner(fr)
        ghost.obj.visible = true
        if (fr.event === 'догнал') celebrate(fr, ghostRef.current)
        if (Math.round(fr.t / 0.02) % 3 === 0 && ghostN < TRAIL_MAX) {
          W(fr.chaser, wp)
          ghostTrail.attr.setXYZ(ghostN, wp.x, Math.max(wp.y, 0.2), wp.z)
          ghostN += 1
          ghostTrail.geom.setDrawRange(0, ghostN)
          ghostTrail.attr.needsUpdate = true
        }
      }
    }

    frameSink.current = (fr) => {
      if (!fr) return
      // новый погон (время потекло сначала) — трассы с чистого листа
      if (last === null || fr.t < last.t) clearTrails()
      if (fr.event === 'догнал' && last?.event !== 'догнал') celebrate(fr, colorRef.current)
      last = fr
      push(chaserT, fr.chaser)
      pushRunner(fr)
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
      ;(track.material as THREE.MeshLambertMaterial).color.setHex(t.track)
      grid.mat.color.setHex(t.grid)
      dome.mat.uniforms.top.value.setHex(t.zenith)
      dome.mat.uniforms.bottom.value.setHex(t.fog)
      clouds.mat.opacity = t.clouds
      for (const m of [flyShadow, ghostShadow, kidShadow]) (m.material as THREE.MeshBasicMaterial).opacity = on ? 0.6 : 1
      scenery.mats.trunk.color.setHex(t.trunk)
      for (const m of [scenery.mats.crown, scenery.mats.bush, scenery.mats.pine]) m.color.setHex(t.leafTint)
      // цветы ночью светятся сами — как настоящие светлые лепестки под луной
      scenery.mats.flower.color.setHex(on ? 0xd8e2ff : 0xffffff)
      scenery.mats.flower.emissive.setHex(on ? 0x3a3a4a : 0x000000)
      scenery.mats.tuft.color.setHex(t.tuft)
      scenery.mats.rock.color.setHex(t.rock)
      stars.obj.visible = on
      moon.obj.visible = on
      fireflies.obj.visible = t.fireflies
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
      const k = t.glow
      for (const m of [...fly.skin, ...ghost.skin]) m.emissive.copy(m.color).multiplyScalar(k)
      // глаза мухи светятся всегда — у них своё, «живое» свечение
      fly.eyeMat.emissive.setHex(on ? 0xb02a1e : 0x5a120c)
      // у Шустрика и днём лёгкое собственное свечение: лицо повёрнуто вбок,
      // солнце светит сверху, и без подсветки кожа уходила в серо-зелёный
      for (const m of [kid.shirtMat, kid.skinMat, kid.hairMat, kid.pantsMat, kid.shoeMat, kid.bowMat, ...kid.faceMats]) {
        m.emissive.copy(m.color).multiplyScalar(Math.max(k, m === kid.skinMat ? 0.28 : 0.1))
      }
      ghostTrail.mat.opacity = on ? 0.95 : 0.7
      fan.mat.opacity = on ? 0.34 : 0.4
    }
    setNight(night)

    const paint = (f: Fly, c: number) => {
      f.bodyMat.color.setHex(c)
      f.bandMat.color.setHex(darker(c, 0.45))
      f.legMat.color.setHex(darker(c, 0.4))
    }
    apiRef.current = {
      reset: clearTrails,
      setColor: (c) => {
        paint(fly, c)
        trailM.mat.color.setHex(c)
        // смена пилота не должна отменять ночь: краски теперь другие, а
        // собственное свечение считаю от нового цвета
        setNight(nightRef.current)
      },
      setGhost: (c) => {
        if (c === null) {
          ghost.obj.visible = false
          ghostTrail.geom.setDrawRange(0, 0)
          ghostLast = null
          return
        }
        paint(ghost, c)
        ghostTrail.mat.color.setHex(c)
        setNight(nightRef.current)
      },
      setFov: (h) => fan.setHalf(h),
      setPath: (pts) => {
        scenery.refit()
        if (!pts || pts.length < 2) {
          pathLine.visible = false
          return
        }
        pathLine.geometry.dispose()
        const pos: number[] = []
        const HALF = 0.22
        let sAcc = 0
        for (let i = 1; i < pts.length; i += 1) {
          const ax = pts[i - 1][0]
          const az = -pts[i - 1][1]
          const bx = pts[i][0]
          const bz = -pts[i][1]
          const len = Math.hypot(bx - ax, bz - az)
          const on = Math.floor(sAcc / 1.1) % 2 === 0
          sAcc += len
          if (!on || len < 1e-6) continue
          const nx = (-(bz - az) / len) * HALF
          const nz = ((bx - ax) / len) * HALF
          const y = 0.05
          pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz)
          pos.push(ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz)
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        pathLine.geometry = geo
        pathLine.visible = true
      },
      setNight,
    }
    apiRef.current.setPath(pathRef.current)

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
    /** 1 — погоня идёт, 0 — стоим. Пока кадры движка приходят, герои бегут;
     *  перестали (до «Пуска» или после финиша) — плавно останавливаются, а не
     *  бегут на месте */
    let motion = 0
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now
      const fr = last
      const tSec = (now - t0) / 1000
      burst.update(dt)
      if (fireflies.obj.visible) fireflies.update(tSec)
      // погода: капли вокруг камеры и туман гуще — ближе подходит к глазу
      const wet = rainRef.current
      rainFx.update(dt, camera.position, wet, nightRef.current)
      {
        const th = nightRef.current ? THEME.night : THEME.day
        const fog = scene.fog as THREE.Fog
        fog.near = th.fogNear * (1 - wet * 0.8)
        fog.far = th.fogFar * (1 - wet * 0.75)
      }
      const moving = runnerT.live && now - runnerT.at < 180 && runnerT.prev.distanceToSquared(runnerT.cur) > 1e-8
      motion += ((moving ? 1 : 0) - motion) * (1 - Math.exp(-dt * 6))
      if (fr) {
        sample(chaserT, wp, now)
        fly.obj.position.set(wp.x, Math.max(wp.y, 0.5), wp.z)
        // Шустрик общий: его путь не зависит от того, кто догоняет, — его
        // ведёт самый свежий кадр из двух (один догоняющий мог уже закончить)
        const gl = ghostLast && ghost.obj.visible ? ghostLast : null
        const rf = gl && gl.t > fr.t ? gl : fr
        sample(runnerT, wp, now)
        // Шустрик бежит по земле: высота убегающего в движке — это точка
        // прицеливания (грудь), а не подошвы; без этого он парил бы над лугом
        kid.obj.position.set(wp.x, 0, wp.z)
        if (gl) {
          sample(ghostT, wp, now)
          ghost.obj.position.set(wp.x, Math.max(wp.y, 0.5), wp.z)
          W(gl.chaser_v, dirV)
          if (dirV.lengthSq() > 1e-9) ghost.obj.quaternion.setFromUnitVectors(AXIS_X, dirV.normalize())
        }

        W(fr.chaser_v, dirV)
        if (dirV.lengthSq() > 1e-9) {
          dirV.normalize()
          fly.obj.quaternion.setFromUnitVectors(AXIS_X, dirV)
        }
        W(rf.runner_v, dirV)
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
        ghost.wingR.rotation.z = 0.18 - flap
        ghost.wingL.rotation.z = -0.18 + flap
        // лёгкое покачивание корпуса в полёте: муха не висит на рельсе
        fly.obj.position.y += Math.sin(tSec * 9) * 0.06
        ghost.obj.position.y += Math.sin(tSec * 9 + 1.3) * 0.06
        // лапки перебирают «треножником»: вперёд-назад и чуть вверх на махе
        for (const f of [fly, ghost]) {
          for (const leg of f.legs) {
            const ph = tSec * 14 + leg.phase
            leg.pivot.rotation.y = Math.sin(ph) * 0.35 * motion
            leg.pivot.rotation.x = Math.max(0, Math.cos(ph)) * 0.25 * Math.sign(leg.pivot.position.z) * motion
          }
        }

        // бег Шустрика: шаги тем чаще, чем быстрее он бежит; руки и ноги
        // противофазны, как у настоящего бегуна
        const speed = Math.hypot(fr.runner_v[0], fr.runner_v[1])
        runPhase += dt * (2.4 + speed * 1.15) * motion
        const swing = Math.sin(runPhase) * Math.min(0.85, 0.22 + speed * 0.07) * motion
        kid.armR.rotation.x = swing
        kid.armL.rotation.x = -swing
        kid.legR.rotation.x = -swing
        kid.legL.rotation.x = swing
        // подпрыгивание на каждом шаге — бег, а не скольжение
        kid.obj.position.y = Math.abs(Math.sin(runPhase)) * Math.min(0.14, speed * 0.02) * motion

        // тени: под мухой бледнеют и растут с высотой полёта
        flyShadow.position.set(fly.obj.position.x, 0.03, fly.obj.position.z)
        kidShadow.position.set(kid.obj.position.x, 0.03, kid.obj.position.z)
        ghostShadow.visible = Boolean(gl)
        if (gl) ghostShadow.position.set(ghost.obj.position.x, 0.03, ghost.obj.position.z)
        const hf = Math.max(0, fly.obj.position.y - 0.5)
        flyShadow.scale.set(1.5 + hf * 0.3, 1, 1.5 + hf * 0.3)

        ring.position.set(kid.obj.position.x, 0.05, kid.obj.position.z)
        // кольцо говорит, видит ли глаз Шустрика: зелёное — видит, красное —
        // Шустрик вышел из поля зрения; при поимке вспыхивает золотом
        ringFlash = Math.max(0, ringFlash - dt * 0.8)
        const ringMat = ring.material as THREE.MeshBasicMaterial
        ringMat.color.setHex(ringFlash > 0 ? 0xffd23f : fr.in_fov ? 0x2e9e5b : 0xe0483a)
        ring.scale.setScalar(Math.max(0.5, tagRef.current) * (1 + ringFlash * 2.5))

        // веер поля зрения: лежит на земле под мухой и смотрит туда, куда она
        // летит. Пока Шустрик в поле — голубой, вышел — красный
        W(fr.chaser_v, dirV)
        fan.obj.position.set(fly.obj.position.x, 0.07, fly.obj.position.z)
        fan.obj.rotation.y = Math.atan2(-dirV.z, dirV.x)
        const fanCol = fr.in_fov ? (nightRef.current ? 0xffe27a : 0x5fb4ff) : 0xff6b5a
        fan.mat.color.setHex(fanCol)
        // красный веер — короткий сигнал «потерял», а не заливка всего луга
        fan.mat.opacity = (fr.in_fov ? 1 : 0.55) * (nightRef.current ? 0.34 : 0.4)
        fan.edgeMat.color.setHex(fanCol)

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
        // с призраком середина берётся по обоим догоняющим: отставший
        // соперник не должен выпадать из кадра
        const chX = gl ? (fly.obj.position.x + ghost.obj.position.x) / 2 : fly.obj.position.x
        const chZ = gl ? (fly.obj.position.z + ghost.obj.position.z) / 2 : fly.obj.position.z
        // высота середины — без покачивания мухи: иначе камера кивала бы вместе с ней
        mid.set((chX + kid.obj.position.x) / 2, (Math.max(chaserT.cur.y, 0.5) + kid.obj.position.y) / 2 + 1.2, (chZ + kid.obj.position.z) / 2)
        const span = Math.max(fr.range_m, gl ? gl.range_m : 0, gl ? fly.obj.position.distanceTo(ghost.obj.position) : 0)
        // камера держит сглаженный курс и сглаженное удаление: у самой цели
        // муха резко доворачивает, и камера, привязанная к мгновенному курсу,
        // моталась бы вслед за каждым доворотом
        const kHead = 1 - Math.exp(-dt * 1.2)
        camFwd.lerp(fwd, kHead).normalize()
        camRight.crossVectors(UP, camFwd)
        if (camRight.lengthSq() < 0.0025) camRight.set(1, 0, 0)
        camRight.normalize()
        const distWant = THREE.MathUtils.clamp(6.5 + span * 0.55, 8.5, 22) * (camera.aspect < 1 ? 1.55 : 1)
        camDist += (distWant - camDist) * (1 - Math.exp(-dt * 1.5))
        const dist = camDist
        want.copy(mid)
          .addScaledVector(camRight, -dist * 0.94)
          .addScaledVector(camFwd, -dist * 0.16)
        want.y = mid.y + dist * 0.34 + 0.2
        // ручной доворот применяется к плечу камеры, а не к готовой позиции:
        // иначе автокамера перетягивала бы её обратно каждый кадр
        const off = want.clone().sub(mid)
        const r = Math.hypot(off.x, off.z)
        const a = Math.atan2(off.z, off.x) + yaw
        off.x = Math.cos(a) * r
        off.z = Math.sin(a) * r
        off.y = THREE.MathUtils.clamp(off.y + r * pitch, 1.2, 90)
        camPos.lerp(mid.clone().add(off), 1 - Math.exp(-dt * 4.5))
        camAim.lerp(mid, 1 - Math.exp(-dt * 8))
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
      if (ghostSink) ghostSink.current = null
      fan.tex.dispose()
      clouds.tex.dispose()
      grassTex.dispose()
      trackTex.dispose()
      shadowTex.dispose()
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
    apiRef.current?.setColor(color)
  }, [color])

  useEffect(() => {
    apiRef.current?.setGhost(ghostColor)
  }, [ghostColor])

  useEffect(() => {
    apiRef.current?.setFov(halfFov)
  }, [halfFov])

  useEffect(() => {
    apiRef.current?.setPath(drawnPath)
  }, [drawnPath])

  useEffect(() => {
    apiRef.current?.reset()
  }, [runKey])

  useEffect(() => {
    apiRef.current?.setNight(night)
  }, [night])

  return (
    <div className="stage" ref={wrapRef}>
      {children}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { GameFrame, Pilot } from './types'

/** Трёхмерная арена: та же погоня, что рисовалась видом сверху, но в объёме —
 *  земля, небо, муха и Шустрик модельками, трассы и камера, которая летит за
 *  парой. Движок ни при чём: он отдаёт кадры, здесь их только показывают.
 *
 *  Специально аскетично, без постобработки стенда (тяжёлая сцена на школьных
 *  машинах и на замерах давала ~2 кадра/с): примитивы, два источника света,
 *  никаких теней, пиксельная плотность ограничена.
 *
 *  Кадры приходят через frameSink — экран складывает их сюда напрямую, минуя
 *  React: иначе 50 раз в секунду перерисовывалось бы всё дерево, и на слабом
 *  ноутбуке погоня начала бы тормозить не из-за сцены, а из-за интерфейса.
 *
 *  Оси: у движка x — вперёд, y — вбок, z — вверх; в three по умолчанию y —
 *  вверх, поэтому мир перекладывается один раз: world = (x, z, −y). */

const PILOT_COLOR: Record<Pilot, number> = { fly: 0x2e9e5b, kid: 0x3a7bd5, cheater: 0xe0a12a }
const SKY = 0xd9eefb
const GRASS = 0xbfe0ab
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
/** верх сцены: у движка вверх — это z, в three он всегда (0,1,0) */
const UP = new THREE.Vector3(0, 1, 0)

/** Мультяшный масштаб: настоящая муха в сантиметр на этих дальностях просто
 *  не разглядеть, а Шустрик ростом 1,4 м на камере в 15 метрах был бы пылинкой.
 *  Поэтому обе модели крупнее жизни — но в ОДНОМ отношении друг к другу, чтобы
 *  ребёнок видел: это муха догоняет человека, а не два одинаковых шарика. */
const FLY_SCALE = 0.8
const KID_SCALE = 1.4

const TRAIL_MAX = 900

/** мир движка → мир three */
const W = (p: number[], o: THREE.Vector3) => o.set(p[0], p[2], -p[1])

function flyModel(color: number): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 18, 14),
    new THREE.MeshLambertMaterial({ color }),
  )
  body.scale.set(1.7, 0.9, 0.9)
  body.name = 'body'
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshLambertMaterial({ color: 0x2b2f26 }))
  head.position.set(0.85, 0.05, 0)
  g.add(head)
  // фасеточные глаза — то, ради чего весь урок
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0xffd35e, emissive: 0x3a2c00 })
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), eyeMat)
    eye.position.set(1.0, 0.12, 0.2 * side)
    g.add(eye)
  }
  // крылья: две округлые пластинки над спиной, их трепетом дышит вся сцена.
  // Прямые прямоугольники торчали «бумажным самолётиком» — крыло мухи короче
  // тела и шире к основанию, поэтому geometry с наклоном и разворотом наружу.
  const wingMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12, 0, Math.PI * 0.75), wingMat)
    wing.position.set(-0.25, 0.42, 0.18 * side)
    wing.rotation.set(-Math.PI / 2 + 0.35 * side, 0, -0.5 * side)
    wing.scale.set(1.5, 0.75, 1)
    wing.name = side > 0 ? 'wingR' : 'wingL'
    g.add(wing)
  }
  g.scale.setScalar(FLY_SCALE)
  return g
}

function kidModel(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.7, 6, 12),
    new THREE.MeshLambertMaterial({ color: 0xd95a3d }),
  )
  body.position.y = 0.55
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshLambertMaterial({ color: 0xf3c9a0 }))
  head.position.y = 1.35
  g.add(head)
  // косичка-хвост сзади: по ней видно, куда Шустрик повернул
  const braidMat = new THREE.MeshLambertMaterial({ color: 0x6a3a1e })
  const braid = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.45, 4, 8), braidMat)
  braid.position.set(0, 1.05, -0.34)
  braid.rotation.x = 0.5
  g.add(braid)
  const tie = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), braidMat)
  tie.position.set(0, 0.82, -0.48)
  g.add(tie)
  const legMat = new THREE.MeshLambertMaterial({ color: 0x3b4a63 })
  for (const side of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), legMat)
    leg.position.set(0, 0.02, 0.16 * side)
    g.add(leg)
  }
  g.scale.setScalar(KID_SCALE)
  return g
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

export type Arena3DProps = {
  /** экран складывает сюда каждый кадр погони */
  frameSink: React.MutableRefObject<((fr: GameFrame | null) => void) | null>
  pilot: Pilot
  /** радиус осаливания, м — им рисуется кольцо под Шустриком */
  tagRadius: number
  /** меняется с каждым пуском: трассы обнуляются */
  runKey: number
  /** что наложить поверх сцены (итог погони); в 2D-виде то же самое лежит
   *  внутри той же .stage — иначе плашка уезжала бы под картинку */
  children?: React.ReactNode
}

export function Arena3D({ frameSink, pilot, tagRadius, runKey, children }: Arena3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<{ setPilot: (p: Pilot) => void; reset: () => void } | null>(null)
  // радиус осаливания читаем через ref: сцена строится один раз на монтаж,
  // а prop приходит из сценария и пересобирать из-за него весь мир незачем
  const tagRef = useRef(tagRadius)
  tagRef.current = tagRadius

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(SKY)
    scene.fog = new THREE.Fog(SKY, 40, 150)

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    wrap.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'

    scene.add(new THREE.HemisphereLight(0xeaf6ff, GRASS, 1.05))
    const sun = new THREE.DirectionalLight(0xfff2d0, 0.85)
    sun.position.set(20, 40, 25)
    scene.add(sun)

    // земля: большой газон и сетка, по которой видно скорость
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: GRASS }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    const grid = new THREE.GridHelper(300, 75, 0x8ec07e, 0xa3d190)
    ;(grid.material as THREE.Material).opacity = 0.4
    ;(grid.material as THREE.Material).transparent = true
    grid.position.y = 0.02
    scene.add(grid)

    const fly = flyModel(PILOT_COLOR[pilot])
    scene.add(fly)
    const kid = kidModel()
    scene.add(kid)

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
    scene.add(new THREE.Line(lookGeom, new THREE.LineBasicMaterial({ color: 0x1f2a1a, transparent: true, opacity: 0.85 })))

    const trailM = makeTrail(PILOT_COLOR[pilot], 0.8)
    const trailT = makeTrail(0x8a7f70, 0.55)
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

    apiRef.current = {
      reset: clearTrails,
      setPilot: (p) => {
        const body = fly.getObjectByName('body') as THREE.Mesh | undefined
        if (body) (body.material as THREE.MeshLambertMaterial).color.setHex(PILOT_COLOR[p])
        trailM.mat.color.setHex(PILOT_COLOR[p])
      },
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
    const tick = () => {
      const fr = last
      if (fr) {
        W(fr.chaser, wp)
        fly.position.set(wp.x, Math.max(wp.y, 0.35), wp.z)
        W(fr.runner, wp)
        kid.position.set(wp.x, Math.max(wp.y, 0), wp.z)

        W(fr.chaser_v, dirV)
        if (dirV.lengthSq() > 1e-9) {
          dirV.normalize()
          fly.quaternion.setFromUnitVectors(AXIS_X, dirV)
        }
        W(fr.runner_v, dirV)
        if (dirV.lengthSq() > 1e-9) {
          dirV.normalize()
          kid.quaternion.setFromUnitVectors(AXIS_Z, dirV)
        }

        // трепет крыльев: частота не зависит от погони, это просто жизнь модели.
        // Машем вокруг продольной оси мухи — базовый разворот пластинки при этом
        // сохраняем, иначе крылья снова встанут «пропеллером»
        const flap = Math.sin(((performance.now() - t0) / 1000) * 42) * 0.45
        const wr = fly.getObjectByName('wingR')
        const wl = fly.getObjectByName('wingL')
        if (wr) wr.rotation.set(-Math.PI / 2 + 0.35 + flap, 0, -0.5)
        if (wl) wl.rotation.set(-Math.PI / 2 - 0.35 - flap, 0, 0.5)

        ring.position.set(kid.position.x, 0.05, kid.position.z)
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
          .add(fly.position)
        lookAttr.setXYZ(0, fly.position.x, fly.position.y, fly.position.z)
        lookAttr.setXYZ(1, aim.x, aim.y, aim.z)
        lookAttr.needsUpdate = true

        // камера: сбоку и чуть сверху, смотрит на середину пары. Сбоку — не
        // из красоты: если встать позади бегущих, Шустрик в 16 метрах впереди
        // мельчает вдвое против Огонька, и погоня превращается в две точки на
        // одной линии. Стоим почти строго сбоку (чуть-чуть позади, чтобы модель
        // не была плоским силуэтом): с такого места оба бегут по экрану слева
        // направо, как читается строчка. Прежние 0.35 дистанции «назад»
        // разворачивали вид в три четверти спиной — погоня выглядела уползающей
        // в даль, а не бегущей через поле. Дистанция растёт с дальностью, чтобы
        // оба умещались; высота небольшая — за горизонт видно небо.
        mid.set((fly.position.x + kid.position.x) / 2, (fly.position.y + kid.position.y) / 2 + 1.2, (fly.position.z + kid.position.z) / 2)
        const dist = THREE.MathUtils.clamp(6.5 + fr.range_m * 0.55, 8.5, 18) * (camera.aspect < 1 ? 1.55 : 1)
        want.copy(mid)
          .addScaledVector(right, -dist * 0.94)
          .addScaledVector(fwd, -dist * 0.16)
        want.y = fly.position.y + dist * 0.34 + 1.4
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
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [frameSink])

  useEffect(() => {
    apiRef.current?.setPilot(pilot)
  }, [pilot])

  useEffect(() => {
    apiRef.current?.reset()
  }, [runKey])

  return (
    <div className="stage" ref={wrapRef}>
      {children}
    </div>
  )
}

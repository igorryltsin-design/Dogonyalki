import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { LINKS, REGIONS, channelValue, linkWeight, regionActivity } from './anatomy'
import type { BrainReadout } from './types'

/** Трёхмерный мозг Огонька: одна точка — один нейрон, яркость — реальная
 *  активность контура в этом кадре (anatomy.ts), толщина и свечение путей —
 *  выученные веса обучаемого выхода. Ничего не анимируется «просто по
 *  таймеру»: потух глаз — погас и регион.
 *
 *  Популяции взяты из открытого коннектами мухи и обсуждены в anatomy.ts:
 *  крупные ядра (медулла, ламина, сетчатка) рисуются реже, чем они есть, —
 *  иначе десятки тысяч точек сливаются в белое пятно и вешают слабый
 *  школьный ноутбук. Размер точки считается из объёма ядра и числа точек,
 *  поэтому у каждого региона своя «клетка»: гигантское ядро дышит мелкой
 *  пылью, а маленький детектор цели — заметными шариками.
 *
 *  Кластер «решение» устроен особенно: в нём по нейрону на каждый канал
 *  входа readout (вернее по два — каналов 24, точек 48), и светится своим
 *  |весом| каждый его нейрон. Тренировка мухи меняет именно эти числа,
 *  поэтому на этом кластере обучение видно лучше всего: врождённая муха
 *  держит два тонких канала, натренированная — много. */

const BG = new THREE.Color(0x05090c)
/** sRGB → линейное: буферы вершинных цветов рендерер читает как линейные */
const s2l = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)

/** Мягкий светящийся кружок вместо квадрата: нейрон должен читаться как
 *  клетка, а не как пиксель. Рисуем градиент прямо в canvas — без внешних
 *  картинок, чтобы офлайн-файл оставался одним файлом. */
function makeSprite(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  if (g) {
    const g2 = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    g2.addColorStop(0, 'rgba(255,255,255,1)')
    g2.addColorStop(0.45, 'rgba(255,255,255,0.55)')
    g2.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = g2
    g.fillRect(0, 0, 64, 64)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s: string) => s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

/** Зрительные регионы муха имеет дважды — по одному на полголовы. Отдельная
 *  функция, чтобы точки и оболочки зеркались одинаково: иначе зеркальная
 *  половина нейронов висела бы в темноте без своей оболочки. */
const mirrored = (name: string) => /ламина|медулла|лобула|T4|T5|LPLC2|LC11/.test(name)

/** Сколько места у региона и какой поэтому диаметр клетки: точка обязана
 *  оставлять соседям воздух, иначе ядро превращается в сплошное пятно. */
function cellSize(reg: (typeof REGIONS)[number]): number {
  const vol = ((4 / 3) * Math.PI * reg.r[0] * reg.r[1] * reg.r[2]) / (mirrored(reg.name) ? 2 : 1) / reg.n
  return Math.min(0.03, Math.max(0.006, 0.62 * Math.cbrt(vol)))
}

type Cloud = {
  ri: number
  geom: THREE.BufferGeometry
  count: number
  ch: Int16Array
  /** 0 — активность канала, 1 — |вес| этого канала, 2 — команда поворота */
  mode: Uint8Array
  gains: Float32Array
  base: Float32Array
  points: THREE.Points
  mat: THREE.PointsMaterial
}

function buildClouds(sprite: THREE.Texture): Cloud[] {
  return REGIONS.map((reg, ri) => {
    const rng = mulberry32(hash(reg.name) + reg.n)
    const isMirrored = mirrored(reg.name)
    const pos = new Float32Array(reg.n * 3)
    const base = new Float32Array(reg.n * 3)
    const ch = new Int16Array(reg.n)
    const mode = new Uint8Array(reg.n)
    const gains = new Float32Array(reg.n)
    for (let i = 0; i < reg.n; i += 1) {
      let vx = rng() * 2 - 1
      let vy = rng() * 2 - 1
      let vz = rng() * 2 - 1
      const len = Math.max(Math.hypot(vx, vy, vz), 1e-6)
      const rad = Math.cbrt(rng())
      const side = isMirrored && i % 2 === 1 ? -1 : 1
      const j = i * 3
      pos[j] = reg.c[0] * side + (vx / len) * rad * reg.r[0]
      pos[j + 1] = reg.c[1] + (vy / len) * rad * reg.r[1]
      pos[j + 2] = reg.c[2] + (vz / len) * rad * reg.r[2]
      base[j] = s2l(reg.col[0])
      base[j + 1] = s2l(reg.col[1])
      base[j + 2] = s2l(reg.col[2])
      if (reg.name === 'решение') {
        mode[i] = 1
        ch[i] = i % 24
      } else if (reg.name === 'крылья') {
        mode[i] = 2
        ch[i] = i % 2
      } else {
        mode[i] = 0
        ch[i] = reg.cols.length ? reg.cols[i % reg.cols.length] : 0
      }
      gains[i] = 0.5 + 0.5 * rng()
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(reg.n * 3), 3).setUsage(THREE.DynamicDrawUsage))
    const mat = new THREE.PointsMaterial({
      size: cellSize(reg),
      map: sprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const points = new THREE.Points(geom, mat)
    return { ri, geom, count: reg.n, ch, mode, gains, base, points, mat }
  })
}

export type Brain3DProps = {
  brain: BrainReadout | undefined
  /** веса обучаемого выхода (2 × 24) — живые, из brain.getW() */
  weights: number[][]
  hover: string | null
  onHover: (name: string | null) => void
}

export function Brain3D({ brain, weights, hover, onHover }: Brain3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef<{ brain: BrainReadout | undefined; weights: number[][]; hover: string | null }>({
    brain,
    weights,
    hover,
  })
  dataRef.current = { brain, weights, hover }

  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const scene = new THREE.Scene()
    scene.background = BG.clone()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50)
    // взгляд чуть сбоку и сверху, центр тяжести кадра — середина мозга: иначе
    // сетчатка, ближайшая к камере, разрастается до половины экрана и
    // закрывает собой все остальные ядра
    const TARGET = new THREE.Vector3(0.05, 0.0, 0.25)
    /** мозг в ширину занимает примерно ±0.8 условной единицы — это самые
     *  боковые оболочки вместе с их рёбрами. Стартовую дальность считаем из
     *  отношения сторон: на узком вертикальном экране телефона горизонтальный
     *  угол зрения обрезает половину ядер, а один и тот же «1.95» на всех
     *  экранах либо резал картинку, либо сжимал её в мелкое пятно. */
    const HALF_W = 0.82
    const fitDist = (aspect: number) => {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(aspect, 0.3)
      return THREE.MathUtils.clamp(HALF_W / tanHalf, 2, 4)
    }
    const dir0 = new THREE.Vector3(0.85, 0.75, 1.95).sub(TARGET).normalize()
    camera.position.copy(TARGET).addScaledVector(dir0, 2.02)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))

    const controls = new OrbitControls(camera, canvas)
    controls.target.copy(TARGET)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.minDistance = 0.5
    controls.maxDistance = 4
    controls.enablePan = false

    const sprite = makeSprite()
    const clouds = buildClouds(sprite)
    clouds.forEach((c) => scene.add(c.points))

    // контуры регионов — полупрозрачные оболочки, чтобы зона читалась целиком;
    // у зеркальных регионов оболочек две — по одной на полголову
    const shellDefs: { ri: number; side: number }[] = []
    REGIONS.forEach((reg, ri) => {
      ;(mirrored(reg.name) ? [1, -1] : [1]).forEach((side) => shellDefs.push({ ri, side }))
    })
    const shells = shellDefs.map(({ ri, side }) => {
      const reg = REGIONS[ri]
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 14),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(s2l(reg.col[0]), s2l(reg.col[1]), s2l(reg.col[2])),
          transparent: true,
          opacity: 0.05,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      )
      mesh.position.set(reg.c[0] * side, reg.c[1], reg.c[2])
      // оболочка едва заметно больше самого облака: она должна намечать границy
      // зоны, а не превращать мозг в кашу из пересекающихся пузырей
      mesh.scale.set(reg.r[0] * 1.06, reg.r[1] * 1.06, reg.r[2] * 1.06)
      // пузыри рисуются раньше нейронов: иначе полупрозрачная оболочка
      // натягивается поверх уже светящихся клеток и гасит их
      mesh.renderOrder = -1
      // номер региона прячем в userData: по нему наведение и называет зону,
      // не перебирая массив оболочек
      mesh.userData.ri = ri
      scene.add(mesh)
      return mesh
    })

    const anchor = (name: string) => REGIONS.find((r) => r.name === name)!.c
    const linkGeom = new THREE.BufferGeometry()
    linkGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINKS.length * 6), 3))
    const linkColAttr = new THREE.BufferAttribute(new Float32Array(LINKS.length * 6), 3)
    linkGeom.setAttribute('color', linkColAttr)
    const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
    const lines = new THREE.LineSegments(linkGeom, linkMat)
    scene.add(lines)
    {
      const arr = linkGeom.getAttribute('position').array as Float32Array
      LINKS.forEach((l, i) => {
        const a = anchor(l.from)
        const b = anchor(l.to)
        arr.set([a[0], a[1], a[2], b[0], b[1], b[2]], i * 6)
      })
    }

    // импульсы: три искры бегут по каждому пути, скорость — от активности источника
    const PULSE_PER_LINK = 3
    const pulseGeom = new THREE.BufferGeometry()
    pulseGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINKS.length * PULSE_PER_LINK * 3), 3))
    const pulseMat = new THREE.PointsMaterial({
      size: 0.05,
      map: sprite,
      color: new THREE.Color(0.9, 0.95, 1),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const pulses = new THREE.Points(pulseGeom, pulseMat)
    scene.add(pulses)

    // наведение курсора — по оболочкам, а не по точкам: перебирать одиннадцать
    // тысяч точек на каждое движение мыши нельзя, а зона всё равно называется
    // целиком, не отдельной клеткой
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    function onMove(ev: PointerEvent) {
      const rect = canvas!.getBoundingClientRect()
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(shells, false)[0]
      onHover(hit ? REGIONS[(hit.object.userData as { ri?: number }).ri ?? 0].name : null)
    }
    canvas.addEventListener('pointermove', onMove)

    // дальность, которую выбрала себе автокамера; пока ребёнок не крутил
    // колесо, при каждом изменении кадра пересчитываем её под новые стороны
    let autoDist = 0
    const resize = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      const d = camera.position.distanceTo(controls.target)
      if (!autoDist || Math.abs(d - autoDist) < 0.06) {
        autoDist = fitDist(w / h)
        // направление считаем ДОЗДРАВО до того, как позиция переедет: иначе
        // camera.position уже равен цели, вектор нулевой, и камера падает
        // внутрь мозга — экран становится чёрным
        const dir = camera.position.clone().sub(controls.target).normalize()
        if (dir.lengthSq() < 1e-6) dir.copy(dir0)
        camera.position.copy(controls.target).addScaledVector(dir, autoDist)
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    setReady(true)

    let raf = 0
    let lastPaint = 0
    let lastHover: string | null | undefined
    const tick = () => {
      const now = performance.now()
      const { brain: fr, weights: w, hover: hov } = dataRef.current
      if (now - lastPaint > 40 || lastHover !== hov) {
        lastPaint = now
        lastHover = hov
        const hovIdx = hov ? REGIONS.findIndex((r) => r.name === hov) : -1
        for (const cloud of clouds) {
          const colors = cloud.geom.getAttribute('color') as THREE.BufferAttribute
          const arr = colors.array as Float32Array
          const focus = hovIdx >= 0 ? (cloud.ri === hovIdx ? 1.5 : 0.32) : 1
          for (let i = 0; i < cloud.count; i += 1) {
            let v = 0
            if (fr) {
              const m = cloud.mode[i]
              if (m === 0) v = channelValue(cloud.ch[i], fr)
              else if (m === 1) v = Math.min(1, (Math.abs(w[0]?.[cloud.ch[i]] ?? 0) + Math.abs(w[1]?.[cloud.ch[i]] ?? 0)) / 2.2)
              else v = Math.min(1, Math.abs(fr.out[cloud.ch[i]] ?? 0) * 1.4)
            }
            const act = Math.min(1, v * cloud.gains[i])
            const s = Math.min(1.3, (fr ? 0.1 : 0.16) + act * 0.95) * focus
            const j = i * 3
            arr[j] = cloud.base[j] * s
            arr[j + 1] = cloud.base[j + 1] * s
            arr[j + 2] = cloud.base[j + 2] * s
          }
          colors.needsUpdate = true
        }
        shells.forEach((mesh, si) => {
          const ri = shellDefs[si].ri
          const mat = mesh.material as THREE.MeshBasicMaterial
          const e = regionActivity(REGIONS[ri].name, fr)
          const focus = hovIdx >= 0 ? (ri === hovIdx ? 1 : 0.25) : 1
          mat.opacity = (0.018 + e * 0.05) * focus
        })
        const lc = linkColAttr.array as Float32Array
        LINKS.forEach((l, i) => {
          const src = REGIONS.findIndex((r) => r.name === l.from)
          const e = regionActivity(l.from, fr)
          const wgt = linkWeight(l, w)
          const s = Math.min(1, 0.12 + e * 0.5 + wgt * 0.55) * (hovIdx >= 0 && hovIdx !== src ? 0.3 : 1)
          const reg = REGIONS[src]
          const j = i * 6
          lc[j] = s2l(reg.col[0]) * s
          lc[j + 1] = s2l(reg.col[1]) * s
          lc[j + 2] = s2l(reg.col[2]) * s
          lc[j + 3] = s2l(reg.col[0]) * s * 0.6
          lc[j + 4] = s2l(reg.col[1]) * s * 0.6
          lc[j + 5] = s2l(reg.col[2]) * s * 0.6
        })
        linkColAttr.needsUpdate = true
      }
      const t = now / 1000
      const pa = pulseGeom.getAttribute('position') as THREE.BufferAttribute
      const parr = pa.array as Float32Array
      let sumE = 0
      LINKS.forEach((l, i) => {
        const a = anchor(l.from)
        const b = anchor(l.to)
        const e = regionActivity(l.from, dataRef.current.brain)
        sumE += e
        const speed = 0.18 + e * 0.9
        for (let p = 0; p < PULSE_PER_LINK; p += 1) {
          const tt = (t * speed + p / PULSE_PER_LINK) % 1
          const j = (i * PULSE_PER_LINK + p) * 3
          if (e > 0.04) {
            parr[j] = a[0] + (b[0] - a[0]) * tt
            parr[j + 1] = a[1] + (b[1] - a[1]) * tt + Math.sin(tt * Math.PI) * 0.06
            parr[j + 2] = a[2] + (b[2] - a[2]) * tt
          } else {
            parr[j] = 9999
            parr[j + 1] = 9999
            parr[j + 2] = 9999
          }
        }
      })
      pa.needsUpdate = true
      pulseMat.opacity = 0.12 + Math.min(1, sumE / LINKS.length) * 0.7
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      controls.dispose()
      clouds.forEach((c) => {
        c.geom.dispose()
        c.mat.dispose()
      })
      linkGeom.dispose()
      pulseGeom.dispose()
      shells.forEach((m) => {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      })
      pulseMat.dispose()
      linkMat.dispose()
      sprite.dispose()
      renderer.dispose()
    }
  }, [onHover])

  return (
    <div className="brain-wrap" ref={wrapRef}>
      <canvas className="brain" ref={canvasRef} />
      {!ready && <div className="brain-note">загружаю мозг…</div>}
    </div>
  )
}

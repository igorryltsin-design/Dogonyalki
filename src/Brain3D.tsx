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
 *  Кластер «решение» устроен особенно: в нём 24 нейрона — по одному на канал
 *  входа readout, и светится своим |весом| каждый его нейрон. Тренировка мухи
 *  меняет именно эти числа, поэтому на этом кластере обучение видно лучше
 *  всего: врождённая муха держит два тонких канала, натренированная — много. */

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

type Built = {
  geom: THREE.BufferGeometry
  count: number
  ch: Int16Array
  /** 0 — активность канала, 1 — |вес| этого канала, 2 — команда поворота */
  mode: Uint8Array
  regionOf: Int16Array
  gains: Float32Array
  base: Float32Array
}

function buildCloud(): Built {
  const total = REGIONS.reduce((s, r) => s + r.n, 0)
  const pos = new Float32Array(total * 3)
  const base = new Float32Array(total * 3)
  const ch = new Int16Array(total)
  const mode = new Uint8Array(total)
  const regionOf = new Int16Array(total)
  const gains = new Float32Array(total)
  let off = 0
  REGIONS.forEach((reg, ri) => {
    const rng = mulberry32(hash(reg.name) + reg.n)
    const isMirrored = mirrored(reg.name)
    for (let i = 0; i < reg.n; i += 1) {
      let vx = rng() * 2 - 1
      let vy = rng() * 2 - 1
      let vz = rng() * 2 - 1
      const len = Math.max(Math.hypot(vx, vy, vz), 1e-6)
      const rad = Math.cbrt(rng())
      const side = isMirrored && i % 2 === 1 ? -1 : 1
      const j = (off + i) * 3
      pos[j] = reg.c[0] * side + (vx / len) * rad * reg.r[0]
      pos[j + 1] = reg.c[1] + (vy / len) * rad * reg.r[1]
      pos[j + 2] = reg.c[2] + (vz / len) * rad * reg.r[2]
      base[j] = s2l(reg.col[0])
      base[j + 1] = s2l(reg.col[1])
      base[j + 2] = s2l(reg.col[2])
      if (reg.name === 'решение') {
        mode[off + i] = 1
        ch[off + i] = i % 24
      } else if (reg.name === 'крылья') {
        mode[off + i] = 2
        ch[off + i] = i % 2
      } else {
        mode[off + i] = 0
        ch[off + i] = reg.cols.length ? reg.cols[i % reg.cols.length] : 0
      }
      regionOf[off + i] = ri
      gains[off + i] = 0.5 + 0.5 * rng()
    }
    off += reg.n
  })
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage))
  return { geom, count: total, ch, mode, regionOf, gains, base }
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
    camera.position.set(0, 0.45, 1.9)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.minDistance = 0.7
    controls.maxDistance = 4
    controls.enablePan = false

    const built = buildCloud()
    const sprite = makeSprite()
    const points = new THREE.Points(
      built.geom,
      new THREE.PointsMaterial({ size: 0.026, map: sprite, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    scene.add(points)

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
      mesh.scale.set(reg.r[0] * 1.25, reg.r[1] * 1.25, reg.r[2] * 1.25)
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
    const pulses = new THREE.Points(
      pulseGeom,
      new THREE.PointsMaterial({ size: 0.05, map: sprite, color: new THREE.Color(0.9, 0.95, 1), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    scene.add(pulses)

    const ray = new THREE.Raycaster()
    ray.params.Points.threshold = 0.035
    const ndc = new THREE.Vector2()
    function onMove(ev: PointerEvent) {
      const rect = canvas!.getBoundingClientRect()
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObject(points)[0]
      const i = hit?.index
      onHover(i === undefined ? null : REGIONS[built.regionOf[i]].name)
    }
    canvas.addEventListener('pointermove', onMove)

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
        const colors = built.geom.getAttribute('color') as THREE.BufferAttribute
        const arr = colors.array as Float32Array
        const hovIdx = hov ? REGIONS.findIndex((r) => r.name === hov) : -1
        for (let i = 0; i < built.count; i += 1) {
          let v = 0
          if (fr) {
            const m = built.mode[i]
            if (m === 0) v = channelValue(built.ch[i], fr)
            else if (m === 1) v = Math.min(1, (Math.abs(w[0]?.[built.ch[i]] ?? 0) + Math.abs(w[1]?.[built.ch[i]] ?? 0)) / 2.2)
            else v = Math.min(1, Math.abs(fr.out[built.ch[i]] ?? 0) * 1.4)
          }
          const act = Math.min(1, v * built.gains[i])
          const s = Math.min(1.3, (fr ? 0.1 : 0.16) + act * 0.95)
          const hovK = hovIdx >= 0 ? (built.regionOf[i] === hovIdx ? 1.5 : 0.32) : 1
          const j = i * 3
          arr[j] = built.base[j] * s * hovK
          arr[j + 1] = built.base[j + 1] * s * hovK
          arr[j + 2] = built.base[j + 2] * s * hovK
        }
        colors.needsUpdate = true
        shells.forEach((mesh, si) => {
          const ri = shellDefs[si].ri
          const mat = mesh.material as THREE.MeshBasicMaterial
          const e = regionActivity(REGIONS[ri].name, fr)
          const focus = hovIdx >= 0 ? (ri === hovIdx ? 1 : 0.25) : 1
          mat.opacity = (0.035 + e * 0.1) * focus
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
      ;(pulses.material as THREE.PointsMaterial).opacity = 0.12 + Math.min(1, sumE / LINKS.length) * 0.7
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
      built.geom.dispose()
      linkGeom.dispose()
      pulseGeom.dispose()
      shells.forEach((m) => {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      })
      ;(points.material as THREE.Material).dispose()
      ;(pulses.material as THREE.Material).dispose()
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

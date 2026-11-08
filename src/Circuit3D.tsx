import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GROUPS, circuit, groupOf } from './connectome'

/** Мозг Огонька в объёме: каждая точка — настоящий нейрон из FlyWire в своих
 *  настоящих координатах (мкм), около десяти тысяч штук. Цвет — группа
 *  (колонки глаза, LC10a, LC11, выходы LC, нисходящие нейроны), яркость —
 *  сколько клетка «говорит» прямо сейчас. Нити — самые толстые связи
 *  схемы (от 20 синапсов): по ним видно, куда течёт сигнал.
 *
 *  Активность приходит через ref, минуя React: десять тысяч чисел
 *  пятьдесят раз в секунду перерисовывали бы весь экран. */

export type Circuit3DProps = {
  /** куда экран складывает активность нейронов последнего кадра */
  rateSink: React.MutableRefObject<((r: Float32Array | null) => void) | null>
  /** подсвеченная группа (наведение на строку списка) */
  focus: number | null
  /** выключенные группы — рисуются серыми */
  silenced: Set<number>
}

function dotSprite(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 32
  const g = c.getContext('2d')
  if (g) {
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grd.addColorStop(0, 'rgba(255,255,255,1)')
    grd.addColorStop(0.4, 'rgba(255,255,255,0.8)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 32, 32)
  }
  return new THREE.CanvasTexture(c)
}

export function Circuit3D({ rateSink, focus, silenced }: Circuit3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef(focus)
  focusRef.current = focus
  const silentRef = useRef(silenced)
  silentRef.current = silenced

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const c = circuit()
    const grp = groupOf()

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b1117)
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    wrap.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'

    // координаты FAFB: x — вбок, y — вниз, z — назад; в three: y — вверх
    const pos = new Float32Array(c.n * 3)
    for (let i = 0; i < c.n; i += 1) {
      pos[i * 3] = c.xyz[i * 3]
      pos[i * 3 + 1] = -c.xyz[i * 3 + 1]
      pos[i * 3 + 2] = -c.xyz[i * 3 + 2]
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const col = new Float32Array(c.n * 3)
    const colAttr = new THREE.BufferAttribute(col, 3)
    colAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('color', colAttr)
    geo.computeBoundingSphere()
    const sprite = dotSprite()
    const mat = new THREE.PointsMaterial({
      size: 5, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geo, mat)
    scene.add(points)

    // нити: только самые толстые связи, иначе — сплошной туман
    const lp: number[] = []
    const lc: number[] = []
    for (let k = 0; k < c.edges; k += 1) {
      // порог выше прежнего (было 20): пучки нитей у выходов складывались в
      // белое пятно, за которым не видно ни групп, ни вспышек
      if (c.syn[k] < 35) continue
      const a = c.pre[k]
      const b = c.post[k]
      lp.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2])
      const ca = GROUPS[grp[a]].color
      const cb = GROUPS[grp[b]].color
      lc.push(...ca.map((x) => x * 0.7), ...cb.map((x) => x * 0.7))
    }
    const lgeo = new THREE.BufferGeometry()
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3))
    lgeo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3))
    const lmat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.03, depthWrite: false, blending: THREE.AdditiveBlending })
    scene.add(new THREE.LineSegments(lgeo, lmat))

    // плотные группы (тысячи колонок глаза в одном комке) при сложении света
    // сливались в белое пятно: каждой точке такой группы — меньше яркости,
    // тогда комок светится цветом своей группы, а не белым
    const groupSize = new Map<number, number>()
    for (let i = 0; i < c.n; i += 1) groupSize.set(grp[i], (groupSize.get(grp[i]) ?? 0) + 1)
    const gain = new Map<number, number>()
    for (const [g, s] of groupSize) gain.set(g, Math.max(0.35, Math.min(1, Math.sqrt(500 / s))))

    const center = geo.boundingSphere!.center.clone()
    const radius = geo.boundingSphere!.radius
    let rates: Float32Array | null = null
    let glow = new Float32Array(c.n)
    rateSink.current = (r) => {
      rates = r
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

    // вращение мышью/пальцем, приближение колесом
    let yaw = 0.5
    let pitch = 0.15
    let dist = radius * 2.3
    let auto = true
    let dragging = false
    let px = 0
    let py = 0
    const el = renderer.domElement
    const down = (e: PointerEvent) => {
      dragging = true
      auto = false
      px = e.clientX
      py = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      yaw -= (e.clientX - px) * 0.006
      pitch = THREE.MathUtils.clamp(pitch + (e.clientY - py) * 0.005, -1.2, 1.2)
      px = e.clientX
      py = e.clientY
    }
    const up = () => {
      dragging = false
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      dist = THREE.MathUtils.clamp(dist * (1 + Math.sign(e.deltaY) * 0.08), radius * 0.6, radius * 4)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })

    let raf = 0
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (auto) yaw += dt * 0.12
      camera.position.set(
        center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        center.y + Math.sin(pitch) * dist,
        center.z + Math.cos(yaw) * Math.cos(pitch) * dist,
      )
      camera.lookAt(center)

      // свечение тает плавно: вспышки видно глазом, а не одним кадром
      const f = focusRef.current
      const off = silentRef.current
      const k = 1 - Math.exp(-dt * 10)
      for (let i = 0; i < c.n; i += 1) {
        const target = rates ? rates[i] : 0
        glow[i] += (target - glow[i]) * k
        const g = grp[i]
        const base = GROUPS[g].color
        const dim = off.has(g) ? 0.05 : f !== null && f !== g ? 0.12 : 1
        const b = off.has(g) ? 0.04 : Math.min(0.85, (0.06 + 2.5 * glow[i]) * (gain.get(g) ?? 1)) * dim
        col[i * 3] = Math.min(1, base[0] * b)
        col[i * 3 + 1] = Math.min(1, base[1] * b)
        col[i * 3 + 2] = Math.min(1, base[2] * b)
      }
      colAttr.needsUpdate = true
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      rateSink.current = null
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      geo.dispose()
      lgeo.dispose()
      mat.dispose()
      lmat.dispose()
      sprite.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      glow = new Float32Array(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateSink])

  return <div className="stage stage--brain" ref={wrapRef} />
}

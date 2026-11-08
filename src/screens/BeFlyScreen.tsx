import { useEffect, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { SeekerView } from '../SeekerView'
import type { ChaseScenario, EyeConfig, GameFrame } from '../types'
import { play } from '../app/sound'
import { complete } from '../app/missions'
import { BEFLY_LEVELS, type BeFlyLevel, loadRecord, saveRecord } from '../app/befly'

/** «Побудь мухой»: ребёнок сам рулит догоняющим, но видит ровно то, что
 *  видит глаз мухи, — кадр 16×16 клеточков, и больше ничего. Ни поля, ни
 *  Шустрика целиком. Так руками понятно, почему широкий глаз помогает, а
 *  камера 13° — нет: на камере Шустрик то и дело пропадает из кадра.
 *
 *  Погоня идёт медленнее настоящей (×0.6): муха реагирует за десятки
 *  миллисекунд, человеку столько не успеть. Потом — та же погоня у Огонька в
 *  настоящем темпе, и обе трассы на одной схеме. Уровни и рекорды живут в
 *  `src/app/befly.ts`, чтобы отчёт урока собирал их, не трогая экран. */

type Result = { hit: boolean; t: number; trail: number[][]; runner: number[][] }

function flyOn(sc: ChaseScenario): Result {
  const trail: number[][] = []
  const runner: number[][] = []
  let hit = false
  let t = 0
  for (const fr of localRun(sc, { pilot: 'fly' })) {
    trail.push([fr.chaser[0], fr.chaser[1]])
    runner.push([fr.runner[0], fr.runner[1]])
    t = fr.t
    if (fr.event === 'догнал') hit = true
  }
  return { hit, t, trail, runner }
}

function drawCompare(c: HTMLCanvasElement, me: Result, fly: Result) {
  const g = c.getContext('2d')
  if (!g) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = c.clientWidth
  const h = c.clientHeight
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = '#eef6e6'
  g.fillRect(0, 0, w, h)
  const all = [...me.trail, ...fly.trail, ...me.runner, ...fly.runner]
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const x0 = Math.min(...xs) - 3
  const x1 = Math.max(...xs) + 3
  const y0 = Math.min(...ys) - 3
  const y1 = Math.max(...ys) + 3
  const k = Math.min(w / (x1 - x0), h / (y1 - y0))
  const ox = (w - (x1 - x0) * k) / 2
  const oy = (h - (y1 - y0) * k) / 2
  const px = (p: number[]) => [ox + (p[0] - x0) * k, h - oy - (p[1] - y0) * k]
  const line = (pts: number[][], color: string, width: number, dash: number[] = []) => {
    g.save()
    g.setLineDash(dash)
    g.strokeStyle = color
    g.lineWidth = width
    g.lineJoin = 'round'
    g.beginPath()
    pts.forEach((p, i) => {
      const [sx, sy] = px(p)
      if (i === 0) g.moveTo(sx, sy)
      else g.lineTo(sx, sy)
    })
    g.stroke()
    g.restore()
  }
  const longer = me.runner.length > fly.runner.length ? me.runner : fly.runner
  line(longer, 'rgba(217,90,61,0.6)', 3, [7, 6])
  line(fly.trail, '#2e9e5b', 3)
  line(me.trail, '#2f6fd0', 3)
  for (const [r, col] of [[me, '#2f6fd0'], [fly, '#2e9e5b']] as const) {
    const end = r.trail[r.trail.length - 1]
    if (!end) continue
    const [sx, sy] = px(end)
    g.fillStyle = col
    g.beginPath()
    g.arc(sx, sy, 6, 0, Math.PI * 2)
    g.fill()
  }
}

export function BeFlyScreen({ eye, scenario, onExit }: { eye: EyeConfig; scenario: () => ChaseScenario; onExit: () => void }) {
  const [frame, setFrame] = useState<GameFrame | null>(null)
  const [state, setState] = useState<'ready' | 'count' | 'run' | 'done'>('ready')
  const [count, setCount] = useState(3)
  const [res, setRes] = useState<{ me: Result; fly: Result; record: boolean } | null>(null)
  const [level, setLevel] = useState<BeFlyLevel>('easy')
  const slow = BEFLY_LEVELS.find((l) => l.key === level)!.slow
  const ctrl = useRef({ yaw: 0, pitch: 0 })
  /** куда по высоте смотрит глаз — по нему автопилот держит высоту */
  const lookEl = useRef(0)
  const keys = useRef(new Set<string>())
  const raf = useRef(0)
  const cmpRef = useRef<HTMLCanvasElement>(null)
  const vw = typeof window === 'undefined' ? 800 : window.innerWidth
  const vh = typeof window === 'undefined' ? 700 : window.innerHeight
  // глаз не шире карточки (экран минус поля) и не выше, чем остаётся под
  // шапкой и подсказкой; на проекторе и большом мониторе растёт до 600 —
  // с задних парт 16×16 клеточек тоже должно быть видно
  const size = Math.round(Math.max(240, Math.min(vw - 72, vh - 340, 600)))

  // клавиатура: стрелки и WASD
  useEffect(() => {
    const sync = () => {
      const k = keys.current
      ctrl.current.yaw = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0)
      ctrl.current.pitch = (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0)
    }
    const map: Record<string, string> = {
      ArrowLeft: 'left', a: 'left', ф: 'left',
      ArrowRight: 'right', d: 'right', в: 'right',
      ArrowUp: 'up', w: 'up', ц: 'up',
      ArrowDown: 'down', s: 'down', ы: 'down',
    }
    const dn = (e: KeyboardEvent) => {
      const m = map[e.key]
      if (!m) return
      e.preventDefault()
      keys.current.add(m)
      sync()
    }
    const upk = (e: KeyboardEvent) => {
      const m = map[e.key]
      if (!m) return
      keys.current.delete(m)
      sync()
    }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', upk)
    return () => {
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', upk)
      cancelAnimationFrame(raf.current)
    }
  }, [])

  useEffect(() => {
    if (res && cmpRef.current) drawCompare(cmpRef.current, res.me, res.fly)
  }, [res])

  function start() {
    setRes(null)
    play('click')
    setState('count')
    setCount(3)
    let n = 3
    const tick = () => {
      n -= 1
      if (n > 0) {
        setCount(n)
        setTimeout(tick, 700)
      } else run()
    }
    setTimeout(tick, 700)
  }

  function run() {
    setState('run')
    const sc = scenario()
    // ребёнок рулит влево-вправо; высоту держит автопилот по тому же кадру
    // глаза (вверх-вниз — лишняя сложность для урока). Свои стрелки ▲▼
    // перекрывают автопилот
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    const gen = localRun(sc, {
      pilot: 'manual',
      manual: () => ({ yaw: ctrl.current.yaw, pitch: ctrl.current.pitch !== 0 ? ctrl.current.pitch : clamp(lookEl.current * 6) }),
    })
    const trail: number[][] = []
    const runner: number[][] = []
    let acc = 0
    let last = performance.now()
    let hit = false
    let t = 0
    const step = () => {
      const now = performance.now()
      acc += ((now - last) / 1000) * slow
      last = now
      // движок шагает по 20 мс; за кадр экрана — столько шагов, сколько
      // набежало замедленного времени
      let done = false
      while (acc >= 0.02 && !done) {
        acc -= 0.02
        const nx = gen.next()
        if (nx.done) {
          done = true
          break
        }
        const fr = nx.value
        trail.push([fr.chaser[0], fr.chaser[1]])
        runner.push([fr.runner[0], fr.runner[1]])
        t = fr.t
        if (fr.lock) lookEl.current = fr.look_el
        if (fr.event === 'догнал') hit = true
        setFrame(fr)
        if (fr.event === 'догнал' || fr.event === 'промах') done = true
      }
      if (done) {
        const prev = loadRecord(level)
        const record = hit && (prev === null || t < prev)
        if (record) saveRecord(level, t)
        setRes({ me: { hit, t, trail, runner }, fly: flyOn(sc), record })
        setState('done')
        play(hit ? 'catch' : 'miss')
        if (hit) complete('befly')
        return
      }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }

  const hold = (dir: 'left' | 'right' | 'up' | 'down') => ({
    onPointerDown: (e: React.PointerEvent) => {
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      keys.current.add(dir)
      ctrl.current.yaw = (keys.current.has('right') ? 1 : 0) - (keys.current.has('left') ? 1 : 0)
      ctrl.current.pitch = (keys.current.has('up') ? 1 : 0) - (keys.current.has('down') ? 1 : 0)
    },
    onPointerUp: () => {
      keys.current.delete(dir)
      ctrl.current.yaw = (keys.current.has('right') ? 1 : 0) - (keys.current.has('left') ? 1 : 0)
      ctrl.current.pitch = (keys.current.has('up') ? 1 : 0) - (keys.current.has('down') ? 1 : 0)
    },
    onPointerCancel: () => {
      keys.current.delete(dir)
      ctrl.current.yaw = 0
      ctrl.current.pitch = 0
    },
  })

  const eyeName = eye.grid === 'foveal' ? 'глаз мухи (165°)' : 'камера (13°)'

  return (
    <div className="page befly">
      <section className="card befly__card">
        <div className="befly__top">
          <h2>Побудь мухой!</h2>
          <button className="big big--ghost big--sm" onClick={onExit}>
            ← назад на арену
          </button>
        </div>
        <p className="hint">
          Ты видишь только то, что видит <b>{eyeName}</b>: 16×16 клеточков. Светлое пятно — это Шустрик. Поворачивай
          стрелками ← → (или кнопками), чтобы пятно было в середине, — тогда летишь прямо на него. Высоту держит
          автопилот. Погоня замедлена: муха думает быстрее человека.
        </p>
        <div className="chips befly__levels" role="group" aria-label="уровень">
          {BEFLY_LEVELS.map((l) => (
            <button key={l.key} type="button" className={level === l.key ? 'is-on' : ''} disabled={state === 'run' || state === 'count'} onClick={() => setLevel(l.key)}>
              {l.name}
              {loadRecord(l.key) !== null ? ` · рекорд ${loadRecord(l.key)!.toFixed(1)} с` : ''}
            </button>
          ))}
        </div>

        <div className="befly__stage">
          <div className="befly__eye">
            <SeekerView img={frame?.image ?? null} eye={eye} lock={frame?.lock} size={size} />
            {state === 'count' && <div className="befly__count">{count}</div>}
            {state === 'ready' && (
              <button className="big befly__start" onClick={start}>
                Старт!
              </button>
            )}
          </div>
          <div className="befly__pad" aria-label="руль">
            <button className="pad pad--left" {...hold('left')} aria-label="влево">◀</button>
            <button className="pad pad--right" {...hold('right')} aria-label="вправо">▶</button>
          </div>
        </div>
        {state === 'run' && frame && (
          <div className="hud-row befly__hud">
            <span className="hint">до Шустрика {frame.range_m.toFixed(1)} м · {frame.in_fov ? 'видно' : 'пропал из глаза!'}</span>
          </div>
        )}
      </section>

      {state === 'done' && res && (
        <section className="card befly__result">
          <h3>
            {res.me.hit ? `Ты догнал за ${res.me.t.toFixed(1)} с! 🎉` : 'Не догнал — Шустрик ускользнул'}
            {res.record ? ' Новый рекорд! 🏅' : ''}
          </h3>
          <p className="hint">
            Огонёк на этой же погоне:{' '}
            <b>{res.fly.hit ? `догнал за ${res.fly.t.toFixed(1)} с` : 'тоже не догнал'}</b>. Синяя линия — твой путь, зелёная —
            муха, пунктир — Шустрик.
          </p>
          <canvas ref={cmpRef} className="befly__cmp" />
          <div className="hud-line">
            <button className="big big--sm" onClick={start}>
              Ещё раз
            </button>
            <button className="big big--ghost big--sm" onClick={onExit}>
              На арену
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { runContest } from '../board'
import { DEFAULT_CHASE, type EyeConfig, type GameFrame, type Pilot } from '../types'
import { gazeErrorDeg, loadNet, predictAzEl } from '../kidBrain'
import { loadCards } from '../cards'
import { SeekerView } from '../SeekerView'
import { Stat } from '../ui-kid/Stat'
import { Arena3D } from '../Arena3D'

/** Экран «Арена»: погоня Огонька за Шустриком. Два вида одного и того же
 *  погоня — объём (три модели, камера летит за парой) и сверху (плоская
 *  схема: оба бегут вправо, вертикаль экрана = вбок). Вид переключается
 *  кнопкой и запоминается; движку всё равно, его кадры только показывают.
 *  «Пуск ×1» — одна погоня вживую, «Пуск ×10» — честная серия из десяти
 *  одинаковых погонь (те же сценарии, что на доске). */

const PILOT_CAP: Record<Pilot, string> = {
  fly: 'Огонёк (муха)',
  kid: 'Сеть школьника',
  cheater: 'Честный читер',
}
const PILOT_COLOR: Record<Pilot, string> = { fly: '#2e9e5b', kid: '#3a7bd5', cheater: '#e0a12a' }

/** есть ли смысл соваться в 3D: без WebGL браузер дал бы чёрный прямоугольник */
function webglWorks(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export function ArenaScreen({ eye }: { eye: EyeConfig }) {
  const [pilot, setPilot] = useState<Pilot>('fly')
  const [runSeed, setRunSeed] = useState(1)
  const [runKey, setRunKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hud, setHud] = useState<{ t: number; range: number; err: number | null; event: string | null }>({
    t: 0,
    range: 0,
    err: null,
    event: null,
  })
  const [retina, setRetina] = useState<{ img: number[][]; lock: boolean } | null>(null)
  const [series, setSeries] = useState<{ catches: number; runs: number; meanErr: number | null } | null>(null)
  const [progress, setProgress] = useState(0)
  const [view3d, setView3d] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('dogonjalki-view') : null
    if (saved) return saved === '3d'
    return webglWorks()
  })
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const lastFrameRef = useRef<GameFrame | null>(null)
  const frameSink = useRef<((fr: GameFrame | null) => void) | null>(null)
  const trailsRef = useRef<{ mx: number[]; my: number[]; tx: number[]; ty: number[] }>({ mx: [], my: [], tx: [], ty: [] })

  const net = loadNet()
  const cards = loadCards(eye)
  const kidReady = Boolean(net?.trained && cards && gazeErrorDeg(net, cards.test, eye) !== null)

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** Врезка глаза — самая важная картинка урока: решётка 16×16, где сидит
   *  Шустрик. И на телефоне, и на мониторе она лежит уголком на самой сцене,
   *  поэтому держим её компактной: 120 пикселей хватает, чтобы различить
   *  клетки, а на широком экране — 180. */
  const eyeSize = vw < 900 ? 108 : Math.round(Math.max(140, Math.min(180, vw * 0.13)))

  /** Арена растягивается вместе с окном: перерисовываем последний кадр, как
   *  только меняются размеры canvas, — иначе картинка остаётся в старых пикселях. */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => draw(lastFrameRef.current))
    ro.observe(canvas)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilot, view3d])

  /** Куда отдать кадр: в объём или на плоскую схему. */
  function show(fr: GameFrame | null) {
    if (view3d) frameSink.current?.(fr)
    else draw(fr)
  }

  /** Пока никто не бежал, показываем стойку на старте: поле не пустое. */
  useEffect(() => {
    const gen = localRun({ ...DEFAULT_CHASE, eye }, { pilot })
    const first = gen.next()
    if (!first.done) {
      lastFrameRef.current = first.value
      show(first.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eye, pilot, view3d])

  function predict(img: number[][]) {
    return net ? predictAzEl(net, img, eye) : { az: 0, el: 0 }
  }

  /** Вид сверху: метры в пиксели. Камера следует за серединой пары, масштаб
   *  считается отдельно по ширине и высоте: и весь погон в кадре, и как можно
   *  крупнее. Прежние «30 метров в min(ширина, высота)» жал картинку в
   *  центр, а боковой манёвр уводил Огонька за край поля. */
  function draw(fr: GameFrame | null) {
    const canvas = canvasRef.current
    if (!canvas || !fr) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    lastFrameRef.current = fr
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const cx = (fr.chaser[0] + fr.runner[0]) / 2
    const cy = (fr.chaser[1] + fr.runner[1]) / 2
    // сколько метров влево-вправо и вверх-вниз от центра пары должно влезть
    const halfX = Math.max(9, fr.range_m * 0.72)
    const halfY = Math.max(5.5, Math.abs(fr.runner[1] - fr.chaser[1]) * 0.9 + 3.5)
    const k = Math.min(w / (2 * halfX), h / (2 * halfY))
    const ox = w / 2 - cx * k
    const oy = h / 2 + cy * k
    const px = (p: number[]) => [ox + p[0] * k, oy - p[1] * k] as const
    const dot = Math.max(7, Math.min(18, k * 0.45))
    const tr = trailsRef.current
    // трассы: Шустрик — тонкая серая, догоняющий — цвет пилота
    const line = (xs: number[], ys: number[], color: string, wid: number) => {
      if (xs.length < 2) return
      ctx.strokeStyle = color
      ctx.lineWidth = wid
      ctx.beginPath()
      xs.forEach((x, i) => {
        const [sx, sy] = px([x, ys[i], 0])
        if (i === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      })
      ctx.stroke()
    }
    line(tr.tx, tr.ty, 'rgba(120,110,100,0.5)', 3)
    line(tr.mx, tr.my, PILOT_COLOR[pilot] + '88', 3)
    // Шустрик — красный кружок с «косичкой»-хвостом
    const [rx, ry] = px(fr.runner)
    ctx.fillStyle = '#d95a3d'
    ctx.beginPath()
    ctx.arc(rx, ry, dot, 0, Math.PI * 2)
    ctx.fill()
    // Огонёк / сеть / читер — зелёный (синий, жёлтый) кружок + стрелка взгляда
    const [mx, my] = px(fr.chaser)
    ctx.fillStyle = PILOT_COLOR[pilot]
    ctx.beginPath()
    ctx.arc(mx, my, dot, 0, Math.PI * 2)
    ctx.fill()
    const a = Math.atan2(fr.look_el, fr.look_az)
    ctx.strokeStyle = '#23301f'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(mx, my)
    ctx.lineTo(mx + Math.cos(a) * dot * 3, my - Math.sin(a) * dot * 3)
    ctx.stroke()
    // итог погони рисует не canvas, а плашка .flash поверх сцены: в 3D-виде
    // картинки нет, и текст должен быть один и тот же в обоих видах
  }

  function startOne() {
    cancelAnimationFrame(rafRef.current)
    setBusy(true)
    setSeries(null)
    setProgress(0)
    setRunKey((k) => k + 1)
    trailsRef.current = { mx: [], my: [], tx: [], ty: [] }
    const sc = { ...DEFAULT_CHASE, eye, seed: runSeed }
    setRunSeed((s) => s + 1)
    const gen = localRun(sc, { pilot: pilot === 'kid' ? 'kid' : pilot, predict: pilot === 'kid' ? predict : undefined })
    let last: GameFrame | null = null
    let i = 0
    let done = false
    const step = () => {
      if (done) return
      // реальный темп: 50 кадров/с движения при ~60 кадрах экрана
      const nx = gen.next()
      if (nx.done) {
        done = true
      } else {
        last = nx.value
        const fr = last
        const tr = trailsRef.current
        if (i % 2 === 0) {
          tr.mx.push(fr.chaser[0]); tr.my.push(fr.chaser[1])
          tr.tx.push(fr.runner[0]); tr.ty.push(fr.runner[1])
          if (tr.mx.length > 600) { tr.mx.shift(); tr.my.shift(); tr.tx.shift(); tr.ty.shift() }
        }
        i += 1
        if (i % 4 === 0) {
          setHud({ t: fr.t, range: fr.range_m, err: fr.look_err_deg, event: fr.event })
          setRetina({ img: fr.image.map((r) => [...r]), lock: fr.lock })
          setProgress(Math.min(1, fr.t / sc.t_max))
        }
        show(fr)
        if (fr.event === 'догнал' || fr.event === 'промах') done = true
      }
      if (done) {
        setBusy(false)
        if (last) {
          setHud({ t: last.t, range: last.range_m, err: last.look_err_deg, event: last.event })
          setRetina({ img: last.image.map((r) => [...r]), lock: last.lock })
        }
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  async function startTen() {
    cancelAnimationFrame(rafRef.current)
    setBusy(true)
    setSeries(null)
    setProgress(0)
    setRunKey((k) => k + 1)
    const res = await runContest(pilot, eye, {
      runs: 10,
      predict: pilot === 'kid' ? predict : undefined,
      onRun: (d, total) => setProgress(d / total),
    })
    setSeries({ catches: res.catches, runs: res.runs, meanErr: res.meanErrDeg })
    setBusy(false)
  }

  function flipView() {
    const next = !view3d
    setView3d(next)
    try {
      localStorage.setItem('dogonjalki-view', next ? '3d' : '2d')
    } catch {
      /* приватный режим: запоминать некуда и не надо */
    }
    // новый вид должен сразу показать тот же миг погони
    if (next) frameSink.current?.(lastFrameRef.current)
    else draw(lastFrameRef.current)
  }

  const banner =
    hud.event === 'догнал' || hud.event === 'промах' ? (
      !busy ? (
        <div className={hud.event === 'догнал' ? 'flash flash--hit' : 'flash flash--miss'}>
          {hud.event === 'догнал' ? 'ДОГНАЛ!' : 'не догнал'}
        </div>
      ) : null
    ) : null

  return (
    <div className="page">
      <div className="stage-wrap">
        {view3d ? (
          <Arena3D
            frameSink={frameSink}
            pilot={pilot}
            tagRadius={DEFAULT_CHASE.tag_radius_m}
            runKey={runKey}
          >
            {banner}
          </Arena3D>
        ) : (
          <div className="stage">
            <canvas className="arena" ref={canvasRef} />
            {banner}
          </div>
        )}

        <div className="overlay overlay--tl">
          <div className="chips" style={{ marginBottom: 8 }}>
            {(['fly', 'kid', 'cheater'] as Pilot[]).map((p) => (
              <button
                key={p}
                type="button"
                className={pilot === p ? 'is-on' : ''}
                disabled={busy || (p === 'kid' && !kidReady)}
                onClick={() => setPilot(p)}
              >
                {PILOT_CAP[p]}
                {p === 'kid' && !kidReady ? ' — сначала научи сеть' : ''}
                {p === 'cheater' ? ' (подглядывает!)' : ''}
              </button>
            ))}
          </div>
          <div className="hud-line">
            <button className="big big--sm" disabled={busy} onClick={startOne}>
              Пуск ×1
            </button>
            <button className="big big--alt big--sm" disabled={busy} onClick={startTen}>
              Пуск ×10
            </button>
            <button className="big big--ghost big--sm" disabled={busy || !webglOk} onClick={flipView}>
              {view3d ? 'вид сверху' : 'вид в 3D'}
            </button>
          </div>
        </div>

        <div className="overlay overlay--tr eye-inset">
          <div className="cap">глаз догоняющего</div>
          {retina ? (
            <SeekerView img={retina.img} eye={eye} lock={retina.lock} size={eyeSize} />
          ) : (
            <SeekerView img={null} eye={eye} size={eyeSize} />
          )}
        </div>

      </div>

      <div className="hud-row">
        <div className="progress" style={{ flex: '1 1 220px', margin: 0 }}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <Stat label="секунда погони" value={hud.t.toFixed(1)} small />
        <Stat label="до Шустрика, м" value={hud.range.toFixed(1)} small />
        <Stat
          label="ошибка взгляда, °"
          value={hud.err === null ? '—' : hud.err.toFixed(2)}
          bad={hud.err !== null && hud.err > 2}
          small
        />
        <Stat
          label="итог серии"
          value={series ? `${series.catches} из ${series.runs}` : hud.event ?? '—'}
          bad={Boolean(series && series.catches < 3 && pilot !== 'cheater')}
          small
        />
      </div>

      <p className="hint">
        {view3d
          ? 'Оба бегут вперёд, кольцо под Шустриком — как близко надо подойти, чтобы осалить. Тяните картинку мышью или пальцем — камера оглядывается. «Пуск ×10» — десять одинаковых погонь, как на доске.'
          : 'Вид сверху: оба бегут вправо, вверх-вниз экрана — вбок. Стрелка показывает, куда догоняющий смотрит глазом. «Пуск ×10» — десять одинаковых погонь, как на доске.'}
      </p>
    </div>
  )
}

const webglOk = typeof window !== 'undefined' && webglWorks()

import { useEffect, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { runContest } from '../board'
import { chaseVariant } from '../scenarios'
import { DEFAULT_CHASE, EYE_FLY, type EyeConfig, type GameFrame, type Pilot } from '../types'
import { gazeErrorDeg, loadNet, predictAzEl } from '../kidBrain'
import { loadCards } from '../cards'
import { SeekerView } from '../SeekerView'
import { Stat } from '../ui-kid/Stat'

/** Экран «Арена»: погоня Огонька за Шустриком. Вид сверху — оба бегут вправо,
 *  вертикаль экрана = вбок. Кнопка «Пуск» показывает одну погоню вживую,
 *  «Пуск ×10» — честную серию из десяти одинаковых погонев (те же сценарии,
 *  что на доске). Никакой наведенческой рамки: только «догнал / не догнал». */

const PILOT_CAP: Record<Pilot, string> = {
  fly: 'Огонёк (муха)',
  kid: 'Сеть школьника',
  cheater: 'Честный читер',
}
const PILOT_COLOR: Record<Pilot, string> = { fly: '#2e9e5b', kid: '#3a7bd5', cheater: '#e0a12a' }

export function ArenaScreen({ eye }: { eye: EyeConfig }) {
  const [pilot, setPilot] = useState<Pilot>('fly')
  const [runSeed, setRunSeed] = useState(1)
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const trailsRef = useRef<{ mx: number[]; my: number[]; tx: number[]; ty: number[] }>({ mx: [], my: [], tx: [], ty: [] })

  const net = loadNet()
  const cards = loadCards(eye)
  const kidReady = Boolean(net?.trained && cards && gazeErrorDeg(net, cards.test, eye) !== null)

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  function predict(img: number[][]) {
    return net ? predictAzEl(net, img, eye) : { az: 0, el: 0 }
  }

  /** вид сверху: метры в пиксели, центр — середина дистанции старта */
  function draw(fr: GameFrame | null, scale = 1) {
    const canvas = canvasRef.current
    if (!canvas || !fr) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.floor(w * dpr)) {
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const span = Math.max(30, fr.range_m * 1.6)
    const k = Math.min(w, h) / span
    const ox = w / 2 - (fr.chaser[0] + fr.range_m * 0.4) * k
    const oy = h / 2
    const px = (p: number[]) => [ox + p[0] * k, oy - p[1] * k] as const
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
    ctx.arc(rx, ry, 9 * scale, 0, Math.PI * 2)
    ctx.fill()
    // Огонёк / сеть / читер — зелёный (синий, жёлтый) кружок + стрелка взгляда
    const [mx, my] = px(fr.chaser)
    ctx.fillStyle = PILOT_COLOR[pilot]
    ctx.beginPath()
    ctx.arc(mx, my, 9 * scale, 0, Math.PI * 2)
    ctx.fill()
    const a = Math.atan2(fr.look_el, fr.look_az)
    ctx.strokeStyle = '#23301f'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(mx, my)
    ctx.lineTo(mx + Math.cos(a) * 26, my - Math.sin(a) * 26)
    ctx.stroke()
    if (fr.event === 'догнал') {
      ctx.fillStyle = '#1c6e3f'
      ctx.font = '700 26px sans-serif'
      ctx.fillText('ДОГНАЛ!', w / 2 - 60, 40)
    } else if (fr.event === 'промах') {
      ctx.fillStyle = '#a33b22'
      ctx.font = '700 26px sans-serif'
      ctx.fillText('не догнал', w / 2 - 66, 40)
    }
  }

  function startOne() {
    cancelAnimationFrame(rafRef.current)
    setBusy(true)
    setSeries(null)
    setProgress(0)
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
      for (let k = 0; k < 1 && !done; k += 1) {
        const nx = gen.next()
        if (nx.done) {
          done = true
          break
        }
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
        draw(fr)
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
    const res = await runContest(pilot, eye, {
      runs: 10,
      predict: pilot === 'kid' ? predict : undefined,
      onRun: (d, total) => setProgress(d / total),
    })
    setSeries({ catches: res.catches, runs: res.runs, meanErr: res.meanErrDeg })
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="row">
        <div className="card" style={{ flex: 2, minWidth: 340 }}>
          <h2>Арена</h2>
          <div className="chips" style={{ marginBottom: 10 }}>
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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="big" disabled={busy} onClick={startOne}>
              Пуск ×1
            </button>
            <button className="big big--alt" disabled={busy} onClick={startTen}>
              Пуск ×10
            </button>
          </div>
          <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="arena-wrap">
            <canvas className="arena" ref={canvasRef} />
          </div>
          <div className="stats" style={{ marginTop: 12 }}>
            <Stat label="секунда погони" value={hud.t.toFixed(1)} />
            <Stat label="до Шустрика, м" value={hud.range.toFixed(1)} />
            <Stat
              label="ошибка взгляда, °"
              value={hud.err === null ? '—' : hud.err.toFixed(2)}
              bad={hud.err !== null && hud.err > 2}
            />
            <Stat
              label="итог серии"
              value={series ? `${series.catches} из ${series.runs}` : hud.event ?? '—'}
              bad={Boolean(series && series.catches < 3 && pilot !== 'cheater')}
            />
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Вид сверху: оба бегут вправо, вверх-вниз экрана — вбок. Стрелка показывает, куда
            догоняющий смотрит глазом. «Пуск ×10» — десять одинаковых погонев, как на доске.
          </p>
        </div>
        <div className="card seeker-side">
          <div className="seeker-cell">
            <div className="cap">глаз догоняющего прямо сейчас</div>
            {retina ? (
              <SeekerView img={retina.img} eye={eye} lock={retina.lock} size={220} />
            ) : (
              <SeekerView img={null} eye={eye} size={220} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

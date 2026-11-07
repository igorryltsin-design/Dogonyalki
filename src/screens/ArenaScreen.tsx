import { useEffect, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { runContest } from '../board'
import { DEFAULT_CHASE, type EyeConfig, type GameFrame, type Pilot } from '../types'
import { gazeErrorDeg, loadNet, predictAzEl } from '../kidBrain'
import { loadCards } from '../cards'
import { SeekerView } from '../SeekerView'
import { Stat } from '../ui-kid/Stat'
import { Arena3D } from '../Arena3D'
import { drawPursuit, emptyTrail, stepTrail, type Trail } from '../topdown'

/** Экран «Арена»: погоня Огонька за Шустриком. Два вида одного и того же
 *  погоня — объём (три модели, камера летит за парой) и сверху (плоская
 *  схема: оба бегут вправо, вертикаль экрана = вбок). Вид переключается
 *  кнопкой и запоминается; движку всё равно, его кадры только показывают.
 *  «Пуск ×1» — одна погоня вживую, «Пуск ×10» — честная серия из десяти
 *  одинаковых погонь (те же сценарии, что на доске).
 *
 *  Кнопка «ночь» меняет только показ: звёзды, луна и светящиеся трассы в
 *  объёме, тёмный луг с теми же приметами — в плоском виде. Движок про ночь
 *  не знает и знать не должен. */

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
  const [night, setNight] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('dogonjalki-sky') === 'night'
    } catch {
      return false
    }
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const lastFrameRef = useRef<GameFrame | null>(null)
  const frameSink = useRef<((fr: GameFrame | null) => void) | null>(null)
  const trailRef = useRef<Trail>(emptyTrail())

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

  /** Куда отдать кадр: в объём или на плоскую схему. Трасса нужна только
   *  плоской схеме — в объёме её ведёт сама сцена. */
  function show(fr: GameFrame | null) {
    if (view3d) {
      frameSink.current?.(fr)
    } else if (fr) {
      stepTrail(trailRef.current, fr)
      draw(fr)
    }
  }

  /** Вид сверху: вся геометрия картинки живёт в ../topdown.ts, потому что тот
   *  же самый погон показывает экран «Мозг» — две версии одной схемы разъехались
   *  бы по масштабу, и ребёнок сверял бы их между собой. */
  function draw(fr: GameFrame | null) {
    const canvas = canvasRef.current
    if (!canvas || !fr) return
    lastFrameRef.current = fr
    drawPursuit(canvas, fr, { color: PILOT_COLOR[pilot], trail: trailRef.current, night })
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


  function startOne() {
    cancelAnimationFrame(rafRef.current)
    setBusy(true)
    setSeries(null)
    setProgress(0)
    setRunKey((k) => k + 1)
    trailRef.current = emptyTrail()
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
    // трассу ведёт только плоская схема, поэтому с видом она начинается заново
    trailRef.current = emptyTrail()
    // новый вид должен сразу показать тот же миг погони
    if (next) frameSink.current?.(lastFrameRef.current)
    else draw(lastFrameRef.current)
  }

  /** день ↔ ночь: показ, а не расчёт; выбор переживает перезапуск страницы */
  function flipSky() {
    const next = !night
    setNight(next)
    try {
      localStorage.setItem('dogonjalki-sky', next ? 'night' : 'day')
    } catch {
      /* приватный режим: запоминать некуда и не надо */
    }
  }

  // смена неба должна сразу перекрасить нарисованный кадр: в плоском виде
  // картинки на экране нет, пока не придёт следующий кадр погони
  useEffect(() => {
    if (!view3d) draw(lastFrameRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night, view3d])

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
            night={night}
          >
            {banner}
          </Arena3D>
        ) : (
          <div className="stage">
            <canvas className={night ? 'arena arena--night' : 'arena'} ref={canvasRef} />
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
            <button className="big big--ghost big--sm" disabled={busy} onClick={flipSky}>
              {night ? 'день' : 'ночь'}
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
          ? 'Оба бегут вперёд, кольцо под Шустриком — как близко надо подойти, чтобы осалить. Тяните картинку мышью или пальцем — камера оглядывается. Деревья и травинки стоят на месте: по ним видно, как быстро бежит погоня. «Пуск ×10» — десять одинаковых погонь, как на доске.'
          : 'Вид сверху: оба бегут вправо, вверх-вниз экрана — вбок. Стрелка показывает, куда догоняющий смотрит глазом. «Пуск ×10» — десять одинаковых погонь, как на доске.'}
        {' '}Кнопка «ночь» меняет только картинку: луна, звёзды и светящиеся трассы — счёт остаётся тот же.
      </p>
    </div>
  )
}

const webglOk = typeof window !== 'undefined' && webglWorks()

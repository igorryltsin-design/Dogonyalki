import { useEffect, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { chaseVariant } from '../scenarios'
import { getW, innateW } from '../brain'
import { flyIsInnate, resetFly, trainFly } from '../trainLocal'
import { CHANNELS, DRAWN_NEURONS, REAL_NEURONS, REGIONS, regionActivity } from '../anatomy'
import { Brain3D } from '../Brain3D'
import { pursuitPath, type PathPoint } from '../field'
import { Stat } from '../ui-kid/Stat'
import { drawPursuit, emptyTrail, stepTrail, type Trail } from '../topdown'
import type { EyeConfig, GameFrame } from '../types'

/** Экран «Мозг»: трёхмерный контур Огонька вживую. Поток кадров — настоящая
 *  погоня с пилотом-мухою, поэтому яркость региона = что контур в этот миг
 *  действительно считает, а толщина путей к «решению» = выученные веса.
 *  Переключи глаз на камеру — и почти всё погаснет: цели перестают быть в
 *  поле, считать нечего.
 *
 *  Чтобы «вживую» не осталось абстракцией, в углу сцены лежит та самая погоня,
 *  чьими кадрами контур зажигается: одна и та же последовательность Frame
 *  показывает и схему в углу, и яркость ядер — они не могут разойтись по
 *  времени.
 *
 *  Каркас тот же, что у Арены: сцена растягивается на всю ширину и высоту
 *  окна, а подписи наплывают на неё справа на большом экране и уезжают под
 *  неё на телефоне — иначе на 390 пикселях панель съела бы весь мозг. */

export function BrainScreen({ eye }: { eye: EyeConfig }) {
  const [fr, setFr] = useState<GameFrame | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const genRef = useRef<Generator<GameFrame> | null>(null)
  const seedRef = useRef(0)
  const stopRef = useRef(false)
  const miniRef = useRef<HTMLCanvasElement>(null)
  const trailRef = useRef<Trail>(emptyTrail())
  const pathRef = useRef<PathPoint[]>([])

  useEffect(() => {
    let raf = 0
    let alive = true
    genRef.current = null
    const step = () => {
      if (!alive) return
      if (!genRef.current) {
        const sc = chaseVariant(seedRef.current, eye)
        genRef.current = localRun(sc, { pilot: 'fly' })
        // приметы плоской схемы рисуют мимо тропы: тот же прогон, то же зерно,
        // значит и тропа совпадает с живой покадрово
        pathRef.current = pursuitPath(sc, 'fly')
      }
      const nx = genRef.current.next()
      if (nx.done) {
        seedRef.current = (seedRef.current + 1) % 24
        genRef.current = null
      } else setFr(nx.value)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [eye])

  // Кадры этой же погони идут и в контур, и в схему в углу: трасса начинается
  // заново, когда время потекло сначала, — то есть на каждом новом погоне
  useEffect(() => {
    const canvas = miniRef.current
    if (!canvas || !fr) return
    stepTrail(trailRef.current, fr)
    drawPursuit(canvas, fr, { color: '#2e9e5b', trail: trailRef.current, path: pathRef.current })
  }, [fr])

  const w = getW()
  const innate = innateW()
  const sumW = w.reduce((s, row) => s + row.reduce((a, v) => a + Math.abs(v), 0), 0)
  // полоска весов нормирована по самому сильному весу и по корню: выученные
  // каналы отличаются в разы (1.4 против 0.05), а линейная шкала оставляла бы
  // всё, кроме двух-четырёх столбцов, практически белой
  const wMax = Math.max(0.25, ...w.map((row) => Math.max(...row.map((v) => Math.abs(v)))))
  // считать каждый кадр, а не по useMemo: тренировка правит веса на месте,
  // ссылка на массив не меняется, и мемоизация по ней залипла бы на нуле
  let stronger = 0
  for (let c = 0; c < CHANNELS; c += 1) {
    const now = Math.abs(w[0][c] ?? 0) + Math.abs(w[1][c] ?? 0)
    const was = Math.abs(innate[0][c] ?? 0) + Math.abs(innate[1][c] ?? 0)
    if (now > was + 0.05) stronger += 1
  }

  async function teach() {
    setBusy(true)
    stopRef.current = false
    await trainFly(eye, 30, (ep, total) => setProgress(ep / total), 0.04, () => stopRef.current)
    setBusy(false)
    setProgress(0)
  }

  const shown = hover ? REGIONS.find((r) => r.name === hover) : null

  return (
    <div className="page">
      <div className="stage-wrap">
        <div className="stage">
          <Brain3D brain={fr?.brain} weights={w} hover={hover} onHover={setHover} />
        </div>

        <div className="overlay overlay--tl brain-controls">
          <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="hud-line">
            <button className="big big--sm" disabled={busy} onClick={teach}>
              {busy ? 'Учусь…' : 'Тренировать муху'}
            </button>
            <button
              className="big big--ghost big--sm"
              disabled={busy || flyIsInnate()}
              onClick={() => {
                resetFly()
                setFr(null)
              }}
            >
              Сбросить в врождённый
            </button>
          </div>
        </div>

        <div className="overlay overlay--bl pursuit-mini">
          <div className="cap">вот что сейчас происходит</div>
          <canvas ref={miniRef} />
          <p className="hint">
            Стрелка — куда Огонёк смотрит глазом. Яркость ядер справа считается
            по этим же кадрам, поэтому схема и контур никогда не расходятся.
          </p>
        </div>

        <div className="overlay overlay--side">
          <h3>что светится сейчас</h3>
          <ul className="brain-legend">
            {REGIONS.map((r) => {
              const a = regionActivity(r.name, fr?.brain)
              return (
                <li
                  key={r.name}
                  className={hover === r.name ? 'is-on' : ''}
                  onPointerEnter={() => setHover(r.name)}
                  onPointerLeave={() => setHover(null)}
                >
                  <i style={{ background: `rgb(${r.col.map((c) => Math.round(c * 255)).join(',')})` }} />
                  <b>{r.name}</b>
                  <span className="bar bar--act"><i style={{ width: `${Math.round(a * 100)}%` }} /></span>
                  <em>{Math.round(a * 100)}%</em>
                  <small>{r.real.toLocaleString('ru-RU')}</small>
                </li>
              )
            })}
          </ul>
          <p className="hint brain-desc">
            {shown ? shown.desc : 'Наведи курсор на область в мозгу или на строку списка — объясню, за что она отвечает.'}
          </p>

          <h3>веса решения</h3>
          <div className="weights">
            {[0, 1].map((row) => (
              <div className="weights__row" key={row}>
                <span className="weights__cap">{row === 0 ? 'наклон' : 'поворот'}</span>
                {Array.from({ length: CHANNELS }, (_, c) => {
                  const now = Math.abs(w[row][c] ?? 0)
                  const was = Math.abs(innate[row][c] ?? 0)
                  const grew = now > was + 0.02
                  return (
                    <i
                      key={c}
                      className={grew ? 'is-grew' : ''}
                      style={{ opacity: 0.05 + 0.95 * Math.sqrt(Math.min(1, now / wMax)) }}
                      title={`канал ${c}: ${w[row][c]?.toFixed(2) ?? '0'} (врождённый ${innate[row][c]?.toFixed(2) ?? '0'})`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <p className="hint">
            Двадцать четыре канала — по одному на каждый признак, что приходит в «решение».
            У врождённой мухи живых каналов всего два; тренировка зажигает остальные.
          </p>

          <div className="stats">
            <Stat label="клеток на картинке" value={DRAWN_NEURONS.toLocaleString('ru-RU')} small />
            <Stat label="нейронов у мухи" value={`≈ ${REAL_NEURONS.toLocaleString('ru-RU')}`} small />
            <Stat label="сумма весов" value={sumW.toFixed(2)} small />
            <Stat label="каналов стало важнее" value={`${stronger} из ${CHANNELS}`} bad={stronger === 0} small />
          </div>

          <p className="hint" style={{ marginTop: 10 }}>
            После тренировки смотри на «решение»: оно разгорается, а пути к нему
            толстеют — это те же числа, что двигают Огонька на арене.
          </p>
        </div>
      </div>

      <p className="hint">
        Тащи мышью или пальцем, чтобы повернуть мозг; колесо или щипок — приблизить. Свет =
        сколько в этот миг считает контур, толщина путей к «решению» = выученные веса. Число
        справа в списке — сколько таких клеток у живой мухи; гигантские ядра рисуем реже, чем
        они есть, иначе картинка слилась бы в сплошное пятно.
      </p>
    </div>
  )
}

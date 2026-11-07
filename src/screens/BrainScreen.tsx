import { useEffect, useMemo, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { chaseVariant } from '../scenarios'
import { getW, innateW } from '../brain'
import { flyIsInnate, resetFly, trainFly } from '../trainLocal'
import { CHANNELS, REGIONS, regionActivity } from '../anatomy'
import { Brain3D } from '../Brain3D'
import { Stat } from '../ui-kid/Stat'
import type { EyeConfig, GameFrame } from '../types'

/** Экран «Мозг»: трёхмерный контур Огонька вживую. Поток кадров — настоящая
 *  погоня с пилотом-мухою, поэтому яркость региона = что контур в этот миг
 *  действительно считает, а толщина путей к «решению» = выученные веса.
 *  Переключи глаз на камеру — и почти всё погаснет: цели перестают быть в
 *  поле, считать нечего. */

const NEURONS = REGIONS.reduce((s, r) => s + r.n, 0)

export function BrainScreen({ eye }: { eye: EyeConfig }) {
  const [fr, setFr] = useState<GameFrame | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const genRef = useRef<Generator<GameFrame> | null>(null)
  const seedRef = useRef(0)
  const stopRef = useRef(false)

  useEffect(() => {
    let raf = 0
    let alive = true
    genRef.current = null
    const step = () => {
      if (!alive) return
      if (!genRef.current) genRef.current = localRun(chaseVariant(seedRef.current, eye), { pilot: 'fly' })
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

  const w = getW()
  const innate = useMemo(() => innateW(), [])
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
      <div className="row">
        <div className="card" style={{ flex: 5, minWidth: 360 }}>
          <h2>Мозг Огонька</h2>
          <Brain3D brain={fr?.brain} weights={w} hover={hover} onHover={setHover} />
          <p className="hint" style={{ marginTop: 10 }}>
            Тащи мышью, чтобы повернуть; колесо — приблизить. Наведи курсор на область —
            расскажу, что она делает. Свет = сколько в этот миг считает контур, толщина
            путей к «решению» = выученные веса.
          </p>
        </div>
        <div className="card" style={{ flex: 4, minWidth: 320 }}>
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
            <Stat label="нейронов в мозге" value={String(NEURONS)} />
            <Stat label="сумма весов" value={sumW.toFixed(2)} />
            <Stat label="каналов стало важнее" value={`${stronger} из ${CHANNELS}`} bad={stronger === 0} />
          </div>

          <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="big" disabled={busy} onClick={teach}>
              {busy ? 'Учусь…' : 'Тренировать муху'}
            </button>
            <button
              className="big big--ghost"
              disabled={busy || flyIsInnate()}
              onClick={() => {
                resetFly()
                setFr(null)
              }}
            >
              Сбросить в врождённый
            </button>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            После тренировки смотри на «решение»: оно разгорается, а пути к нему
            толстеют — это те же числа, что двигают Огонька на арене.
          </p>
        </div>
      </div>
    </div>
  )
}

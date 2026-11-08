import { useEffect, useRef } from 'react'
import { useKid } from '../app/settings'
import { clearTraining, startTraining, stopTraining, useFlyTraining } from '../app/flyTraining'
import { innateConnectomeW } from '../connectome'
import { TRIAL_CHASES, type TrialChase } from '../trainLocal'
import type { EyeConfig } from '../types'

/** Панель «Огонёк тренируется». Учёба длится минуту-другую, и детям надо на
 *  что-то смотреть: каждая проба — это шесть настоящих погонь с чуть другим
 *  рулём, и их следы рисуются на шести маленьких картах. Поймал — зелёная
 *  галочка. Ниже — график: серые точки — сколько поймала каждая проба,
 *  зелёная линия — лучший руль на сейчас (он только растёт: худшие пробы
 *  муха отбрасывает). И четыре ручки руля, которые двигаются, когда муха
 *  находит руль получше. */

const STEER_KID = ['поворот', 'подъём', 'заглядывать вперёд: вбок', 'заглядывать вперёд: вверх']
const STEER_T = ['сила поворота', 'сила набора высоты', 'упреждение поворота', 'упреждение высоты']

/** Одна учебная погоня сверху: след Шустрика пунктиром, след мухи —
 *  сплошной; новая проба «пролетает» заново за секунду. */
function ChaseMini({ ch, stamp }: { ch: TrialChase | null; stamp: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const W = c.clientWidth || 120
    const H = c.clientHeight || 90
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!ch || ch.fly.length < 2) {
      g.fillStyle = '#eef3e6'
      g.fillRect(0, 0, W, H)
      return
    }
    const all = [...ch.fly, ...ch.run]
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const [x, y] of all) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    const pad = 8
    const k = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0))
    const ox = (W - (x1 - x0) * k) / 2
    const oy = (H - (y1 - y0) * k) / 2
    const px = (p: number[]) => [ox + (p[0] - x0) * k, H - (oy + (p[1] - y0) * k)] as const
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const t0 = performance.now()
    const draw = () => {
      const u = reduce ? 1 : Math.min(1, (performance.now() - t0) / 1100)
      g.fillStyle = ch.hit ? '#eaf6ee' : '#f8efe9'
      g.fillRect(0, 0, W, H)
      const line = (pts: number[][], color: string, w: number, dash: number[]) => {
        const n = Math.max(2, Math.round(pts.length * u))
        g.save()
        g.setLineDash(dash)
        g.strokeStyle = color
        g.lineWidth = w
        g.lineJoin = 'round'
        g.beginPath()
        for (let i = 0; i < n; i += 1) {
          const [x, y] = px(pts[i])
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
        g.restore()
        return px(pts[n - 1])
      }
      const [rx, ry] = line(ch.run, '#d95a3d', 2, [4, 3])
      const [fx, fy] = line(ch.fly, '#1f8a4c', 2.5, [])
      g.fillStyle = '#d95a3d'
      g.beginPath()
      g.arc(rx, ry, 3.5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#1f8a4c'
      g.beginPath()
      g.arc(fx, fy, 3.5, 0, Math.PI * 2)
      g.fill()
      if (u < 1) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [ch, stamp])
  return (
    <div className={`trmini${ch ? (ch.hit ? ' is-hit' : ' is-miss') : ''}`}>
      <canvas ref={ref} />
      <span className="trmini__tag">{ch ? (ch.hit ? '✓ поймал' : '✗ ушёл') : '…'}</span>
    </div>
  )
}

function ScoreChart({ tries, total }: { tries: { iter: number; hits: number; accepted: boolean; bestHits: number }[]; total: number }) {
  const W = 520
  const H = 150
  const L = 30
  const n = TRIAL_CHASES.length
  const x = (i: number) => L + (i / Math.max(1, total)) * (W - L - 8)
  const y = (v: number) => 8 + (1 - v / n) * (H - 30)
  const best = tries.map((t) => `${x(t.iter)},${y(t.bestHits)}`).join(' ')
  return (
    <svg className="trchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Сколько учебных погонь ловит каждая проба">
      {[0, 3, 6].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} className="grid-line" />
          <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="axis-label">
            {v}
          </text>
        </g>
      ))}
      {tries.map((t) => (
        <circle key={t.iter} cx={x(t.iter)} cy={y(t.hits)} r={t.accepted && t.iter > 0 ? 5 : 3.2} fill={t.accepted && t.iter > 0 ? '#e7a600' : '#b9bfb5'} />
      ))}
      {tries.length > 1 && <polyline points={best} fill="none" stroke="#1f8a4c" strokeWidth={3} />}
      <text x={W - 8} y={H - 4} textAnchor="end" className="axis-label">
        проба →
      </text>
    </svg>
  )
}

export function FlyTrainingPanel({ eye }: { eye: EyeConfig }) {
  const kid = useKid()
  const st = useFlyTraining()
  const innate = innateConnectomeW()
  const innateSteer = [innate[1][0], innate[0][1], innate[1][2], innate[0][3]]
  const names = kid ? STEER_KID : STEER_T
  const shown = st.last
  const started = st.running || st.finished || st.tries.length > 0

  if (!started) {
    return (
      <section className="card trpanel" id="fly-training">
        <h3>🏋️ {kid ? 'Потренируй Огонька' : 'Тренировка мухи пробами'}</h3>
        <p className="hint">
          {kid
            ? 'Огонёк будет сам пробовать чуть-чуть другой руль на шести погонях. Стал ловить лучше — оставит, хуже — выбросит. Подсказок ему никто не даёт!'
            : `Муха пробует случайные небольшие изменения четырёх чисел руля на ${TRIAL_CHASES.length} учебных погонях и оставляет только те, что помогли. Карточек с ответами нет. Учёба идёт в фоне: можно уйти на другую вкладку и вернуться.`}
        </p>
        <button className="big" data-guide="learn-fly" onClick={() => void startTraining(eye)}>
          🏋️ {kid ? 'Начать тренировку' : 'Тренировать муху'}
        </button>
      </section>
    )
  }

  return (
    <section className="card trpanel" id="fly-training">
      <div className="trpanel__head">
        <h3>
          🏋️ {st.running ? (kid ? 'Огонёк тренируется' : 'Муха учится пробами') : st.finished ? 'Тренировка закончена 🎉' : 'Тренировка остановлена'}
        </h3>
        <span className="trpanel__count">
          {st.iter === 0 ? 'проверяю, как ловит сейчас' : `проба ${st.iter} из ${st.total}`}
        </span>
        {st.running ? (
          <button className="big big--ghost big--sm" onClick={stopTraining}>
            стоп
          </button>
        ) : (
          <>
            <button className="big big--sm" onClick={() => void startTraining(eye)}>
              ещё раз
            </button>
            <button className="big big--ghost big--sm" onClick={clearTraining}>
              скрыть
            </button>
          </>
        )}
      </div>
      <div className="progress">
        <i style={{ width: `${Math.round((st.iter / Math.max(1, st.total)) * 100)}%` }} />
      </div>
      <p className="hint">
        {kid
          ? 'Каждая проба — шесть погонь с чуть другим рулём. Лучше прежнего — ⭐ и Огонёк оставляет новый руль.'
          : 'Ниже — шесть учебных погонь последней пробы (сверху: муха — сплошная, Шустрик — пунктир). Жёлтая точка на графике — проба, которую муха оставила.'}
      </p>
      {shown && (
        <p className={`trpanel__verdict${shown.accepted && shown.iter > 0 ? ' is-good' : ''}`}>
          {shown.iter === 0
            ? `Сначала проверка: с прежним рулём поймал ${shown.hits} из ${TRIAL_CHASES.length}.`
            : shown.accepted
              ? `Проба ${shown.iter}: поймал ${shown.hits} из ${TRIAL_CHASES.length} — ⭐ лучше прежнего, оставляет этот руль!`
              : `Проба ${shown.iter}: поймал ${shown.hits} из ${TRIAL_CHASES.length} — не лучше, этот руль выбрасывает.`}
        </p>
      )}
      <div className="trpanel__minis">
        {TRIAL_CHASES.map((_, i) => (
          <ChaseMini key={i} ch={shown?.chases[i] ?? null} stamp={shown?.iter ?? -1} />
        ))}
      </div>
      <div className="trpanel__row">
        <div className="trpanel__chart">
          <b>
            {kid ? 'Сколько из 6 поймал' : 'Поимки из 6 учебных погонь'}: лучший руль — {st.tries.length ? st.tries[st.tries.length - 1].bestHits : 0}
          </b>
          <ScoreChart tries={st.tries} total={Math.max(st.total, 1)} />
        </div>
        <div className="trpanel__steer">
          <b>{kid ? 'Руль Огонька' : 'Руль: 4 числа'}</b>
          {st.steer.map((v, k) => (
            <div key={k} className="trknob">
              <span>{names[k]}</span>
              <span className="trknob__bar">
                <i className="trknob__base" style={{ left: `${50 + (innateSteer[k] / 6) * 50}%` }} />
                <i className="trknob__dot" style={{ left: `${Math.max(2, Math.min(98, 50 + (v / 6) * 50))}%` }} />
              </span>
              {!kid && <em>{v.toFixed(2)}</em>}
            </div>
          ))}
          <small className="hint">{kid ? 'серая чёрточка — каким руль был сначала' : 'серая чёрточка — врождённое значение'}</small>
        </div>
      </div>
      {st.finished && (
        <p className="exp__result">
          {kid
            ? 'Готово! Беги на арену — посмотри, как Огонёк ловит теперь.'
            : 'Лучший руль уже стоит у мухи: его используют арена, лаборатория и опыты. Турнир учит муху заново сам.'}
        </p>
      )}
    </section>
  )
}

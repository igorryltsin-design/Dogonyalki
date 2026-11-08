import type React from 'react'
import { useReveal } from '../ui-kid/useReveal'
import { useFlyTraining } from '../app/flyTraining'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AXES,
  NOISE_LEVELS,
  RUNS,
  contenderInfo,
  examplesCurve,
  loadCurve,
  loadTournament,
  saveCurve,
  type ExamplesCurve,
  runTournament,
  saveTournament,
  type ContenderKey,
  type ContenderResult,
  type TournamentResult,
} from '../tournament'
import type { EyeConfig } from '../types'
import { useKid } from '../app/settings'
import { complete } from '../app/missions'

/** Экран «Турнир»: муха против сетей из обычного машинного зрения.
 *
 *  Главная мысль урока — не «муха всех победила», а «у природы другой
 *  счёт»: при той же задаче она обходится десятками весов, учится без
 *  правильных ответов и держит помехи. Где сети сильнее, турнир говорит
 *  это так же прямо — выводы ниже собираются из самих цифр, а не пишутся
 *  заранее. */

const fmt = (n: number) => n.toLocaleString('ru-RU')

type Tip = { x: number; y: number; title: string; lines: string[] } | null

function useTip() {
  const [tip, setTip] = useState<Tip>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const show = (e: React.PointerEvent | React.MouseEvent, title: string, lines: string[]) => {
    const r = wrap.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, lines })
  }
  const hide = () => setTip(null)
  const node = tip ? (
    <div className="tip" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.title}</b>
      {tip.lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  ) : null
  return { wrap, show, hide, node }
}

/* ── поимки: горизонтальные полосы, читер — пунктирный потолок ── */
function CatchBars({ rows }: { rows: ContenderResult[] }) {
  const t = useTip()
  return (
    <div className="chart" ref={t.wrap} onPointerLeave={t.hide}>
      {rows.map((r) => {
        const c = contenderInfo(r.key)
        const ref = c.family === 'ref'
        return (
          <div
            key={r.key}
            className="hbar"
            onPointerMove={(e) =>
              t.show(e, c.name, [
                `догнал ${r.catches} из ${RUNS}`,
                r.meanErrDeg === null ? 'ошибка взгляда: —' : `ошибка взгляда ${r.meanErrDeg.toFixed(2)}°`,
                c.how,
              ])
            }
          >
            <span className="hbar__name">
              <i className="swatch" style={{ background: c.color }} />
              {c.name}
            </span>
            <span className="hbar__track">
              <span
                className={ref ? 'hbar__fill hbar__fill--ref' : 'hbar__fill'}
                style={{ width: `${(r.catches / RUNS) * 82}%`, background: ref ? undefined : c.color, borderColor: c.color }}
              />
              <span className="hbar__val">
                {r.catches} из {RUNS}
              </span>
            </span>
          </div>
        )
      })}
      {t.node}
    </div>
  )
}

/* ── паутинка: шесть осей «больше — лучше» ── */
function Radar({ rows, shown }: { rows: ContenderResult[]; shown: Set<ContenderKey> }) {
  const t = useTip()
  const S = 360
  const VW = 500
  const cx = VW / 2
  const cy = S / 2 + 6
  const R = 120
  const n = AXES.length
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]
  }
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, Math.max(0.03, v)).join(',')).join(' ')
  const list = rows.filter((r) => shown.has(r.key))
  return (
    <div className="chart chart--radar" ref={t.wrap} onPointerLeave={t.hide}>
      <svg viewBox={`0 0 ${VW} ${S + 10}`} role="img" aria-label="Паутинка умений бойцов">
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <polygon key={k} points={poly(AXES.map(() => k))} className="radar__ring" />
        ))}
        {AXES.map((ax, i) => {
          const [x, y] = pt(i, 1)
          const [lx, ly] = pt(i, 1.16)
          return (
            <g key={ax.key}>
              <line x1={cx} y1={cy} x2={x} y2={y} className="radar__spoke" />
              <text
                x={lx}
                y={ly}
                textAnchor={Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end'}
                dominantBaseline="middle"
                className="radar__label"
                onPointerMove={(e) => t.show(e, ax.name, [ax.hint])}
              >
                {ax.name}
              </text>
            </g>
          )
        })}
        {list.map((r) => {
          const c = contenderInfo(r.key)
          const vals = AXES.map((a) => a.value(r))
          return (
            <g key={r.key}>
              <polygon points={poly(vals)} fill={c.color} fillOpacity={0.12} stroke={c.color} strokeWidth={2} strokeLinejoin="round" />
              {vals.map((v, i) => {
                const [x, y] = pt(i, Math.max(0.03, v))
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={5}
                    fill={c.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                    onPointerMove={(e) => t.show(e, `${c.name} · ${AXES[i].name}`, [`балл ${Math.round(v * 100)} из 100`, AXES[i].hint])}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>
      {t.node}
    </div>
  )
}

/* ── стойкость к помехам: линии по уровням шума ── */
function NoiseLines({ rows, shown }: { rows: ContenderResult[]; shown: Set<ContenderKey> }) {
  const t = useTip()
  const W = 420
  const H = 230
  const m = { l: 34, r: 14, t: 12, b: 34 }
  const x = (i: number) => m.l + (i / (NOISE_LEVELS.length - 1)) * (W - m.l - m.r)
  const y = (v: number) => m.t + (1 - v / RUNS) * (H - m.t - m.b)
  const list = rows.filter((r) => shown.has(r.key))
  return (
    <div className="chart" ref={t.wrap} onPointerLeave={t.hide}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Поимки при разных помехах">
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid-line" />
            <text x={m.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className="axis-label">
              {v}
            </text>
          </g>
        ))}
        {NOISE_LEVELS.map((lvl, i) => (
          <text key={lvl} x={x(i)} y={H - 12} textAnchor="middle" className="axis-label">
            {Math.round(lvl * 100)}%
          </text>
        ))}
        {list.map((r) => {
          const c = contenderInfo(r.key)
          return (
            <g key={r.key}>
              <polyline
                points={r.noise.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={c.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeDasharray={c.family === 'ref' ? '5 4' : undefined}
              />
              {r.noise.map((v, i) => (
                <g key={i} onPointerMove={(e) => t.show(e, c.name, [`помехи ${Math.round(NOISE_LEVELS[i] * 100)}%`, `догнал ${v} из ${RUNS}`])}>
                  <circle cx={x(i)} cy={y(v)} r={12} fill="transparent" />
                  <circle cx={x(i)} cy={y(v)} r={4.5} fill={c.color} stroke="var(--card)" strokeWidth={2} />
                </g>
              ))}
            </g>
          )
        })}
      </svg>
      <div className="chart__foot">
        <span className="legend-row">
          {list.map((r) => (
            <span key={r.key}>
              <i className="swatch" style={{ background: contenderInfo(r.key).color }} />
              {contenderInfo(r.key).short}
            </span>
          ))}
        </span>
        <span className="chart__x">помехи в глазу →</span>
      </div>
      {t.node}
    </div>
  )
}

/* ── цена мозга: три маленьких графика в логарифмической шкале ── */
function CostBars({ rows, pick, title, unit, note }: {
  rows: ContenderResult[]
  pick: (r: ContenderResult) => number
  title: string
  unit: (v: number) => string
  note: string
}) {
  const t = useTip()
  const vals = rows.map(pick)
  const max = Math.max(...vals, 10)
  const scale = (v: number) => (v <= 0 ? 0 : Math.max(0.02, Math.log10(1 + v) / Math.log10(1 + max)))
  return (
    <div className="cost" ref={t.wrap} onPointerLeave={t.hide}>
      <h4>{title}</h4>
      {rows.map((r) => {
        const c = contenderInfo(r.key)
        const v = pick(r)
        return (
          <div key={r.key} className="hbar hbar--sm" onPointerMove={(e) => t.show(e, c.name, [unit(v), note])}>
            <span className="hbar__name">{c.short}</span>
            <span className="hbar__track">
              <span className="hbar__fill" style={{ width: `${scale(v) * 80}%`, background: c.color }} />
              <span className="hbar__val">{v === 0 ? '0' : fmt(Math.round(v))}</span>
            </span>
          </div>
        )
      })}
      <p className="cost__note">{note}</p>
      {t.node}
    </div>
  )
}

/** Выводы из цифр: что сказать классу. Только то, что видно в таблице. */
function conclusions(res: TournamentResult): { good: boolean; text: string }[] {
  const by = (k: ContenderKey) => res.rows.find((r) => r.key === k)!
  const fly = by('trained')
  const anns = res.rows.filter((r) => contenderInfo(r.key).family === 'ann')
  const bestAnn = anns.reduce((a, b) => (b.catches > a.catches ? b : a))
  const out: { good: boolean; text: string }[] = []
  if (fly.catches > bestAnn.catches)
    out.push({ good: true, text: `Обученная муха догнала ${fly.catches} из ${RUNS}, лучшая из сетей (${contenderInfo(bestAnn.key).name.toLowerCase()}) — ${bestAnn.catches}.` })
  else if (fly.catches === bestAnn.catches)
    out.push({ good: true, text: `Муха и лучшая из сетей поймали поровну: по ${fly.catches} из ${RUNS}. Но посмотрите, чего это стоило каждой.` })
  else
    out.push({ good: false, text: `Здесь сеть сильнее: ${contenderInfo(bestAnn.key).name.toLowerCase()} догнала ${bestAnn.catches} из ${RUNS}, муха — ${fly.catches}.` })

  const minAnnP = Math.min(...anns.map((r) => r.params))
  const maxAnnP = Math.max(...anns.map((r) => r.params))
  out.push({
    good: true,
    text: fly.fixedWeights
      ? `Муха выучила всего ${fly.params} числа — остальные ${fmt(fly.fixedWeights)} связей мозга достались ей готовыми, по настоящей карте мозга мухи. Сетям пришлось выучить от ${fmt(minAnnP)} до ${fmt(maxAnnP)}.`
      : `У мухи ${fly.params} весов. У сетей — от ${fmt(minAnnP)} до ${fmt(maxAnnP)}: в ${Math.round(maxAnnP / fly.params)} раз больше у самой крупной.`,
  })
  out.push({
    good: true,
    text: `Муха не видела ни одной карточки с правильным ответом: её учитель — её же глаз. Каждой сети понадобилось ${fmt(bestAnn.labelled)} карточек с ответами.`,
  })
  const last = NOISE_LEVELS.length - 1
  const flyNoise = fly.noise[last]
  const annNoise = Math.max(...anns.map((r) => r.noise[last]))
  if (flyNoise > annNoise)
    out.push({ good: true, text: `Сильные помехи (${Math.round(NOISE_LEVELS[last] * 100)}%): муха всё ещё ловит ${flyNoise} из ${RUNS}, лучшая сеть — ${annNoise}.` })
  else out.push({ good: false, text: `При сильных помехах сеть держится не хуже мухи: ${annNoise} против ${flyNoise}.` })
  const bestTr = anns.reduce((a, b) => (b.transfer > a.transfer ? b : a))
  if (bestTr.transfer > fly.transfer)
    out.push({ good: false, text: `Зато в незнакомой погоне ${contenderInfo(bestTr.key).name.toLowerCase()} оказалась смекалистее мухи: ${bestTr.transfer} против ${fly.transfer}. Природа выигрывает не во всём.` })
  else out.push({ good: true, text: `В незнакомой погоне муха поймала ${fly.transfer}, лучшая сеть — ${bestTr.transfer}.` })
  const cheapestAnn = anns.reduce((a, b) => (b.opsPerFrame < a.opsPerFrame ? b : a))
  const priciestAnn = anns.reduce((a, b) => (b.opsPerFrame > a.opsPerFrame ? b : a))
  if (fly.opsPerFrame < cheapestAnn.opsPerFrame)
    out.push({ good: true, text: `На каждое решение муха тратит около ${fmt(fly.opsPerFrame)} действий, самая экономная сеть — ${fmt(cheapestAnn.opsPerFrame)}, детектор — ${fmt(by('det').opsPerFrame)}.` })
  else
    out.push({
      good: false,
      text: `Зато мозг из коннектома считает больше всех: около ${fmt(fly.opsPerFrame)} действий на кадр, у сетей — от ${fmt(cheapestAnn.opsPerFrame)} до ${fmt(priciestAnn.opsPerFrame)}. Компьютер считает клетки по очереди, а настоящая муха — все сразу.`,
    })
  return out
}

/* ── «Сколько нужно подсказок?»: поимки от числа карточек с ответами ── */
function ExamplesChart({ curve }: { curve: ExamplesCurve }) {
  const t = useTip()
  const W = 520
  const H = 250
  const m = { l: 34, r: 16, t: 16, b: 40 }
  const xsVals = [0, ...curve.nets.mlp.map((p) => p.cards)]
  const x = (i: number) => m.l + (i / (xsVals.length - 1)) * (W - m.l - m.r)
  const y = (v: number) => m.t + (1 - v / RUNS) * (H - m.t - m.b)
  const fly = contenderInfo('trained')
  return (
    <div className="chart chart--examples" ref={t.wrap} onPointerLeave={t.hide}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Поимки в зависимости от числа карточек с ответами">
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid-line" />
            <text x={m.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className="axis-label">
              {v}
            </text>
          </g>
        ))}
        {xsVals.map((n, i) => (
          <text key={n} x={x(i)} y={H - 18} textAnchor="middle" className="axis-label">
            {n}
          </text>
        ))}
        {/* муха: ни одной карточки — пунктир через весь график */}
        <line x1={x(0)} x2={W - m.r} y1={y(curve.fly)} y2={y(curve.fly)} stroke={fly.color} strokeWidth={2} strokeDasharray="6 5" />
        <g onPointerMove={(e) => t.show(e, 'Огонёк (муха)', [`без единой карточки ловит ${curve.fly} из ${RUNS}`])}>
          <circle cx={x(0)} cy={y(curve.fly)} r={14} fill="transparent" />
          <circle cx={x(0)} cy={y(curve.fly)} r={7} fill={fly.color} stroke="var(--card)" strokeWidth={2} />
        </g>
        <text x={x(0) + 12} y={y(curve.fly) - 10} className="axis-label" style={{ fill: 'var(--ink)', fontWeight: 700 }}>
          🪰 муха — без карточек
        </text>
        {(['mlp', 'cnn', 'det'] as const).map((k) => {
          const c = contenderInfo(k)
          const pts = curve.nets[k]
          return (
            <g key={k}>
              <polyline
                points={pts.map((p, i) => `${x(i + 1)},${y(p.catches)}`).join(' ')}
                fill="none"
                stroke={c.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {pts.map((p, i) => (
                <g key={i} onPointerMove={(e) => t.show(e, c.name, [`${p.cards} карточек с ответами`, `ловит ${p.catches} из ${RUNS}`])}>
                  <circle cx={x(i + 1)} cy={y(p.catches)} r={12} fill="transparent" />
                  <circle cx={x(i + 1)} cy={y(p.catches)} r={4.5} fill={c.color} stroke="var(--card)" strokeWidth={2} />
                </g>
              ))}
            </g>
          )
        })}
      </svg>
      <div className="chart__foot">
        <span className="legend-row">
          {(['trained', 'mlp', 'cnn', 'det'] as const).map((k) => (
            <span key={k}>
              <i className="swatch" style={{ background: contenderInfo(k).color }} />
              {contenderInfo(k).short}
            </span>
          ))}
        </span>
        <span className="chart__x">карточек с правильным ответом →</span>
      </div>
      {t.node}
    </div>
  )
}

/* ── пьедестал для малышей: три номинации, медали, персонажи ── */
const KID_NAME: Record<ContenderKey, { icon: string; name: string }> = {
  innate: { icon: '🪰', name: 'Огонёк-малыш' },
  trained: { icon: '🪰', name: 'Огонёк' },
  mlp: { icon: '🤖', name: 'Робот Простой' },
  cnn: { icon: '🦾', name: 'Робот Фильтр' },
  det: { icon: '🔍', name: 'Робот Искатель' },
  cheater: { icon: '🕵️', name: 'Читер' },
}
const MEDALS = ['🥇', '🥈', '🥉']

function Podium({ res }: { res: TournamentResult }) {
  const players = res.rows.filter((r) => r.key === 'trained' || contenderInfo(r.key).family === 'ann')
  const noiseIdx = Math.min(2, NOISE_LEVELS.length - 1)
  const noms: { icon: string; title: string; rank: (r: ContenderResult) => number; say: (r: ContenderResult) => string }[] = [
    { icon: '🎯', title: 'Кто ловит лучше', rank: (r) => r.catches, say: (r) => `догнал ${r.catches} из ${RUNS}` },
    { icon: '📚', title: 'Кто учится без подсказок', rank: (r) => -r.labelled, say: (r) => (r.labelled === 0 ? 'ни одной подсказки!' : `${fmt(r.labelled)} подсказок`) },
    { icon: '🌧', title: 'Кому не мешает дождь', rank: (r) => r.noise[noiseIdx], say: (r) => `в ливень ${r.noise[noiseIdx]} из ${RUNS}` },
  ]
  return (
    <div className="podium" data-guide="tour-go">
      {noms.map((n) => {
        const sorted = [...players].sort((a, b) => n.rank(b) - n.rank(a))
        // одинаковый результат — одинаковая медаль
        let place = 0
        const medal = sorted.map((r, i) => {
          if (i > 0 && n.rank(r) !== n.rank(sorted[i - 1])) place = i
          return place
        })
        return (
          <section key={n.title} className="card podium__nom">
            <h3>
              <span aria-hidden>{n.icon}</span> {n.title}
            </h3>
            <ol>
              {sorted.map((r, i) => (
                <li key={r.key} className={r.key === 'trained' ? 'is-fly' : ''}>
                  <span className="podium__medal">{MEDALS[medal[i]] ?? ''}</span>
                  <span className="podium__who">
                    <span aria-hidden>{KID_NAME[r.key].icon}</span> {KID_NAME[r.key].name}
                  </span>
                  <span className="podium__what">{n.say(r)}</span>
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

export function TournamentScreen({ eye }: { eye: EyeConfig }) {
  const [res, setRes] = useState<TournamentResult | null>(() => loadTournament(eye))
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState({ text: '', frac: 0 })
  const [shown, setShown] = useState<Set<ContenderKey>>(new Set(['trained', 'mlp', 'cnn', 'det']))
  // турнир сам учит муху заново — пока идёт общая тренировка, он ждёт
  const training = useFlyTraining()
  // свежие итоги турнира — ниже кнопки: показать их, а не оставить за краем
  const factsRef = useReveal<HTMLElement>(res)

  useEffect(() => {
    if (!busy) setRes(loadTournament(eye))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eye])

  async function go() {
    setBusy(true)
    try {
      const r = await runTournament(eye, (text, frac) => setStage({ text, frac }))
      saveTournament(r)
      setRes(r)
    } finally {
      setBusy(false)
    }
  }

  function toggle(k: ContenderKey) {
    const next = new Set(shown)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setShown(next)
  }

  const facts = useMemo(() => (res ? conclusions(res) : []), [res])
  const kid = useKid()
  useEffect(() => {
    if (res) complete('podium')
  }, [res])
  const eyeName = eye.grid === 'foveal' ? `глаз-сеточка ${eye.fovDeg}°` : `камера ${eye.fovDeg}°`

  if (kid)
    return (
      <div className="page tour">
        <section className="card tour__kidhero">
          <h2>🏆 Турнир: муха против роботов</h2>
          <p className="hint">
            Огонёк и три робота-нейросети много раз догоняли Шустрика с одним и тем же глазом. Кто победил?
          </p>
          <div className="tour__cast">
            {(['trained', 'mlp', 'cnn', 'det'] as ContenderKey[]).map((k) => (
              <span key={k} className="tour__actor">
                <span aria-hidden>{KID_NAME[k].icon}</span>
                {KID_NAME[k].name}
              </span>
            ))}
          </div>
        </section>
        {res ? (
          <>
            <Podium res={res} />
            <section className="card tour__moral">
              <span aria-hidden>💡</span> Роботам нужны тысячи подсказок, чтобы научиться. Муха учится сама — её мозг устроен
              для погони с рождения.
            </section>
          </>
        ) : (
          <section className="card">
            <button className="big" data-guide="tour-go" disabled={busy || training.running} onClick={go}>
              ▶ Провести турнир
            </button>
            {busy && (
              <div className="progress" style={{ marginTop: 10 }}>
                <i style={{ width: `${Math.round(stage.frac * 100)}%` }} />
              </div>
            )}
          </section>
        )}
      </div>
    )

  return (
    <div className="page tour">
      {/* шапка в одну строку: что это и кнопка. Перечень бойцов — в «Бойцах» */}
      <section className="card tour__head">
        <div className="tour__head-text">
          <h2>Турнир: муха против нейросетей</h2>
          <p className="hint">
            Все на одном глазе: <b>{eyeName}</b>, помехи {Math.round(eye.noisePct * 100)}%. Сети учатся на карточках с ответами, муха — сама,
            на погонях. Мерим одинаково: поимки, помехи, незнакомая погоня и цена мозга. Кто есть кто — во вкладке «Бойцы».
          </p>
        </div>
        <div className="tour__head-go">
          <button className="big" data-guide="tour-go" disabled={busy || training.running} onClick={go}>
            {res ? '▶ Провести турнир заново' : '▶ Провести турнир'}
          </button>
          {busy && <span className="hint">{stage.text}…</span>}
          {busy && (
            <div className="progress">
              <i style={{ width: `${Math.round(stage.frac * 100)}%` }} />
            </div>
          )}
        </div>
      </section>

      {!res && !busy && (
        <section className="card tour__empty">
          <p className="hint">Нажмите «▶ Провести турнир». На обычном ноутбуке это займёт около полутора минут: муха учится пробами — почти три сотни погонь.</p>
        </section>
      )}

      {res && (
        <>
          {/* итоги — в один экран: выводы, поимки, паутинка */}
          <div className="tour__summary" ref={factsRef as React.RefObject<HTMLDivElement>}>
            <section className="card">
              <h3>Что видно из цифр</h3>
              <ul className="facts facts--list">
                {facts.map((f) => (
                  <li key={f.text} className={f.good ? 'is-good' : 'is-honest'}>
                    <span aria-hidden>{f.good ? '🪰' : '🤖'}</span>
                    {f.text}
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h3>Поимки из {RUNS}</h3>
              <p className="hint">Десять одинаковых погонь для всех. Пунктир — читер: он подглядывает, это потолок.</p>
              <CatchBars rows={res.rows} />
            </section>

            <section className="card">
              <h3>Паутинка умений</h3>
              <p className="hint">Шесть умений: дальше от центра — лучше. Наведите на название оси.</p>
              <div className="chips chips--legend">
                {res.rows
                  .filter((r) => contenderInfo(r.key).family !== 'ref')
                  .map((r) => {
                    const c = contenderInfo(r.key)
                    const on = shown.has(r.key)
                    return (
                      <button key={r.key} type="button" className={on ? 'legend-chip is-on' : 'legend-chip'} onClick={() => toggle(r.key)} aria-pressed={on}>
                        <i className="swatch" style={{ background: on ? c.color : 'transparent', borderColor: c.color }} />
                        {c.short}
                      </button>
                    )
                  })}
              </div>
              <Radar rows={res.rows} shown={shown} />
            </section>
          </div>

          <details className="card tour__more">
            <summary>
              <b>Помехи и цена мозга</b> <span className="hint">— стойкость к шуму в глазу, сколько чисел учить, сколько считать</span>
            </summary>
          <div className="tour__grid">
            <section className="card">
              <h3>Стойкость к помехам</h3>
              <p className="hint">Сети учились на чистых кадрах. Что будет, если глаз зашумит? Те же бойцы, что в паутинке.</p>
              <NoiseLines rows={res.rows} shown={shown} />
            </section>

            <section className="card">
              <h3>Сколько стоит мозг</h3>
              <p className="hint">Шкала растёт в десять раз на каждом шаге — иначе мушиная полоска была бы не видна.</p>
              <div className="cost-grid">
                <CostBars
                  rows={res.rows.filter((r) => r.key !== 'cheater')}
                  pick={(r) => r.params}
                  title="чисел, которые надо выучить"
                  unit={(v) => `${fmt(v)} выученных чисел`}
                  note="Готовые связи из карты мозга мухи не в счёт: их никто не учил."
                />
                <CostBars
                  rows={res.rows.filter((r) => r.key !== 'cheater')}
                  pick={(r) => r.opsPerFrame}
                  title="действий на кадр"
                  unit={(v) => `≈ ${fmt(v)} умножений и сложений`}
                  note="Сколько считать, чтобы решить, куда повернуть."
                />
                <CostBars
                  rows={res.rows.filter((r) => r.key !== 'cheater')}
                  pick={(r) => r.labelled}
                  title="карточек с ответом"
                  unit={(v) => (v === 0 ? 'ни одной: учится сама' : `${fmt(v)} карточек`)}
                  note="Сколько готовых правильных ответов понадобилось."
                />
              </div>
            </section>
          </div>
          </details>

          <details className="card tour__more">
            <summary>
              <b>Все цифры таблицей</b>
            </summary>
            <div className="table-scroll">
              <table className="tour-table">
                <thead>
                  <tr>
                    <th>боец</th>
                    <th>поимки</th>
                    <th>ошибка взгляда, °</th>
                    {NOISE_LEVELS.map((l) => (
                      <th key={l}>помехи {Math.round(l * 100)}%</th>
                    ))}
                    <th>незнакомая погоня</th>
                    <th>учит чисел</th>
                    <th>готовых связей</th>
                    <th>действий на кадр</th>
                    <th>карточек с ответом</th>
                    <th>учёба, с</th>
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <i className="swatch" style={{ background: contenderInfo(r.key).color }} /> {contenderInfo(r.key).name}
                      </td>
                      <td>{r.catches}</td>
                      <td>{r.meanErrDeg === null ? '—' : r.meanErrDeg.toFixed(2)}</td>
                      {r.noise.map((v, i) => (
                        <td key={i}>{v}</td>
                      ))}
                      <td>{r.transfer}</td>
                      <td>{fmt(r.params)}</td>
                      <td>{r.fixedWeights ? fmt(r.fixedWeights) : '—'}</td>
                      <td>{r.opsPerFrame ? fmt(r.opsPerFrame) : '—'}</td>
                      <td>{fmt(r.labelled)}</td>
                      <td>{(r.trainMs / 1000).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Карточек в учебной выборке: {fmt(res.cards)}. «Незнакомая погоня» — Шустрик быстрее, дальше и петляет круче, чем в любой
              тренировке. Действия мухи из коннектома посчитаны по факту, счётчиком во время погонь. Тот же глаз и те же зёрна дают те же цифры.
            </p>
          </details>
        </>
      )}
    </div>
  )
}

/** «Сколько нужно подсказок?»: поимки сетей от числа карточек с ответами
 *  против мухи без карточек. Живёт во «Учёбе» — это вопрос про то, как
 *  учатся сети, а не про сам турнир. */
export function ExamplesCurveCard({ eye }: { eye: EyeConfig }) {
  const [curve, setCurve] = useState<ExamplesCurve | null>(() => loadCurve(eye))
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState({ text: '', frac: 0 })
  const training = useFlyTraining()
  useEffect(() => {
    if (!busy) setCurve(loadCurve(eye))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eye])
  async function go() {
    setBusy(true)
    try {
      const c = await examplesCurve(eye, (text, frac) => setStage({ text, frac }))
      saveCurve(c)
      setCurve(c)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <h3>📈 Сколько нужно подсказок?</h3>
      <p className="hint">
        Нейросети учатся на 25, 100, 400 и всех карточках с ответами — и ловят по-разному. Муха не получает ни одной: её учитель — её
        же глаз.
      </p>
      <div className="hud-line">
        <button className="big big--alt big--sm" disabled={busy || training.running} onClick={go}>
          {curve ? '▶ Посчитать заново' : '▶ Посчитать'}
        </button>
        {busy && <span className="hint">{stage.text}…</span>}
      </div>
      {busy && (
        <div className="progress" style={{ marginTop: 10 }}>
          <i style={{ width: `${Math.round(stage.frac * 100)}%` }} />
        </div>
      )}
      {curve && !busy && <ExamplesChart curve={curve} />}
    </section>
  )
}

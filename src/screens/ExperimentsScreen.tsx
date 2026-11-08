import type React from 'react'
import { useReveal } from '../ui-kid/useReveal'
import { useFlyTraining } from '../app/flyTraining'
import { useEffect, useMemo, useState } from 'react'
import { LabScreen } from './LabScreen'
import { CardThumb } from './EyeScreen'
import { SeekerView } from '../SeekerView'
import { applyEyeExtras, rasterEye } from '../eye'
import { complete } from '../app/missions'
import { play } from '../app/sound'
import {
  CELL_CHOICES,
  EVO_CHASES,
  EVO_SIZE,
  FAULTS,
  FOV_CHOICES,
  GLARE_CHOICES,
  adoptBug,
  bestOf,
  builtEye,
  cardPool,
  checkFly,
  evaluateBug,
  examBug,
  examRobot,
  firstGeneration,
  glareTest,
  nextGeneration,
  randomFault,
  teachRobot,
  testEye,
  type Bug,
  type FaultId,
  type GlareRow,
} from '../app/experiments'
import { EYE_FLY, type CardRec } from '../types'

/** Вкладка «Опыты»: лаборатория и пять опытов-игр. Каждый — про одну мысль:
 *  почини муху (из чего она состоит), эволюция (как подбирается руль без
 *  учителя), собери свой глаз (что важнее в глазе), научи робота сам (как
 *  робот зависит от примеров) и блик на линзе (кого легко обмануть). */

export type Part = 'lab' | 'fix' | 'evo' | 'eye' | 'robot'
const PARTS: { key: Part; label: string }[] = [
  { key: 'lab', label: '🧪 Лаборатория' },
  { key: 'fix', label: '🔧 Почини муху' },
  { key: 'evo', label: '🧬 Эволюция' },
  { key: 'eye', label: '👁 Собери глаз' },
  { key: 'robot', label: '✨ Блик на линзе' },
]

function Progress({ frac }: { frac: number }) {
  return (
    <div className="progress" style={{ margin: '8px 0' }}>
      <i style={{ width: `${Math.round(frac * 100)}%` }} />
    </div>
  )
}

/* ── Почини муху ─────────────────────────────────────────────────────── */
function FixFly() {
  const [fault, setFault] = useState<FaultId | null>(null)
  const [log, setLog] = useState<{ what: string; catches: number }[]>([])
  const logRef = useReveal<HTMLUListElement>(log.length || null)
  const [tried, setTried] = useState<FaultId[]>([])
  /** что дала каждая уже испробованная починка: видно прямо на кнопке */
  const [got, setGot] = useState<Partial<Record<FaultId, number>>>({})
  const [busy, setBusy] = useState(false)
  const [p, setP] = useState(0)
  const [solved, setSolved] = useState(false)

  async function run(label: string, f: FaultId | null) {
    setBusy(true)
    const c = await checkFly(f, (d, t) => setP(d / t))
    setLog((l) => [{ what: label, catches: c }, ...l])
    setBusy(false)
    setP(0)
    return c
  }

  async function breakIt() {
    const f = randomFault(fault)
    setFault(f)
    setTried([])
    setGot({})
    setSolved(false)
    setLog([])
    play('click')
    await run('муха заболела', f)
  }

  async function tryFix(f: FaultId) {
    setTried((t) => [...t, f])
    const fixed = f === fault
    const c = await run(`${FAULTS.find((x) => x.id === f)!.fix}`, fixed ? null : fault)
    setGot((g) => ({ ...g, [f]: c }))
    if (fixed) {
      setSolved(true)
      play(c > 0 ? 'catch' : 'star')
      complete('fix')
    } else play('miss')
  }

  return (
    <section className="card exp">
      <h2>🔧 Почини муху</h2>
      <p className="hint">
        Огонёк заболел: внутри сломалась одна часть, и он перестал догонять. Какая? Проверяй догадки: «чини» по одной части и
        смотри, начнёт ли муха снова ловить. Так учёные и ищут, за что отвечает каждая часть мозга.
      </p>
      <div className="hud-line">
        <button className="big" disabled={busy} onClick={breakIt}>
          {fault ? '🎲 Новая болезнь' : '🎲 Сломать муху'}
        </button>
        <button className="big big--ghost big--sm" disabled={busy} onClick={() => run('здоровая муха (для сравнения)', null)}>
          ▶ 10 погонь здоровой мухи
        </button>
      </div>
      {busy && <Progress frac={p} />}
      {fault && !solved && (
        <>
          <h3>Что чинить?</h3>
          <div className="chips exp__choices">
            {FAULTS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={got[f.id] !== undefined ? 'is-tried' : undefined}
                disabled={busy || tried.includes(f.id)}
                onClick={() => tryFix(f.id)}
              >
                {f.icon} {f.fix}
                {got[f.id] !== undefined && <span className="exp__tag">✗ {got[f.id]} из 10</span>}
                {tried.includes(f.id) && got[f.id] === undefined && <span className="exp__tag">проверяю…</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {solved && fault && (
        <div className="exp__win">
          <b>Починили! 🎉 Догадка верная — с {tried.length === 1 ? 'первой' : `${tried.length}-й`} попытки.</b>
          <span>{FAULTS.find((f) => f.id === fault)!.what}</span>
        </div>
      )}
      {log.length > 0 && (
        <ul className="exp__log" ref={logRef}>
          {log.map((r, i) => (
            <li key={i}>
              <span>{r.what}</span>
              <b className={r.catches === 0 ? 'is-bad' : ''}>
                догнал {r.catches} из 10
              </b>
            </li>
          ))}
        </ul>
      )}
      <p className="hint exp__note">
        Интересно: если выключить только нейроны погони или только детекторы мелочи, муха всё равно ловит — соседняя группа
        подстраховывает. Поэтому такой «болезни» здесь нет: в мозге есть запас прочности.
      </p>
    </section>
  )
}

/* ── Эволюция ────────────────────────────────────────────────────────── */
function Evolution() {
  const [gen, setGen] = useState<Bug[]>(() => firstGeneration())
  const [n, setN] = useState(1)
  const [history, setHistory] = useState<{ best: number; avg: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [champ, setChamp] = useState<number | null>(null)
  const champRef = useReveal<HTMLParagraphElement>(champ)
  const [adopted, setAdopted] = useState(false)
  /** какую муху сейчас проверяют: её карточка подсвечена, пока бегут погони */
  const [checking, setChecking] = useState<number | null>(null)
  const evaluated = gen.every((b) => b.fit !== null)

  async function evaluate(g: Bug[]) {
    setBusy(true)
    const out: Bug[] = [...g]
    // по очереди: руль у Огонька один, проверки одновременно мешали бы друг другу
    for (let i = 0; i < out.length; i += 1) {
      if (out[i].fit === null) {
        setChecking(out[i].id)
        out[i] = await evaluateBug(out[i])
        setGen([...out])
      }
    }
    setChecking(null)
    const best = Math.max(...out.map((b) => b.caught ?? 0))
    const avg = out.reduce((s, b) => s + (b.caught ?? 0), 0) / out.length
    setHistory((h) => [...h, { best, avg }])
    setBusy(false)
    return out
  }

  async function step() {
    let g = gen
    if (!g.every((b) => b.fit !== null)) g = await evaluate(g)
    const next = nextGeneration(g)
    setGen(next)
    setN((x) => x + 1)
    setChamp(null)
    await evaluate(next)
  }

  async function exam() {
    setBusy(true)
    setChamp(await examBug(bestOf(gen)))
    setBusy(false)
  }

  const best = evaluated ? bestOf(gen) : null
  // график поколений: слева шкала «сколько догнала из 4», точка на каждое
  // поколение — видно, как отбор шаг за шагом подтягивает среднюю муху
  const W = 520
  const H = 150
  const L = 34
  const gx = (i: number) => L + (history.length > 1 ? (i / (history.length - 1)) * (W - L) : (W - L) / 2)
  const gy = (v: number) => H - (v / EVO_CHASES.length) * H
  const pts = (key: 'best' | 'avg') => history.map((h, i) => `${gx(i)},${gy(h[key])}`).join(' ')

  return (
    <section className="card exp">
      <h2>🧬 Эволюция: мухи учатся без учителя</h2>
      <p className="hint">
        Вот {EVO_SIZE} мух с чуть разными «рулями». Каждую проверим на {EVO_CHASES.length} погонях. Лучшие оставят потомство —
        копии себя с маленькими случайными отличиями. Так, поколение за поколением, руль подбирается сам. Природа делает это
        миллионы лет.
      </p>
      <div className="hud-line">
        {!evaluated ? (
          <button className="big" disabled={busy} onClick={() => evaluate(gen)}>
            ▶ Проверить поколение {n}
          </button>
        ) : (
          <button className="big" disabled={busy} onClick={step}>
            🧬 Новое поколение (будет {n + 1}-е)
          </button>
        )}
        <button
          className="big big--ghost big--sm"
          disabled={busy}
          onClick={() => {
            setGen(firstGeneration())
            setN(1)
            setHistory([])
            setChamp(null)
            setAdopted(false)
          }}
        >
          начать сначала
        </button>
      </div>
      <div className="evo__grid">
        {gen.map((b, i) => (
          <div key={b.id} className={`evo__bug${best && b.id === best.id ? ' is-best' : ''}${checking === b.id ? ' is-checking' : ''}`}>
            <span className="evo__face" aria-hidden>
              🪰
            </span>
            <b>муха {i + 1}</b>
            <span className="evo__score">{b.caught === null ? (checking === b.id ? 'летит…' : busy ? 'ждёт' : '?') : `догнала ${b.caught} из ${EVO_CHASES.length}`}</span>
            {b.parent !== null ? <small>потомок</small> : n > 1 ? <small>осталась с прошлого раза</small> : null}
          </div>
        ))}
      </div>
      {history.length > 0 && (
        <div className="evo__chart">
          <svg viewBox={`-6 -12 ${W + 18} ${H + 54}`} role="img" aria-label="Как меняются мухи от поколения к поколению">
            {[0, 2, 4].map((v) => (
              <g key={v}>
                <line x1={L} x2={W} y1={gy(v)} y2={gy(v)} className="grid-line" />
                <text x={L - 8} y={gy(v)} textAnchor="end" dominantBaseline="middle" className="axis-label">
                  {v}
                </text>
              </g>
            ))}
            <polyline points={pts('avg')} fill="none" stroke="#3fb06c" strokeWidth={3} strokeDasharray="6 4" />
            <polyline points={pts('best')} fill="none" stroke="#0e6b46" strokeWidth={3} />
            {history.map((h, i) => (
              <g key={i}>
                <circle className="evo__dot" cx={gx(i)} cy={gy(h.avg)} r={5} fill="#3fb06c" />
                <circle className="evo__dot" cx={gx(i)} cy={gy(h.best)} r={6} fill="#0e6b46" />
                {(history.length <= 12 || i % 2 === 0 || i === history.length - 1) && (
                  <text x={gx(i)} y={H + 22} textAnchor="middle" className="axis-label">
                    {i + 1}
                  </text>
                )}
              </g>
            ))}
            <text x={W} y={H + 22} dx={-2} dy={14} textAnchor="end" className="axis-label">
              поколение →
            </text>
          </svg>
          <span className="legend-row">
            <span>
              <i className="swatch" style={{ background: '#0e6b46' }} /> лучшая муха
            </span>
            <span>
              <i className="swatch" style={{ background: '#3fb06c' }} /> в среднем
            </span>
          </span>
        </div>
      )}
      {best && (
        <div className="hud-line">
          <button className="big big--alt big--sm" disabled={busy} onClick={exam}>
            ▶ 10 погонь чемпиону
          </button>
          <button
            className="big big--ghost big--sm"
            disabled={busy || adopted}
            onClick={() => {
              adoptBug(best)
              setAdopted(true)
              play('star')
            }}
          >
            {adopted ? 'чемпион стал Огоньком ✓' : 'сделать чемпиона Огоньком'}
          </button>
        </div>
      )}
      {champ !== null && (
        <p className="exp__result" ref={champRef}>
          Чемпион догнал <b>{champ} из 10</b> на погонях, которых при отборе не было. Врождённый Огонёк ловит на них 3.
        </p>
      )}
    </section>
  )
}

/* ── Собери свой глаз ────────────────────────────────────────────────── */
function BuildEye() {
  const [fov, setFov] = useState(165)
  const [grid, setGrid] = useState<'foveal' | 'camera'>('foveal')
  const [cells, setCells] = useState(16)
  const [rows, setRows] = useState<{ label: string; catches: number }[]>([])
  const rowsRef = useReveal<HTMLElement>(rows.length || null)
  const [busy, setBusy] = useState(false)
  const [p, setP] = useState(0)
  const eye = builtEye(fov, grid, cells)
  // пример кадра: Шустрик чуть сбоку, как в середине погони
  const sample = useMemo(() => applyEyeExtras(rasterEye(0.18, 0.04, 0.06, eye), eye), [fov, grid, cells])
  const label = `${fov}° · ${grid === 'foveal' ? 'густо в центре' : 'ровные клеточки'} · ${cells}×${cells}`

  async function go() {
    setBusy(true)
    const c = await testEye(eye, (d, t) => setP(d / t))
    setRows((r) => [{ label, catches: c }, ...r])
    setBusy(false)
    setP(0)
    play(c > 0 ? 'catch' : 'miss')
  }

  return (
    <section className="card exp">
      <h2>👁 Собери свой глаз</h2>
      <p className="hint">
        Какой глаз лучше для погони? Выбери, насколько широко он смотрит, как расставлены клеточки и сколько их. Мозг у мухи
        остаётся тот же — меняется только глаз.
      </p>
      <div className="buildeye">
        <div className="buildeye__knobs">
          <h3>Как широко смотрит</h3>
          <div className="chips">
            {FOV_CHOICES.map((f) => (
              <button key={f} type="button" className={fov === f ? 'is-on' : ''} disabled={busy} onClick={() => setFov(f)}>
                {f}°{f === 13 ? ' (как телефон)' : f === 165 ? ' (как муха)' : ''}
              </button>
            ))}
          </div>
          <h3>Как расставлены клеточки</h3>
          <div className="chips">
            <button type="button" className={grid === 'foveal' ? 'is-on' : ''} disabled={busy} onClick={() => setGrid('foveal')}>
              🎯 густо в центре (как у мухи)
            </button>
            <button type="button" className={grid === 'camera' ? 'is-on' : ''} disabled={busy} onClick={() => setGrid('camera')}>
              ▦ ровно (как у телефона)
            </button>
          </div>
          <h3>Сколько клеточек</h3>
          <div className="chips">
            {CELL_CHOICES.map((c) => (
              <button key={c} type="button" className={cells === c ? 'is-on' : ''} disabled={busy} onClick={() => setCells(c)}>
                {c}×{c}
              </button>
            ))}
          </div>
        </div>
        <div className="buildeye__preview">
          <SeekerView img={sample} eye={eye} lock size={180} />
          <span className="hint">так этот глаз видит Шустрика</span>
        </div>
      </div>
      <div className="hud-line">
        <button className="big" disabled={busy} onClick={go}>
          ▶ 10 погонь с этим глазом
        </button>
      </div>
      {busy && <Progress frac={p} />}
      {rows.length > 0 && (
        <ul className="exp__log" ref={rowsRef as React.RefObject<HTMLUListElement>}>
          {rows.map((r, i) => (
            <li key={i}>
              <span>{r.label}</span>
              <b className={r.catches === 0 ? 'is-bad' : ''}>догнал {r.catches} из 10</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── Научи робота сам ────────────────────────────────────────────────── */
export function TeachRobot() {
  const [pool, setPool] = useState<{ pick: CardRec[]; test: CardRec[] } | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [p, setP] = useState(0)
  const [rows, setRows] = useState<{ label: string; catches: number; err: number | null }[]>([])
  const rowsRef = useReveal<HTMLElement>(rows.length || null)

  useEffect(() => {
    let alive = true
    void cardPool().then((x) => alive && setPool(x))
    return () => {
      alive = false
    }
  }, [])

  const choose = (f: (i: number) => boolean) => setSel(new Set(pool ? pool.pick.map((_, i) => i).filter(f) : []))

  async function teach() {
    if (!pool || sel.size === 0) return
    setBusy(true)
    const cards = [...sel].map((i) => pool.pick[i])
    const net = await teachRobot(cards)
    const r = await examRobot(net, pool.test, EYE_FLY, (d, t) => setP(d / t))
    setRows((x) => [{ label: `${sel.size} карточек`, catches: r.catches, err: r.errDeg }, ...x])
    setBusy(false)
    setP(0)
    play(r.catches > 0 ? 'catch' : 'miss')
    complete('teach')
  }

  return (
    <section className="card exp">
      <h2>🤖 Научи робота сам</h2>
      <p className="hint">
        Робот-нейросеть учится только на карточках с ответом: картинка глаза и стрелка «Шустрик здесь». Выбери, какие карточки
        ему показать. А если показать мало? А если Шустрик на всех карточках только слева?
      </p>
      {!pool ? (
        <p className="hint">Собираю карточки…</p>
      ) : (
        <>
          <div className="chips">
            <button type="button" disabled={busy} onClick={() => choose(() => true)}>
              все 24
            </button>
            <button type="button" disabled={busy} onClick={() => choose((i) => i % 5 === 0)}>
              только 5
            </button>
            <button type="button" disabled={busy} onClick={() => choose((i) => i < 12)}>
              только «слева»
            </button>
            <button type="button" disabled={busy} onClick={() => choose((i) => i >= 12)}>
              только «справа»
            </button>
            <button type="button" disabled={busy} onClick={() => choose(() => false)}>
              очистить
            </button>
          </div>
          <div className="teach__grid">
            {pool.pick.map((c, i) => (
              <button
                key={i}
                type="button"
                className={sel.has(i) ? 'teach__card is-on' : 'teach__card'}
                disabled={busy}
                onClick={() => {
                  const s = new Set(sel)
                  if (s.has(i)) s.delete(i)
                  else s.add(i)
                  setSel(s)
                }}
                aria-pressed={sel.has(i)}
              >
                <CardThumb img={c.img} eye={EYE_FLY} />
              </button>
            ))}
          </div>
          <div className="hud-line">
            <button className="big" disabled={busy || sel.size === 0} onClick={teach}>
              ▶ Учить на {sel.size} карточках
            </button>
          </div>
          {busy && <Progress frac={p} />}
        </>
      )}
      {rows.length > 0 && (
        <ul className="exp__log" ref={rowsRef as React.RefObject<HTMLUListElement>}>
          {rows.map((r, i) => (
            <li key={i}>
              <span>{r.label}</span>
              <b className={r.catches === 0 ? 'is-bad' : ''}>
                догнал {r.catches} из 10{r.err !== null ? ` · промах взгляда ${r.err.toFixed(0)}°` : ''}
              </b>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── Блик на линзе: кого обманет? ────────────────────────────────────── */
function Glare() {
  const [busy, setBusy] = useState(false)
  const [p, setP] = useState(0)
  const [rows, setRows] = useState<{ label: string; r: GlareRow }[]>([])
  const rowsRef = useReveal<HTMLElement>(rows.length || null)
  const [pick, setPick] = useState('left')
  const choice = GLARE_CHOICES.find((g) => g.id === pick)!
  const eye = { ...EYE_FLY, glare: choice.glare }
  const sample = useMemo(() => applyEyeExtras(rasterEye(0.3, 0.02, 0.05, eye), eye), [pick])

  async function go() {
    setBusy(true)
    const r = await glareTest(choice.glare, (d, t) => setP(d / t))
    setRows((x) => [{ label: choice.label, r }, ...x])
    setBusy(false)
    setP(0)
  }

  return (
    <section className="card exp">
      <h2>✨ Блик на линзе: кого обманет?</h2>
      <p className="hint">
        На линзу попала капля — в одном месте кадра всегда горит яркое пятно. Шустрик бегает, а пятно стоит. Кто купится: муха
        или роботы? Сначала угадайте, потом проверьте!
      </p>
      <div className="buildeye">
        <div className="buildeye__knobs">
          <div className="chips">
            {GLARE_CHOICES.map((g) => (
              <button key={g.id} type="button" className={pick === g.id ? 'is-on' : ''} disabled={busy} onClick={() => setPick(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="hud-line" style={{ marginTop: 10 }}>
            <button className="big" disabled={busy} onClick={go}>
              ▶ 10 погонь каждому
            </button>
          </div>
          {busy && <Progress frac={p} />}
        </div>
        <div className="buildeye__preview">
          <SeekerView img={sample} eye={eye} lock size={180} />
          <span className="hint">кадр с бликом: Шустрик справа</span>
        </div>
      </div>
      {rows.length > 0 && (
        <table className="exp__table" ref={rowsRef as React.RefObject<HTMLTableElement>}>
          <thead>
            <tr>
              <th />
              <th>🪰 Огонёк</th>
              <th>🔍 Искатель</th>
              <th>🤖 Простой</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={i}>
                <td>{x.label}</td>
                <td>{x.r.fly}</td>
                <td>{x.r.det}</td>
                <td>{x.r.mlp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint exp__note">
        Подсказка учителю: блик сбоку может сбить муху сильнее, чем роботов, — её руль поворачивает туда, где ярче. У каждой
        системы свои слабые места, и честный опыт их показывает.
      </p>
    </section>
  )
}

export function ExperimentsScreen({ initial = 'lab' }: { initial?: Part }) {
  const [part, setPart] = useState<Part>(initial)
  const training = useFlyTraining()
  return (
    <>
      <div className="subtabs">
        {PARTS.map((x) => (
          <button key={x.key} type="button" className={part === x.key ? 'is-on' : ''} onClick={() => setPart(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      {part === 'lab' && <LabScreen />}
      {part !== 'lab' && (
        <div className="page">
          {/* эти два опыта сами меняют руль Огонька — пока он тренируется,
              они бы мешали друг другу, поэтому ждут конца тренировки */}
          {(part === 'fix' || part === 'evo') && training.running && (
            <section className="card exp">
              <p className="exp__result">🏋️ Огонёк сейчас тренируется (проба {training.iter} из {training.total}). Этот опыт меняет его руль — давай подождём конца тренировки.</p>
            </section>
          )}
          {part === 'fix' && !training.running && <FixFly />}
          {part === 'evo' && !training.running && <Evolution />}
          {part === 'eye' && <BuildEye />}
          {/* «Научи робота сам» переехал во «Внутри мухи → Учёба»: всё
              обучение — в одном месте, и у ребёнка, и у учителя */}
          {part === 'robot' && <Glare />}
        </div>
      )}
    </>
  )
}

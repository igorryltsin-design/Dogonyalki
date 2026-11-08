import { useEffect, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { chaseVariant } from '../scenarios'
import { runContest } from '../board'
import { flyIsInnate, resetFly } from '../trainLocal'
import { startTraining, useFlyTraining } from '../app/flyTraining'
import { GROUPS, circuit, getSteer, groupMeans, groupOf, innateConnectomeW, setSilenced } from '../connectome'
import { Circuit3D } from '../Circuit3D'
import { BrainSchema } from '../BrainSchema'
import { useKid } from '../app/settings'
import { complete } from '../app/missions'
import { play } from '../app/sound'
import { Stat } from '../ui-kid/Stat'
import { drawPursuit, emptyTrail, stepTrail, type Trail } from '../topdown'
import type { EyeConfig, GameFrame } from '../types'

/** Экран «Мозг»: настоящая схема погони из коннектома FlyWire — около десяти
 *  тысяч нейронов в их настоящих координатах — и как она светится во время
 *  погони. Поток кадров — настоящая погоня с пилотом-мухой, поэтому яркость
 *  клетки = что она в этот миг действительно делает.
 *
 *  «Выключи нейрон»: любую группу можно заглушить, как при настоящем
 *  нокауте в лаборатории, — и посмотреть, сможет ли муха догонять без неё.
 *
 *  В углу — та самая погоня, чьими кадрами светится мозг: одна и та же
 *  последовательность кадров, разойтись по времени они не могут. */

const STEER_NAMES = ['сила поворота', 'сила набора высоты', 'упреждение поворота', 'упреждение высоты']

export function BrainScreen({ eye, onLearn }: { eye: EyeConfig; onLearn: () => void }) {
  const [fr, setFr] = useState<GameFrame | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [off, setOff] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [check, setCheck] = useState<{ catches: number; off: string } | null>(null)
  const [, force] = useState(0)
  const genRef = useRef<Generator<GameFrame> | null>(null)
  const seedRef = useRef(0)
  const miniRef = useRef<HTMLCanvasElement>(null)
  const trailRef = useRef<Trail>(emptyTrail())
  const rateSink = useRef<((r: Float32Array | null) => void) | null>(null)
  const meansRef = useRef<number[]>(GROUPS.map(() => 0))
  const c = circuit()
  const kid = useKid()
  const [view, setView] = useState<'schema' | '3d'>(() => (kid || !WEBGL ? 'schema' : '3d'))
  const [means, setMeans] = useState<number[]>(GROUPS.map(() => 0))

  // выключатели действуют на все погони, пока открыт экран; уходим — включаем
  useEffect(() => {
    setSilenced(off)
    genRef.current = null
  }, [off])
  useEffect(() => () => setSilenced(new Set()), [])

  useEffect(() => {
    let raf = 0
    let alive = true
    let i = 0
    genRef.current = null
    const step = () => {
      if (!alive) return
      if (!genRef.current) genRef.current = localRun(chaseVariant(seedRef.current, eye), { pilot: 'fly', recordCircuit: true })
      const nx = genRef.current.next()
      if (nx.done) {
        seedRef.current = (seedRef.current + 1) % 24
        genRef.current = null
      } else {
        const f = nx.value
        const r = f.brain?.circuit ?? null
        rateSink.current?.(r)
        if (r) {
          const m = groupMeans(r)
          meansRef.current = meansRef.current.map((v, k) => v + (m[k] - v) * 0.2)
        }
        i += 1
        if (i % 3 === 0) {
          setFr(f)
          setMeans([...meansRef.current])
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [eye])

  useEffect(() => {
    const canvas = miniRef.current
    if (!canvas || !fr) return
    stepTrail(trailRef.current, fr)
    drawPursuit(canvas, fr, { color: '#2e9e5b', trail: trailRef.current })
  }, [fr])

  // тренировка — общая на всё приложение (src/app/flyTraining.ts): уйдёшь
  // на другую вкладку — она идёт дальше, а панель ниже показывает её ход
  const training = useFlyTraining()
  // тренировка живёт во «Учёбе»: кнопка здесь запускает её и ведёт туда,
  // чтобы было видно, что началось
  function teach() {
    void startTraining(eye)
    onLearn()
  }

  async function checkTen() {
    setBusy(true)
    const res = await runContest('fly', eye, { runs: 10, onRun: (d, t) => setProgress(d / t) })
    setCheck({ catches: res.catches, off: [...off].map((g) => GROUPS[g].name).join(', ') })
    setBusy(false)
    play(res.catches > 0 ? 'catch' : 'miss')
    if (off.size > 0) complete('knockout')
    setProgress(0)
  }

  function toggle(g: number) {
    const next = new Set(off)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    setOff(next)
    setCheck(null)
  }

  const steer = getSteer()
  const innate = innateConnectomeW()
  const innateSteer = [innate[1][0], innate[0][1], innate[1][2], innate[0][3]]
  const grp = groupOf()
  const counts = GROUPS.map((_, g) => grp.reduce((n, x) => n + (x === g ? 1 : 0), 0))

  return (
    <div className="page">
      <div className={view === '3d' && WEBGL ? 'stage-wrap' : 'stage-wrap stage-wrap--schema'}>
        {view === '3d' && WEBGL ? (
          <Circuit3D rateSink={rateSink} focus={focus} silenced={off} />
        ) : (
          <div className="stage stage--schema">
            <BrainSchema means={means} off={off} focus={focus} onFocus={setFocus} />
          </div>
        )}

        <div className="overlay overlay--tl brain-controls">
          <div className="progress"><i style={{ width: `${Math.round((training.running ? training.iter / Math.max(1, training.total) : progress) * 100)}%` }} /></div>
          <div className="hud-line">
            <button className="big big--sm" disabled={busy} onClick={training.running ? onLearn : teach}>
              {training.running ? `🏋️ Учится ${training.iter}/${training.total} — смотреть` : kid ? '🏋️ Потренируй Огонька' : '🏋️ Тренировать муху'}
            </button>
            {WEBGL && (
              <button className="big big--ghost big--sm" onClick={() => setView(view === '3d' ? 'schema' : '3d')}>
                {view === '3d' ? '🔵 схема' : '🧠 настоящий мозг'}
              </button>
            )}
            <button
              className="big big--ghost big--sm"
              disabled={busy || training.running || flyIsInnate()}
              onClick={() => {
                resetFly()
                force((x) => x + 1)
              }}
            >
              Сбросить
            </button>
          </div>
        </div>

        <div className="overlay overlay--bl pursuit-mini pursuit-mini--after">
          <div className="cap">вот что сейчас происходит</div>
          <canvas ref={miniRef} />
          <p className="hint">Эта погоня и зажигает мозг: те же самые кадры, в то же самое мгновение.</p>
        </div>

        <div className="overlay overlay--side">
          <h3>{kid ? 'мозг мухи' : 'мозг из настоящей карты'}</h3>
          <p className="hint">
            {kid
              ? 'Сигнал бежит от глаза к крыльям. Выключи часть мозга — догонит ли муха?'
              : 'Каждая точка — нейрон мухи из карты FlyWire, на своём настоящем месте. Нажми «выкл.», чтобы заглушить группу, как в лаборатории, — и посмотри, догонит ли муха без неё.'}
          </p>
          <ul className="brain-legend" data-guide="brain-ko">
            {GROUPS.map((g, k) => {
              // доля от самой активной группы: видно, кто сейчас «громче»
              const a = meansRef.current[k] / Math.max(1e-6, ...meansRef.current)
              const isOff = off.has(k)
              return (
                <li
                  key={g.key}
                  className={focus === k ? 'is-on' : ''}
                  onPointerEnter={() => setFocus(k)}
                  onPointerLeave={() => setFocus(null)}
                >
                  <i style={{ background: `rgb(${g.color.map((v) => Math.round(v * 255)).join(',')})`, opacity: isOff ? 0.25 : 1 }} />
                  <b style={{ textDecoration: isOff ? 'line-through' : undefined }}>{kid ? g.kid : g.name}</b>
                  <span className="bar bar--act"><i style={{ width: `${isOff ? 0 : Math.round(a * 100)}%` }} /></span>
                  <button type="button" className={isOff ? 'ko is-off' : 'ko'} onClick={() => toggle(k)} disabled={busy}>
                    {isOff ? 'вкл.' : 'выкл.'}
                  </button>
                  <small>{counts[k].toLocaleString('ru-RU')}</small>
                </li>
              )
            })}
          </ul>
          <p className="hint brain-desc">
            {focus !== null ? GROUPS[focus].what : 'Наведи на строку — расскажу, что делает эта группа.'}
          </p>
          <div className="hud-line">
            <button className="big big--alt big--sm" disabled={busy || training.running} onClick={checkTen}>
              ▶ 10 погонь
            </button>
            {check && (
              <span className="hint">
                <b>
                  догнал {check.catches} из 10
                </b>
                {check.off ? ` без: ${check.off}` : ' — всё включено'}
              </span>
            )}
          </div>

          {!kid && (
          <>
          <h3>руль: 4 числа, которые муха учит сама</h3>
          <div className="steer">
            {steer.map((v, k) => (
              <div key={k} className="steer__row">
                <span>{STEER_NAMES[k]}</span>
                <span className="bar bar--act"><i style={{ width: `${Math.min(100, (Math.abs(v) / 4) * 100)}%` }} /></span>
                <em>
                  {v.toFixed(2)}
                  {Math.abs(v - innateSteer[k]) > 0.01 ? ` (было ${innateSteer[k].toFixed(2)})` : ''}
                </em>
              </div>
            ))}
          </div>
          <p className="hint">
            Всё остальное — {c.edges.toLocaleString('ru-RU')} связей между нейронами — муха получила готовым: так её мозг
            устроен от рождения. Учится она пробами: чуть меняет руль и оставляет то, что помогает догонять.
          </p>

          <div className="stats">
            <Stat label="нейронов в схеме" value={c.n.toLocaleString('ru-RU')} small />
            <Stat label="связей" value={c.edges.toLocaleString('ru-RU')} small />
            <Stat label="синапсов" value={`${Math.round(c.synapses / 1000)} тыс.`} small />
            <Stat label="во всём мозге мухи" value="≈ 139 тыс." small />
          </div>
          </>
          )}
        </div>
      </div>

      <p className="hint">
        {view === '3d' && WEBGL
          ? 'Тащи мышью или пальцем, чтобы повернуть мозг; колесо — приблизить. Цвет — группа нейронов, яркость — сколько клетка «говорит» прямо сейчас. Нити — самые толстые связи. '
          : 'Кружок светится, когда его нейроны «говорят»; по стрелкам бегут огоньки сигнала — от глаза к крыльям. '}
        Это не весь мозг мухи (в нём около 139 тысяч нейронов), а та его часть, что ведёт погоню: от колонок глаза
        через нейроны погони к командам телу. Карта — FlyWire (Dorkenwald et al., Nature 2024).
      </p>
    </div>
  )
}

/** без WebGL трёхмерный мозг был бы чёрным квадратом — тогда только схема */
const WEBGL = (() => {
  if (typeof document === 'undefined') return false
  try {
    const cv = document.createElement('canvas')
    return Boolean(cv.getContext('webgl2') || cv.getContext('webgl'))
  } catch {
    return false
  }
})()

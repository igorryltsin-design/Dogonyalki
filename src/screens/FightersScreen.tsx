import { useEffect, useMemo, useRef, useState } from 'react'
import { useKid } from '../app/settings'
import { circuit, connectomeTrained, getSteer, groupOf, GROUPS, LEARNED_PARAMS } from '../connectome'
import { EYE_N, eyeAngles, rasterEye } from '../eye'
import { predictAzEl } from '../kidBrain'
import { pretrainedNets } from '../precomputed'
import { CNN_OPS, CNN_PARAMS, DET_OPS, DET_PARAMS, cnnPredict, detPredict } from '../rivals'
import { MLP_OPS, MLP_PARAMS } from '../tournament'
import { EYE_FLY } from '../types'
import { RobotView } from '../ui-kid/RobotView'
import { WeightGrid } from '../ui-kid/WeightGrid'

/** «Бойцы»: кто участвует в турнире и как каждый устроен. Малышу — галерея
 *  персонажей и общий кадр, на котором каждый робот ставит свою метку «Шустрик
 *  тут». Учителю — то же плюс схема слоёв, счёт чисел и действий и настоящие
 *  выученные веса картинками: видно, что внутри не заглушки, а сети, которые
 *  выросли из обучения на карточках. Всё на тех же готовых сетях, что турнир
 *  берёт по умолчанию (глаз мухи 165°, ясно). */

const D = 180 / Math.PI
const fmt = (n: number) => n.toLocaleString('ru-RU')

type RobotKey = 'mlp' | 'cnn' | 'det'
const ROBOT: Record<RobotKey, { icon: string; kid: string; color: string; looks: string }> = {
  mlp: { icon: '🤖', kid: 'Робот Простой', color: '#2f6fd0', looks: 'Каждая клеточка картинки соединена с каждым его «нейроном». Смотрит на всё сразу.' },
  cnn: { icon: '🦾', kid: 'Робот Фильтр', color: '#e0662a', looks: 'Водит по картинке окошком 3×3 и ищет кусочки узора — как программы, что узнают кошек на фото.' },
  det: { icon: '🔍', kid: 'Робот Искатель', color: '#a03fb0', looks: 'Рисует карту «где, скорее всего, Шустрик» и смотрит в самое горячее место.' },
}

/* ── кадр глаза с метками роботов ─────────────────────────────────────── */
const frac = (ax: number[], a: number) => {
  if (a <= ax[0]) return 0
  if (a >= ax[ax.length - 1]) return ax.length - 1
  let i = 0
  while (i < ax.length - 2 && ax[i + 1] < a) i += 1
  return i + (a - ax[i]) / (ax[i + 1] - ax[i])
}

function GuessView({ img, marks, truth, size }: { img: number[][]; marks: { color: string; az: number; el: number }[]; truth: { az: number; el: number }; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(size * dpr)
    c.height = Math.round(size * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const n = img.length
    const cell = size / n
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1) {
        const v = Math.pow(Math.max(0, img[j][i]), 0.7)
        const q = Math.round(16 + v * 230)
        g.fillStyle = `rgb(${Math.round(q * 0.32)}, ${q}, ${Math.round(q * 0.66)})`
        g.fillRect(i * cell, j * cell, cell - 1, cell - 1)
      }
    const ax = eyeAngles(EYE_FLY)
    const at = (p: { az: number; el: number }) => [(frac(ax, p.az) + 0.5) * cell, (frac(ax, p.el) + 0.5) * cell]
    const [tx, ty] = at(truth)
    g.strokeStyle = '#7dff9a'
    g.lineWidth = 3
    g.beginPath()
    g.arc(tx, ty, 14, 0, Math.PI * 2)
    g.stroke()
    // совпавшие ответы не прячутся друг под другом: каждый крестик чуть сдвинут
    marks.forEach((m, k) => {
      const [x0, y0] = at(m)
      const x = x0 + (k - (marks.length - 1) / 2) * 7
      const y = y0
      g.strokeStyle = '#fff'
      g.lineWidth = 6
      g.beginPath()
      g.moveTo(x - 9, y - 9)
      g.lineTo(x + 9, y + 9)
      g.moveTo(x + 9, y - 9)
      g.lineTo(x - 9, y + 9)
      g.stroke()
      g.strokeStyle = m.color
      g.lineWidth = 3.5
      g.stroke()
    })
  }, [img, marks, truth, size])
  return <canvas ref={ref} className="robot-view" style={{ width: size, height: size }} aria-label="Кадр глаза и метки роботов" />
}

/* ── схема слоёв ───────────────────────────────────────────────────────── */
function Layers({ items }: { items: { top: string; sub: string; tone?: 'in' | 'mid' | 'out' }[] }) {
  return (
    <div className="layers">
      {items.map((it, i) => (
        <div key={i} className="layers__step">
          {i > 0 && <span className="layers__arrow" aria-hidden>→</span>}
          <div className={`layers__box layers__box--${it.tone ?? 'mid'}`}>
            <b>{it.top}</b>
            <small>{it.sub}</small>
          </div>
        </div>
      ))}
    </div>
  )
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <table className="fighter__facts">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function FightersScreen() {
  const kid = useKid()
  const nets = pretrainedNets('foveal')
  const [az, setAz] = useState(25)
  // по умолчанию Шустрик близко: так все трое отвечают верно. «Далеко» —
  // маленькое пятно: тут простая и свёрточная сети начинают путаться, а
  // детектор держится (это видно и в турнире, на дальних погонях)
  const [near, setNear] = useState(true)
  const el = 0
  const truth = { az: az / D, el: el / D }
  const img = useMemo(() => rasterEye(az / D, el / D, near ? 0.15 : 0.03, EYE_FLY), [az, near])
  const guesses = useMemo(() => {
    if (!nets) return null
    return {
      mlp: predictAzEl(nets.mlp, img, EYE_FLY),
      cnn: cnnPredict(nets.cnn, img, EYE_FLY),
      det: detPredict(nets.det, img, EYE_FLY),
    }
  }, [img, nets])
  const fly = useMemo(() => {
    const c = circuit()
    const g = groupOf()
    const sizes = GROUPS.map((_, k) => g.reduce((s, x) => s + (x === k ? 1 : 0), 0))
    return { n: c.n, edges: c.edges, sizes }
  }, [])
  const steer = getSteer()
  const viewPx = kid ? 300 : 260
  const side = (a: number) => (Math.abs(a) < 1.5 ? 'прямо' : a < 0 ? `левее на ${Math.abs(Math.round(a))}°` : `правее на ${Math.round(a)}°`)

  return (
    <div className="page">
      <section className="card">
        <h2>🤖 Кто бьётся в турнире</h2>
        <p className="hint">
          Все бойцы смотрят одним и тем же глазом мухи — картинкой 16×16 клеточек — и отвечают на один вопрос: <b>где Шустрик?</b>{' '}
          Рулит за всех роботов один и тот же автопилот: он берёт ответ и поворачивает крылья. Отличается только «голова».
        </p>
        <div className="fighters__try" data-guide="who-try">
          {guesses ? (
            <GuessView
              img={img}
              size={viewPx}
              truth={truth}
              marks={(Object.keys(ROBOT) as RobotKey[]).map((k) => ({ color: ROBOT[k].color, az: guesses[k].az, el: guesses[k].el }))}
            />
          ) : (
            <p className="hint">Готовые роботы не загрузились.</p>
          )}
          <div className="fighters__knobs">
            <label className="fighters__slider">
              Где Шустрик: <b>{side(az)}</b>
              <input type="range" min={-70} max={70} step={1} value={az} onChange={(e) => setAz(Number(e.target.value))} />
            </label>
            <div className="chips">
              <button type="button" className={!near ? 'is-on' : ''} onClick={() => setNear(false)}>
                далеко
              </button>
              <button type="button" className={near ? 'is-on' : ''} onClick={() => setNear(true)}>
                близко
              </button>
            </div>
            <ul className="fighters__says">
              <li>
                <i className="swatch swatch--ring" style={{ borderColor: '#2bbf5c' }} /> где Шустрик на самом деле — <b>{side(az)}</b>
              </li>
              {guesses &&
                (Object.keys(ROBOT) as RobotKey[]).map((k) => (
                  <li key={k}>
                    <i className="swatch" style={{ background: ROBOT[k].color }} /> {ROBOT[k].kid}: «Шустрик {side(guesses[k].az * D)}»
                  </li>
                ))}
            </ul>
            <p className="hint">Нажми «далеко» и двигай Шустрика — кто из роботов начнёт ошибаться?</p>
          </div>
        </div>
      </section>

      <div className="fighters__grid">
        <section className="card fighter">
          <div className="fighter__head">
            <span className="fighter__icon" aria-hidden>🪰</span>
            <div>
              <h3>Огонёк</h3>
              <small>{kid ? 'живой мозг мухи' : 'мозг из коннектома FlyWire'}</small>
            </div>
          </div>
          <p>
            Его мозг — кусочек настоящей карты мозга дрозофилы: {fmt(fly.n)} нейронов, соединённых так же, как у живой мухи.
            {kid ? ' Карточек с ответами он не видел ни одной: учился сам, пробуя погони.' : ''}
          </p>
          {!kid && (
            <>
              <Layers
                items={[
                  { top: 'глаз 16×16', sub: '256 клеточек', tone: 'in' },
                  ...GROUPS.map((g, k) => ({ top: g.kid, sub: `${fmt(fly.sizes[k])} нейронов` })),
                  { top: 'руль', sub: `${LEARNED_PARAMS} числа`, tone: 'out' as const },
                ]}
              />
              <Facts
                rows={[
                  ['связи', `${fmt(fly.edges)} — из карты мозга, не учатся`],
                  ['учит', `${LEARNED_PARAMS} числа руля${connectomeTrained() ? '' : ' (пока врождённые)'}: ${steer.map((x) => x.toFixed(2)).join(' · ')}`],
                  ['как учится', 'пробами: чуть меняет руль, оставляет, если стал ловить лучше'],
                  ['подсказок', '0 карточек с ответом'],
                ]}
              />
            </>
          )}
        </section>

        {(Object.keys(ROBOT) as RobotKey[]).map((k) => (
          <section key={k} className="card fighter">
            <div className="fighter__head">
              <span className="fighter__icon" aria-hidden>{ROBOT[k].icon}</span>
              <div>
                <h3>{ROBOT[k].kid}</h3>
                <small>{k === 'mlp' ? 'полносвязная нейросеть' : k === 'cnn' ? 'свёрточная нейросеть' : 'сеть-детектор'}</small>
              </div>
            </div>
            <p>{ROBOT[k].looks}</p>
            {kid && <p className="hint">Учился на 935 карточках «картинка → где Шустрик».</p>}
            {!kid && nets && k === 'mlp' && (
              <>
                <Layers items={[{ top: 'глаз 16×16', sub: '256 входов', tone: 'in' }, { top: '16 нейронов', sub: 'каждый — со всеми 256' }, { top: '2 выхода', sub: 'влево-вправо, вверх-вниз', tone: 'out' }]} />
                <Facts
                  rows={[
                    ['учит чисел', fmt(MLP_PARAMS)],
                    ['действий на кадр', fmt(MLP_OPS)],
                    ['как учится', '40 проходов по 935 карточкам, обратное распространение ошибки, шаг 0,25'],
                  ]}
                />
                <p className="hint">Что ищет каждый из 16 нейронов — его веса картинкой 16×16 (оранжевое «за», синее «против»):</p>
                <div className="wgrid-row">
                  {nets.mlp.w1.map((row, h) => (
                    <WeightGrid key={h} w={row} n={EYE_N} px={4} title={`нейрон ${h + 1}`} />
                  ))}
                </div>
              </>
            )}
            {!kid && nets && k === 'cnn' && (
              <>
                <Layers
                  items={[
                    { top: 'глаз 16×16', sub: '256 входов', tone: 'in' },
                    { top: '6 фильтров 3×3', sub: 'с полями → 6 карт 16×16' },
                    { top: 'сжатие 2×2', sub: '6 карт 8×8' },
                    { top: '16 нейронов', sub: 'из 384 признаков' },
                    { top: '2 выхода', sub: 'куда смотреть', tone: 'out' },
                  ]}
                />
                <Facts
                  rows={[
                    ['учит чисел', fmt(CNN_PARAMS)],
                    ['действий на кадр', fmt(CNN_OPS)],
                    ['как учится', '40 проходов по 935 карточкам, обратное распространение ошибки, шаг 0,05'],
                  ]}
                />
                <p className="hint">Шесть выученных фильтров 3×3 — окошки, которыми сеть водит по кадру:</p>
                <div className="wgrid-row">
                  {Array.from({ length: 6 }, (_, f) => (
                    <WeightGrid key={f} w={nets.cnn.wc.slice(f * 9, f * 9 + 9)} n={3} px={22} title={`фильтр ${f + 1}`} />
                  ))}
                </div>
              </>
            )}
            {!kid && nets && k === 'det' && (
              <>
                <Layers
                  items={[
                    { top: 'глаз 16×16', sub: '256 входов', tone: 'in' },
                    { top: '8 фильтров 3×3', sub: 'кадр не сжимается' },
                    { top: 'карта 16×16', sub: '«тут цель?» в каждой клеточке' },
                    { top: 'центр тяжести', sub: 'куда смотреть', tone: 'out' },
                  ]}
                />
                <Facts
                  rows={[
                    ['учит чисел', fmt(DET_PARAMS)],
                    ['действий на кадр', fmt(DET_OPS)],
                    ['как учится', '40 проходов по 935 карточкам, обратное распространение ошибки, шаг 0,02'],
                  ]}
                />
                <div className="fighter__det">
                  <div>
                    <p className="hint">Восемь фильтров 3×3:</p>
                    <div className="wgrid-row">
                      {Array.from({ length: 8 }, (_, f) => (
                        <WeightGrid key={f} w={nets.det.wc.slice(f * 9, f * 9 + 9)} n={3} px={16} title={`фильтр ${f + 1}`} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="hint">Его карта на кадре сверху:</p>
                    <RobotView img={img} truth={truth} size={150} />
                  </div>
                </div>
              </>
            )}
          </section>
        ))}

        <section className="card fighter">
          <div className="fighter__head">
            <span className="fighter__icon" aria-hidden>🕵️</span>
            <div>
              <h3>Читер</h3>
              <small>не мозг, а линейка</small>
            </div>
          </div>
          <p>Он не смотрит глазом: ему прямо подсказывают, где Шустрик и как быстро бежит. Это потолок — лучше поймать нельзя.</p>
        </section>
      </div>
    </div>
  )
}

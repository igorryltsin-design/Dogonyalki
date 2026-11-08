import { useEffect, useRef, useState } from 'react'
import type { CardDataset } from '../cards'
import { eyeAngles } from '../eye'
import { evalLoss, gazeErrorDeg, initNet, predictAzEl, saveNet, trainOnCards, type KidNet } from '../kidBrain'
import type { CardRec, EyeConfig } from '../types'
import { WeightGrid } from './WeightGrid'

/** Учитель видит, как учится полносвязная сеть: график ошибки по проходам
 *  (на учебных карточках и на проверочных, которых сеть не видела), что
 *  ищет каждый из 16 её нейронов и как она отвечает на проверочные карточки.
 *  Ползунок «проход» листает учёбу назад: в начале веса — случайный шум,
 *  ответы — мимо; к концу в весах проступают пятна, ответы садятся в цель.
 *  Ручки — сколько проходов, какой шаг и сколько карточек: можно показать,
 *  как сеть «зубрит» на 25 карточках и как большой шаг всё ломает. */

const EPOCHS = [10, 40, 120]
const LRS = [0.05, 0.25, 1]
const SIZES: { key: string; label: string; n: number | null }[] = [
  { key: '25', label: '25 карточек', n: 25 },
  { key: '100', label: '100', n: 100 },
  { key: 'all', label: 'все', n: null },
]
const SHOW = 8

type Row = { epoch: number; loss: number; hold: number; err: number }

const cloneNet = (n: KidNet): KidNet => ({ ...n, w1: n.w1.map((r) => [...r]), b1: [...n.b1], w2: n.w2.map((r) => [...r]), b2: [...n.b2] })

/** равномерная выборка: карточки идут погоня за погоней, первые 25 были бы
 *  все из одной — так нечестно даже для урока про «мало примеров» */
function pick(cards: CardRec[], n: number | null): CardRec[] {
  if (n === null || n >= cards.length) return cards
  return Array.from({ length: n }, (_, i) => cards[Math.floor(((i + 0.5) / n) * cards.length)])
}

function frac(ax: number[], a: number) {
  if (a <= ax[0]) return 0
  if (a >= ax[ax.length - 1]) return ax.length - 1
  let i = 0
  while (i < ax.length - 2 && ax[i + 1] < a) i += 1
  return i + (a - ax[i]) / (ax[i + 1] - ax[i])
}

/** проверочная карточка: кружок — где Шустрик, крестик — ответ сети */
function PredThumb({ card, pred, eye }: { card: CardRec; pred: { az: number; el: number } | null; eye: EyeConfig }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const S = 96
    c.width = S
    c.height = S
    const n = card.img.length
    const cell = S / n
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1) {
        const q = Math.round(16 + Math.pow(Math.max(0, card.img[j][i]), 0.7) * 230)
        g.fillStyle = `rgb(${Math.round(q * 0.32)}, ${q}, ${Math.round(q * 0.66)})`
        g.fillRect(i * cell, j * cell, cell - 0.5, cell - 0.5)
      }
    const ax = eyeAngles(eye, n)
    const at = (p: { az: number; el: number }) => [(frac(ax, p.az) + 0.5) * cell, (frac(ax, p.el) + 0.5) * cell]
    const [tx, ty] = at(card)
    g.strokeStyle = '#7dff9a'
    g.lineWidth = 2
    g.beginPath()
    g.arc(tx, ty, 8, 0, Math.PI * 2)
    g.stroke()
    if (pred) {
      const [x, y] = at(pred)
      g.strokeStyle = '#fff'
      g.lineWidth = 4
      g.beginPath()
      g.moveTo(x - 6, y - 6)
      g.lineTo(x + 6, y + 6)
      g.moveTo(x + 6, y - 6)
      g.lineTo(x - 6, y + 6)
      g.stroke()
      g.strokeStyle = '#2f6fd0'
      g.lineWidth = 2.5
      g.stroke()
    }
  }, [card, pred, eye])
  return <canvas ref={ref} className="predthumb" />
}

/** Ошибка падает в сотни раз за первые проходы — в обычной шкале график
 *  сразу ложится на ноль. Шкала логарифмическая: каждая линия сетки — в
 *  десять раз меньше ошибки. Точка 0 — сеть до учёбы, со случайными весами. */
function LossChart({ rows, total, sel }: { rows: Row[]; total: number; sel: number }) {
  const W = 520
  const H = 170
  const L = 48
  const vals = rows.flatMap((r) => [r.loss, r.hold]).filter((v) => v > 0)
  const hi = Math.ceil(Math.log10(Math.max(1e-4, ...vals)))
  const lo = Math.floor(Math.log10(Math.max(1e-6, Math.min(...vals, 1))))
  const x = (e: number) => L + (e / Math.max(1, total)) * (W - L - 10)
  const y = (v: number) => 10 + ((hi - Math.log10(Math.max(v, 1e-6))) / Math.max(1, hi - lo)) * (H - 36)
  const line = (k: 'loss' | 'hold') => rows.map((r) => `${x(r.epoch)},${y(r[k])}`).join(' ')
  const ticks: number[] = []
  for (let p = hi; p >= lo; p -= 1) ticks.push(10 ** p)
  return (
    <svg className="trchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ошибка сети по проходам, логарифмическая шкала: на учебных и на проверочных карточках">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} className="grid-line" />
          <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="axis-label">
            {v >= 1 ? v.toFixed(0) : v.toFixed(Math.min(5, -Math.log10(v))).replace('.', ',')}
          </text>
        </g>
      ))}
      {rows.length > 0 && <line x1={x(sel)} x2={x(sel)} y1={8} y2={H - 26} stroke="#e7a600" strokeWidth={2} strokeDasharray="4 3" />}
      {rows.length > 1 && <polyline points={line('loss')} fill="none" stroke="#2f6fd0" strokeWidth={3} />}
      {rows.length > 1 && <polyline points={line('hold')} fill="none" stroke="#e0662a" strokeWidth={3} strokeDasharray="7 4" />}
      <text x={L} y={H - 6} className="axis-label">
        до учёбы
      </text>
      <text x={W - 10} y={H - 6} textAnchor="end" className="axis-label">
        проход →
      </text>
    </svg>
  )
}

export function NetTrainingPanel({ dataset, eye, onNet }: { dataset: CardDataset | null; eye: EyeConfig; onNet: (n: KidNet) => void }) {
  const [epochs, setEpochs] = useState(40)
  const [lr, setLr] = useState(0.25)
  const [size, setSize] = useState('all')
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [snaps, setSnaps] = useState<KidNet[]>([])
  const [sel, setSel] = useState(0)
  const [follow, setFollow] = useState(true)
  const stop = useRef(false)
  const total = rows.length ? epochs : epochs

  async function go() {
    if (!dataset) return
    stop.current = false
    setRunning(true)
    setRows([])
    setSnaps([])
    setSel(0)
    setFollow(true)
    const cards = pick(dataset.train, SIZES.find((s) => s.key === size)!.n)
    const net = initNet(7, '')
    const first = cloneNet(net)
    setSnaps([first])
    // точка «до учёбы»: случайные веса, ошибка большая — с неё и видно падение
    setRows([{ epoch: 0, loss: evalLoss(net, cards, eye), hold: evalLoss(net, dataset.test, eye), err: gazeErrorDeg(net, dataset.test, eye) ?? 0 }])
    await trainOnCards(net, cards, {
      eye,
      epochs,
      lr,
      holdout: dataset.test,
      pauseMs: epochs > 60 ? 15 : 60,
      shouldStop: () => stop.current,
      onProgress: (p) => {
        const err = gazeErrorDeg(net, dataset.test, eye) ?? 0
        const snap = cloneNet(net)
        setRows((r) => [...r, { epoch: p.epoch, loss: p.loss, hold: p.holdLoss ?? 0, err }])
        setSnaps((s) => [...s, snap])
      },
    })
    setRunning(false)
    if (!stop.current) {
      saveNet(net)
      onNet(net)
    }
  }

  // пока учится — ползунок едет за последним проходом; тронул — остаётся
  const shownIdx = follow ? snaps.length - 1 : Math.min(sel, snaps.length - 1)
  const shown = shownIdx >= 0 ? snaps[shownIdx] : null
  const last = rows[rows.length - 1]
  const test = dataset ? dataset.test.filter((_, i) => i % Math.max(1, Math.floor(dataset.test.length / SHOW)) === 0).slice(0, SHOW) : []

  return (
    <section className="card trpanel">
      <div className="trpanel__head">
        <h3>🎓 Учим полносвязную сеть</h3>
        {running ? (
          <button className="big big--ghost big--sm" onClick={() => (stop.current = true)}>
            стоп
          </button>
        ) : (
          <button className="big big--alt big--sm" data-guide="learn-net" disabled={!dataset} onClick={() => void go()}>
            ▶ {rows.length ? 'Учить заново' : 'Учить сеть'}
          </button>
        )}
        {!dataset && <span className="hint">сначала соберите карточки</span>}
      </div>
      <p className="hint">
        Сеть 256 → 16 → 2 учится на карточках «кадр глаза → где Шустрик» обратным распространением ошибки. Синяя линия — ошибка на
        учебных карточках, оранжевый пунктир — на проверочных, которых сеть не видела. Если синяя падает, а оранжевая нет — сеть
        зубрит.
      </p>
      <div className="trpanel__knobs">
        <span className="chips__cap">проходов:</span>
        <div className="chips">
          {EPOCHS.map((e) => (
            <button key={e} type="button" className={epochs === e ? 'is-on' : ''} disabled={running} onClick={() => setEpochs(e)}>
              {e}
            </button>
          ))}
        </div>
        <span className="chips__cap">шаг:</span>
        <div className="chips">
          {LRS.map((v) => (
            <button key={v} type="button" className={lr === v ? 'is-on' : ''} disabled={running} onClick={() => setLr(v)}>
              {String(v).replace('.', ',')}
            </button>
          ))}
        </div>
        <span className="chips__cap">карточек:</span>
        <div className="chips">
          {SIZES.map((s) => (
            <button key={s.key} type="button" className={size === s.key ? 'is-on' : ''} disabled={running} onClick={() => setSize(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length > 0 && (
        <>
          <div className="trpanel__row">
            <div className="trpanel__chart">
              <b>
                Проход {last.epoch} из {total}: ошибка взгляда на проверке — {last.err.toFixed(1)}°
              </b>
              <LossChart rows={rows} total={total} sel={shownIdx} />
              <span className="legend-row">
                <span>
                  <i className="swatch" style={{ background: '#2f6fd0' }} /> учебные
                </span>
                <span>
                  <i className="swatch" style={{ background: '#e0662a' }} /> проверочные
                </span>
              </span>
            </div>
            <div className="trpanel__steer">
              <label className="fighters__slider">
                Смотрим проход: <b>{shownIdx === 0 ? 'до учёбы' : shownIdx}</b>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, snaps.length - 1)}
                  value={shownIdx}
                  onChange={(e) => {
                    setFollow(false)
                    setSel(Number(e.target.value))
                  }}
                />
              </label>
              <p className="hint">Ответы сети на проверочных карточках: ◯ — где Шустрик, ✕ — куда смотрит сеть.</p>
              <div className="wgrid-row">
                {test.map((c, i) => (
                  <PredThumb key={i} card={c} eye={eye} pred={shown ? predictAzEl(shown, c.img, eye) : null} />
                ))}
              </div>
            </div>
          </div>
          {shown && (
            <>
              <p className="hint">Что ищет каждый из 16 нейронов на этом проходе (оранжевое «за», синее «против»):</p>
              <div className="wgrid-row">
                {shown.w1.map((row, h) => (
                  <WeightGrid key={h} w={row} n={16} px={5} title={`нейрон ${h + 1}`} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

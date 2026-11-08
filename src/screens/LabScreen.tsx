import { useEffect, useRef, useState } from 'react'
import { runContest } from '../board'
import { setSilenced } from '../connectome'
import { useKid } from '../app/settings'
import { complete } from '../app/missions'
import { play } from '../app/sound'
import { glow } from '../ui-kid/guide'
import {
  CONTROL,
  KNOBS,
  clearLab,
  condLabel,
  condShort,
  controlRun,
  deltaOf,
  deltaWord,
  eyeOf,
  isBase,
  knobOf,
  knobSummary,
  loadLab,
  rowShort,
  saveRun,
  scenarioOf,
  silencedOf,
  type Condition,
  type LabRun,
} from '../app/lab'

/** «Лаборатория» — один экран, один изменённый шаг, десять погонь.
 *
 *  Ребёнок выбирает, что поменять (глаз, погоду, скорость Шустрика, его путь
 *  или часть мозга), а всё остальное игра держит нетронутым — и не может
 *  позволить поменять две вещи сразу, потому что тогда цифра уже ни про что.
 *  Результаты складываются в таблицу с полосками: «что меняли → сколько
 *  поймала муха». Контрольный опыт (когда не меняли ничего) — линейка, без
 *  которой не понять, стало лучше или хуже. */

const HELD = [
  { icon: '🪰', text: 'догоняет — врождённый Огонёк' },
  { icon: '🎲', text: 'погони — те же десять из набора' },
  { icon: '🧠', text: 'мозг — целый, если его не выключать' },
  { icon: '', text: 'правила осаливания — как в игре' },
]

export function LabScreen() {
  const kid = useKid()
  const [cond, setCond] = useState<Condition>(CONTROL)
  const [rows, setRows] = useState<LabRun[]>(() => loadLab())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [last, setLast] = useState<LabRun | null>(null)
  const stopRef = useRef(false)

  // если ребёнок ушёл с экрана посреди опыта — мозг включаем обратно
  useEffect(() => {
    stopRef.current = false
    return () => {
      stopRef.current = true
      setSilenced(new Set())
    }
  }, [])

  const control = controlRun(rows)
  const picked = isBase(cond) ? CONTROL : cond

  async function run() {
    if (busy) return
    setBusy(true)
    setDone(0)
    play('start')
    const silenced = silencedOf(picked)
    setSilenced(new Set(silenced))
    let res
    try {
      res = await runContest('fly', eyeOf(picked), {
        runs: 10,
        scenario: (i) => scenarioOf(i, picked),
        onRun: (d) => setDone(d),
        shouldStop: () => stopRef.current,
      })
    } finally {
      setSilenced(new Set())
    }
    const run: LabRun = {
      at: Date.now(),
      knob: picked.knob,
      choice: picked.choice,
      label: condLabel(picked),
      short: condShort(picked),
      runs: res.runs,
      catches: res.catches,
      meanErrDeg: res.meanErrDeg,
    }
    const all = saveRun(run)
    setRows(all)
    setLast(run)
    setBusy(false)
    play(res.catches > 0 ? 'catch' : 'miss')
    // звезда — когда класс сравнил: есть контроль и есть хотя бы один изменённый опыт
    if (controlRun(all) && all.some((r) => r.knob !== 'none')) complete('lab')
    // опыт с переменой без контрольного — подсказать, что нажать дальше
    else if (picked.knob !== 'none' && !controlRun(all)) glow('lab-control')
  }

  function wipe() {
    clearLab()
    setRows([])
    setLast(null)
  }

  return (
    <div className="page lab">
      <h2>🧪 Лаборатория</h2>
      <p className="hint">
        Здесь ты учёный. Меняешь <b>одну</b> вещь, запускаешь десять тех же погонь и смотришь, что изменилось.
        Всё остальное игра держит как есть — иначе цифра будет непонятно про что.
      </p>

      <div className="lab__held">
        <span className="cap">Держим как есть:</span>
        {HELD.map((h) => (
          <span key={h.text} className="lab__held-item">
            <span aria-hidden>{h.icon}</span> {h.text}
          </span>
        ))}
      </div>

      <div className="lab__knobs">
        {KNOBS.map((k) => {
          const active = picked.knob === k.key
          const current = active ? picked.choice : k.choices[0].id
          const note = k.choices.find((c) => c.id === current)?.note ?? ''
          return (
            <div key={k.key} className={active ? 'lab__knob lab__knob--on' : 'lab__knob'}>
              <div className="lab__knob-name">
                <span aria-hidden>{k.icon}</span> <b>{k.name}</b>
                {active && <em className="lab__flag">меняем это</em>}
              </div>
              <div className="lab__choices">
                {k.choices.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={c.id === current ? 'is-on' : ''}
                    disabled={busy}
                    onClick={() => setCond({ knob: k.key, choice: c.id })}
                    title={c.note}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <span className="hint">{note}</span>
            </div>
          )
        })}
      </div>

      <div className="hud-line lab__go">
        <button className="big" data-guide="lab-run" disabled={busy} onClick={() => void run()}>
          {busy ? `Бегает погоня ${done} из 10…` : picked.knob === 'none' ? '🧪 Провести контрольный опыт' : '🧪 Провести опыт'}
        </button>
        <button
          className="big big--ghost"
          data-guide="lab-control"
          disabled={busy || picked.knob === 'none'}
          onClick={() => setCond(CONTROL)}
        >
          ничего не менять
        </button>
        {rows.length > 0 && (
          <button className="big big--ghost" disabled={busy} onClick={wipe}>
            стереть опыты
          </button>
        )}
      </div>
      {busy && (
        <div className="progress" style={{ margin: '6px 0 0' }}>
          <i style={{ width: `${done * 10}%` }} />
        </div>
      )}

      {last && !busy && (
        <p className="lab__verdict">
          <b>{last.label}</b> — догнал {last.catches} из {last.runs}
          {last.knob === 'none'
            ? rows.some((r) => r.knob !== 'none')
              ? '. Это твоя линейка: с ней сравнивай остальные опыты.'
              : '. Это твоя линейка. Теперь поменяй одну вещь и проведи опыт — и сравни.'
            : control
              ? `, ${deltaWord(deltaOf(last, control))}.`
              : '. А стало лучше или хуже? Без контрольного опыта не понять — нажми «ничего не менять» и проведи его: тогда будет сравнение (и звезда ⭐).'}
          {' '}
          {!kid && last.meanErrDeg !== null && `Средняя ошибка взгляда — ${last.meanErrDeg.toFixed(2)}°.`}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="hint lab__empty">
          Таблица пустая. Начни с контрольного опыта: десять погонь, когда ничего не меняли. Это твоя линейка — без неё
          не понять, стало лучше или хуже.
        </p>
      ) : (
        <>
          <table className="lab__table">
            <thead>
              <tr>
                <th>№</th>
                <th>Что меняли</th>
                <th>Сколько догнал</th>
                <th></th>
                {!kid && <th>Ошибка взгляда, °</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const d = deltaOf(r, control)
                return (
                  <tr key={r.at} className={r.knob === 'none' ? 'is-control' : ''}>
                    <td>{i + 1}</td>
                    <td className="lab__what">
                      {rowShort(r)}
                      {r.knob !== 'none' && <small>{knobOf(r.knob).name}</small>}
                    </td>
                    <td className="lab__num">
                      {r.catches} из {r.runs}
                    </td>
                    <td className="lab__bar-cell">
                      <i className="lab__bar" style={{ width: `${(r.catches / r.runs) * 100}%` }} />
                      <span className="lab__delta">{r.knob === 'none' ? 'твоя линейка' : deltaWord(d)}</span>
                    </td>
                    {!kid && <td>{r.meanErrDeg === null ? '—' : r.meanErrDeg.toFixed(2)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="lab__sums">
            {KNOBS.map((k) => {
              const s = knobSummary(rows, k.key, control)
              return s ? <p key={k.key}>{s}</p> : null
            })}
            {!control && <p className="lab__warn">Пока нет контрольного опыта — сравнивать не с чем. Нажми «ничего не менять» и проведи его.</p>}
          </div>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { runContest, type ContestResult } from '../board'
import { resetFly, trainFly } from '../trainLocal'
import { loadNet, predictAzEl } from '../kidBrain'
import { eyeFingerprint, type EyeConfig } from '../types'

/** Экран «Доска»: десять одинаковых погонев для каждого догоняющего под
 *  выбранный в шапке глаз. Меры ровно две, как в курсе: «догнал из 10» и
 *  «ошибка взгляда, °». Ряд «врождённый Огонёк» честно сбрасывает муху к
 *  рефлексу — после доски её надо натренировать заново на экране «Глаз». */

type Row = { key: string; name: string; pilot: 'fly' | 'kid' | 'cheater'; note: string }

const ROWS: Row[] = [
  { key: 'innate', name: 'Огонёк без тренировки', pilot: 'fly', note: 'врождённый рефлекс: поворачивает туда, куда видит' },
  { key: 'trained', name: 'Огонёк после тренировки', pilot: 'fly', note: 'доучился на тридцати погонях' },
  { key: 'kid', name: 'Сеть школьника', pilot: 'kid', note: 'учится на карточках «кадр → куда смотреть»' },
  { key: 'cheater', name: 'Честный читер', pilot: 'cheater', note: 'знает дальность и скорость — глаз такого не даёт' },
]

export function BoardScreen({ eye }: { eye: EyeConfig }) {
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [results, setResults] = useState<Record<string, ContestResult | null>>({})
  const net = loadNet()
  const kidReady = Boolean(net?.trained && net.fingerprint === eyeFingerprint(eye))

  async function computeBoard() {
    setBusy(true)
    const next: Record<string, ContestResult | null> = {}
    for (const row of ROWS) {
      if (row.key === 'kid' && !kidReady) {
        next[row.key] = null
        continue
      }
      if (row.key === 'innate') resetFly()
      if (row.key === 'trained') {
        setStage('тренирую муху…')
        await trainFly(eye, 30)
      }
      setStage(`${row.name}: десять погонев…`)
      next[row.key] = await runContest(row.pilot, eye, {
        runs: 10,
        predict: row.pilot === 'kid' && net ? (img) => predictAzEl(net, img, eye) : undefined,
      })
      setResults({ ...next })
    }
    setStage('')
    setBusy(false)
  }

  const cheater = results.cheater

  return (
    <div className="page">
      <div className="card">
        <h2>Доска результатов</h2>
        <p className="hint">
          Один глаз на всех: <b>{eye.grid === 'foveal' ? 'глаз-сеточка 165°' : `камера ${Math.round(eye.fovDeg)}°`}</b>,
          помехи {Math.round(eye.noisePct * 100)}%. Переключи глаз или помехи в шапке и посчитай заново —
          вот она, главная мысль: дело в глазе, а не в хитрости сети.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
          <button className="big" disabled={busy} onClick={computeBoard}>
            {busy ? 'считаю…' : 'Считать доску'}
          </button>
          <button className="big big--ghost" disabled={busy} onClick={() => setResults({})}>
            Очистить
          </button>
          {busy && <span className="hint">{stage}</span>}
        </div>
        <table className="board">
          <thead>
            <tr>
              <th>кто догоняет</th>
              <th>догнал из 10</th>
              <th>ошибка взгляда, °</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const r = results[row.key]
              return (
                <tr key={row.key}>
                  <td>
                    {row.name}
                    {row.key === 'cheater' && <span className="badge">подглядывает!</span>}
                    <div className="hint" style={{ fontWeight: 400 }}>{row.note}</div>
                  </td>
                  <td>
                    {row.key === 'kid' && !kidReady ? (
                      <span className="hint">сначала научи сеть на экране «Глаз»</span>
                    ) : r ? (
                      <>
                        <b>{r.catches} / {r.runs}</b>
                        <div className={row.key === 'cheater' ? 'bar bar--peek' : 'bar'} style={{ width: `${Math.max(r.catches * 20, 2)}px` }} />
                      </>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>{r && r.meanErrDeg !== null ? r.meanErrDeg.toFixed(2) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {cheater && (
          <p className="hint" style={{ marginTop: 12 }}>
            Смотри на последний ряд: читер ловит {cheater.catches} из 10 при ошибке взгляда 0°. Но он не умнее —
            он знает то, чего глаз вообще не видит. Поэтому честное сравнение только над строками мухи и сети.
          </p>
        )}
      </div>
    </div>
  )
}

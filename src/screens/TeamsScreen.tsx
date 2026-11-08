import { useReveal } from '../ui-kid/useReveal'
import { useEffect, useRef, useState } from 'react'
import { PathDrawer } from '../ui-kid/PathDrawer'
import { PathThumb } from '../ui-kid/PathThumb'
import { useKid } from '../app/settings'
import { complete } from '../app/missions'
import { play } from '../app/sound'
import {
  MAX_TEAMS,
  beflyWord,
  clearTeams,
  hasPath,
  isLeaderboardReady,
  lengthWord,
  loadTeams,
  makeTeam,
  medal,
  nextTeamName,
  packPath,
  rankTeams,
  runAll,
  runTeam,
  saveTeams,
  scoreWord,
  secWord,
  teamMeters,
  winnerWord,
  type Team,
} from '../app/teams'

/** Вкладка «Команды»: каждая команда рисует свой путь убегания, пути
 *  запускаются по очереди, получается таблица очков, а сами пути с именами
 *  авторов остаются в галерее до следующего урока.
 *
 *  «По очереди» — не только про проектор: результат каждой команды игра
 *  показывает сразу, как посчитает, чтобы класс не висел в ожидании. Кнопка
 *  «на арене» отдаёт путь большой арене — там его можно пробежать вживую, а
 *  не только в таблице. */

const HELD = ['глаз — мушиный', 'мозг — врождённый Огонёк', 'скорость Шустрика — общая', 'погода — ясно']

export function TeamsScreen({ onSendToArena }: { onSendToArena: (path: number[][]) => void }) {
  const kid = useKid()
  const [teams, setTeams] = useState<Team[]>(() => loadTeams())
  // таблица мест появляется под командами — показать её, когда посчитали
  const tableRef = useReveal<HTMLTableElement>(teams.filter((t) => t.score).length || null)
  const [drawFor, setDrawFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<Team | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const stopRef = useRef(false)

  useEffect(() => {
    stopRef.current = false
    return () => {
      stopRef.current = true
    }
  }, [])

  const board = rankTeams(teams)
  const drawn = teams.filter(hasPath).length

  function update(list: Team[]) {
    setTeams(saveTeams(list))
  }

  function add() {
    if (teams.length >= MAX_TEAMS) return
    play('click')
    update([...teams, makeTeam(nextTeamName(teams))])
  }

  function patch(id: string, by: Partial<Team>) {
    update(teams.map((t) => (t.id === id ? { ...t, ...by } : t)))
  }

  function drop(id: string) {
    update(teams.filter((t) => t.id !== id))
  }

  /** путь готов: память об прежнем результате стираем, иначе таблица соврёт */
  function submitPath(path: number[][]) {
    if (drawFor) patch(drawFor, { path: packPath(path), score: null })
    setDrawFor(null)
    play('click')
  }

  /** посчитать одну команду — для «а давай ещё разок» без всей таблицы */
  async function runOne(t: Team) {
    if (busy || !hasPath(t)) return
    setBusy(true)
    setStage(t)
    const score = await runTeam(t)
    const next = teams.map((x) => (x.id === t.id ? { ...x, score } : x))
    update(next)
    setStage(null)
    setBusy(false)
    play(score && !score.caught ? 'star' : 'catch')
    if (isLeaderboardReady(next)) complete('teams')
  }

  /** прогон по очереди: результат каждой команды видно сразу */
  async function runBoard() {
    if (busy) return
    setBusy(true)
    play('start')
    const done = await runAll(
      teams,
      (d, total, team) => {
        setProgress({ done: d, total })
        setStage(team)
      },
      () => stopRef.current
    )
    update(done)
    setBusy(false)
    setProgress(null)
    setStage(null)
    play(done.some((t) => t.score && !t.score!.caught) ? 'star' : 'catch')
    if (isLeaderboardReady(done)) complete('teams')
  }

  function wipe() {
    clearTeams()
    setTeams([])
    setStage(null)
  }

  const drawing = teams.find((t) => t.id === drawFor)

  return (
    <div className="page teams">
      <h2>🤝 Соревнование команд</h2>
      <p className="hint">
        Каждая команда придумывает путь, на котором Огонёк догоняет подольше — или не догоняет вовсе. Потом пути
        запускают по очереди, и выходит таблица. Держим ровно одно для всех: {HELD.join(', ')}. Отличается только путь —
        иначе таблица меряет не хитрость.
      </p>

      <div className="teams__list">
        {teams.map((t) => (
          <div key={t.id} className={hasPath(t) ? 'teams__card' : 'teams__card teams__card--empty'}>
            <input
              className="teams__name"
              value={t.name}
              maxLength={28}
              aria-label="Название команды"
              onChange={(e) => patch(t.id, { name: e.target.value })}
            />
            <div className="teams__thumb">
              <PathThumb path={t.path} mark={Boolean(stage && stage.id === t.id)} />
              <span className="hint">{lengthWord(t)}</span>
            </div>
            <div className="teams__score">
              <b>{scoreWord(t.score)}</b>
              {!kid && t.score && t.score.errDeg !== null && <small>ошибка взгляда {t.score.errDeg.toFixed(2)}°</small>}
            </div>
            <div className="teams__acts">
              <button type="button" className="big big--sm" disabled={busy} onClick={() => setDrawFor(t.id)}>
                {hasPath(t) ? 'перерисовать путь' : '✏️ нарисовать путь'}
              </button>
              <button type="button" className="big big--sm" disabled={busy || !hasPath(t)} onClick={() => void runOne(t)}>
                ▶ посчитать
              </button>
              <button type="button" className="big big--ghost big--sm" disabled={busy || !hasPath(t)} onClick={() => onSendToArena(t.path!)}>
                на арене
              </button>
              <button type="button" className="big big--ghost big--sm" disabled={busy} onClick={() => drop(t.id)}>
                убрать
              </button>
            </div>
            {!kid && (
              <label className="teams__befly">
                «Побудь мухой», с
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={t.befly ?? ''}
                  disabled={busy}
                  onChange={(e) => patch(t.id, { befly: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="hud-line">
        <button type="button" className="big big--ghost" data-guide="teams-add" disabled={busy || teams.length >= MAX_TEAMS} onClick={add}>
          ➕ добавить команду
        </button>
        {teams.length > 0 && (
          <button type="button" className="big big--ghost" disabled={busy} onClick={wipe}>
            стереть класс
          </button>
        )}
      </div>

      <div className="hud-line teams__go">
        <button type="button" className="big" disabled={busy || drawn < 2} onClick={() => void runBoard()}>
          {busy && progress ? `Считаем: ${progress.done} из ${progress.total}…` : '▶ Запустить все пути по очереди'}
        </button>
        {busy && (
          <button
            type="button"
            className="big big--ghost"
            onClick={() => {
              stopRef.current = true
            }}
          >
            стоп
          </button>
        )}
      </div>
      {busy && progress && (
        <div className="progress" style={{ margin: '6px 0 0' }}>
          <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </div>
      )}
      {teams.length > 0 && drawn < 2 && <p className="hint">Нарисуйте пути хотя бы у двух команд — тогда будет с чем сравнивать.</p>}
      {teams.length === 0 && (
        <p className="hint">
          Начните с кнопки «➕ добавить команду»: назовите команду и нарисуйте её путь. Команд можно до {MAX_TEAMS}. Пути
          остаются в игре до следующего урока — это галерея хитрых путей вашего класса.
        </p>
      )}

      {stage && (
        <div className="teams__stage">
          <b>{stage.name}</b>
          <PathThumb path={stage.path} width={420} mark />
          <p className="teams__verdict">{!stage.score ? 'Считаем…' : stage.score.caught ? `Огонёк догонял ${secWord(stage.score.seconds)} с.` : 'Огонёк так и не догнал! Этот путь — самый хитрый.'}</p>
        </div>
      )}

      {teams.some((t) => t.score) && (
        <>
          <table className="teams__table" ref={tableRef}>
            <thead>
              <tr>
                <th></th>
                <th>Команда</th>
                <th>Путь</th>
                <th>Сколько догоняли</th>
                {!kid && <th>Ошибка взгляда, °</th>}
                <th>«Побудь мухой»</th>
              </tr>
            </thead>
            <tbody>
              {board.map((t, i) => (
                <tr key={t.id} className={t.score && !t.score.caught ? 'is-winner' : ''}>
                  <td>{medal(rankOfScored(board, i))}</td>
                  <td>{t.name}</td>
                  <td className="teams__path-cell">
                    <PathThumb path={t.path} width={120} />
                    <small>{teamMeters(t) ? `${teamMeters(t)} м` : '—'}</small>
                  </td>
                  <td className="teams__num">{scoreWord(t.score)}</td>
                  {!kid && <td>{t.score && t.score.errDeg !== null ? t.score.errDeg.toFixed(2) : '—'}</td>}
                  <td>{beflyWord(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="teams__winner">{winnerWord(teams)}</p>
          <p className="hint">
            Длина пути сама по себе не побеждает: Огонёк бегает быстрее Шустрика, и на длинной прямой пойма придёт
            скорее. Хитрость в поворотах — там взгляду мухи труднее уцелеть за целью.
          </p>
        </>
      )}

      {drawing && (
        <PathDrawer
          initial={drawing.path}
          onDone={(p) => submitPath(p)}
          onCancel={() => setDrawFor(null)}
        />
      )}
    </div>
  )
}

/** медали получает только посчитанная команда: строчка в списке — ещё не
 *  место в таблице */
function rankOfScored(board: Team[], i: number): number {
  if (!board[i].score) return -1
  let r = 0
  for (let k = 0; k < i; k += 1) if (board[k].score) r += 1
  return r
}

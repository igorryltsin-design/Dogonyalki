/** «Отчёт урока» — одна страница про то, что класс сегодня действительно сделал.
 *  Собирает журналы, которые игра ведёт сама: звёзды заданий, опыты из
 *  лаборатории, таблицу команд, рекорды «Побудь мухой» и голосование прогнозов.
 *
 *  Правило то же, что во всей игре: страница печатает только факты. Цифры
 *  берутся из тех же записей, что показывают экраны, вывод лаборатории — из
 *  `knobSummary`, который не выдумывает «лучше», если цифры равны. Пустой
 *  раздел не прячется, а честно пишется «за урок не успели»: учителю нужно
 *  видеть и пробелы.
 *
 *  Разделы собираются один раз (`reportSections`), а текст для печати и для
 *  файла — просто их запись строками: на экране и в файле цифры не разойдутся. */

import { MISSIONS, type MissionId } from './missions'
import { KNOBS, controlRun, deltaOf, deltaWord, knobSummary, loadLab, rowShort, type LabRun } from './lab'
import { loadPolls, pollStats, type PollStats } from './predict'
import { beflyRecords } from './befly'
import { beflyWord, loadTeams, rankTeams, scoreWord, teamMeters, winnerWord, type Team } from './teams'

export type Report = {
  /** когда открыли страницу */
  when: string
  stars: { icon: string; title: string; done: boolean }[]
  lab: LabRun[]
  control: LabRun | null
  teams: Team[]
  winner: string | null
  befly: { name: string; record: number | null }[]
  polls: PollStats
}

/** всё, что игра знает про конец этого урока */
export function buildReport(stars: Set<MissionId>): Report {
  const lab = loadLab()
  const control = controlRun(lab)
  const teams = rankTeams(loadTeams())
  return {
    when: new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
    stars: MISSIONS.map((m) => ({ icon: m.icon, title: m.title, done: stars.has(m.id) })),
    lab,
    control,
    teams,
    winner: winnerWord(teams),
    befly: beflyRecords(),
    polls: pollStats(loadPolls()),
  }
}

/** число по-русски: «8,1» */
function num(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',')
}

/** сколько звёзд склоняется правильно: одна, две-четыре, пять и больше */
function starsWord(n: number): string {
  if (n === 1) return '1 звезда'
  const t = n % 10
  if (t >= 2 && t <= 4) return `${n} звезды`
  return `${n} звёзд`
}

export type Section = { title: string; lines: string[] }

/** разделы страницы — и для экрана, и для файла, одними и теми же словами */
export function reportSections(r: Report): Section[] {
  const done = r.stars.filter((s) => s.done)
  const out: Section[] = [
    {
      title: `Задания: ${starsWord(done.length)} из ${r.stars.length}`,
      lines: r.stars.map((s) => `${s.done ? '★' : '☆'} ${s.icon} ${s.title}`),
    },
  ]

  const lab: Section = { title: 'Опыты (лаборатория)', lines: [] }
  if (!r.lab.length) lab.lines = ['За урок не успели провести ни одного опыта.']
  else {
    for (const run of r.lab) {
      const tail = run.knob === 'none' ? ' — это линейка, с ней сравнивай' : `, ${deltaWord(deltaOf(run, r.control))}`
      lab.lines.push(`${rowShort(run)}: догнал ${run.catches} из ${run.runs}${tail}`)
    }
    for (const k of KNOBS) {
      const w = knobSummary(r.lab, k.key, r.control)
      if (w) lab.lines.push(`Вывод — ${w}`)
    }
  }
  out.push(lab)

  const scored = r.teams.filter((t) => t.score)
  const teams: Section = { title: 'Соревнование команд', lines: [] }
  if (!scored.length) teams.lines = ['Команды ещё не считали: пути не запущены.']
  else {
    scored.forEach((t, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ' ·'
      teams.lines.push(
        `${medal} ${t.name} — ${scoreWord(t.score)}, ${teamMeters(t)} м пути, «Побудь мухой» ${beflyWord(t)}`
      )
    })
    if (r.winner) teams.lines.push(r.winner)
    const waiting = r.teams.length - scored.length
    if (waiting > 0) teams.lines.push(`Ждут своего пути: ${waiting}.`)
  }
  out.push(teams)

  const anyBefly = r.befly.some((b) => b.record !== null)
  out.push({
    title: 'Побудь мухой: время ученика',
    lines: anyBefly
      ? r.befly.map((b) => `${b.name}: ${b.record === null ? 'ещё не выигрывали' : `${num(b.record)} с`}`)
      : ['На этом уроке никто не догнал Шустрика сам.'],
  })

  const p = r.polls
  out.push({
    title: 'Прогнозы класса',
    lines: p.asked
      ? [
          `Вопросов: ${p.asked}, большинство угадало: ${p.guessed}.`,
          `Голосов поднятыми руками: ${p.hands}.`,
          `Догонит или нет — угадали ${p.byKey.dolet.guessed} из ${p.byKey.dolet.asked};` +
            ` сколько поимок — ${p.byKey.seriya.guessed} из ${p.byKey.seriya.asked};` +
            ` кто первым — ${p.byKey.kto.guessed} из ${p.byKey.kto.asked}.`,
        ]
      : ['Класс ничего не прогнозировал.'],
  })

  return out
}

const LINE = '────────────────────────────────────────'

/** страница словами: её печатают, её сохраняют в файл, её читают без игры */
export function reportText(r: Report): string {
  const out: string[] = ['Догонялки — отчёт урока', r.when, LINE]
  for (const s of reportSections(r)) out.push('', s.title, ...s.lines.map((l) => `  ${l}`))
  out.push('', LINE, 'Данные этого урока игра хранила в браузере: «Новый класс» стирает их.')
  return out.join('\n')
}

/** скачать отчёт: один текстовый файл, без сервера */
export function downloadReport(r: Report) {
  const name = `догонялки-отчёт-${new Date().toISOString().slice(0, 10)}.txt`
  const blob = new Blob([reportText(r)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // файл уже качается; ссылку отпускаем сразу после него
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

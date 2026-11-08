import { useMemo } from 'react'
import { buildReport, downloadReport, reportSections } from '../app/report'
import { useStars } from '../app/missions'

/** «Отчёт урока» — одна страница в конце занятия: что класс сделал, что
 *  измерил и о чём договорился. Печатается (`@media print` оставляет только
 *  эту страницу) и сохраняется обычным текстовым файлом — на случай, если
 *  в школе нет принтера, а отчёт нужен завучу.
 *
 *  Страница ничего не считает сама: все строки приходят из журналов игры —
 *  звёзд, лаборатории, команд, рекордов и голосований. Пустой раздел так и
 *  написано: «за урок не успели». */

export function Report({ onClose }: { onClose: () => void }) {
  const { done } = useStars()
  const report = useMemo(() => buildReport(done), [done])
  const sections = useMemo(() => reportSections(report), [report])
  return (
    <div className="drawer-modal worksheet-modal" role="dialog" aria-label="Отчёт урока">
      <div className="report">
        <div className="report__tools">
          <button type="button" className="big big--sm" onClick={() => window.print()}>
            🖨 Печать
          </button>
          <button type="button" className="big big--sm" onClick={() => downloadReport(report)}>
            💾 Сохранить в файл
          </button>
          <button type="button" className="big big--ghost big--sm" onClick={onClose}>
            закрыть
          </button>
        </div>
        <h1>Догонялки — отчёт урока</h1>
        <p className="report__when">{report.when}</p>
        {sections.map((s) => (
          <section key={s.title} className="report__sec">
            <h2>{s.title}</h2>
            <ul>
              {s.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        ))}
        <p className="report__note">
          Данные этого урока игра хранила в браузере: «Новый класс» в меню ⚙ стирает их, поэтому отчёт лучше сохранить
          до того, как начнёте новый урок.
        </p>
      </div>
    </div>
  )
}

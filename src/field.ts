import { localRun } from './localSim'
import type { ChaseScenario, Pilot } from './types'

/** Поле вокруг погони, а не погоня посреди поля.
 *
 *  Приметы (деревья, кусты, травинки) стоят на месте, а бойцы бегут — и если
 *  посадить дерево на беговую полосу, получится, что и муха, и Шустрик
 *  проходят сквозь ствол. Поэтому поле строят по настоящему пути этого
 *  погоня: прогоняем сценарий заранее (это чистая математика, ~14 мс на
 *  погоню), запоминаем, где бывают оба, и сажаем деревья только мимо.
 *
 *  Движок не тронут: заранее прогоняется ровно тот же генератор, что потом
 *  показывает экран, с тем же зерном — пути совпадают кадр в кадр. */

/** Точка пути в осях движка: x — вперёд, y — вбок. */
export type PathPoint = [number, number]

/** Как далеко от пути что стоит, м. Крона дерева до 2,5 м в поперечнике плюс
 *  запас на разворот модели; куст ниже — его можно поставить ближе; травинка
 *  под ногами не мешает, но в сам след её сажать незачем. */
export const CLEAR_TREE = 5
export const CLEAR_BUSH = 2.6
export const CLEAR_TUFT = 0.7

/** Путь обоих бойцов: кадры идут каждые `every` шагов симулятора, этого
 *  хватает с запасом — между точками меньше полуметра, а зазор мы меряем
 *  метрами. */
export function pursuitPath(
  sc: ChaseScenario,
  pilot: Pilot,
  predict?: (img: number[][]) => { az: number; el: number },
  every = 3,
): PathPoint[] {
  const pts: PathPoint[] = []
  let i = 0
  for (const fr of localRun(sc, { pilot, predict })) {
    if (i % every === 0) {
      pts.push([fr.runner[0], fr.runner[1]])
      pts.push([fr.chaser[0], fr.chaser[1]])
    }
    i += 1
  }
  return pts
}

/** Стоит ли предмет в `r` метрах от всей тропы, по которой бегают.
 *  Проверка с ранним выходом: первая же близкая точка пути отвечает «нельзя». */
export function clearOfPath(pts: PathPoint[], x: number, y: number, r: number): boolean {
  const r2 = r * r
  for (let i = 0; i < pts.length; i += 1) {
    const dx = pts[i][0] - x
    const dy = pts[i][1] - y
    if (dx * dx + dy * dy < r2) return false
  }
  return true
}

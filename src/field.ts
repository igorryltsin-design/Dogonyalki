/** Карта тропинок: где на поле бегают, а значит — где нельзя сажать деревья,
 *  кусты и камни. Без неё Огонёк и Шустрик пробегали насквозь через стволы:
 *  приметы обходили только узкую полосу вдоль оси, а Шустрик петляет,
 *  разворачивается кругами и уходит на десяток метров вбок.
 *
 *  Путь Шустрика не зависит от того, кто его догоняет (manoeuvre — функция
 *  только сценария и времени), поэтому все тропинки игры можно обсчитать
 *  заранее: каждый сценарий, который где-либо запускается (арена, турнир,
 *  карточки, мозг), плюс путь простого догоняющего «нос на цель» — он
 *  повторяет срезанные углы настоящих бойцов. Тропинка расширяется полем
 *  MARGIN_M, а предмет ставится, только если весь его след на земле вне её.
 *
 *  Координаты здесь — движка: x вперёд, y вбок. Сцена в three кладёт мир как
 *  (x, −y), это забота того, кто спрашивает. */

import { integrate, runnerAccel, runnerOnPath } from './localSim'
import { ARENA_POOL, arenaVariant, chaseVariant, sprintVariant } from './scenarios'
import { DEFAULT_CHASE, EYE_FLY, type ChaseScenario } from './types'

/** запас вокруг тропинки, м: тело бегущих и разброс путей разных бойцов */
export const MARGIN_M = 3.2
const CELL = 1
const X0 = -90
const X1 = 340
const Y0 = -90
const Y1 = 90
const NX = Math.ceil((X1 - X0) / CELL)
const NY = Math.ceil((Y1 - Y0) / CELL)

/** все сценарии, которые игра когда-либо показывает */
export function allScenarios(): ChaseScenario[] {
  const out: ChaseScenario[] = [{ ...DEFAULT_CHASE, eye: EYE_FLY }]
  for (let i = 0; i < 30; i += 1) out.push(chaseVariant(i, EYE_FLY))
  for (let i = 0; i < 10; i += 1) out.push(sprintVariant(i, EYE_FLY))
  for (let i = 0; i < ARENA_POOL; i += 1) out.push(arenaVariant(i, EYE_FLY))
  return out
}

/** Пути одного сценария: Шустрик и простой догоняющий «нос на цель». */
export function scenarioPaths(sc: ChaseScenario): { runner: number[][]; chaser: number[][] } {
  const dt = 0.02
  const raw = [1, ((sc.mirror ? -0.5 : 0.5) * sc.off_axis_m) / Math.max(sc.range_m, 1), 0.05]
  const n = Math.hypot(raw[0], raw[1], raw[2])
  const drawn = sc.path && sc.path.length >= 2
  const t = drawn ? runnerOnPath(sc, 0) : { p: raw.map((v) => (v * sc.range_m) / n), v: [sc.v_runner, 0, 0] }
  const m = { p: [0, 0, 0], v: [sc.v_chaser, 0, 0] }
  const runner: number[][] = []
  const chaser: number[][] = []
  const G = 9.81
  // путь Шустрика считаем до конца погони всегда: условный догоняющий мог
  // его «поймать», а настоящий — промахнуться, и тогда Шустрик бежит дальше
  let caught = false
  for (let time = 0; time < sc.t_max; time += dt) {
    runner.push([t.p[0], t.p[1]])
    if (!caught) chaser.push([m.p[0], m.p[1]])
    // догоняющий: поворачивает скорость на цель с ограничением перегрузки
    const d = [t.p[0] - m.p[0], t.p[1] - m.p[1], t.p[2] - m.p[2]]
    const dn = Math.hypot(d[0], d[1], d[2]) || 1
    const sp = Math.hypot(m.v[0], m.v[1], m.v[2]) || 1
    const want = d.map((x) => (x / dn) * sp)
    let a = want.map((x, i) => (x - m.v[i]) * 4)
    const dot = (a[0] * m.v[0] + a[1] * m.v[1] + a[2] * m.v[2]) / (sp * sp)
    a = a.map((x, i) => x - m.v[i] * dot)
    const an = Math.hypot(a[0], a[1], a[2])
    const lim = sc.n_max * G
    if (an > lim) a = a.map((x) => (x * lim) / an)
    if (drawn) {
      const r = runnerOnPath(sc, time + dt)
      t.p = r.p
      t.v = r.v
    } else integrate(t, runnerAccel(t.v, sc, time), dt)
    if (!caught) integrate(m, a, dt)
    if (dn < sc.tag_radius_m) caught = true
  }
  return { runner, chaser }
}

let MAP: Uint8Array | null = null
/** тропинка нарисованного пути: отдельный слой поверх постоянной карты */
let CUSTOM: Uint8Array | null = null

function markScenarios(grid: Uint8Array, list: ChaseScenario[]) {
  const r = Math.ceil(MARGIN_M / CELL)
  const mark = (x: number, y: number) => {
    const cx = Math.floor((x - X0) / CELL)
    const cy = Math.floor((y - Y0) / CELL)
    for (let dy = -r; dy <= r; dy += 1)
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue
        const ix = cx + dx
        const iy = cy + dy
        if (ix < 0 || iy < 0 || ix >= NX || iy >= NY) continue
        grid[iy * NX + ix] = 1
      }
  }
  for (const sc of list) {
    const { runner, chaser } = scenarioPaths(sc)
    for (let i = 0; i < runner.length; i += 5) mark(runner[i][0], runner[i][1])
    for (let i = 0; i < chaser.length; i += 5) mark(chaser[i][0], chaser[i][1])
  }
}

/** Нарисованный путь: его тропинку тоже расчищаем; null — убрать слой. */
export function setCustomPath(sc: ChaseScenario | null) {
  if (!sc) {
    CUSTOM = null
    return
  }
  CUSTOM = new Uint8Array(NX * NY)
  markScenarios(CUSTOM, [sc])
}

function build(): Uint8Array {
  const grid = new Uint8Array(NX * NY)
  markScenarios(grid, allScenarios())
  return grid
}

function onPath(x: number, y: number): boolean {
  MAP ??= build()
  const ix = Math.floor((x - X0) / CELL)
  const iy = Math.floor((y - Y0) / CELL)
  if (ix < 0 || iy < 0 || ix >= NX || iy >= NY) return false
  return MAP[iy * NX + ix] === 1 || (CUSTOM !== null && CUSTOM[iy * NX + ix] === 1)
}

/** Свободно ли место под предмет с радиусом следа radius (координаты движка). */
export function isClear(x: number, y: number, radius = 0): boolean {
  if (onPath(x, y)) return false
  if (radius <= 0) return true
  // след проверяем по кругу из восьми точек и половинному радиусу
  for (const k of [0.5, 1]) {
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2
      if (onPath(x + Math.cos(a) * radius * k, y + Math.sin(a) * radius * k)) return false
    }
  }
  return true
}

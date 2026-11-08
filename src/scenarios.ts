/** Набор погон-сценариев: один и тот же ChaseVariant получает и доска, и
 *  генератор карточек, и арена — чтобы цифры были про одну и ту же игру. */

import type { ChaseScenario, EyeConfig, Maneuver } from './types'
import { makeRng } from './rng'
import { DEFAULT_CHASE } from './types'

/** кроме «прямо»: убегающий в игре всегда петляет, straight — редкий гость */
export const MANEUVERS: Maneuver[] = ['weave', 'scissors', 'dive', 'turn', 'combo', 'straight']

/** Вариант погоня №i: манёвр, сбоку, дальность и скорость Шустрика меняются
 *  по кругу, зерно — своё. Детерминировано: тот же i — тот же погон. */
export function chaseVariant(i: number, eye: EyeConfig): ChaseScenario {
  const maneuver = MANEUVERS[i % MANEUVERS.length]
  return {
    ...DEFAULT_CHASE,
    eye,
    maneuver,
    n_runner: maneuver === 'straight' ? 0 : 1 + (i % 3) * 0.2,
    off_axis_m: 2 + (i % 4) * 2.2,
    range_m: 13 + (i % 3) * 3.5,
    v_runner: 6.2 + (i % 4) * 0.3,
    seed: 1000 + i * 7,
  }
}

/** «Незнакомая погоня» для проверки переноса: Шустрик быстрее, дальше и
 *  петляет круче, чем на любой карточке и любой тренировке. Зёрна свои. */
export function sprintVariant(i: number, eye: EyeConfig): ChaseScenario {
  const base = chaseVariant(i + 3, eye)
  return {
    ...base,
    v_runner: base.v_runner + 0.5,
    range_m: base.range_m + 4,
    off_axis_m: base.off_axis_m + 2,
    n_runner: base.maneuver === 'straight' ? 0 : base.n_runner * 1.25,
    seed: 5000 + i * 13,
  }
}

/* ── погони для кнопки «Пуск» на арене ──────────────────────────────────
 * Каждый «Пуск» — новая погоня из набора: разные манёвры, расстояния,
 * скорости, старт слева или справа (зеркальные варианты). Набор нарочно
 * конечный: все его пути заранее попадают в карту тропинок (field.ts), и
 * деревья на них не растут. «▶ 10 погонь» и турнир по-прежнему идут по своим
 * десяти погоням — чтобы цифры можно было сравнивать. */

export const ARENA_POOL = 48

/** как назвать манёвр для ребёнка */
export const MANEUVER_NAME: Record<Maneuver, string> = {
  weave: 'петляет змейкой',
  scissors: 'бегает зигзагом',
  dive: 'плавно виляет',
  turn: 'сворачивает в сторону',
  combo: 'хитрит: петли с рывками',
  straight: 'бежит прямо',
}

const ARENA_MANEUVERS: Maneuver[] = ['weave', 'scissors', 'turn', 'combo', 'dive', 'weave', 'scissors', 'turn', 'straight']

export function arenaVariant(k: number, eye: EyeConfig): ChaseScenario {
  const rng = makeRng(9001 + k * 131)
  const maneuver = ARENA_MANEUVERS[k % ARENA_MANEUVERS.length]
  return {
    ...DEFAULT_CHASE,
    eye,
    maneuver,
    // сложность подобрана так, чтобы врождённый Огонёк догонял не всегда
    // (около двух третей погонь): малышу интересно, а не обидно, и видно,
    // что исход зависит от манёвра — резкий поворот, например, муху обманывает
    n_runner: maneuver === 'straight' ? 0 : 0.5 + rng() * 0.5,
    off_axis_m: 1 + rng() * 8,
    range_m: 10 + rng() * 6,
    v_runner: 5.6 + rng() * 0.8,
    mirror: k % 2 === 1,
    seed: 7000 + k * 11,
  }
}

/** Новая погоня для «Пуск»: случайная из набора, но не та же, что была. */
export function nextArenaVariant(prev: number | null): number {
  let k = Math.floor(Math.random() * ARENA_POOL)
  if (k === prev) k = (k + 1 + Math.floor(Math.random() * (ARENA_POOL - 1))) % ARENA_POOL
  return k
}

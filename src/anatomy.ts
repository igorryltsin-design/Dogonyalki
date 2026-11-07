/** Анатомия мозга Огонька — то, что рисует вкладка «Мозг».

    Честность по построению: регион попадает сюда, только если у игры есть
    измеримый сигнал, который его освещает. В контуре мухи это 24 канала
    обучаемого выхода (10 признаков глаза + T4/T5 + LC11/LC10 — см.
    brain.ts) и две команды поворота. Никаких «красивых» зон из учебника,
    которых в расчёте нет: в родительском стенде их больше (грибовидное тело,
    узлы AOTU, пул скрытых нейронов), но в игре их никто не вычисляет, и
    светить им было бы нечем.

    Якоря и радиусы эллипсоидов, палитра и проводка взяты из 3D-вида
    родительского стенда (web/src/Brain3DView.tsx), лексика — детская. */

import type { BrainReadout } from './types'

export type Region = {
  name: string
  /** сколько нейронов рисуем */
  n: number
  /** центр эллипсоида: x — вбок, y — вверх, z — вперёд (условный мозг) */
  c: [number, number, number]
  /** полуоси эллипсоида */
  r: [number, number, number]
  /** цвет в sRGB-долях */
  col: [number, number, number]
  /** что region делает — по-детски */
  desc: string
  /** каналы readout, которые этим регионом и освещены */
  cols: number[]
}

/** 24 канала входа обучаемого выхода — по схеме brain.ts. */
export const CHANNELS = 24

export const REGIONS: Region[] = [
  {
    name: 'глаз',
    n: 256,
    c: [0, 0.1, 0.95],
    r: [0.42, 0.3, 0.1],
    col: [1, 0.82, 0.35],
    desc: 'Сетчатка 16×16: здесь появляется светлое пятно — это Шустрик.',
    cols: [9],
  },
  {
    name: 'ламина',
    n: 420,
    c: [0.55, 0.02, 0.7],
    r: [0.16, 0.3, 0.1],
    col: [0.55, 1, 0.78],
    desc: 'Первая обработка: сигнал очищают от лишнего и измеряют размер пятна.',
    cols: [4],
  },
  {
    name: 'медулла',
    n: 700,
    c: [0.5, -0.05, 0.4],
    r: [0.2, 0.36, 0.16],
    col: [0.45, 1, 0.72],
    desc: 'Здесь видят движение: куда ползёт картинка по сетчатке.',
    cols: [7, 8],
  },
  {
    name: 'T4',
    n: 64,
    c: [0.46, -0.05, 0.26],
    r: [0.1, 0.18, 0.08],
    col: [0.65, 1, 0.85],
    desc: 'Детекторы направления: светлое пятно бежит влево, вправо, вверх, вниз.',
    cols: [10, 11, 12, 13],
  },
  {
    name: 'T5',
    n: 64,
    c: [-0.46, -0.05, 0.26],
    r: [0.1, 0.18, 0.08],
    col: [0.6, 0.95, 0.85],
    desc: 'То же самое, но по тёмным краям — муха видит и тень цели.',
    cols: [14, 15, 16, 17],
  },
  {
    name: 'лобула',
    n: 240,
    c: [0.45, -0.12, 0.05],
    r: [0.15, 0.24, 0.1],
    col: [0.4, 0.95, 0.75],
    desc: 'Где именно цель в кадре и как быстро она туда-сюда смещается.',
    cols: [0, 1, 2, 3],
  },
  {
    name: 'LC11',
    n: 40,
    c: [0.45, -0.12, 0.05],
    r: [0.09, 0.14, 0.07],
    col: [0.95, 0.75, 0.4],
    desc: 'Четверть кадра, в которой сидит цель.',
    cols: [18, 19, 20, 21],
  },
  {
    name: 'LC10',
    n: 20,
    c: [-0.45, -0.12, 0.05],
    r: [0.09, 0.14, 0.07],
    col: [0.95, 0.7, 0.45],
    desc: 'Насколько цель выше или ниже и левее или правее центра взгляда.',
    cols: [22, 23],
  },
  {
    name: 'LPLC2',
    n: 16,
    c: [0.4, -0.18, -0.08],
    r: [0.09, 0.13, 0.06],
    col: [1, 0.45, 0.35],
    desc: 'Радар сближения: пятно растёт — значит, догоняем.',
    cols: [5, 6],
  },
  {
    name: 'решение',
    n: 24,
    c: [0, 0.18, -0.12],
    r: [0.09, 0.09, 0.14],
    col: [0.7, 0.85, 1],
    desc: 'Сборка решения: сюда приходят все признаки, и здесь каждый получает свой вес. Именно эти веса меняются, когда муху тренируют.',
    cols: [],
  },
  {
    name: 'крылья',
    n: 32,
    c: [0, -0.5, -0.35],
    r: [0.08, 0.06, 0.06],
    col: [1, 0.4, 0.3],
    desc: 'Команда поворота: наклониться и повернуть — то, что делает Огонёк.',
    cols: [],
  },
]

/** Проводка путей. cols — каналы, чьи веса readout этот путь толщат: тренировка
 *  меняет числа в brain.ts, и путь к «решению» на глазах становится жирнее. */
export type Link = { from: string; to: string; cols: number[] }

export const LINKS: Link[] = [
  { from: 'глаз', to: 'ламина', cols: [] },
  { from: 'ламина', to: 'медулла', cols: [] },
  { from: 'медулла', to: 'T4', cols: [] },
  { from: 'медулла', to: 'T5', cols: [] },
  { from: 'T4', to: 'лобула', cols: [] },
  { from: 'T5', to: 'лобула', cols: [] },
  { from: 'лобула', to: 'LC11', cols: [] },
  { from: 'лобула', to: 'LC10', cols: [] },
  { from: 'лобула', to: 'LPLC2', cols: [] },
  // дальше — входы обучаемого выхода: thickness = |веса| по своим каналам
  { from: 'глаз', to: 'решение', cols: [9] },
  { from: 'ламина', to: 'решение', cols: [4] },
  { from: 'медулла', to: 'решение', cols: [7, 8] },
  { from: 'T4', to: 'решение', cols: [10, 11, 12, 13] },
  { from: 'T5', to: 'решение', cols: [14, 15, 16, 17] },
  { from: 'лобула', to: 'решение', cols: [0, 1, 2, 3] },
  { from: 'LC11', to: 'решение', cols: [18, 19, 20, 21] },
  { from: 'LC10', to: 'решение', cols: [22, 23] },
  { from: 'LPLC2', to: 'решение', cols: [5, 6] },
  { from: 'решение', to: 'крылья', cols: [] },
]

export const regionByName = (name: string): Region | undefined =>
  REGIONS.find((r) => r.name === name)

/** Активность региона в этом кадре, 0…1. Регионы без своих каналов («решение»,
 *  «крылья») светятся тем, что через них реально протекает. */
export function regionActivity(name: string, b: BrainReadout | undefined): number {
  if (!b) return 0
  const abs = (v: number) => Math.abs(v)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + abs(v), 0) / xs.length : 0)
  switch (name) {
    case 'глаз':
      return b.feat[9]
    case 'ламина':
      return b.feat[4]
    case 'медулла':
      return Math.min(1, mean([b.feat[7], b.feat[8]]) * 1.6)
    case 'T4':
      return Math.min(1, mean(b.t4) * 3)
    case 'T5':
      return Math.min(1, mean(b.t5) * 3)
    case 'лобула':
      return Math.min(1, mean(b.feat.slice(0, 4)) * 1.3)
    case 'LC11':
      return Math.min(1, mean(b.lc11) * 2.4)
    case 'LC10':
      return Math.min(1, mean(b.lc10) * 1.4)
    case 'LPLC2':
      return Math.min(1, Math.max(b.feat[5], b.feat[6] * 0.3))
    case 'решение':
      return Math.min(1, mean([...b.feat, ...b.t4, ...b.t5, ...b.lc11, ...b.lc10]) * 1.6)
    case 'крылья':
      return Math.min(1, mean(b.out) * 1.2)
    default:
      return 0
  }
}

/** Активность отдельного канала — для подсветки нейронов внутри региона. */
export function channelValue(ch: number, b: BrainReadout): number {
  const all = [...b.feat, ...b.t4, ...b.t5, ...b.lc11, ...b.lc10]
  return Math.min(1, Math.abs(all[ch] ?? 0))
}

/** Сколько весов readout «держит» этот путь — средний модуль по каналам. */
export function linkWeight(link: Link, w: number[][]): number {
  if (!link.cols.length) return 0
  let s = 0
  for (const c of link.cols) for (const row of w) s += Math.abs(row[c] ?? 0)
  return s / (link.cols.length * Math.max(w.length, 1))
}

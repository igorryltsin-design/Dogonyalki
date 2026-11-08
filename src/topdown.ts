import { CLEAR_BUSH, CLEAR_TREE, CLEAR_TUFT, clearOfPath, type PathPoint } from './field'
import { hashSeed } from './rng'
import type { GameFrame } from './types'

/** Вид сверху: одна и та же плоская схема погони для Арены и для экрана «Мозг».
 *  Руки одни, картинка одинаковая — иначе две версии «как выглядит погоня»
 *  разъехались бы по стилю и по масштабу, а ребёнок сверял бы их между собой.
 *
 *  Оси движка: x — вперёд, y — вбок; на экране вправо — это x, вниз — это −y. */

export type Trail = { mx: number[]; my: number[]; tx: number[]; ty: number[]; t: number }

const TRAIL_MAX = 900

export const emptyTrail = (): Trail => ({ mx: [], my: [], tx: [], ty: [], t: -1 })

/** Точка трассы. Новый погон (время потекло сначала) начинается с чистого
 *  листа, иначе хвост прошлого бегуна остался бы висеть на схеме. */
export function stepTrail(tr: Trail, fr: GameFrame): void {
  if (fr.t < tr.t) {
    tr.mx = []
    tr.my = []
    tr.tx = []
    tr.ty = []
  }
  tr.t = fr.t
  tr.mx.push(fr.chaser[0])
  tr.my.push(fr.chaser[1])
  tr.tx.push(fr.runner[0])
  tr.ty.push(fr.runner[1])
  if (tr.mx.length > TRAIL_MAX) {
    tr.mx.shift()
    tr.my.shift()
    tr.tx.shift()
    tr.ty.shift()
  }
}

/** Палитры: днём — луг на свету, ночью — тот же луг под луной, но трассы и
 *  взгляд светятся, как в объёме: на тёмном фоне их видно, а на светлом они
 *  были бы серой кашей. */
const THEME = {
  day: {
    runnerTrail: 'rgba(120,110,100,0.5)', seekTrailAlpha: '88', beam: '#23301f', runner: '#d95a3d',
    mark: 'rgba(74,128,84,0.35)', markStem: 'rgba(96,72,44,0.5)',
  },
  night: {
    runnerTrail: 'rgba(255,122,85,0.5)', seekTrailAlpha: 'cc', beam: '#7dffc8', runner: '#ff8a5a',
    mark: 'rgba(120,200,170,0.22)', markStem: 'rgba(150,190,200,0.3)',
  },
}

/** canvas клиента → буфер с учётом плотности пикселей; возвращает false, если
 *  рисовать пока некуда (нулевой размер: панель свёрнута или экран не виден). */
function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return null
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { ctx, w, h }
}

export function drawPursuit(
  canvas: HTMLCanvasElement,
  fr: GameFrame,
  opts: { color: string; trail: Trail; night?: boolean; path?: PathPoint[] },
): void {
  const box = fit(canvas)
  if (!box) return
  const { ctx, w, h } = box
  const pal = opts.night ? THEME.night : THEME.day

  // сколько метров влево-вправо и вверх-вниз от центра пары должно влезть:
  // масштаб считается раздельно по осям, чтобы погоня была целиком и в то же
  // время как можно крупнее
  const cx = (fr.chaser[0] + fr.runner[0]) / 2
  const cy = (fr.chaser[1] + fr.runner[1]) / 2
  const halfX = Math.max(9, fr.range_m * 0.72)
  const halfY = Math.max(5.5, Math.abs(fr.runner[1] - fr.chaser[1]) * 0.9 + 3.5)
  const k = Math.min(w / (2 * halfX), h / (2 * halfY))
  const ox = w / 2 - cx * k
  const oy = h / 2 + cy * k
  const px = (x: number, y: number) => [ox + x * k, oy - y * k] as const
  const dot = Math.max(6, Math.min(18, k * 0.45))

  // Приметы поля: кусты и деревья стоят на месте, а картинка под ними едет —
  // именно это выдаёт скорость и направление. Раскладка детерминирована по
  // координатам решётки: тот же кусок поля выглядит одинаково в любой момент
  // погони и в обоих видах.
  //
  // Высокое над тропой не растёт: дерево, посаженное на путь, выглядело бы так,
  // будто бойцы пробегают сквозь ствол. Поэтому для каждой приметы свой зазор
  // до тропы — тот же, что держит объёмная сцена (см. ./field.ts): дерево
  // сторонится погони на пять метров, куст на два с половиной, а травинка
  // может лежать и в полуметре: сквозь неё не идёшь, и именно она ближе всего
  // показывает, с какой скоростью бежит погоня.
  const CELL = 3.5
  const x0 = cx - halfX - CELL
  const x1 = cx + halfX + CELL
  const y0 = cy - halfY - CELL
  const y1 = cy + halfY + CELL
  ctx.fillStyle = pal.mark
  for (let ix = Math.floor(x0 / CELL); ix <= Math.ceil(x1 / CELL); ix += 1) {
    for (let iy = Math.floor(y0 / CELL); iy <= Math.ceil(y1 / CELL); iy += 1) {
      const seed = hashSeed(ix, iy)
      const tier = seed % 8
      if (tier === 0) continue // пусто: луг не вымазан точками сплошь
      const wx = ix * CELL + (seed % 17) / 17 * CELL * 0.7
      const wy = iy * CELL + ((seed >> 5) % 13) / 13 * CELL * 0.7
      // ярусы в тех же пропорциях, что в объёме: дерево редкое, трава густая
      const kind = tier === 1 ? 'tree' : tier <= 3 ? 'bush' : 'grass'
      const clear = kind === 'tree' ? CLEAR_TREE : kind === 'bush' ? CLEAR_BUSH : CLEAR_TUFT
      if (opts.path && !clearOfPath(opts.path, wx, wy, clear)) continue
      const [sx, sy] = px(wx, wy)
      const r = Math.max(1.5, k * (kind === 'tree' ? 1.9 : kind === 'bush' ? 0.6 : 0.18))
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
      if (kind === 'tree') {
        ctx.strokeStyle = pal.markStem
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }

  const line = (xs: number[], ys: number[], color: string) => {
    if (xs.length < 2) return
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath()
    xs.forEach((x, i) => {
      const [sx, sy] = px(x, ys[i])
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    })
    ctx.stroke()
  }
  line(opts.trail.tx, opts.trail.ty, pal.runnerTrail)
  // цвет пилота приходит шестью цифрами, две последние дописываем напролом:
  // так трасса догоняющего получает нужную дневную или ночную прозрачность
  line(opts.trail.mx, opts.trail.my, opts.color + pal.seekTrailAlpha)

  // Шустрик — кружок с «косичкой»: хвостик показывает, куда он повернул
  const [rx, ry] = px(fr.runner[0], fr.runner[1])
  ctx.fillStyle = pal.runner
  ctx.beginPath()
  ctx.arc(rx, ry, dot, 0, Math.PI * 2)
  ctx.fill()
  const [rvx, rvy] = px(fr.runner[0] + fr.runner_v[0] * 0.6, fr.runner[1] + fr.runner_v[1] * 0.6)
  ctx.strokeStyle = pal.runner
  ctx.lineWidth = Math.max(2, dot * 0.5)
  ctx.beginPath()
  ctx.moveTo(rx, ry)
  ctx.lineTo(rx * 2 - rvx, ry * 2 - rvy)
  ctx.stroke()

  // догоняющий — кружок пилота плюс стрелка взгляда: куда смотрит глаз, а не
  // куда летит тело. Это и есть весь урок в одной картинке
  const [mx, my] = px(fr.chaser[0], fr.chaser[1])
  ctx.fillStyle = opts.color
  ctx.beginPath()
  ctx.arc(mx, my, dot, 0, Math.PI * 2)
  ctx.fill()
  const a = Math.atan2(fr.look_el, fr.look_az)
  ctx.strokeStyle = pal.beam
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(mx, my)
  ctx.lineTo(mx + Math.cos(a) * dot * 3, my - Math.sin(a) * dot * 3)
  ctx.stroke()
}

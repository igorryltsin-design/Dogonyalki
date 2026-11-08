import { GROUPS } from './connectome'

/** Мозг для малышей: та же схема из коннектома, но пятью кружками — от глаза
 *  к крыльям. Кружок светится, когда его нейроны «говорят», по стрелкам
 *  бегут огоньки сигнала — тем чаще, чем сильнее сигнал. Выключенная группа
 *  серая, и после неё огоньки не бегут. Это и запасной вид мозга для
 *  компьютеров без 3D. Анимация — SVG (animateMotion), без JS-цикла. */

type Node = { g: number | null; x: number; y: number; icon: string; name: string }

const NODES: Node[] = [
  { g: null, x: 60, y: 150, icon: '👁', name: 'глаз' },
  { g: 0, x: 190, y: 150, icon: '🔷', name: 'колонки' },
  { g: 1, x: 330, y: 85, icon: '🎯', name: 'нейроны погони' },
  { g: 2, x: 330, y: 215, icon: '✨', name: 'детекторы мелочи' },
  { g: 3, x: 470, y: 150, icon: '🔀', name: 'выходы' },
  { g: 4, x: 600, y: 150, icon: '⬇️', name: 'команды телу' },
  { g: null, x: 720, y: 150, icon: '🪽', name: 'крылья' },
]
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 3],
  [2, 4],
  [3, 4],
  [4, 5],
  [5, 6],
]

export function BrainSchema({
  means,
  off,
  focus,
  onFocus,
}: {
  means: number[]
  off: Set<number>
  focus: number | null
  onFocus: (g: number | null) => void
}) {
  const top = Math.max(1e-6, ...means)
  // активность кружка 0…1; у глаза и крыльев — по соседям
  const act = (n: Node, k: number) => {
    if (n.g !== null) return off.has(n.g) ? 0 : Math.min(1, means[n.g] / top)
    return k === 0 ? Math.min(1, means[0] / top) : off.has(4) ? 0 : Math.min(1, means[4] / top)
  }
  // сигнал течёт, только если весь путь от глаза до этой стрелки включён
  const alive = (k: number): boolean => {
    const g = NODES[k].g
    if (g !== null && off.has(g)) return false
    if (k === 0) return true
    const parents = EDGES.filter(([, b]) => b === k).map(([a]) => a)
    return parents.some(alive)
  }
  return (
    <div className="schema">
      <svg viewBox="0 0 780 300" role="img" aria-label="Как сигнал идёт в мозге мухи: от глаза к крыльям">
        {EDGES.map(([a, b], i) => {
          const A = NODES[a]
          const B = NODES[b]
          const flow = alive(a) && alive(b) ? act(A, a) : 0
          const d = `M${A.x},${A.y} L${B.x},${B.y}`
          return (
            <g key={i}>
              <path d={d} className="schema__edge" style={{ opacity: 0.25 + flow * 0.6 }} />
              {flow > 0.05 &&
                [0, 0.33, 0.66].map((delay) => (
                  <circle key={delay} r={5 + flow * 3} className="schema__spark" style={{ opacity: 0.3 + flow * 0.7 }}>
                    <animateMotion dur={`${1.4 - flow * 0.6}s`} begin={`${delay}s`} repeatCount="indefinite" path={d} />
                  </circle>
                ))}
            </g>
          )
        })}
        {NODES.map((n, k) => {
          const a = act(n, k)
          const isOff = n.g !== null && off.has(n.g)
          const col = n.g !== null ? GROUPS[n.g].color : [0.9, 0.9, 0.9]
          const rgb = `rgb(${col.map((v) => Math.round(v * 255)).join(',')})`
          const dim = focus !== null && n.g !== focus
          return (
            <g
              key={k}
              className="schema__node"
              style={{ opacity: dim ? 0.35 : 1 }}
              onPointerEnter={() => n.g !== null && onFocus(n.g)}
              onPointerLeave={() => onFocus(null)}
            >
              <circle cx={n.x} cy={n.y} r={40 + a * 8} fill={isOff ? '#4a4f55' : rgb} opacity={isOff ? 0.5 : 0.25 + a * 0.75} />
              <circle cx={n.x} cy={n.y} r={36} fill="none" stroke={isOff ? '#777' : rgb} strokeWidth={3} />
              <text x={n.x} y={n.y + 9} textAnchor="middle" fontSize={28}>
                {isOff ? '💤' : n.icon}
              </text>
              <text x={n.x} y={n.y + 64} textAnchor="middle" className="schema__label">
                {n.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

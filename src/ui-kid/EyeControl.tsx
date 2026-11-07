import type { EyeConfig } from '../types'

/** Единая ручка глаза для всей игры: переключатель решётки + помехи.
 *  Живёт в шапке и виден на всех трёх экранах — поворачиваешь глаз,
 *  и картинка, и игра меняются сразу. */
export function EyeControl({ eye, onChange }: { eye: EyeConfig; onChange: (next: EyeConfig) => void }) {
  const foveal: EyeConfig = { grid: 'foveal', fovDeg: 165, noisePct: eye.noisePct }
  const camera: EyeConfig = { grid: 'camera', fovDeg: 13, noisePct: eye.noisePct }
  return (
    <div className="eyebar" title="Один и тот же глаз достётся и мухе, и сети школьника">
      <div className="eyebar__seg">
        <button
          type="button"
          className={eye.grid === 'foveal' ? 'is-on' : ''}
          onClick={() => onChange(foveal)}
        >
          глаз-сеточка
        </button>
        <button type="button" className={eye.grid === 'camera' ? 'is-on' : ''} onClick={() => onChange(camera)}>
          камера {camera.fovDeg}°
        </button>
      </div>
      <label>
        помехи в глазу
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.05}
          value={eye.noisePct}
          onChange={(e) => onChange({ ...eye, noisePct: Number(e.target.value) })}
        />
        <b>{Math.round(eye.noisePct * 100)}%</b>
      </label>
    </div>
  )
}

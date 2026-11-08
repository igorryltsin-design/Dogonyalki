import type { EyeConfig } from '../types'
import { useKid } from '../app/settings'

/** Ручка глаза для всей игры: чей глаз (мухи или телефона) и какая погода.
 *  Погода — это помехи в глазу, только понятнее: дождик и ливень правда
 *  идут на арене, а в глазу — шумят клеточки. Один глаз и одна погода — и
 *  для мухи, и для нейросетей: сравнение честное. */

export const WEATHER = [
  { noise: 0, icon: '☀️', name: 'ясно' },
  { noise: 0.3, icon: '🌦', name: 'дождик' },
  { noise: 0.6, icon: '🌧', name: 'ливень' },
] as const

export function weatherOf(noise: number) {
  return WEATHER.reduce((a, b) => (Math.abs(b.noise - noise) < Math.abs(a.noise - noise) ? b : a))
}

/** locked — надпись вместо ручек (в «Опытах» и «Командах» глаз и погода
 *  свои). Ручки при этом остаются на месте, только невидимы и не нажимаются:
 *  блок не меняет размер, и шапка не прыгает при переходе между вкладками. */
export function EyeControl({ eye, onChange, locked }: { eye: EyeConfig; onChange: (next: EyeConfig) => void; locked?: string }) {
  const kid = useKid()
  const foveal: EyeConfig = { grid: 'foveal', fovDeg: 165, noisePct: eye.noisePct }
  const camera: EyeConfig = { grid: 'camera', fovDeg: 13, noisePct: eye.noisePct }
  return (
    <div
      className={locked ? 'eyebar eyebar--locked' : 'eyebar'}
      data-guide={locked ? undefined : 'eye-control'}
      title={locked ? undefined : 'Один глаз и одна погода — и для мухи, и для нейросетей'}
    >
      {locked && (
        <div className="eyebar__lock" role="note">
          🔒 {locked}
        </div>
      )}
      {/* невидимые (visibility: hidden) ручки не нажимаются и не берут фокус */}
      <div className="eyebar__body" aria-hidden={locked ? true : undefined}>
      <div className="eyebar__seg" role="group" aria-label="чей глаз">
        <button type="button" className={eye.grid === 'foveal' ? 'is-on' : ''} onClick={() => onChange(foveal)}>
          🪰 глаз мухи{kid ? '' : <span className="eyebar__deg"> 165°</span>}
        </button>
        <button type="button" className={eye.grid === 'camera' ? 'is-on' : ''} onClick={() => onChange(camera)}>
          📱 глаз телефона{kid ? '' : <span className="eyebar__deg"> 13°</span>}
        </button>
      </div>
      <div className="eyebar__seg eyebar__weather" role="group" aria-label="погода">
        {WEATHER.map((w) => (
          <button
            key={w.name}
            type="button"
            className={Math.abs(eye.noisePct - w.noise) < 0.01 ? 'is-on' : ''}
            onClick={() => onChange({ ...eye, noisePct: w.noise })}
            title={kid ? w.name : `${w.name}: помехи ${Math.round(w.noise * 100)}%`}
          >
            <span aria-hidden>{w.icon}</span>
            <span className="eyebar__wname">{w.name}</span>
          </button>
        ))}
      </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { EYE_FLY, type EyeConfig } from './types'
import { EyeControl } from './ui-kid/EyeControl'
import { ArenaScreen } from './screens/ArenaScreen'
import { EyeScreen } from './screens/EyeScreen'
import { BrainScreen } from './screens/BrainScreen'
import { BoardScreen } from './screens/BoardScreen'

/** Оболочка игры: четыре больших экрана + одна ручка глаза в шапке.
 *  Стейт глаза живёт здесь — переключатель виден на всех экранах сразу,
 *  и мухе, и сети школьника достаётся ровно тот же глаз. */

type Screen = 'arena' | 'eye' | 'brain' | 'board'

const TABS: { key: Screen; name: string }[] = [
  { key: 'arena', name: 'Арена' },
  { key: 'eye', name: 'Глаз' },
  { key: 'brain', name: 'Мозг' },
  { key: 'board', name: 'Доска' },
]

export function GameApp() {
  const [screen, setScreen] = useState<Screen>('arena')
  const [eye, setEye] = useState<EyeConfig>(EYE_FLY)
  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__title">Догонялки</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={screen === t.key ? 'is-on' : ''} onClick={() => setScreen(t.key)}>
              {t.name}
            </button>
          ))}
        </nav>
        <EyeControl eye={eye} onChange={setEye} />
      </header>
      {screen === 'arena' && <ArenaScreen eye={eye} />}
      {screen === 'eye' && <EyeScreen eye={eye} />}
      {screen === 'brain' && <BrainScreen eye={eye} />}
      {screen === 'board' && <BoardScreen eye={eye} />}
      <footer className="footer">
        Учебная игра по материалам курса NNTrack · модель мозга мухи — FlyWire (CC BY-NC-SA 4.0) · без сервера и интернета
      </footer>
    </div>
  )
}

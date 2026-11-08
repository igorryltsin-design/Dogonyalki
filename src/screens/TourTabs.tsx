import { useState } from 'react'
import type { EyeConfig } from '../types'
import { FightersScreen } from './FightersScreen'
import { TournamentScreen } from './TournamentScreen'

/** «Турнир»: сам турнир и «Бойцы» — кто в нём участвует и как устроен. */
export function TourTabs({ eye, initial = 'tour' }: { eye: EyeConfig; initial?: 'tour' | 'who' }) {
  const [part, setPart] = useState<'tour' | 'who'>(initial)
  return (
    <>
      <div className="subtabs">
        <button type="button" className={part === 'tour' ? 'is-on' : ''} onClick={() => setPart('tour')}>
          🏆 Турнир
        </button>
        <button type="button" className={part === 'who' ? 'is-on' : ''} onClick={() => setPart('who')}>
          🤖 Бойцы
        </button>
      </div>
      {part === 'tour' ? <TournamentScreen eye={eye} /> : <FightersScreen />}
    </>
  )
}

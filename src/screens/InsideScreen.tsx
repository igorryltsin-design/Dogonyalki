import { useState } from 'react'
import type { EyeConfig } from '../types'
import { EyeScreen } from './EyeScreen'
import { BrainScreen } from './BrainScreen'
import { LearnScreen } from './LearnScreen'

export type InsidePart = 'eye' | 'brain' | 'learn'

/** «Внутри мухи»: глаз, мозг и учёба — одна вкладка с тремя половинками.
 *  Детям проще: снаружи — игра, внутри — как она устроена и как учится. */
export function InsideScreen({ eye, initial = 'eye' }: { eye: EyeConfig; initial?: InsidePart }) {
  const [part, setPart] = useState<InsidePart>(initial)
  return (
    <>
      <div className="subtabs">
        <button type="button" className={part === 'eye' ? 'is-on' : ''} onClick={() => setPart('eye')}>
          👁 Что видит глаз
        </button>
        <button type="button" className={part === 'brain' ? 'is-on' : ''} onClick={() => setPart('brain')}>
          🧠 Как думает мозг
        </button>
        <button type="button" className={part === 'learn' ? 'is-on' : ''} onClick={() => setPart('learn')}>
          🏋️ Учёба
        </button>
      </div>
      {part === 'eye' && <EyeScreen eye={eye} />}
      {part === 'brain' && <BrainScreen eye={eye} onLearn={() => setPart('learn')} />}
      {part === 'learn' && <LearnScreen eye={eye} />}
    </>
  )
}

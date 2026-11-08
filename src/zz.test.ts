import { it } from 'vitest'
import { runTournament } from './tournament'
import { precomputed } from './precomputed'
import { EYE_FLY } from './types'
it('d', async () => {
  const a = await runTournament(EYE_FLY)
  const p = precomputed().tournaments['foveal:165:0']
  for (let i = 0; i < a.rows.length; i += 1) console.log('CMP', a.rows[i].key, JSON.stringify([a.rows[i].catches, a.rows[i].noise, a.rows[i].transfer]), JSON.stringify([p.rows[i].catches, p.rows[i].noise, p.rows[i].transfer]))
  console.log('CMP cards', a.cards, p.cards, 'date', p.date)
}, 300000)

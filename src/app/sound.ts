import { currentSettings } from './settings'

/** Звуки игры синтезируются прямо в браузере (Web Audio): ни одного файла,
 *  игра остаётся одним файлом. Короткие, мягкие, без резких частот — их
 *  слышит весь класс. Выключаются кнопкой в шапке. */

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (!currentSettings().sound) return null
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.18, slideTo?: number) {
  const a = audio()
  if (!a) return
  const t = a.currentTime + at
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

export type Sfx = 'start' | 'catch' | 'miss' | 'star' | 'click'

export function play(s: Sfx) {
  switch (s) {
    case 'start':
      tone(440, 0, 0.12, 'triangle')
      tone(660, 0.12, 0.16, 'triangle')
      break
    case 'catch':
      // весёлое «та-да-дам» вверх
      ;[523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.2))
      break
    case 'miss':
      tone(392, 0, 0.35, 'sine', 0.14, 220)
      break
    case 'star':
      ;[880, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.3, 'sine', 0.16))
      break
    case 'click':
      tone(700, 0, 0.05, 'square', 0.04)
      break
  }
}

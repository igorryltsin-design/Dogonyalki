import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Настройки игры, общие для всех экранов: режим (малыши видят крупно и
 *  просто, учитель — все цифры и графики), звук и «проектор» (всё крупнее
 *  для большого экрана в классе). Хранятся в браузере, переживают
 *  перезагрузку; «Новый класс» их не трогает. */

export type Mode = 'kid' | 'teacher'
export type Settings = { mode: Mode; sound: boolean; projector: boolean }

const KEY = 'dogonjalki-settings-v1'
const DEFAULTS: Settings = { mode: 'kid', sound: true, projector: false }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

type Ctx = Settings & { set: (patch: Partial<Settings>) => void }
const SettingsCtx = createContext<Ctx>({ ...DEFAULTS, set: () => {} })

/** звук читают и не-React модули (sound.ts) — держим копию снаружи */
let CURRENT: Settings = DEFAULTS
export const currentSettings = () => CURRENT

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(load)
  CURRENT = s
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* приватный режим */
    }
    document.documentElement.classList.toggle('is-projector', s.projector)
    document.documentElement.classList.toggle('is-kid', s.mode === 'kid')
  }, [s])
  return <SettingsCtx.Provider value={{ ...s, set: (p) => setS((old) => ({ ...old, ...p })) }}>{children}</SettingsCtx.Provider>
}

export const useSettings = () => useContext(SettingsCtx)
export const useKid = () => useContext(SettingsCtx).mode === 'kid'

/** «Новый класс»: стираем всё, что накопил прошлый урок, — обученную муху,
 *  сети, карточки, звёзды, нарисованные пути, рекорды. Настройки остаются. */
export function resetClass() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith('dogonjalki') && k !== KEY) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* приватный режим: стирать нечего */
  }
  location.reload()
}

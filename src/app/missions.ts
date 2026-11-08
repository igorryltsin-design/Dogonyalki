import { useEffect, useState } from 'react'
import { play } from './sound'

/** Задания со звёздами — это и есть урок, только в виде игры: каждое ведёт
 *  к одной мысли. Экраны сообщают о сделанном (complete), шапка показывает
 *  звёзды, а выполненное задание вспыхивает поздравлением. Хранится в
 *  браузере; «Новый класс» стирает. */

export type MissionId = 'catch' | 'phone' | 'rain' | 'trick' | 'befly' | 'knockout' | 'podium' | 'predict' | 'lab' | 'teams' | 'fix' | 'teach'

export const MISSIONS: { id: MissionId; icon: string; title: string; why: string }[] = [
  { id: 'catch', icon: '🪰', title: 'Догони Шустрика мухой', why: 'Огонёк видит Шустрика глазом и летит следом.' },
  { id: 'phone', icon: '📱', title: 'Включи глаз телефона и попробуй', why: 'Узкий глаз то и дело теряет Шустрика.' },
  { id: 'rain', icon: '🌧', title: 'Включи дождь и посмотри, кто справится', why: 'Дождь мешает глазу. Кому меньше?' },
  { id: 'trick', icon: '✏️', title: 'Нарисуй путь, на котором муха не догонит', why: 'Даже у мухи есть слабые места.' },
  { id: 'befly', icon: '🎮', title: 'Побудь мухой и догони сам', why: 'Видишь только то, что видит муха. Трудно?' },
  { id: 'knockout', icon: '🧠', title: 'Выключи нейроны погони в мозге', why: 'Так учёные узнают, зачем нужна каждая часть мозга.' },
  { id: 'podium', icon: '🏆', title: 'Посмотри, кто победил в турнире', why: 'Муха против трёх роботов-нейросетей.' },
  { id: 'lab', icon: '🧪', title: 'Проведи опыт в лаборатории', why: 'Два опыта: контрольный (ничего не меняем) и с одной переменой — и сравни их.' },
  { id: 'predict', icon: '🔮', title: 'Спрогнозируй исход вместе с классом', why: 'Сначала сказали, чего ждём. Потом посмотрели, вышло или нет.' },
  { id: 'teams', icon: '🤝', title: 'Соберите таблицу команд', why: 'Пути команд запускаются по очереди: чей хитрее?' },
  { id: 'fix', icon: '🔧', title: 'Почини заболевшую муху', why: 'Проверяй догадки по одной — как настоящие учёные.' },
  { id: 'teach', icon: '🎓', title: 'Научи робота на своих карточках', why: 'Роботу нужны примеры. А если их мало?' },
]

const KEY = 'dogonjalki-stars-v1'
const EVT = 'dogonjalki-star'

function load(): Set<MissionId> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as MissionId[])
  } catch {
    return new Set()
  }
}

export function complete(id: MissionId) {
  const s = load()
  if (s.has(id)) return
  s.add(id)
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]))
  } catch {
    /* приватный режим: звезда только на этот раз */
  }
  play('star')
  window.dispatchEvent(new CustomEvent(EVT, { detail: id }))
}

/** звёзды и последнее выполненное задание (для поздравления) */
export function useStars(): { done: Set<MissionId>; fresh: MissionId | null; dismiss: () => void } {
  const [done, setDone] = useState(load)
  const [fresh, setFresh] = useState<MissionId | null>(null)
  useEffect(() => {
    const on = (e: Event) => {
      setDone(load())
      setFresh((e as CustomEvent<MissionId>).detail)
    }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])
  return { done, fresh, dismiss: () => setFresh(null) }
}

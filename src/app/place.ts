import type { Tab } from '../ui-kid/Lesson'
import type { Spot } from '../ui-kid/guide'

/** Адрес в игре: вкладка, подвкладка и кнопка, которую подсветить. */
export type Place = { tab: Tab; sub?: string; spot?: Spot }

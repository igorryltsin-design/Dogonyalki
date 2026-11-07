/** Карточки «кадр глаза → куда смотреть». Датасет производит сама игра:
 *  погон ведёт догоняющий с эталонным глазом-декодером (тем же, что у мухи),
 *  поэтому карточки — настоящие кадры погони, где цель у центра и дистанция
 *  тает: сеть учится ровно на том распределении кадров, что увидит в бою.
 *  Метка — истинный пеленг цели (его сеть и читает по картинке; упреждение
 *  добавляет пилот по истории взгляда, а не сеть).
 *
 *  Учебная и проверочная выборки разделены ПО ЭПИЗОДАМ, не по кадрам:
 *  кадры одного погоня сильно похожи, и проверка по «соседнему кадру» была
 *  бы нечестной. Сменил глаз — карточки устарили (в ключе fingerprint глаза),
 *  сеть обязана пересобрать датасет и переучиться. */

import { localRun } from './localSim'
import { decodeImage } from './eye'
import { chaseVariant } from './scenarios'
import { CARD_VERSION, eyeFingerprint, type CardRec, type ChaseScenario, type EyeConfig } from './types'
import { yieldToUi } from './yield'

export type CardDataset = {
  fingerprint: string
  train: CardRec[]
  test: CardRec[]
}

/** С одного погоня берём каждый samplingStep-й кадр, не более maxPerEpisode;
 *  кадр годится, только если цель в поле глаза. */
export function episodeCards(sc: ChaseScenario, samplingStep = 6, maxPerEpisode = 60): CardRec[] {
  const out: CardRec[] = []
  let i = 0
  const eye = sc.eye
  const predict = (img: number[][]) => {
    const d = decodeImage(img, eye)
    return { az: d.az, el: d.el }
  }
  for (const fr of localRun(sc, { pilot: 'kid', predict, kidLead: 0.3, kidGain: 1.4 })) {
    if (i % samplingStep === 0 && fr.in_fov) {
      out.push({
        img: fr.image.map((row) => row.map((v) => Math.round(v * 1000) / 1000)),
        az: fr.truth_az,
        el: fr.truth_el,
        episode: sc.seed,
        seed: sc.seed,
      })
      if (out.length >= maxPerEpisode) break
    }
    i += 1
  }
  return out
}

/** Собрать датасет под глаз: несколько погонь, деление 4:1 по эпизодам. */
export async function collectCards(
  eye: EyeConfig,
  episodes = 24,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): Promise<CardDataset> {
  const train: CardRec[] = []
  const test: CardRec[] = []
  for (let ep = 0; ep < episodes; ep += 1) {
    if (shouldStop?.()) break
    const sc = chaseVariant(ep, eye)
    const cards = episodeCards(sc)
    // каждый пятый эпизод — в проверку; пересечения эпизодов нет по построению
    if (ep % 5 === 4) test.push(...cards)
    else train.push(...cards)
    onProgress?.(ep + 1, episodes)
    await yieldToUi()
  }
  return { fingerprint: eyeFingerprint(eye), train, test }
}

const storageKey = (fp: string) => `${CARD_VERSION}:${fp}`

export function saveCards(ds: CardDataset) {
  try {
    localStorage.setItem(storageKey(ds.fingerprint), JSON.stringify(ds))
  } catch {
    /* приватный режим — датасет живёт до перезагрузки страницы */
  }
}

export function loadCards(eye: EyeConfig): CardDataset | null {
  try {
    const raw = localStorage.getItem(storageKey(eyeFingerprint(eye)))
    if (!raw) return null
    const ds = JSON.parse(raw) as CardDataset
    return ds.fingerprint === eyeFingerprint(eye) ? ds : null
  } catch {
    return null
  }
}

/** Скачивание датасета учителю: один JSON с обеими выборками и глазами. */
export function cardsToJson(ds: CardDataset): string {
  return JSON.stringify({ version: CARD_VERSION, fingerprint: ds.fingerprint, train: ds.train, test: ds.test })
}

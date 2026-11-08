import { useEffect, useState } from 'react'
import { useKid } from '../app/settings'
import { useFlyTraining } from '../app/flyTraining'
import { collectCards, loadCards, saveCards, cardsToJson, type CardDataset } from '../cards'
import { gazeErrorDeg, loadNet } from '../kidBrain'
import { flyIsInnate } from '../trainLocal'
import { eyeFingerprint, type EyeConfig } from '../types'
import { FlyTrainingPanel } from '../ui-kid/FlyTrainingPanel'
import { NetTrainingPanel } from '../ui-kid/NetTrainingPanel'
import { CardThumb } from './EyeScreen'
import { TeachRobot } from './ExperimentsScreen'
import { ExamplesCurveCard } from './TournamentScreen'

/** «Учёба»: всё обучение в одном месте и рядом — это и есть главная мысль
 *  стенда. Огонёк учится пробами, без единой подсказки; нейросеть — по
 *  карточкам «кадр → правильный ответ». Раньше тренировка мухи пряталась под
 *  мозгом, а обучение сети — внизу экрана глаза, и найти их было трудно. */
const NET_PARTS: { key: 'teach' | 'net' | 'curve'; label: string }[] = [
  { key: 'teach', label: '🎓 Научи сам' },
  { key: 'net', label: '📉 Подробно' },
  { key: 'curve', label: '📈 Сколько подсказок' },
]

export function LearnScreen({ eye }: { eye: EyeConfig }) {
  const kid = useKid()
  const [part, setPart] = useState<'teach' | 'net' | 'curve'>('teach')
  const [dataset, setDataset] = useState<CardDataset | null>(() => loadCards(eye))
  const [collecting, setCollecting] = useState(false)
  const [collectP, setCollectP] = useState(0)
  const [net, setNet] = useState(() => loadNet())
  const flyJob = useFlyTraining()
  const [flyInnate, setFlyInnate] = useState(() => flyIsInnate())
  useEffect(() => {
    if (!flyJob.running) setFlyInnate(flyIsInnate())
  }, [flyJob.running])
  // сменился глаз — карточки другого глаза не годятся
  useEffect(() => {
    setDataset(loadCards(eye))
  }, [eye])

  async function doCollect() {
    setCollecting(true)
    const ds = await collectCards(eye, 24, (d, t) => setCollectP(d / t))
    saveCards(ds)
    setDataset(ds)
    setCollecting(false)
  }

  function downloadCards() {
    if (!dataset) return
    const blob = new Blob([cardsToJson(dataset)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'dogonjalki-cards.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const netErr = net?.trained && dataset ? gazeErrorDeg(net, dataset.test, eye) : null
  const netStale = Boolean(net?.trained && net.fingerprint !== eyeFingerprint(eye))

  return (
    <div className="page">
      {/* две колонки — два способа учиться, рядом, чтобы сравнивать глазами */}
      <div className="learn__cols">
        <div className="learn__col">
          <section className="card learn__head">
            <h2>🪰 Огонёк — пробами</h2>
            <p className="hint">
              {kid
                ? 'Никто не говорит ему правильный ответ. Он сам пробует чуть другой руль и оставляет, если стал ловить лучше.'
                : 'Связи мозга готовы от рождения (карта FlyWire). Муха подбирает 4 числа руля: пробует изменение на шести погонях и оставляет, если ловит лучше. Карточек с ответами — ноль.'}{' '}
              Сейчас: <b>{flyInnate ? 'врождённый, ещё не тренирован' : 'тренированный'}</b>.
            </p>
          </section>
          <FlyTrainingPanel eye={eye} />
        </div>

        <div className="learn__col">
          <section className="card learn__head">
            <h2>🤖 Нейросеть — по карточкам</h2>
            <p className="hint">
              {kid
                ? 'Ей показывают картинки, и на каждой написано, где Шустрик. Так она учится отвечать сама.'
                : 'Сеть подправляет тысячи весов обратным распространением ошибки, пока её ответы на карточках «кадр глаза → где Шустрик» не совпадут с правильными.'}
            </p>
            {!kid && (
              <div className="learn__cards">
                <span className="hint">
                  Карточки: <b>{dataset ? `${dataset.train.length} учебных · ${dataset.test.length} проверочных` : 'ещё не собраны'}</b>
                  {netErr !== null && !netStale && <> · сеть на арене ошибается на <b>{netErr.toFixed(1)}°</b></>}
                </span>
                <button className="big big--ghost big--sm" disabled={collecting} onClick={doCollect}>
                  {collecting ? 'собираю…' : dataset ? 'собрать заново' : '▶ Собрать карточки'}
                </button>
                {dataset && (
                  <button className="big big--ghost big--sm" onClick={downloadCards}>
                    скачать
                  </button>
                )}
                {collecting && (
                  <div className="progress" style={{ flexBasis: '100%' }}>
                    <i style={{ width: `${Math.round(collectP * 100)}%` }} />
                  </div>
                )}
                {netStale && <span className="hint" style={{ color: 'var(--red)', flexBasis: '100%' }}>Сохранённая сеть училась под ДРУГОЙ глаз — переучите её.</span>}
              </div>
            )}
            {!kid && (
              <div className="subtabs subtabs--inline" role="tablist">
                {NET_PARTS.map((x) => (
                  <button key={x.key} type="button" role="tab" aria-selected={part === x.key} className={part === x.key ? 'is-on' : ''} onClick={() => setPart(x.key)}>
                    {x.label}
                  </button>
                ))}
              </div>
            )}
          </section>
          {(kid || part === 'teach') && (
            <div data-guide="learn-robot">
              <TeachRobot />
            </div>
          )}
          {!kid && part === 'net' && <NetTrainingPanel dataset={dataset} eye={eye} onNet={setNet} />}
          {!kid && part === 'curve' && <ExamplesCurveCard eye={eye} />}
          {!kid && part === 'teach' && dataset && (
            <details className="card">
              <summary>
                <b>Какие карточки видит сеть</b>
              </summary>
              <div className="cards-strip">
                {dataset.train.slice(0, 8).map((c, i) => (
                  <CardThumb key={i} img={c.img} eye={eye} />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { rasterEye, decodeImage } from '../eye'
import { localRun } from '../localSim'
import { collectCards, loadCards, saveCards, cardsToJson, type CardDataset } from '../cards'
import { gazeErrorDeg, initNet, loadNet, saveNet, trainOnCards } from '../kidBrain'
import { flyIsInnate, trainFly } from '../trainLocal'
import { DEFAULT_CHASE, EYE_CAMERA, EYE_FLY, eyeFingerprint, type EyeConfig, type GameFrame } from '../types'
import { SeekerView } from '../SeekerView'
import { Stat } from '../ui-kid/Stat'

/** Экран «Глаз»: два глаза смотрят на одного и того же Шустрика — мушиная
 *  решётка и обычная камера. Ниже — карточки «кадр → куда смотреть» и училка
 *  сети школьника. Главная мысль курса прячется здесь: сила мухи в ГЛАЗУ,
 *  сети достаётся ровно тот же глаз — сравнение честное. */
export function EyeScreen({ eye }: { eye: EyeConfig }) {
  const [fr, setFr] = useState<GameFrame | null>(null)
  const rafRef = useRef(0)
  const [dataset, setDataset] = useState<CardDataset | null>(() => loadCards(eye))
  const [collecting, setCollecting] = useState(false)
  const [collectP, setCollectP] = useState(0)
  const [training, setTraining] = useState(false)
  const [trainP, setTrainP] = useState('')
  const [net, setNet] = useState(() => loadNet())
  const [flyTraining, setFlyTraining] = useState(false)
  const [flyP, setFlyP] = useState('')
  const [flyInnate, setFlyInnate] = useState(() => flyIsInnate())

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])
  // сменился глаз — карточки другого глаза не годятся
  useEffect(() => {
    setDataset(loadCards(eye))
  }, [eye])

  // живой поток: один и тот же бег Шустрика кормит кадрами оба глаза
  useEffect(() => {
    let dead = false
    let gen: Generator<GameFrame> | null = null
    const tick = () => {
      if (dead) return
      if (!gen) gen = localRun({ ...DEFAULT_CHASE, eye: EYE_FLY, seed: 42 }, { pilot: 'cheater' })
      const nx = gen.next()
      if (nx.done) gen = null
      else setFr(nx.value)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      dead = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const truth = fr ? { az: fr.truth_az, el: fr.truth_el } : null
  const size = fr ? Math.min(0.35, 0.55 / Math.max(fr.range_m, 0.5)) : 0.2
  const flyImg = useMemo(
    () => (truth ? rasterEye(truth.az, truth.el, size, EYE_FLY) : null),
    [truth?.az, truth?.el, size],
  )
  const camImg = useMemo(
    () => (truth ? rasterEye(truth.az, truth.el, size, EYE_CAMERA) : null),
    [truth?.az, truth?.el, size],
  )
  const dec = truth ? decodeImage(rasterEye(truth.az, truth.el, size, eye), eye) : null

  async function doCollect() {
    setCollecting(true)
    const ds = await collectCards(eye, 24, (d, t) => setCollectP(d / t))
    saveCards(ds)
    setDataset(ds)
    setCollecting(false)
  }

  async function doTrainNet() {
    if (!dataset) return
    setTraining(true)
    const next = initNet(7, '')
    await trainOnCards(next, dataset.train, {
      eye,
      holdout: dataset.test,
      epochs: 40,
      onProgress: (p) => setTrainP(`эпоха ${p.epoch} из ${p.epochs}, ошибка проверки: ${p.holdLoss === null ? '—' : p.holdLoss.toFixed(3)}`),
    })
    saveNet(next)
    setNet(next)
    setTraining(false)
  }

  async function doTrainFly() {
    setFlyTraining(true)
    await trainFly(eye, 30, (ep, total) => setFlyP(`погоня ${ep} из ${total}`))
    setFlyInnate(flyIsInnate())
    setFlyTraining(false)
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

  const kidErr = net?.trained && dataset ? gazeErrorDeg(net, dataset.test, eye) : null
  const netStale = Boolean(net?.trained && net.fingerprint !== eyeFingerprint(eye))

  return (
    <div className="page">
      <div className="row">
        <div className="card">
          <h3>глаз-сеточка (как у мухи)</h3>
          <SeekerView img={flyImg} eye={EYE_FLY} lock={Boolean(fr)} size={220} />
          <p className="hint">густо в центре, редко по краям, поле 165° — Шустрик виден всегда</p>
        </div>
        <div className="card">
          <h3>камера (как у телефона)</h3>
          <SeekerView img={camImg} eye={EYE_CAMERA} lock={Boolean(fr)} size={220} />
          <p className="hint">ровные клеточки, но поле всего 13° — стоит отвернуться, и цель пропала</p>
        </div>
        <div className="card">
          <h3>что видит выбранный глаз</h3>
          <div className="stats" style={{ flexDirection: 'column' }}>
            <Stat label="куда смотрит (азимут), °" value={dec ? ((dec.az * 180) / Math.PI).toFixed(1) : '—'} />
            <Stat label="по захвату?" value={dec && dec.peak_rel > 0.25 ? 'да' : 'нет'} bad={!(dec && dec.peak_rel > 0.25)} />
          </div>
          <p className="hint">тот же кадр получает и муха, и сеть школьника — они в равных условиях</p>
        </div>
      </div>
      <div className="row">
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          <h3>карточки для обучения сети</h3>
          <p className="hint">
            игра сама снимает карточки «кадр глаза → куда смотреть»: {dataset ? `${dataset.train.length} учебных и ${dataset.test.length} проверочных` : 'пока нет — собери'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="big big--ghost" disabled={collecting} onClick={doCollect}>
              {collecting ? 'собираю…' : 'Собрать карточки'}
            </button>
            {dataset && (
              <button className="big big--ghost" onClick={downloadCards}>
                Скачать учителю
              </button>
            )}
          </div>
          {collecting && <div className="progress"><i style={{ width: `${Math.round(collectP * 100)}%` }} /></div>}
          <div className="cards-strip">
            {(dataset?.train.slice(0, 8) ?? []).map((c, i) => (
              <CardThumb key={i} img={c.img} eye={eye} />
            ))}
          </div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          <h3>научи сеть школьника</h3>
          <p className="hint">та же картинка, те же умножения и сложения — но без мушиного глаза внутри</p>
          <button className="big big--alt" disabled={!dataset || training} onClick={doTrainNet}>
            {training ? 'учу…' : 'Учить сеть'}
          </button>
          {training && <p className="hint">{trainP}</p>}
          {netStale && (
            <p className="hint" style={{ color: 'var(--red)' }}>
              сеть училась под ДРУГОЙ глаз — переучи под текущий
            </p>
          )}
          {kidErr !== null && !netStale && <Stat label="ошибка взгляда сети на проверке, °" value={kidErr.toFixed(1)} bad={kidErr > 5} />}
        </div>
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          <h3>натренируй Огонька</h3>
          <p className="hint">муха учится на тех же погонях, что и игра: 30 тренировок — и она ловит чаще</p>
          <button className="big" disabled={flyTraining} onClick={doTrainFly}>
            {flyTraining ? 'тренируется…' : 'Тренировать муху'}
          </button>
          {flyTraining && <p className="hint">{flyP}</p>}
          <Stat label="Огонёк сейчас" value={flyInnate ? 'врождённый (не тренирован)' : 'тренированный'} />
        </div>
      </div>
    </div>
  )
}

/** миниатюра карточки: картинка глаза + стрелка «куда надо смотреть» */
function CardThumb({ img, eye }: { img: number[][]; eye: EyeConfig }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const S = 96
    canvas.width = S
    canvas.height = S
    const n = img.length
    const cell = S / n
    for (let j = 0; j < n; j += 1)
      for (let i = 0; i < n; i += 1) {
        const g = Math.round(16 + img[j][i] * 230)
        ctx.fillStyle = `rgb(${Math.round(g * 0.32)}, ${g}, ${Math.round(g * 0.66)})`
        ctx.fillRect(i * cell, j * cell, cell - 0.5, cell - 0.5)
      }
    // метка: центр тяжести пятна → куда смотреть
    const d = decodeImage(img, eye)
    const ax = (d.az / ((Math.max(eye.fovDeg, 2) * Math.PI) / 360)) * 0.5
    const ay = -(d.el / ((Math.max(eye.fovDeg, 2) * Math.PI) / 360)) * 0.5
    ctx.strokeStyle = '#e7c15a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(S / 2, S / 2)
    ctx.lineTo(S / 2 + ax * S, S / 2 + ay * S)
    ctx.stroke()
  }, [img, eye])
  return <canvas ref={ref} width={96} height={96} />
}

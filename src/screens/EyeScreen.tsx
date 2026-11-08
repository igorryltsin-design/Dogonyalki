import { useEffect, useMemo, useRef, useState } from 'react'
import { rasterEye, decodeImage, eyeImage, eyeHalfFov } from '../eye'
import { FieldDrag } from '../ui-kid/FieldDrag'
import { useKid } from '../app/settings'
import { RobotView } from '../ui-kid/RobotView'
import { localRun } from '../localSim'
import { DEFAULT_CHASE, EYE_CAMERA, EYE_FLY, type EyeConfig, type GameFrame } from '../types'
import { SeekerView } from '../SeekerView'
import { Stat } from '../ui-kid/Stat'

/** Экран «Глаз»: два глаза смотрят на одного и того же Шустрика — мушиная
 *  решётка и обычная камера (карточки и обучение сетей — во «Учёбе»). Главная мысль курса прячется здесь: сила мухи в ГЛАЗУ,
 *  сети достаётся ровно тот же глаз — сравнение честное. */
export function EyeScreen({ eye }: { eye: EyeConfig }) {
  const [fr, setFr] = useState<GameFrame | null>(null)
  const rafRef = useRef(0)

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

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

  const kid = useKid()
  // Шустрик, которого ребёнок таскает пальцем; пока не трогали — бежит сам
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const dragTruth = drag
    ? { az: Math.atan2(drag.y, drag.x), el: Math.atan2(0.8, Math.hypot(drag.x, drag.y)), range: Math.hypot(drag.x, drag.y) }
    : null
  const truth = dragTruth ?? (fr ? { az: fr.truth_az, el: fr.truth_el } : null)
  const range = dragTruth ? dragTruth.range : fr ? fr.range_m : 10
  const size = Math.min(0.35, 0.55 / Math.max(range, 0.5))
  // кадр честный: вышел из поля глаза — пятна нет (или чуть-чуть у края)
  const view = (e: EyeConfig) => (truth ? eyeImage(truth.az, truth.el, size, Math.abs(truth.az), e) : null)
  const flyImg = useMemo(() => view(EYE_FLY), [truth?.az, truth?.el, size])
  const camImg = useMemo(() => view(EYE_CAMERA), [truth?.az, truth?.el, size])
  // до 900 px глаза стоят по два в ряд — размер от ширины экрана
  const narrow = typeof window !== 'undefined' && window.innerWidth <= 900
  // на широком мониторе и проекторе окошки растут вместе с экраном (до 320),
  // иначе на Full HD они терялись рядом с большим полем
  const wide = typeof window !== 'undefined' ? Math.floor((window.innerWidth - 700) / 4) : 220
  const eyePx = narrow
    ? Math.max(120, Math.min(260, Math.floor((window.innerWidth - 64) / 2)))
    : Math.max(kid ? 240 : 220, Math.min(320, wide))
  const seen = (e: EyeConfig) => Boolean(truth && Math.abs(truth.az) <= eyeHalfFov(e))
  const dec = truth ? decodeImage(rasterEye(truth.az, truth.el, size, eye), eye) : null

  return (
    <div className="page">
      <div className="row eye-row">
        <div className="card field-card" data-guide="eye-field">
          <h3>{kid ? 'Потаскай Шустрика пальцем 👆' : 'поле: потаскай Шустрика'}</h3>
          <FieldDrag
            pos={drag ?? { x: 12, y: 4 }}
            onMove={setDrag}
            flyHalf={eyeHalfFov(EYE_FLY)}
            camHalf={eyeHalfFov(EYE_CAMERA)}
          />
          <p className="hint">
            {drag ? 'Смотри, как меняется картинка в каждом глазу.' : 'Пока не трогаешь — Шустрик бегает сам.'}
            {drag && (
              <button type="button" className="linklike" onClick={() => setDrag(null)}>
                пусть бегает сам
              </button>
            )}
          </p>
        </div>
        <div className="card">
          <h3>🪰 {kid ? 'глаз мухи' : 'глаз-сеточка (как у мухи)'}</h3>
          <SeekerView img={flyImg} eye={EYE_FLY} lock={seen(EYE_FLY)} size={eyePx} />
          <p className={seen(EYE_FLY) ? 'hint eye-verdict is-yes' : 'hint eye-verdict is-no'}>
            {seen(EYE_FLY) ? '✅ вижу Шустрика' : '❌ не вижу'}
          </p>
          {!kid && <p className="hint">густо в центре, редко по краям, поле 165°</p>}
        </div>
        <div className="card">
          <h3>📱 {kid ? 'глаз телефона' : 'камера (как у телефона)'}</h3>
          <SeekerView img={camImg} eye={EYE_CAMERA} lock={seen(EYE_CAMERA)} size={eyePx} />
          <p className={seen(EYE_CAMERA) ? 'hint eye-verdict is-yes' : 'hint eye-verdict is-no'}>
            {seen(EYE_CAMERA) ? '✅ вижу Шустрика' : '❌ не вижу'}
          </p>
          {!kid && <p className="hint">ровные клеточки, но поле всего 13°</p>}
        </div>
        <div className="card">
          <h3>🔍 {kid ? 'что видит робот' : 'что видит робот-искатель'}</h3>
          <RobotView img={flyImg} truth={truth} size={eyePx} />
          <p className="hint">
            {kid
              ? 'Ярче — тут, думает робот, Шустрик. ✕ — куда робот смотрит, ◯ — где Шустрик на самом деле.'
              : 'Тепловая карта сети-детектора на том же кадре глаза мухи: ярче — увереннее. ✕ — центр карты (куда смотрит робот), ◯ — истинное место.'}
          </p>
        </div>
        {!kid && (
        <div className="card">
          <h3>что видит выбранный глаз</h3>
          <div className="stats" style={{ flexDirection: 'column' }}>
            <Stat label="куда смотрит (азимут), °" value={dec ? ((dec.az * 180) / Math.PI).toFixed(1) : '—'} />
            <Stat label="по захвату?" value={dec && dec.peak_rel > 0.25 ? 'да' : 'нет'} bad={!(dec && dec.peak_rel > 0.25)} />
          </div>
          <p className="hint">тот же кадр получает и муха, и полносвязная сеть — они в равных условиях</p>
        </div>
        )}
      </div>
    </div>
  )
}

/** миниатюра карточки: картинка глаза + стрелка «куда надо смотреть» */
export function CardThumb({ img, eye }: { img: number[][]; eye: EyeConfig }) {
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

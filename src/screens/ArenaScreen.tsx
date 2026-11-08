import { useEffect, useRef, useState } from 'react'
import { localRun } from '../localSim'
import { runContest } from '../board'
import { DEFAULT_CHASE, type ChaseScenario, type EyeConfig, type GameFrame, type Pilot } from '../types'
import { MANEUVER_NAME, arenaVariant, nextArenaVariant } from '../scenarios'
import { cnnPredict, detPredict, loadCnn, loadDet } from '../rivals'
import { pretrainedNets } from '../precomputed'
import { eyeHalfFov } from '../eye'
import { pathScenario } from '../drawPath'
import { setCustomPath } from '../field'
import { PathDrawer } from '../ui-kid/PathDrawer'
import { BeFlyScreen } from './BeFlyScreen'
import { useKid } from '../app/settings'
import { play } from '../app/sound'
import { complete } from '../app/missions'
import {
  judgeOne,
  judgeRace,
  judgeSeries,
  loadPolls,
  makePoll,
  pollStats,
  savePoll,
  scoreVotes,
  type Poll,
} from '../app/predict'
import { PollCard, type PollResult } from '../ui-kid/PollCard'
import { loadNet, predictAzEl } from '../kidBrain'
import { SeekerView } from '../SeekerView'
import { Stat } from '../ui-kid/Stat'
import { Arena3D } from '../Arena3D'
import { drawPursuit, emptyTrail, stepTrail, type Trail } from '../topdown'

/** Экран «Арена»: погоня Огонька за Шустриком. Два вида одного и того же
 *  погоня — объём (три модели, камера летит за парой) и сверху (плоская
 *  схема: оба бегут вправо, вертикаль экрана = вбок). Вид переключается
 *  кнопкой и запоминается; движку всё равно, его кадры только показывают.
 *  «▶ Пуск» — одна погоня вживую, «▶ 10 погонь» — честная серия из десяти
 *  одинаковых погонь (те же сценарии, что на доске).
 *
 *  Кнопка «ночь» меняет только показ: звёзды, луна и светящиеся трассы в
 *  объёме, тёмный луг с теми же приметами — в плоском виде. Движок про ночь
 *  не знает и знать не должен. */

/** Боец арены. Муха и читер — свои пилоты движка; три нейросети рулят
 *  одним и тем же «детским» пилотом, отличаются только тем, как читают кадр. */
type Fighter = 'fly' | 'kid' | 'cnn' | 'det' | 'cheater'
const FIGHTERS: Fighter[] = ['fly', 'kid', 'cnn', 'det', 'cheater']
const CAP: Record<Fighter, string> = {
  fly: 'Огонёк (муха)',
  kid: 'Полносвязная сеть',
  cnn: 'Свёрточная сеть',
  det: 'Сеть-детектор',
  cheater: 'Честный читер',
}
/** короткие имена — для плашки итога гонки */
const SHORT: Record<Fighter, string> = { fly: 'Огонёк', kid: 'Полносвязная', cnn: 'Свёрточная', det: 'Детектор', cheater: 'Читер' }
const COLOR: Record<Fighter, string> = { fly: '#2e9e5b', kid: '#2f6fd0', cnn: '#e0662a', det: '#a03fb0', cheater: '#b8860b' }
const hex = (c: string) => parseInt(c.slice(1), 16)
const enginePilot = (f: Fighter): Pilot => (f === 'fly' ? 'fly' : f === 'cheater' ? 'cheater' : 'kid')

type RaceEnd = { who: Fighter; hit: boolean; t: number }

/** Открытое голосование класса: о чём спросили, чем это закончится и какой
 *  именно погоню мы обещали (её зерно выбирается до голосования, чтобы класс
 *  прогнозировал ровно тот пуск, который потом и случится). */
type Ask = { poll: Poll; kind: 'one' | 'ten' | 'race'; sc: ChaseScenario | null }

/** есть ли смысл соваться в 3D: без WebGL браузер дал бы чёрный прямоугольник */
function webglWorks(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export function ArenaScreen({
  eye,
  pendingPath = null,
  onPathTaken,
}: {
  eye: EyeConfig
  /** путь из вкладки «Команды»: арена принимает его как свой собственный и
   *  сразу расчищает тропинку в лесу */
  pendingPath?: number[][] | null
  onPathTaken?: () => void
}) {
  const [pilot, setPilot] = useState<Fighter>('fly')
  const [rival, setRival] = useState<Fighter | null>(null)
  const [race, setRace] = useState<RaceEnd[] | null>(null)
  /** нарисованный путь Шустрика; null — обычные погони */
  const [drawn, setDrawn] = useState<number[][] | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [beFly, setBeFly] = useState(false)
  const kid = useKid()
  /** «Предскажи и проверь»: вопрос классу, поднятые руки, итог проверки */
  const [ask, setAsk] = useState<Ask | null>(null)
  const [votes, setVotes] = useState<number[]>([])
  const [checked, setChecked] = useState<PollResult | null>(null)
  const askRef = useRef<Ask | null>(null)
  const votesRef = useRef<number[]>([])
  /** сколько прогнозов класс дал и сколько угадал — за весь урок */
  const [tally, setTally] = useState(() => pollStats(loadPolls()))
  /** какая погоня из набора идёт сейчас (на каждый «Пуск» — новая) */
  const [arenaK, setArenaK] = useState<number | null>(null)
  const makeSc = (seed: number) => (drawn ? pathScenario(drawn, eye, seed) : { ...DEFAULT_CHASE, eye, seed })
  /** погоня для нового «Пуска»: свой путь — если нарисован, иначе новая из набора */
  function freshSc(seed: number): ChaseScenario {
    if (drawn) return pathScenario(drawn, eye, seed)
    const k = nextArenaVariant(arenaK)
    setArenaK(k)
    return arenaVariant(k, eye)
  }
  /** путь меняется — тропинку под ним расчищаем до того, как сцена перерисует лес */
  function applyPath(p: number[][] | null) {
    setCustomPath(p ? pathScenario(p, eye) : null)
    setDrawn(p)
    setRace(null)
    setSeries(null)
  }
  /** путь команды из вкладки «Команды»: арена берёт его как нарисованный */
  useEffect(() => {
    if (!pendingPath || pendingPath.length < 2) return
    applyPath(pendingPath)
    onPathTaken?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPath])
  const [runSeed, setRunSeed] = useState(1)
  const [runKey, setRunKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hud, setHud] = useState<{ t: number; range: number; err: number | null; event: string | null }>({
    t: 0,
    range: 0,
    err: null,
    event: null,
  })
  const [retina, setRetina] = useState<{ img: number[][]; lock: boolean } | null>(null)
  const [series, setSeries] = useState<{ catches: number; runs: number; meanErr: number | null } | null>(null)
  const [progress, setProgress] = useState(0)
  const [view3d, setView3d] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('dogonjalki-view') : null
    if (saved) return saved === '3d'
    return webglWorks()
  })
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth))
  const [night, setNight] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('dogonjalki-sky') === 'night'
    } catch {
      return false
    }
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const lastFrameRef = useRef<GameFrame | null>(null)
  const frameSink = useRef<((fr: GameFrame | null) => void) | null>(null)
  const ghostSink = useRef<((fr: GameFrame | null) => void) | null>(null)
  const trailRef = useRef<Trail>(emptyTrail())

  // свои сети этого браузера (обучены под этот глаз), а нет — готовые
  // роботы, заранее обученные в ясную погоду для этой же решётки глаза
  const sameGrid = (f?: string) => Boolean(f && f.split(':')[0] === eye.grid)
  const pre = pretrainedNets(eye.grid)
  const ownNet = loadNet()
  const ownCnn = loadCnn()
  const ownDet = loadDet()
  const net = ownNet?.trained && sameGrid(ownNet.fingerprint) ? ownNet : pre?.mlp ?? null
  const cnn = ownCnn?.trained && sameGrid(ownCnn.fingerprint) ? ownCnn : pre?.cnn ?? null
  const det = ownDet?.trained && sameGrid(ownDet.fingerprint) ? ownDet : pre?.det ?? null
  const ready: Record<Fighter, boolean> = {
    fly: true,
    cheater: true,
    kid: Boolean(net),
    cnn: Boolean(cnn),
    det: Boolean(det),
  }
  /** «робот» у малышей — лучшая из готовых нейросетей */
  const robot: Fighter = (['det', 'cnn', 'kid'] as Fighter[]).find((f) => ready[f]) ?? 'cheater'
  const lockedWhy: Partial<Record<Fighter, string>> = {
    kid: 'сначала научи сеть на «Глазе» или проведи турнир',
    cnn: 'появится после турнира',
    det: 'появится после турнира',
  }

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** Врезка глаза — самая важная картинка урока: решётка 16×16, где сидит
   *  Шустрик. И на телефоне, и на мониторе она лежит уголком на самой сцене,
   *  поэтому держим её компактной: 120 пикселей хватает, чтобы различить
   *  клетки, а на широком экране — 180. */
  const eyeSize = vw < 900 ? 108 : Math.round(Math.max(140, Math.min(180, vw * 0.13)))

  /** Арена растягивается вместе с окном: перерисовываем последний кадр, как
   *  только меняются размеры canvas, — иначе картинка остаётся в старых пикселях. */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => draw(lastFrameRef.current))
    ro.observe(canvas)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilot, view3d])

  /** Куда отдать кадр: в объём или на плоскую схему. Трасса нужна только
   *  плоской схеме — в объёме её ведёт сама сцена. */
  function show(fr: GameFrame | null) {
    if (view3d) {
      frameSink.current?.(fr)
    } else if (fr) {
      stepTrail(trailRef.current, fr)
      draw(fr)
    }
  }

  /** Вид сверху: вся геометрия картинки живёт в ../topdown.ts, потому что тот
   *  же самый погон показывает экран «Мозг» — две версии одной схемы разъехались
   *  бы по масштабу, и ребёнок сверял бы их между собой. */
  function draw(fr: GameFrame | null) {
    const canvas = canvasRef.current
    if (!canvas || !fr) return
    lastFrameRef.current = fr
    drawPursuit(canvas, fr, { color: COLOR[pilot], trail: trailRef.current, night, path: drawn })
  }

  /** Пока никто не бежал, показываем стойку на старте: поле не пустое. */
  useEffect(() => {
    const gen = localRun(makeSc(1), { pilot: enginePilot(pilot) })
    ghostSink.current?.(null)
    trailRef.current = emptyTrail()
    const first = gen.next()
    if (!first.done) {
      lastFrameRef.current = first.value
      show(first.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eye, pilot, view3d, drawn])

  /** чем боец читает кадр; у мухи и читера своё, у сетей — предсказатель */
  function predictFor(f: Fighter): ((img: number[][]) => { az: number; el: number }) | undefined {
    if (f === 'kid' && net) return (img) => predictAzEl(net, img, eye)
    if (f === 'cnn' && cnn) return (img) => cnnPredict(cnn, img, eye)
    if (f === 'det' && det) return (img) => detPredict(det, img, eye)
    return undefined
  }


  /* ── «Предскажи и проверь» ────────────────────────────────────────────
   * Учитель опрашивает класс поднятыми руками ДО погони, а правильный
   * ответ даёт только исход погони. Голоса считывает он же на этом экране:
   * сервера и телефонов у школьного урока нет, и игра от этого не
   * становится меньше — важна сама проверка «сказали → вышло». */

  function closePoll() {
    askRef.current = null
    votesRef.current = []
    setAsk(null)
    setVotes([])
    setChecked(null)
  }

  /** Спросить класс: вопрос собирается по текущим условиям, а погоня для
   *  «Пуска ×1» выбирается сразу — иначе проголосовали бы об одном пуске, а
   *  полетело бы совсем другое зерно. */
  function askPoll(kind: Ask['kind']) {
    cancelAnimationFrame(rafRef.current)
    const real: Ask['kind'] = kind === 'race' || (kind === 'one' && rival && view3d) ? 'race' : kind
    const poll = makePoll({
      kind: real,
      who: pilot,
      rival: rival ?? undefined,
      eye,
      drawn: Boolean(drawn),
      kid,
    })
    let sc: ChaseScenario | null = null
    if (real !== 'ten') {
      sc = freshSc(runSeed)
      setRunSeed((s) => s + 1)
    }
    const a: Ask = { poll, kind: real, sc }
    askRef.current = a
    votesRef.current = poll.options.map(() => 0)
    setAsk(a)
    setVotes(poll.options.map(() => 0))
    setChecked(null)
  }

  /** Итог: чем кончилась погоня, тем и правильным был ответ. */
  function finishPoll(rightId: string, outcome: string) {
    const a = askRef.current
    if (!a) return
    const v = votesRef.current
    const score = scoreVotes(a.poll, v, rightId)
    const all = savePoll({
      key: a.poll.key,
      q: a.poll.q,
      votes: v,
      right: rightId,
      guessed: score.guessed,
      hands: score.hands,
      eye: eye.grid,
      rain: eye.noisePct,
      at: Date.now(),
    })
    const st = pollStats(all)
    setTally(st)
    setChecked({
      rightId,
      rightLabel: a.poll.options.find((o) => o.id === rightId)?.label ?? '',
      correct: score.correct,
      hands: score.hands,
      guessed: score.guessed,
      minority: score.minority,
      outcome,
      stats: st,
    })
    askRef.current = null
    setAsk(a)
    complete('predict')
  }

  /** «Пуск» из карточки: те же руки, что посчитали, уходят в запись опыта */
  function runPoll() {
    const a = askRef.current
    if (!a) return
    votesRef.current = votes
    setAsk(null)
    if (a.kind === 'ten') void startTen(a)
    else startOne(a.sc ?? undefined)
  }

  function startOne(preSc?: ChaseScenario) {
    play('start')
    cancelAnimationFrame(rafRef.current)
    setBusy(true)
    setSeries(null)
    setProgress(0)
    setRunKey((k) => k + 1)
    trailRef.current = emptyTrail()
    // погоня либо ровно та, о которой голосовал класс, либо новая из набора
    const sc = preSc ?? freshSc(runSeed)
    if (!preSc) setRunSeed((s) => s + 1)
    setRace(null)
    setChecked(null)
    const gen = localRun(sc, { pilot: enginePilot(pilot), predict: predictFor(pilot) })
    // призрак бежит ту же погоню (тот же seed — тот же Шустрик) своим мозгом
    const opp = rival && view3d ? rival : null
    const gGen = opp ? localRun(sc, { pilot: enginePilot(opp), predict: predictFor(opp) }) : null
    let last: GameFrame | null = null
    let gLast: GameFrame | null = null
    let i = 0
    let tick = 0
    let done = false
    let gDone = !gGen
    const isEnd = (fr: GameFrame) => fr.event === 'догнал' || fr.event === 'промах'
    // скорость показа: кадр движка — 0,02 с. Учителю погоня идёт чуть быстрее
    // жизни (как раньше, 60 кадров в секунду), малышу — медленнее жизни:
    // иначе Шустрика ловят за три-четыре секунды и ребёнок ничего не успевает
    // разглядеть. Сама погоня от этого не меняется — только её показ.
    const rate = kid ? 0.65 : 1.2
    let prevT = performance.now()
    let budget = 1
    const step = () => {
      if (done && gDone) return
      const now = performance.now()
      const dtShow = Math.min(0.1, (now - prevT) / 1000)
      prevT = now
      // ровная скорость до самого конца: прежнее замедление у поимки
      // выглядело как рывок — муха вот-вот долетит, и вдруг ей что-то мешает
      budget += (dtShow * rate) / 0.02
      // на экран за один его кадр уходит только последний кадр движка: если
      // отдать сцене два кадра в одну миллисекунду, модели прыгают
      let toShow: GameFrame | null = null
      let toGhost: GameFrame | null = null
      while (budget >= 1 && !(done && gDone)) {
        budget -= 1
        tick += 1
        if (!done) {
          const nx = gen.next()
          if (nx.done) done = true
          else {
            last = nx.value
            const fr = last
            i += 1
            if (i % 4 === 0) {
              setHud({ t: fr.t, range: fr.range_m, err: fr.look_err_deg, event: fr.event })
              setRetina({ img: fr.image.map((r) => [...r]), lock: fr.lock })
              setProgress(Math.min(1, fr.t / sc.t_max))
            }
            toShow = fr
            if (isEnd(fr)) done = true
          }
        }
        if (!gDone && gGen) {
          const gx = gGen.next()
          if (gx.done) gDone = true
          else {
            gLast = gx.value
            toGhost = gLast
            if (isEnd(gLast)) gDone = true
          }
        }
      }
      if (toShow) show(toShow)
      if (toGhost) ghostSink.current?.(toGhost)
      if (done && gDone) {
        setBusy(false)
        const hit = last?.event === 'догнал' || gLast?.event === 'догнал'
        play(hit ? 'catch' : 'miss')
        if (pilot === 'fly' && last?.event === 'догнал' && !drawn) complete('catch')
        if (eye.grid === 'camera') complete('phone')
        if (eye.noisePct > 0) complete('rain')
        if (drawn && pilot === 'fly' && last && last.event !== 'догнал') complete('trick')
        let ends: RaceEnd[] | null = null
        if (opp && last && gLast) {
          ends = [
            { who: pilot, hit: last.event === 'догнал', t: last.t },
            { who: opp, hit: gLast.event === 'догнал', t: gLast.t },
          ]
          setRace(ends)
        }
        if (last) {
          setHud({ t: last.t, range: last.range_m, err: last.look_err_deg, event: last.event })
          setRetina({ img: last.image.map((r) => [...r]), lock: last.lock })
        }
        // класс ждал этого момента: чем кончилась погоня, тем и ответ был
        if (askRef.current) {
          const race = ends && ends.some((r) => r.hit)
            ? `Первым догнал ${SHORT[ends.filter((r) => r.hit).sort((a, b) => a.t - b.t)[0].who]} (${Math.min(...ends.filter((r) => r.hit).map((r) => r.t)).toFixed(1)} с)`
            : 'Никто не догнал'
          const single = last
            ? last.event === 'догнал'
              ? `Догнал за ${last.t.toFixed(1)} с`
              : `Не догнал: ${last.t.toFixed(1)} с погони, до Шустрика осталось ${last.range_m.toFixed(1)} м`
            : 'Погоня не успела начаться'
          finishPoll(
            ends ? judgeRace(ends) : judgeOne(last?.event ?? null),
            ends ? race : single,
          )
        }
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  async function startTen(asked?: Ask) {
    cancelAnimationFrame(rafRef.current)
    setBusy(true)
    setSeries(null)
    setRace(null)
    setProgress(0)
    setRunKey((k) => k + 1)
    const res = await runContest(enginePilot(pilot), eye, {
      runs: 10,
      predict: predictFor(pilot),
      scenario: drawn ? (i) => pathScenario(drawn, eye, 1000 + i * 7) : undefined,
      onRun: (d, total) => setProgress(d / total),
    })
    setSeries({ catches: res.catches, runs: res.runs, meanErr: res.meanErrDeg })
    setBusy(false)
    play(res.catches > 0 ? 'catch' : 'miss')
    if (eye.grid === 'camera') complete('phone')
    if (eye.noisePct > 0) complete('rain')
    if (asked) {
      askRef.current = asked
      finishPoll(judgeSeries(res.catches), `Из десяти погонь ${res.catches} кончились поимкой`)
    }
  }

  function flipView() {
    const next = !view3d
    setView3d(next)
    try {
      localStorage.setItem('dogonjalki-view', next ? '3d' : '2d')
    } catch {
      /* приватный режим: запоминать некуда и не надо */
    }
    // трассу ведёт только плоская схема, поэтому с видом она начинается заново
    trailRef.current = emptyTrail()
    // новый вид должен сразу показать тот же миг погони
    if (next) frameSink.current?.(lastFrameRef.current)
    else draw(lastFrameRef.current)
  }

  /** день ↔ ночь: показ, а не расчёт; выбор переживает перезапуск страницы */
  function flipSky() {
    const next = !night
    setNight(next)
    try {
      localStorage.setItem('dogonjalki-sky', next ? 'night' : 'day')
    } catch {
      /* приватный режим: запоминать некуда и не надо */
    }
  }

  // смена неба должна сразу перекрасить нарисованный кадр: в плоском виде
  // картинки на экране нет, пока не придёт следующий кадр погони
  useEffect(() => {
    if (!view3d) draw(lastFrameRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night, view3d])

  const maneuverText = drawn ? 'бежит по твоему пути' : arenaK !== null ? MANEUVER_NAME[arenaVariant(arenaK, eye).maneuver] : null
  const winner = race
    ? race.filter((r) => r.hit).sort((a, b) => a.t - b.t)[0] ?? null
    : null
  const banner = race && !busy ? (
    <div className={winner ? 'flash flash--hit flash--race' : 'flash flash--miss flash--race'}>
      <span>{winner ? `Первым догнал: ${SHORT[winner.who]}! 🏁` : 'Никто не догнал 😮'}</span>
      <small>
        {race.map((r) => `${SHORT[r.who]} — ${r.hit ? `${r.t.toFixed(1)} с` : 'не догнал'}`).join(' · ')}
      </small>
    </div>
  ) : hud.event === 'догнал' || hud.event === 'промах' ? (
      !busy ? (
        <div className={hud.event === 'догнал' ? 'flash flash--hit' : 'flash flash--miss'}>
          {hud.event === 'догнал' ? 'Догнал! 🎉' : 'Не догнал 😮'}
        </div>
      ) : null
    ) : null

  if (beFly) return <BeFlyScreen eye={eye} scenario={() => (drawn ? pathScenario(drawn, eye, runSeed) : arenaVariant(nextArenaVariant(null), eye))} onExit={() => setBeFly(false)} />

  return (
    <div className="page">
      {drawerOpen && (
        <div className="drawer-modal" role="dialog" aria-label="Нарисуй путь">
          <PathDrawer
            initial={drawn}
            onCancel={() => setDrawerOpen(false)}
            onDone={(p) => {
              applyPath(p)
              setDrawerOpen(false)
            }}
          />
        </div>
      )}
      {ask && !busy && (
        <div className="drawer-modal">
          <PollCard
            poll={ask.poll}
            kid={kid}
            votes={votes}
            result={checked}
            onVote={(i, d) => setVotes((v) => v.map((x, j) => (j === i ? Math.max(0, x + d) : x)))}
            onRun={runPoll}
            onClear={() => setVotes(ask.poll.options.map(() => 0))}
            onClose={closePoll}
          />
        </div>
      )}
      <div className="stage-wrap">
        {view3d ? (
          <Arena3D
            frameSink={frameSink}
            ghostSink={ghostSink}
            color={hex(COLOR[pilot])}
            ghostColor={rival ? hex(COLOR[rival]) : null}
            halfFov={eyeHalfFov(eye)}
            drawnPath={drawn}
            rain={eye.noisePct}
            tagRadius={DEFAULT_CHASE.tag_radius_m}
            runKey={runKey}
            night={night}
          >
            {banner}
          </Arena3D>
        ) : (
          <div className="stage">
            <canvas className={night ? 'arena arena--night' : 'arena'} ref={canvasRef} />
            {banner}
          </div>
        )}

        {kid ? (
        <div className="overlay overlay--tl kid-panel">
          <div className="kid-pick" role="group" aria-label="кто догоняет">
            <span className="chips__cap">Кто догоняет?</span>
            <button type="button" className={pilot === 'fly' ? 'is-on' : ''} disabled={busy} onClick={() => { setPilot('fly'); if (rival === 'fly') setRival(null) }}>
              <span aria-hidden>🪰</span> Огонёк
            </button>
            <button
              type="button"
              className={pilot === robot ? 'is-on' : ''}
              disabled={busy || robot === 'cheater'}
              onClick={() => { setPilot(robot); if (rival === robot) setRival(null) }}
            >
              <span aria-hidden>🤖</span> Робот
            </button>
          </div>
          <div className="hud-line kid-actions">
            <button className="big kid-go" data-guide="arena-go" disabled={busy} onClick={() => startOne()}>
              ▶ Пуск
            </button>
            <button
              className="big big--ghost big--sm"
              data-guide="arena-poll"
              disabled={busy}
              onClick={() => askPoll(rival && view3d ? 'race' : 'one')}
            >
              🔮 угадай вместе
            </button>
            {view3d && (
              <button
                className={rival ? 'big big--alt big--sm is-on' : 'big big--ghost big--sm'}
                disabled={busy || robot === 'cheater'}
                onClick={() => setRival(rival ? null : pilot === 'fly' ? robot : 'fly')}
                title="второй боец побежит за тем же Шустриком"
              >
                🏁 наперегонки
              </button>
            )}
          </div>
          <div className="hud-line mode-line">
            <button className="big big--play big--sm" data-guide="arena-draw" disabled={busy} onClick={() => setDrawerOpen(true)}>
              ✏️ {drawn ? 'другой путь' : 'нарисовать путь'}
            </button>
            {drawn && (
              <button className="big big--ghost big--sm" disabled={busy} onClick={() => applyPath(null)} title="вернуть обычные погони">
                ✕
              </button>
            )}
            <button className="big big--play2 big--sm" data-guide="arena-befly" disabled={busy} onClick={() => setBeFly(true)}>
              🎮 побудь мухой
            </button>
            <button className="big big--ghost big--sm" disabled={busy} onClick={flipSky} aria-label={night ? 'день' : 'ночь'} title={night ? 'день' : 'ночь'}>
              {night ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
        ) : (
        <div className="overlay overlay--tl arena-panel">
          <div className="chips" style={{ marginBottom: 8 }}>
            {FIGHTERS.map((p) => (
              <button
                key={p}
                type="button"
                className={pilot === p ? 'is-on fighter' : 'fighter'}
                disabled={busy || !ready[p]}
                title={!ready[p] ? lockedWhy[p] : undefined}
                onClick={() => {
                  setPilot(p)
                  if (rival === p) setRival(null)
                }}
              >
                <i className="swatch" style={{ background: COLOR[p] }} />
                <span className="lbl-full">
                  {CAP[p]}
                  {p === 'cheater' ? ' (подглядывает!)' : ''}
                </span>
                <span className="lbl-short">{SHORT[p]}</span>
              </button>
            ))}
          </div>
          {view3d && (
            <div className="chips chips--rival" style={{ marginBottom: 8 }}>
              <span className="chips__cap">
                <span className="lbl-full">соперник-</span>призрак:
              </span>
              <button type="button" className={rival === null ? 'is-on' : ''} disabled={busy} onClick={() => setRival(null)}>
                нет
              </button>
              {FIGHTERS.filter((f) => f !== pilot).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={rival === f ? 'is-on fighter' : 'fighter'}
                  disabled={busy || !ready[f]}
                  title={!ready[f] ? lockedWhy[f] : undefined}
                  onClick={() => setRival(f)}
                >
                  <i className="swatch" style={{ background: COLOR[f], opacity: 0.6 }} />
                  {SHORT[f]}
                </button>
              ))}
            </div>
          )}
          <div className="hud-line">
            <button className="big big--sm" data-guide="arena-go" disabled={busy} onClick={() => startOne()}>
              ▶ Пуск
            </button>
            <button className="big big--alt big--sm" disabled={busy} onClick={() => startTen()}>
              ▶ 10 погонь
            </button>
            <button
              className="big big--ghost big--sm"
              data-guide="arena-poll"
              disabled={busy}
              title="класс голосует поднятыми руками, потом проверяет по погоне"
              onClick={() => askPoll(rival && view3d ? 'race' : 'one')}
            >
              🔮 <span className="lbl-full">спросить класс</span>
              <span className="lbl-short">прогноз</span>
            </button>
            <button className="big big--ghost big--sm" disabled={busy} onClick={() => askPoll('ten')}>
              🔮 <span className="lbl-full">угадать серию</span>
              <span className="lbl-short">серия</span>
            </button>
            <button className="big big--ghost big--sm" disabled={busy || !webglOk} onClick={flipView}>
              <span className="lbl-full">{view3d ? 'вид сверху' : 'вид в 3D'}</span>
              <span className="lbl-short">{view3d ? 'сверху' : 'в 3D'}</span>
            </button>
            <button className="big big--ghost big--sm" disabled={busy} onClick={flipSky}>
              {night ? 'день' : 'ночь'}
            </button>
          </div>
          <div className="hud-line mode-line">
            <button className="big big--play big--sm" data-guide="arena-draw" disabled={busy} onClick={() => setDrawerOpen(true)}>
              ✏️ {drawn ? 'перерисовать путь' : 'нарисовать путь'}
            </button>
            {drawn && (
              <button className="big big--ghost big--sm" disabled={busy} onClick={() => applyPath(null)} title="вернуть обычные погони">
                ✕ <span className="lbl-full">обычные погони</span>
              </button>
            )}
            <button className="big big--play2 big--sm" data-guide="arena-befly" disabled={busy} onClick={() => setBeFly(true)}>
              🎮 побудь мухой
            </button>
          </div>
        </div>
        )}

        <div className="overlay overlay--tr eye-inset">
          <div className="cap">{kid ? 'что видит глаз' : 'глаз догоняющего'}</div>
          {retina ? (
            <SeekerView img={retina.img} eye={eye} lock={retina.lock} size={eyeSize} />
          ) : (
            <SeekerView img={null} eye={eye} size={eyeSize} />
          )}
        </div>

      </div>

      {kid ? (
        <div className="kid-hud">
          <div className="progress" style={{ margin: 0 }}>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p>
            {busy
              ? hud.range > 0
                ? `До Шустрика ${hud.range < 1 ? 'совсем чуть-чуть' : `${Math.round(hud.range)} шагов`}…`
                : 'Погнали!'
              : 'Нажми «Пуск» — догонит ли Огонёк Шустрика?'}
          </p>
          {maneuverText && <p className="kid-hud__how">🏃‍♀️ Шустрик {maneuverText}</p>}
          {tally.asked > 0 && (
            <p className="kid-hud__how">
              🔮 угадано {tally.guessed} из {tally.asked}
            </p>
          )}
        </div>
      ) : (
      <div className="hud-row">
        <div className="progress" style={{ flex: '1 1 220px', margin: 0 }}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <Stat label="секунда погони" value={hud.t.toFixed(1)} small />
        <Stat label="до Шустрика, м" value={hud.range.toFixed(1)} small />
        <Stat
          label="ошибка взгляда, °"
          value={hud.err === null ? '—' : hud.err.toFixed(2)}
          bad={hud.err !== null && hud.err > 2}
          small
        />
        <Stat
          label="итог серии"
          value={series ? `${series.catches} из ${series.runs}` : hud.event ?? '—'}
          bad={Boolean(series && series.catches < 3 && pilot !== 'cheater')}
          small
        />
        <Stat label="прогнозы класса" value={tally.asked ? `${tally.guessed} из ${tally.asked}` : '—'} small />
      </div>
      )}

      {kid ? (
        <p className="hint">Голубой веер на земле — то, что видит глаз догоняющего. Шустрик выбежал из веера — веер краснеет.</p>
      ) : (
      <p className="hint">
        {view3d
          ? 'Голубой веер на земле — поле зрения глаза: у мухи почти полкруга, у камеры узкий луч. Шустрик выбежал из веера — веер и кольцо краснеют, глазу смотреть не на что. Выберите соперника-призрака — и два мозга побегут за одним Шустриком наперегонки. Тяните картинку мышью или пальцем — камера оглядывается. «▶ 10 погонь» — десять одинаковых погонь, как в турнире.'
          : 'Вид сверху: оба бегут вправо, вверх-вниз экрана — вбок. Стрелка показывает, куда догоняющий смотрит глазом. Гонка с призраком — только в объёме. «▶ 10 погонь» — десять одинаковых погонь, как в турнире.'}
        {maneuverText ? ` Сейчас: Шустрик ${maneuverText}${arenaK !== null && !drawn ? ` (погоня №${arenaK + 1} из набора)` : ''}.` : ''}
        {' '}Каждый «▶ Пуск» — новая погоня из набора; «▶ 10 погонь» — всегда те же десять, как в турнире, чтобы цифры можно было сравнивать.
        {' '}Кнопка «ночь» меняет только картинку: луна, звёзды и светящиеся трассы — счёт остаётся тот же.
        {' '}🔮 — это «предскажи и проверь»: класс голосует поднятыми руками, учитель считает, погоня отвечает, угадали или нет.
      </p>
      )}
    </div>
  )
}

const webglOk = typeof window !== 'undefined' && webglWorks()

import { useFlyTraining } from './app/flyTraining'
import { glow } from './ui-kid/guide'
import type { Place } from './app/place'
import type { InsidePart } from './screens/InsideScreen'
import type { Part } from './screens/ExperimentsScreen'
import { useEffect, useState } from 'react'
import { EYE_FLY, type EyeConfig } from './types'
import { EyeControl } from './ui-kid/EyeControl'
import { ArenaScreen } from './screens/ArenaScreen'
import { InsideScreen } from './screens/InsideScreen'
import { ExperimentsScreen } from './screens/ExperimentsScreen'
import { TeamsScreen } from './screens/TeamsScreen'
import { Intro } from './ui-kid/Intro'
import { TeacherIntro } from './ui-kid/TeacherIntro'
import { useKid } from './app/settings'
import { TourTabs } from './screens/TourTabs'
import { SettingsProvider } from './app/settings'
import { MissionsPanel, SettingsMenu, TeacherMenu, StarToast, StarsButton } from './ui-kid/TopMenu'
import { Lesson, Worksheet, type Tab } from './ui-kid/Lesson'
import { Report } from './ui-kid/Report'
import { play } from './app/sound'

/** Оболочка игры: вкладки — играть, заглянуть внутрь мухи, турнир, опыты и
 *  команды; одна ручка глаза и погоды в шапке, звёзды заданий, меню настроек
 *  и знакомство при первом входе. Стейт глаза живёт здесь: и мухе, и
 *  нейросетям достаётся ровно тот же глаз. */

const TABS: { key: Tab; name: string; icon: string }[] = [
  { key: 'arena', name: 'Играть', icon: '🎯' },
  { key: 'inside', name: 'Внутри мухи', icon: '🔬' },
  { key: 'tour', name: 'Турнир', icon: '🏆' },
  { key: 'lab', name: 'Опыты', icon: '🧪' },
  { key: 'teams', name: 'Команды', icon: '🤝' },
]

const INTRO_KEY = 'dogonjalki-intro-seen'
const TEACHER_KEY = 'dogonjalki-teacher-intro-seen'
function introSeen() {
  try {
    return localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

/** Куда ведёт каждое задание: вкладка, подвкладка и кнопка, которую
 *  подсветить, — ребёнок сразу видит, что нажать. */
const MISSION_PLACE: Record<string, Place> = {
  catch: { tab: 'arena', spot: 'arena-go' },
  phone: { tab: 'arena', spot: 'eye-control' },
  rain: { tab: 'arena', spot: 'eye-control' },
  trick: { tab: 'arena', spot: 'arena-draw' },
  befly: { tab: 'arena', spot: 'arena-befly' },
  knockout: { tab: 'inside', sub: 'brain', spot: 'brain-ko' },
  podium: { tab: 'tour', sub: 'tour', spot: 'tour-go' },
  predict: { tab: 'arena', spot: 'arena-poll' },
  lab: { tab: 'lab', sub: 'lab', spot: 'lab-run' },
  teams: { tab: 'teams', spot: 'teams-add' },
  fix: { tab: 'lab', sub: 'fix' },
  teach: { tab: 'inside', sub: 'learn', spot: 'learn-robot' },
}

function Shell() {
  const [screen, setScreen] = useState<Tab>('arena')
  /** подвкладка, куда привёл гид, урок или задание; обычный щелчок по
   *  вкладке её сбрасывает. subN — чтобы экран открылся заново на ней. */
  const [sub, setSub] = useState<string | null>(null)
  const [subN, setSubN] = useState(0)
  const [eye, setEye] = useState<EyeConfig>(EYE_FLY)
  const [intro, setIntro] = useState(() => !introSeen())
  /** приветствие учителя — один раз, при первом включении режима учителя */
  const kid = useKid()
  const [teacherIntro, setTeacherIntro] = useState(false)
  useEffect(() => {
    if (kid) return
    try {
      if (localStorage.getItem(TEACHER_KEY) === '1') return
      localStorage.setItem(TEACHER_KEY, '1')
    } catch {
      return
    }
    setTeacherIntro(true)
  }, [kid])
  const [missions, setMissions] = useState(false)
  const [lesson, setLesson] = useState(false)
  const [sheet, setSheet] = useState(false)
  /** отчёт урока — страница в конце занятия; открывается из меню ⚙ */
  const [report, setReport] = useState(false)
  /** путь, который вкладка «Команды» передаёт арене: там его можно пробежать
   *  вживую, а не только посчитать в таблице */
  const [arenaPath, setArenaPath] = useState<number[][] | null>(null)
  /** тренировка Огонька идёт в фоне: значок в шапке ведёт к её панели */
  const training = useFlyTraining()
  const go = (t: Tab) => {
    play('click')
    setSub(null)
    setScreen(t)
  }
  /** переход «туда и подсвети»: для гида, урока по шагам и заданий */
  const goTo = (p: Place) => {
    play('click')
    setScreen(p.tab)
    setSub(p.sub ?? null)
    setSubN((n) => n + 1)
    if (p.spot) glow(p.spot)
  }
  const sendToArena = (path: number[][]) => {
    play('click')
    setArenaPath(path)
    setScreen('arena')
  }
  const closeIntro = () => {
    setIntro(false)
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch {
      /* приватный режим: покажем ещё раз — не беда */
    }
  }
  return (
    <div className="app">
      {intro && (
        <Intro
          onClose={closeIntro}
          onShow={(p) => {
            closeIntro()
            goTo(p)
          }}
          onTeacher={
            kid
              ? undefined
              : () => {
                  closeIntro()
                  setTeacherIntro(true)
                }
          }
        />
      )}
      {teacherIntro && !intro && (
        <TeacherIntro
          onClose={() => setTeacherIntro(false)}
          onShow={(p) => {
            setTeacherIntro(false)
            goTo(p)
          }}
          onLesson={() => {
            setTeacherIntro(false)
            setLesson(true)
          }}
        />
      )}
      {missions && (
        <MissionsPanel
          onClose={() => setMissions(false)}
          onGo={(id) => {
            setMissions(false)
            goTo(MISSION_PLACE[id])
          }}
        />
      )}
      {sheet && <Worksheet onClose={() => setSheet(false)} />}
      {report && <Report onClose={() => setReport(false)} />}
      <StarToast />
      <header className="topbar">
        <span className="topbar__title">Догонялки</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={screen === t.key ? 'is-on' : ''} onClick={() => go(t.key)}>
              <span className="tabs__icon" aria-hidden>{t.icon}</span> {t.name}
            </button>
          ))}
        </nav>
        <div className="topbar__tools">
          {training.running && (
            <button
              type="button"
              className="train-pill"
              title="Огонёк тренируется — нажми, чтобы посмотреть"
              onClick={() => goTo({ tab: 'inside', sub: 'learn', spot: 'learn-fly' })}
            >
              🏋️ {training.iter}/{training.total || '…'}
            </button>
          )}
          <StarsButton onOpen={() => setMissions(true)} />
          <button type="button" className="menu__btn tabs__help" data-guide="help" onClick={() => setIntro(true)} aria-label="Что здесь происходит?" title="Что здесь происходит?">
            ?
          </button>
          {/* key={screen}: смена вкладки закрывает открытое меню */}
          <TeacherMenu key={`t-${screen}`} onLesson={() => setLesson(true)} onWorksheet={() => setSheet(true)} onReport={() => setReport(true)} />
          <SettingsMenu key={`s-${screen}`} />
        </div>
        {/* в «Опытах» и «Командах» глаз и погода свои, общие для всех: ручки
            в шапке там не действуют, и ребёнок ждал бы от них перемен */}
        <EyeControl
          eye={eye}
          onChange={setEye}
          locked={screen === 'lab' ? 'Здесь ты сам выбираешь, что поменять в опыте' : screen === 'teams' ? 'Условия одинаковые для всех команд' : undefined}
        />
      </header>
      {screen === 'arena' && <ArenaScreen eye={eye} pendingPath={arenaPath} onPathTaken={() => setArenaPath(null)} />}
      {screen === 'inside' && (
        <InsideScreen key={`in-${subN}`} eye={eye} initial={(sub as InsidePart) ?? 'eye'} />
      )}
      {screen === 'tour' && <TourTabs key={`tour-${subN}`} eye={eye} initial={(sub as 'tour' | 'who') ?? 'tour'} />}
      {screen === 'lab' && <ExperimentsScreen key={`lab-${subN}`} initial={(sub as Part) ?? 'lab'} />}
      {screen === 'teams' && <TeamsScreen onSendToArena={sendToArena} />}
      {lesson && <Lesson onGo={goTo} onClose={() => setLesson(false)} />}
    </div>
  )
}

export function GameApp() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  )
}

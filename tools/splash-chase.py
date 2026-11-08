"""Генератор погони для заставки РобоТрек (design/robotrek-splash.html).

Шустрик петляет сквозь буквы «робо», Огонёк пикирует сверху и ловит его у
шестерёнки, потом садится на флажок «б». Движение задано CSS-кадрами (а не
SMIL и не offset-path), чтобы одинаково шло в Chrome и Safari. Точки пути
расставлены через равные отрезки длины, поэтому скорость постоянна и след
(stroke-dashoffset, linear) рисуется ровно за героем. Глазки букв «о» смотрят
на того, кто сейчас интереснее: на Шустрика, на место поимки, на растущую
руку, на захват — и в конце на зрителя.

Запуск: python3 tools/splash-chase.py — печатает CSS и SVG между метками
/* chase:css */ и <!-- chase:svg --> в design/robotrek-splash.html.
"""
import math, re, pathlib

FILE = pathlib.Path(__file__).resolve().parent.parent / 'design' / 'robotrek-splash.html'

def catmull(pts, n=60):
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    out.append(pts[-1])
    return out

def resample(curve, n):
    L = [0.0]
    for a, b in zip(curve, curve[1:]):
        L.append(L[-1] + math.dist(a, b))
    total = L[-1]
    res, j = [], 0
    for i in range(n + 1):
        s = total * i / n
        while j < len(L) - 2 and L[j + 1] < s:
            j += 1
        a, b = curve[j], curve[j + 1]
        u = 0 if L[j + 1] == L[j] else (s - L[j]) / (L[j + 1] - L[j])
        res.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
    return res, total

def heading(res):
    ang, prev = [], None
    for i in range(len(res)):
        a, b = res[max(0, i - 1)], res[min(len(res) - 1, i + 1)]
        d = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        if prev is not None:
            while d - prev > 180: d -= 360
            while d - prev < -180: d += 360
        ang.append(d); prev = d
    return ang

def d_attr(curve):
    return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in curve[::3] + [curve[-1]])

# --- пути (координаты рисунка 500×240) ---
CATCH = (326, 84)
S_PTS = [(-30, 66), (34, 92), (98, 196), (162, 98), (242, 198), (300, 112), CATCH]
F_PTS = [(-36, 22), (60, 40), (160, 30), (250, 44), CATCH]
PERCH_PTS = [CATCH, (296, 52), (248, 58), (212, 76), (192, 87)]
S_T0, F_T0, CATCH_T, PERCH_T = 0.6, 1.8, 3.6, 4.6
ARM = 4.4  # начало роста руки (в design/robotrek-splash.html те же числа)
N = 36

s_curve = catmull(S_PTS); s_pts, s_len = resample(s_curve, N)
f_curve = catmull(F_PTS); f_pts, f_len = resample(f_curve, N)
p_curve = catmull(PERCH_PTS); p_pts, _ = resample(p_curve, 16)
s_ang = heading(s_pts); f_ang = heading(f_pts)
p_ang = heading(p_pts)
# стыкуем угол посадочного полёта с концом погони без лишнего оборота
off = round((f_ang[-1] - p_ang[0]) / 360) * 360
p_ang = [a + off for a in p_ang]
PERCH_ANG = p_ang[-1]

def kf(name, pts, angs=None):
    rows = []
    for i, (x, y) in enumerate(pts):
        tr = f'translate({x:.1f}px, {y:.1f}px)' + (f' rotate({angs[i]:.0f}deg)' if angs else '')
        rows.append(f'    {100 * i / (len(pts) - 1):.2f}% {{ transform: {tr} }}')
    return f'  @keyframes {name} {{\n' + '\n'.join(rows) + '\n  }'

# --- куда смотрят глазки ---
EYES = [((138.5, 146), (146, 145.5)), ((278, 146), (284, 145.5))]  # центр кольца, зрачок в покое
REACH = 7.0
def lerp_path(pts, u):
    u = max(0, min(1, u)); k = u * (len(pts) - 1); i = min(int(k), len(pts) - 2); f = k - i
    return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)

def arm_tip(t):
    """кончик растущей руки и захват (с учётом взмахов плеча и локтя)"""
    if t < ARM: return (342, 112)
    if t < ARM + .4: return lerp_path([(342, 112), (257, 63)], (t - ARM) / 0.4)
    if t < ARM + .45: return (237, 52)
    if t < ARM + .8: return lerp_path([(216, 56), (116, 74)], (t - ARM - .45) / 0.35)
    g = (95.8, 82)
    if t < ARM + 1.15: return g
    u = (t - ARM - 1.15) / 1.7
    def kv(keys):
        for (a, va), (b, vb) in zip(keys, keys[1:]):
            if a <= u <= b: return va + (vb - va) * (u - a) / (b - a)
        return 0
    sh = math.radians(kv([(0, 0), (.3, 6), (.6, -1), (.82, 1), (1, 0)]))
    el = math.radians(kv([(0, 0), (.3, 9), (.6, -3), (.82, 1.5), (1, 0)]))
    def rot(p, c, a):
        x, y = p[0] - c[0], p[1] - c[1]
        return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))
    p = rot(g, (237, 52), el)
    return rot(p, (342, 112), sh)

def target(t):
    if t < 0.75: return None
    if t < S_T0 + 0.05: return (-10, 70)
    if t <= CATCH_T: return lerp_path(s_pts, (t - S_T0 + 0.08) / (CATCH_T - S_T0))
    if t < CATCH_T + .3: return CATCH
    if t < PERCH_T - .1: return lerp_path(p_pts, (t - CATCH_T - .3) / (PERCH_T - CATCH_T - .4))
    if t < ARM + 2.85: return arm_tip(t)
    return 'viewer'

LOOK_T0, LOOK_T1 = 0.7, ARM + 3.0
def look_kf(eye):
    (cx, cy), (bx, by) = eye
    rows = []
    steps = int((LOOK_T1 - LOOK_T0) / 0.1)
    for i in range(steps + 1):
        t = LOOK_T0 + i * 0.1
        tg = target(t)
        if tg is None: dx, dy = 0, 0
        elif tg == 'viewer': dx, dy = cx - bx, cy - by
        else:
            vx, vy = tg[0] - cx, tg[1] - cy; d = math.hypot(vx, vy) or 1
            k = min(REACH, d) / d
            dx, dy = cx + vx * k - bx, cy + vy * k - by
        rows.append(f'    {100 * i / steps:.1f}% {{ transform: translate({dx:.1f}px, {dy:.1f}px) }}')
    return rows

css = []
css.append('  /* погоня: сгенерировано tools/splash-chase.py — правьте там */')
css.append(f'  .chase-s {{ opacity: 0; transform-origin: 0 0; animation: s-move {CATCH_T - S_T0:.2f}s linear {S_T0}s both, show .12s {S_T0}s both, gulp .3s ease-in {CATCH_T}s forwards; }}')
css.append(f'  .chase-f {{ transform-origin: 0 0; transform: translate({p_pts[-1][0]:.1f}px, {p_pts[-1][1]:.1f}px) rotate({PERCH_ANG:.0f}deg); animation: f-move {CATCH_T - F_T0:.2f}s linear {F_T0}s backwards, f-perch {PERCH_T - CATCH_T:.2f}s ease-out {CATCH_T}s forwards; }}')
css.append(f'  .chase-f > g {{ animation: show .12s {F_T0}s both; }}')
css.append(f'  .wing {{ animation: flap .07s linear {F_T0}s {round((PERCH_T - F_T0) / 0.07) // 2 * 2} alternate; }}')
css.append('  .wing-l { transform-origin: -1px -2px } .wing-r { transform-origin: -1px 2px }')
css.append('  @keyframes flap { to { transform: scaleY(.35) } }')
css.append('  @keyframes show { from { opacity: 0 } to { opacity: 1 } }')
css.append('  @keyframes gulp { from { opacity: 1; transform: translate(%.0fpx, %.0fpx) scale(1) } to { opacity: 0; transform: translate(%.0fpx, %.0fpx) scale(0) } }' % (CATCH + CATCH))
css.append(f'  .trail {{ fill: none; stroke-dasharray: 1 2; stroke-dashoffset: 1.01; }}')
css.append(f'  .trail-s {{ stroke: #fff; stroke-width: 9; animation: draw {CATCH_T - S_T0:.2f}s linear {S_T0}s forwards; }}')
css.append(f'  .trail-f {{ stroke: #1f8a4c; stroke-width: 3; stroke-linecap: round; animation: draw {CATCH_T - F_T0:.2f}s linear {F_T0}s forwards; }}')
css.append(f'  .trails {{ animation: fade .45s ease-in {CATCH_T + 0.05:.2f}s forwards; }}')
css.append('  @keyframes fade { to { opacity: 0 } }')
css.append(f'  .star {{ transform-origin: {CATCH[0]}px {CATCH[1]}px; transform: scale(0); animation: star .5s ease-out {CATCH_T}s; }}')
css.append('  @keyframes star { 0% { transform: scale(0) rotate(0) } 40% { transform: scale(1.25) rotate(40deg) } 100% { transform: scale(0) rotate(90deg); opacity: 0 } }')
css.append(kf('s-move', s_pts))
css.append(kf('f-move', f_pts, f_ang))
css.append(kf('f-perch', p_pts, p_ang))
css.append('  /* глазки: следят за Шустриком, за поимкой, за рукой и захватом — и в конце смотрят на нас */')
css.append(f'  .p1 {{ animation: look1 {LOOK_T1 - LOOK_T0:.2f}s linear {LOOK_T0}s both; }}')
css.append(f'  .p2 {{ animation: look2 {LOOK_T1 - LOOK_T0:.2f}s linear {LOOK_T0}s both; }}')
css.append('  @keyframes look1 {\n' + '\n'.join(look_kf(EYES[0])) + '\n  }')
css.append('  @keyframes look2 {\n' + '\n'.join(look_kf(EYES[1])) + '\n  }')

# трафарет пунктира Шустрика: пунктир рисуется маской, которая «растёт» за ним
s_d = d_attr(s_curve); f_d = d_attr(f_curve)
svg = f'''      <!-- погоня: сгенерировано tools/splash-chase.py -->
      <defs>
        <mask id="trail-s-mask" maskUnits="userSpaceOnUse" x="-80" y="-40" width="660" height="320">
          <path class="trail trail-s" pathLength="1" d="{s_d}" />
        </mask>
      </defs>
      <g class="trails">
        <path d="{s_d}" fill="none" stroke="#e04a2f" stroke-width="3" stroke-dasharray="6 5" mask="url(#trail-s-mask)" />
        <path class="trail trail-f" pathLength="1" d="{f_d}" />
      </g>
      <!-- Шустрик -->
      <g class="chase-s">
        <circle r="8" fill="#e04a2f" stroke="#fff" stroke-width="1.5" />
        <circle cx="-2.5" cy="-2.8" r="2.4" fill="#fff" opacity=".85" />
      </g>
      <!-- Огонёк: муха сверху, голова смотрит по ходу полёта -->
      <g class="chase-f"><g transform="scale(1.3)">
        <g class="wing wing-l"><ellipse cx="-5" cy="-6.5" rx="9.5" ry="4.2" transform="rotate(22 -5 -6.5)" fill="#dcebf5" fill-opacity=".85" stroke="#8fa9bb" stroke-width=".8" /></g>
        <g class="wing wing-r"><ellipse cx="-5" cy="6.5" rx="9.5" ry="4.2" transform="rotate(-22 -5 6.5)" fill="#dcebf5" fill-opacity=".85" stroke="#8fa9bb" stroke-width=".8" /></g>
        <ellipse cx="-6" cy="0" rx="8" ry="4.6" fill="#6b4226" />
        <path d="M-10 -3.6 v7.2 M-6.5 -4.4 v8.8" stroke="#3b2414" stroke-width="1.3" />
        <circle cx="3.5" cy="0" r="4.2" fill="#7d4f2c" />
        <circle cx="8.8" cy="0" r="3.4" fill="#8a5631" />
        <circle cx="9.6" cy="-2.6" r="2.1" fill="#d0312d" />
        <circle cx="9.6" cy="2.6" r="2.1" fill="#d0312d" />
      </g></g>
      <!-- звёздочка поимки -->
      <path class="star" fill="#ffc21a" stroke="#ff8a00" stroke-width="1.2" d="M{CATCH[0]} {CATCH[1]-17} L{CATCH[0]+4.5} {CATCH[1]-4.5} L{CATCH[0]+17} {CATCH[1]} L{CATCH[0]+4.5} {CATCH[1]+4.5} L{CATCH[0]} {CATCH[1]+17} L{CATCH[0]-4.5} {CATCH[1]+4.5} L{CATCH[0]-17} {CATCH[1]} L{CATCH[0]-4.5} {CATCH[1]-4.5} Z" />'''

src = FILE.read_text(encoding='utf-8')
src = re.sub(r'  /\* chase:css \*/.*?  /\* /chase:css \*/', lambda m: '  /* chase:css */\n' + '\n'.join(css) + '\n  /* /chase:css */', src, flags=re.S)
src = re.sub(r'      <!-- chase:svg -->.*?      <!-- /chase:svg -->', lambda m: '      <!-- chase:svg -->\n' + svg + '\n      <!-- /chase:svg -->', src, flags=re.S)
FILE.write_text(src, encoding='utf-8')
print('Шустрик', round(s_len), 'px за', CATCH_T - S_T0, 'с; Огонёк', round(f_len), 'px за', CATCH_T - F_T0, 'с')

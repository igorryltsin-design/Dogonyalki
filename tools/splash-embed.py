"""Переносит анимацию заставки из design/robotrek-splash.html в index.html.

В дизайн-файле классы и анимации называются коротко (.pop, @keyframes spin),
а в игре рядом живут свои стили. Поэтому при переносе всем классам, именам
анимаций, переменным цвета и id даётся приставка sp-. Меняется только то, что
стоит между метками splash:css и splash:svg в index.html; логика показа и
ухода заставки (скрипт под разметкой) не трогается.

Порядок правки: design/robotrek-splash.html (и tools/splash-chase.py для
погони) → python3 tools/splash-embed.py → npm run build:offline.
"""
import re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'design' / 'robotrek-splash.html').read_text(encoding='utf-8')

css = src[src.index('  /* общий вход'):src.index('  .controls {')]
svg = src[src.index('    <g class="logo">'):src.index('  </svg>')]
# классы и анимации дизайн-файла
classes = set()
for m in re.finditer(r'class="([^"]+)"', svg): classes.update(m.group(1).split())
kfs = set(re.findall(r'@keyframes ([\w-]+)', css))
names = sorted(classes, key=len, reverse=True)
css = re.sub(r'\.(' + '|'.join(map(re.escape, names)) + r')(?![\w-])', lambda m: '.sp-' + m.group(1), css)
css = re.sub(r'@keyframes ([\w-]+)', lambda m: '@keyframes sp-' + m.group(1), css)
kre = re.compile(r'(?<![\w.-])(' + '|'.join(map(re.escape, sorted(kfs, key=len, reverse=True))) + r')(?![\w-])')
css = re.sub(r'(animation:)([^;}]*)', lambda m: m.group(1) + kre.sub(lambda k: 'sp-' + k.group(1), m.group(2)), css)
# в игре растворением управляет скрипт (класс sp-out), а не таймер
css = re.sub(r', sp-leave [^;]*forwards', '', css)
css = re.sub(r'var\(--(orange|ink|bg)\)', lambda m: 'var(--sp-' + m.group(1) + ')', css)
svg = re.sub(r'class="([^"]+)"', lambda m: 'class="' + ' '.join('sp-' + c for c in m.group(1).split()) + '"', svg)
svg = re.sub(r'var\(--(orange|ink|bg)\)', lambda m: 'var(--sp-' + m.group(1) + ')', svg)
svg = re.sub(r'id="([\w-]+)"', lambda m: 'id="sp-' + m.group(1) + '"', svg)
svg = re.sub(r'url\(#([\w-]+)\)', lambda m: 'url(#sp-' + m.group(1) + ')', svg)
# шестерёнка в дизайн-файле строится скриптом — здесь вписываем готовый контур
import math
cx, cy, R, r, hole, n = 387, 144, 75, 64, 47.5, 20
d = ''
for i in range(n):
    s = 2 * math.pi / n; a = i * s - s * 0.27
    for rad, ang in [(r, a), (R, a + s * .12), (R, a + s * .42), (r, a + s * .54), (r, a + s)]:
        d += ('L' if d else 'M') + f'{cx + rad * math.cos(ang):.1f} {cy + rad * math.sin(ang):.1f}'
d += f'Z M{cx + hole} {cy} a{hole} {hole} 0 1 0 {-2 * hole} 0 a{hole} {hole} 0 1 0 {2 * hole} 0Z'
svg = svg.replace('<path id="sp-gear" ', '<path d="' + d + '" ')
ind = lambda text, k: '\n'.join((' ' * k + l[2:] if l.startswith('  ') else l) for l in text.rstrip().split('\n'))
css = ind(css, 6); svg = ind(svg, 6)
p = ROOT / 'index.html'; html = p.read_text(encoding='utf-8')
html = re.sub(r'(      /\* splash:css[^\n]*\n).*?(\n      /\* /splash:css \*/)', lambda m: m.group(1) + css + m.group(2), html, flags=re.S)
html = re.sub(r'(        <!-- splash:svg -->\n).*?(\n        <!-- /splash:svg -->)', lambda m: m.group(1) + svg + m.group(2), html, flags=re.S)
p.write_text(html, encoding='utf-8')
print('index.html: заставка обновлена,', len(classes), 'классов,', len(kfs), 'анимаций')

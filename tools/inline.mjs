// Вшивает CSS и JS сборки в один dist/index.html, чтобы игра открывалась
// двойным кликом по file:// без сервера: внешние ES-модули браузер по file://
// блокирует по CORS, а инлайновый <script type="module"> выполняется.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const dist = new URL('../dist/', import.meta.url)
const htmlPath = new URL('index.html', dist)
let html = readFileSync(htmlPath, 'utf8')

const css = readdirSync(new URL('assets/', dist)).filter((f) => f.endsWith('.css'))
const js = readdirSync(new URL('assets/', dist)).filter((f) => f.endsWith('.js'))
if (!css.length || !js.length) {
  console.error('в dist нет собранных ассетов — сначала `vite build`')
  process.exit(1)
}
const cssText = readFileSync(new URL('assets/' + css[0], dist), 'utf8')
const jsText = readFileSync(new URL('assets/' + js[0], dist), 'utf8')

// Экранируем ВСЕ последовательности "</" (в JS-строке "<\/" то же, что "</"),
// иначе HTML-парсер обрвёт инлайновый модуль на первом встреченном "</script>"
// — такие строки оставляет polyfill modulepreload у Vite.
const jsSafe = jsText.replace(/<\//g, '<\\/')

// Замена — функцией, а не строкой: в минифицированном JS попадаются `$&`, `$'`
// и `$1`, и строковая замена расшифровала бы их как спецссылки на куски HTML.
// Модуль — в самый конец <body>, а не в <head>, куда его ставит Vite: иначе
// браузер сначала читает 2 МБ скрипта и только потом доходит до заставки.
// Модуль всё равно отложенный, так что порядок запуска не меняется.
html = html.replace(/\s*<script\s+type="module"[^>]*src="[^"]*"[^>]*><\/script>/, '')
html = html.replace(/<\/body>/, () => `<script type="module">${jsSafe}</script>\n  </body>`)
html = html.replace(/<link\s+rel="stylesheet"[^>]*href="[^"]*"[^>]*>/, () => `<style>${cssText}</style>`)

writeFileSync(htmlPath, html)

// Самопроверка: внутри инлайнового модуля не должно остаться буквального `</`
const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)
if (!module) {
  console.error('не нашёл инлайновый модуль — сборка сломана')
  process.exit(1)
}
const loose = (module[1].match(/<\//g) || []).length
if (loose) {
  console.error(`в модуле осталось ${loose} буквальных "</" — браузер оборвёт скрипт`)
  process.exit(1)
}
console.log('dist/index.html собран в один файл:', (html.length / 1024).toFixed(0) + ' КБ')

// Копия того же файла в корень репозитория: `dist/` в .gitignore, поэтому без
// неё клон репозитория не содержит чего открыть двойным кликом — обещание
// README «нужен только один HTML-файл» держится именно на этом файле.
const ready = new URL('../game.html', import.meta.url)
writeFileSync(ready, html)
console.log('game.html в корне обновлён: тот же файл, что и dist/index.html')

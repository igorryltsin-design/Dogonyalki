import { existsSync, readFileSync } from 'node:fs'
import { it, expect, describe } from 'vitest'

/** Готовый файл урока лежит в репозитории, а не только в `dist/`, который в
 *  .gitignore. Проверка держит обещание README: скачал `game.html` — открыл
 *  двойным кликом — урок работает без сервера, без интернета и без Node. Если
 *  сборка снова начнёт выносить что-то наружу или файл отстанет от `dist/`,
 *  тест падает, а не молча оставляет школу без урока. */

const ready = new URL('../game.html', import.meta.url)
const dist = new URL('../dist/index.html', import.meta.url)

function html() {
  return readFileSync(ready, 'utf8')
}

describe('game.html — один файл для урока', () => {
  it('лежит в корне репозитория и начинается с doctype', () => {
    expect(existsSync(ready)).toBe(true)
    expect(html().trimStart().toLowerCase()).toMatch(/^<!doctype html>/)
    expect(html().length).toBeGreaterThan(1_000_000)
  })

  it('ничего не тянет извне: ни ассетов, ни ссылок на src/', () => {
    const s = html()
    expect(s).not.toMatch(/assets\//)
    expect(s).not.toMatch(/<script[^>]*\ssrc=/)
    expect(s).not.toMatch(/<link[^>]*stylesheet/)
    expect(s).not.toMatch(/["']\/src\//)
  })

  it('стили и модуль вшиты внутрь', () => {
    const s = html()
    expect(s).toMatch(/<style>/)
    expect(s).toMatch(/<script type="module">/)
    // признаки того, что вшит именно текущий CSS, а не старый снимок
    expect(s).toContain('.intro__pic')
    expect(s).toContain('pic-in')
    expect(s).toContain('.report')
  })

  it('совпадает с dist/index.html, когда сборка есть', () => {
    if (!existsSync(dist)) return
    expect(readFileSync(dist, 'utf8')).toBe(html())
  })
})

describe('заставка РобоТрек при загрузке', () => {
  it('стоит в game.html раньше вшитого модуля игры', () => {
    const s = html()
    const splash = s.indexOf('id="splash"')
    const mod = s.indexOf('<script type="module">')
    expect(splash).toBeGreaterThan(0)
    expect(splash).toBeLessThan(mod)
    // модуль вшит в конец body: заставка рисуется до того, как прочитаны 2 МБ скрипта
    expect(s.slice(mod)).toMatch(/<\/script>\s*<\/body>/)
  })

  it('в заставке есть погоня: Шустрик, Огонёк и их следы', () => {
    const s = html()
    for (const part of ['sp-chase-s', 'sp-chase-f', 'sp-trails', 'sp-star', 'url(#sp-trail-s-mask)']) expect(s).toContain(part)
  })

  it('уходит по сигналу игры, а игра этот сигнал посылает', () => {
    expect(html()).toContain("addEventListener('dogonyalki:ready'")
    const app = readFileSync(new URL('./GameApp.tsx', import.meta.url), 'utf8')
    expect(app).toContain("new Event('dogonyalki:ready')")
  })

  it('не задевает стили игры: свои классы, анимации и переменные с приставкой sp-', () => {
    const own = html().slice(0, html().indexOf('<script type="module">'))
    const style = own.slice(own.indexOf('#splash {'), own.indexOf('</style>', own.indexOf('#splash {')))
    for (const m of style.matchAll(/@keyframes ([\w-]+)/g)) expect(m[1]).toMatch(/^sp-/)
    for (const m of style.matchAll(/--([\w-]+):/g)) expect(m[1]).toMatch(/^sp-/)
  })
})

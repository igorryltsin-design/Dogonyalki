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

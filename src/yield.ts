/** Уступка браузеру между порциями тяжёлого счёта.

    Обычный `setTimeout(…, 0)` в фоновой вкладке Chrome притормаживается до
    одного вызова в секунду: «Учить сеть» на сотнях карточек превращается в
    вечность, стоит ребёнку переключить вкладку. Очередь сообщений
    MessageChannel такому троттлингу не подлежит, поэтому уступаем через неё;
    setTimeout остаётся запасным путём для окружений без MessageChannel. */

const waiting: Array<() => void> = []
// держим канал в переменной модуля, чтобы порты не собрал сборщик мусора
let channel: MessageChannel | null = null

if (typeof MessageChannel !== 'undefined') {
  channel = new MessageChannel()
  channel.port1.onmessage = () => waiting.shift()?.()
}

export function yieldToUi(): Promise<void> {
  if (!channel) return new Promise<void>((resolve) => setTimeout(resolve, 0))
  return new Promise<void>((resolve) => {
    waiting.push(resolve)
    channel!.port2.postMessage(0)
  })
}

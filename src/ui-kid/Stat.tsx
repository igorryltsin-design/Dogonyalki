/** Крупная цифра с подписью — то, что ребёнок читает через полкласса.
 *  small — та же цифра, но втиснутая в ряд под сценой или в наплывную панель:
 *  там 28 пикселей на число съели бы всю картинку. */
export function Stat({ label, value, bad, small }: { label: string; value: string; bad?: boolean; small?: boolean }) {
  const cls = ['stat', small ? 'stat--sm' : '', bad ? 'is-bad' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

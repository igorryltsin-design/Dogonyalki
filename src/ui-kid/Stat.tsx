/** Крупная цифра с подписью — то, что ребёнок читает через полкласса. */
export function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={bad ? 'stat is-bad' : 'stat'}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

import { pct } from '../lib/money'

export function ProgressBar({
  value,
  max,
  className = '',
}: {
  value: number
  max: number
  className?: string
}) {
  const p = pct(value, max)
  const color = p >= 100 ? 'bg-red-500' : p >= 80 ? 'bg-amber-500' : 'bg-brand'
  return (
    <div className={`h-2 w-full rounded-full bg-neutral-200 overflow-hidden ${className}`} aria-hidden>
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
    </div>
  )
}

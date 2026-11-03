import { pct } from '../lib/money'

export function ProgressBar({
  value,
  max,
  className = '',
  thin = false,
}: {
  value: number
  max: number
  className?: string
  thin?: boolean
}) {
  const p = pct(value, max)
  const color = p >= 100 ? 'bg-danger' : p >= 80 ? 'bg-amber-500' : 'bg-brand'
  return (
    <div className={`${thin ? 'h-1.5' : 'h-2'} w-full rounded-pill bg-lavender-deep overflow-hidden ${className}`} aria-hidden>
      <div className={`h-full rounded-pill ${color} transition-all`} style={{ width: `${p}%` }} />
    </div>
  )
}

import { sar } from '../lib/money'

export function Money({
  halalas,
  className = '',
  compact = false,
  signed = false,
}: {
  halalas: number | null | undefined
  className?: string
  compact?: boolean
  signed?: boolean
}) {
  const v = halalas ?? 0
  const text = sar(Math.abs(v), { compact })
  return (
    <span className={`tnum ${className}`}>
      {signed ? (v < 0 ? '-' : '+') : v < 0 ? '-' : ''}
      {text}
    </span>
  )
}

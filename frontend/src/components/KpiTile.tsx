import type { ReactNode } from 'react'

export function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'red'
}) {
  const accent =
    tone === 'green'
      ? 'text-mint-deep bg-mint'
      : tone === 'amber'
        ? 'text-amber-800 bg-amber-100'
        : tone === 'red'
          ? 'text-red-700 bg-red-100'
          : 'text-brand bg-brand-light'
  return (
    <div className="card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide truncate">
          {label}
        </span>
        {icon && <span className={`rounded-md p-1.5 ${accent}`}>{icon}</span>}
      </div>
      <div className="text-xl md:text-2xl font-semibold tnum truncate">{value}</div>
      {hint && <div className="text-xs text-neutral-500 truncate">{hint}</div>}
    </div>
  )
}

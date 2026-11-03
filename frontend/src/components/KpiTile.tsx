import type { ReactNode } from 'react'

export function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  children,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'violet'
  children?: ReactNode
}) {
  const valueTone =
    tone === 'violet'
      ? 'text-brand'
      : tone === 'green'
        ? 'text-success'
        : tone === 'amber'
          ? 'text-warn'
          : tone === 'red'
            ? 'text-danger'
            : 'text-ink'
  return (
    <div className="card-lg px-5 py-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-neutral-600 truncate">{label}</span>
        {icon && <span className="rounded-full bg-brand-light p-1.5 text-brand">{icon}</span>}
      </div>
      <div className={`kpi-value ${valueTone}`}>{value}</div>
      {children}
      {hint && <div className="text-xs text-neutral-500 truncate">{hint}</div>}
    </div>
  )
}

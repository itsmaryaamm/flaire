import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-7">
      <div>
        <h1 className="text-[28px] md:text-[32px] leading-tight font-extrabold tracking-tightest">{title}</h1>
        {subtitle && <p className="text-sm text-neutral-600 mt-1.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 sm:pt-2">{actions}</div>}
    </div>
  )
}

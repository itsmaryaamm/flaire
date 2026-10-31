import type { ReactNode } from 'react'

export type PillTone = 'green' | 'amber' | 'red' | 'neutral' | 'blue' | 'mint'

const toneClasses: Record<PillTone, string> = {
  green: 'bg-mint text-brand-dark border-mint-deep/20',
  mint: 'bg-mint text-brand-dark border-mint-deep/20',
  amber: 'bg-amber-100 text-amber-800 border-amber-300/60',
  red: 'bg-red-100 text-red-700 border-red-300/60',
  neutral: 'bg-neutral-100 text-neutral-700 border-neutral-300/60',
  blue: 'bg-sky-100 text-sky-800 border-sky-300/60',
}

/** Maps any status string from the API onto a visual tone. */
export function toneFor(status: string | null | undefined): PillTone {
  switch (status) {
    case 'approved':
    case 'completed':
    case 'settled':
    case 'authorized':
    case 'active':
    case 'ok':
      return 'green'
    case 'pending_approval':
    case 'pending':
    case 'paused':
      return 'amber'
    case 'denied':
    case 'rejected':
    case 'failed':
    case 'declined':
    case 'reversed':
    case 'frozen':
    case 'broken':
      return 'red'
    default:
      return 'neutral'
  }
}

export function labelFor(status: string | null | undefined): string {
  if (!status) return 'unknown'
  return status.replace(/_/g, ' ')
}

export function StatusPill({
  status,
  tone,
  children,
  className = '',
  dot = true,
}: {
  status?: string | null
  tone?: PillTone
  children?: ReactNode
  className?: string
  dot?: boolean
}) {
  const t = tone ?? toneFor(status)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap ${toneClasses[t]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children ?? labelFor(status)}
    </span>
  )
}

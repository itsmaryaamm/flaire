import type { ReactNode } from 'react'

export type PillTone = 'green' | 'amber' | 'red' | 'neutral' | 'blue' | 'mint' | 'lavender'

const toneClasses: Record<PillTone, string> = {
  green: 'bg-success-tint text-success',
  mint: 'bg-success-tint text-success',
  amber: 'bg-warn-tint text-warn',
  red: 'bg-danger-tint text-danger',
  lavender: 'bg-brand-light text-brand',
  neutral: 'bg-lavender-deep text-neutral-600',
  blue: 'bg-brand-light text-brand-deep',
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
    case 'auto_approved':
      return 'lavender'
    default:
      return 'neutral'
  }
}

const LABELS: Record<string, string> = {
  completed: 'Paid',
  settled: 'Paid',
  authorized: 'Paid',
  pending_approval: 'Awaiting you',
  pending: 'Pending',
  denied: 'Declined',
  rejected: 'Declined',
  declined: 'Declined',
  failed: 'Payment failed',
  approved: 'Approved',
  auto_approved: 'Auto-approved',
  reversed: 'Reversed',
  active: 'Active',
  paused: 'Paused',
  frozen: 'Frozen',
}

export function labelFor(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  const known = LABELS[status]
  if (known) return known
  const plain = status.replace(/_/g, ' ')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

export function StatusPill({
  status,
  tone,
  children,
  className = '',
  dot = false,
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
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${toneClasses[t]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children ?? labelFor(status)}
    </span>
  )
}

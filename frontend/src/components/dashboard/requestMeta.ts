import type { PurchaseRequest } from '../../types'

/** "Auto-approved", "Human approval" or "Not allowed" for the activity subtitle. */
export function routeLabel(r: PurchaseRequest): string {
  if (r.status === 'denied') return 'Not allowed'
  if (
    r.status === 'pending_approval' ||
    r.status === 'rejected' ||
    r.approved_by ||
    r.decision?.verdict === 'pending_approval'
  )
    return 'Human approval'
  return 'Auto-approved'
}

/** Status key for the pill: completed requests that no human touched show as "Auto-approved". */
export function pillStatus(r: PurchaseRequest): string {
  if (r.status === 'completed' && !r.approved_by && r.decision?.verdict === 'approved') return 'auto_approved'
  return r.status
}

export function isPaid(r: PurchaseRequest): boolean {
  return r.status === 'completed'
}

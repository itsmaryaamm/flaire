import { Link } from 'react-router-dom'
import { formatTime } from '../../lib/useFetch'
import type { PurchaseRequest } from '../../types'
import { Money } from '../Money'

/** "Needs your approval" rows. Buttons go to /approvals because approving needs a password there. */
export function PendingList({ requests }: { requests: PurchaseRequest[] }) {
  if (requests.length === 0) return null
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-bold">Needs your approval</h2>
        <Link to="/approvals" className="text-sm text-neutral-600 hover:text-brand">
          {requests.length} waiting
        </Link>
      </div>
      <ul className="space-y-3">
        {requests.map((r) => (
          <li key={r.id} className="rounded-card-lg border-[1.5px] border-brand bg-white px-5 py-4 shadow-[0_8px_24px_-16px_rgba(123,47,242,.6)]">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="font-bold text-ink">{r.merchant}</span>
                  <span className="text-xs text-neutral-500">
                    {r.category} · {formatTime(r.created_at)}
                  </span>
                </div>
                {r.description && <p className="text-sm text-neutral-600 mt-1 line-clamp-3">{r.description}</p>}
              </div>
              <Money halalas={r.amount} className="text-xl font-bold shrink-0" />
              <div className="flex gap-2 shrink-0">
                <Link to="/approvals" className="btn-secondary">
                  Decline
                </Link>
                <Link to="/approvals" className="btn-success">
                  Approve
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

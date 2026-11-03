import { Link } from 'react-router-dom'
import { formatTime } from '../../lib/useFetch'
import type { PurchaseRequest } from '../../types'
import { EmptyState } from '../EmptyState'
import { Money } from '../Money'
import { StatusPill } from '../StatusPill'
import { pillStatus, routeLabel } from './requestMeta'

export function RecentActivity({
  requests,
  selectedId,
  onSelect,
}: {
  requests: PurchaseRequest[]
  selectedId?: number | null
  onSelect?: (r: PurchaseRequest) => void
}) {
  return (
    <section className="card-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-base font-bold">Recent activity</h2>
        <Link to="/transactions" className="font-mono text-xs text-neutral-500 hover:text-brand tnum">
          {requests.length} requests
        </Link>
      </div>
      {requests.length === 0 ? (
        <EmptyState compact title="No requests yet" description="Give an AI employee a task to see requests here." />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {requests.map((r) => {
            const active = r.id === selectedId
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(r)}
                  className={`w-full text-left flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3.5 transition-colors ${
                    active ? 'bg-lavender' : 'hover:bg-lavender/60'
                  }`}
                >
                  <span className="hidden sm:inline font-mono text-xs text-neutral-500 w-11 shrink-0 tnum">{formatTime(r.created_at)}</span>
                  <span className="flex-1 min-w-0 basis-full sm:basis-auto">
                    <span className="block text-sm font-semibold text-ink truncate">{r.merchant}</span>
                    <span className="block text-xs text-neutral-500 truncate">
                      <span className="sm:hidden font-mono">{formatTime(r.created_at)} · </span>{r.category} · {routeLabel(r)}
                    </span>
                  </span>
                  <Money halalas={r.amount} className="text-sm font-medium shrink-0" />
                  <StatusPill status={pillStatus(r)} className="shrink-0 ml-auto sm:ml-0" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

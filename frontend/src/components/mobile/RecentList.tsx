import { sar } from '../../lib/money'
import { formatTime } from '../../lib/useFetch'
import type { PurchaseRequest } from '../../types'
import { StatusPill } from '../StatusPill'

export function RecentList({ items }: { items: PurchaseRequest[] }) {
  return (
    <section>
      <h2 className="text-sm font-bold px-1 mb-2.5">Recent</h2>
      <div className="card-lg overflow-hidden">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No requests yet.</div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 min-h-[56px] py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{r.merchant}</div>
                  <div className="text-xs text-neutral-500 truncate">
                    {r.agent_name} · {formatTime(r.created_at)}
                  </div>
                </div>
                <div className="text-sm font-semibold tnum whitespace-nowrap">{sar(r.amount)}</div>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

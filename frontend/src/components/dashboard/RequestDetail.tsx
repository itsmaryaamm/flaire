import { Link } from 'react-router-dom'
import { formatTime } from '../../lib/useFetch'
import { sar } from '../../lib/money'
import type { PurchaseRequest } from '../../types'
import { Money } from '../Money'
import { StatusPill } from '../StatusPill'
import { PolicyCheck } from '../PolicyCheck'
import { pillStatus } from './requestMeta'

type Step = { label: string; meta?: string; state: 'done' | 'active' | 'muted' }

function lifecycle(r: PurchaseRequest): Step[] {
  const pending = r.status === 'pending_approval'
  const paid = r.status === 'completed'
  const declined = r.status === 'denied' || r.status === 'rejected'
  const humanDone = !!r.approved_by || r.status === 'rejected'
  return [
    { label: 'Request from AI employee', meta: formatTime(r.created_at), state: 'done' },
    { label: 'Policy check', meta: r.decision?.rule_id ?? undefined, state: 'done' },
    {
      label: declined ? 'Declined' : 'Waiting for your approval',
      meta: r.decided_at && !pending ? formatTime(r.decided_at) : undefined,
      state: pending ? 'active' : humanDone || declined ? 'done' : 'muted',
    },
    { label: 'Payment authorized · card', state: paid || r.status === 'approved' ? 'done' : 'muted' },
    { label: 'Paid · settled', meta: paid && r.transaction_id ? `txn #${r.transaction_id}` : undefined, state: paid ? 'done' : 'muted' },
  ]
}

function Dot({ state }: { state: Step['state'] }) {
  if (state === 'active')
    return (
      <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inset-0 rounded-full bg-brand/30 animate-ping" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-brand" />
      </span>
    )
  return <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${state === 'done' ? 'bg-ink' : 'bg-line-strong'}`} />
}

/** Right-hand detail panel for one request: reason, policy check and lifecycle. */
export function RequestDetail({ request: r }: { request: PurchaseRequest }) {
  const pending = r.status === 'pending_approval'
  return (
    <aside className="card-lg p-6 space-y-5 lg:sticky lg:top-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-neutral-500 tracking-wide tnum">
            REQ-{r.id} · {formatTime(r.created_at)}
          </div>
          <h2 className="text-lg font-bold mt-1 truncate">{r.merchant}</h2>
        </div>
        <StatusPill status={pillStatus(r)} />
      </div>
      <Money halalas={r.amount} className="block text-[34px] leading-none font-extrabold tracking-tightest" />

      <div className="rounded-card bg-lavender-deep px-4 py-3.5">
        <div className="mono-label mb-1.5">AI employee's reason</div>
        <p className="text-sm text-ink leading-relaxed">{r.description || 'No description given.'}</p>
        <p className="text-xs text-neutral-500 mt-2">
          {r.agent_name} · {r.department_name}
        </p>
      </div>

      {pending && (
        <div className="grid grid-cols-[1fr_1.6fr] gap-2">
          <Link to="/approvals" className="btn-secondary">
            Decline
          </Link>
          <Link to="/approvals" className="btn-success">
            Approve {sar(r.amount)}
          </Link>
        </div>
      )}

      <PolicyCheck decision={r.decision} />

      <div>
        <div className="mono-label mb-2">Lifecycle</div>
        <ol className="space-y-2.5">
          {lifecycle(r).map((s) => (
            <li key={s.label} className="flex items-center gap-3 text-sm">
              <Dot state={s.state} />
              <span className={`flex-1 ${s.state === 'muted' ? 'text-neutral-400' : s.state === 'active' ? 'text-ink font-semibold' : 'text-ink'}`}>
                {s.label}
              </span>
              {s.meta && <span className="font-mono text-[11px] text-neutral-500 tnum">{s.meta}</span>}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}

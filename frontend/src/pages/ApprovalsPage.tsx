import { useState } from 'react'
import { Check, X, CheckSquare, Bot, Lock } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatDate } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import type { PurchaseRequest } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Money } from '../components/Money'
import { StatusPill } from '../components/StatusPill'
import { ReasonsList } from '../components/DecisionDetails'
import { EmptyState } from '../components/EmptyState'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'

function ApprovalCard({
  req,
  killSwitch,
  onDone,
}: {
  req: PurchaseRequest
  killSwitch: boolean
  onDone: (result: PurchaseRequest) => void
}) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [result, setResult] = useState<PurchaseRequest | null>(null)

  const act = async (action: 'approve' | 'reject') => {
    setBusy(action)
    try {
      const { data } = await api.post<PurchaseRequest>(`/approvals/${req.id}/${action}`, {
        note: note.trim() || undefined,
      })
      setResult(data)
      toast.success(
        action === 'approve'
          ? data.status === 'completed'
            ? `Approved and paid: ${data.merchant}.`
            : `Approved. Payment status: ${data.status}.`
          : `Rejected: ${data.merchant}.`,
      )
      onDone(data)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const shown = result ?? req

  return (
    <div className={`card p-5 ${result ? 'opacity-90' : ''}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-lg bg-amber-100 text-amber-800 p-2.5 shrink-0">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold truncate">{shown.merchant}</h3>
            <span className="text-xs rounded-md bg-neutral-100 px-1.5 py-0.5 text-neutral-600">{shown.category}</span>
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {shown.agent_name} · {shown.department_name} · {formatDate(shown.created_at)}
          </div>
          {shown.description && <p className="text-sm text-neutral-700 mt-2">{shown.description}</p>}
        </div>
        <div className="text-right">
          <Money halalas={shown.amount} className="text-xl font-semibold block" />
          <StatusPill status={shown.status} className="mt-1" />
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-neutral-50 border border-neutral-200 p-3">
        <div className="text-xs text-neutral-500 mb-1.5">
          Why this needs a human
          {shown.decision?.rule_id && (
            <>
              {' '}· rule <code className="font-mono">{shown.decision.rule_id}</code>
            </>
          )}
        </div>
        <ReasonsList decision={shown.decision} />
      </div>

      {result ? (
        <div className="mt-4 text-sm">
          <span className="text-neutral-500">Result: </span>
          <StatusPill status={result.status} />
          {result.decision?.payment_error && (
            <ErrorNote message={`Payment error: ${result.decision.payment_error}`} className="mt-2" />
          )}
          {result.transaction_id && (
            <span className="text-xs text-neutral-500 ml-2 tnum">Transaction #{result.transaction_id}</span>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1"
            placeholder="Optional note for the ledger"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn-secondary text-red-700 border-red-200 hover:bg-red-50" onClick={() => act('reject')} disabled={busy !== null}>
              {busy === 'reject' ? <Spinner /> : <X className="h-4 w-4" />} Reject
            </button>
            <span className="relative group">
              <button className="btn-primary" onClick={() => act('approve')} disabled={busy !== null || killSwitch}>
                {busy === 'approve' ? <Spinner /> : killSwitch ? <Lock className="h-4 w-4" /> : <Check className="h-4 w-4" />} Approve
              </button>
              {killSwitch && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover:block whitespace-nowrap rounded-md bg-ink text-white text-xs px-2 py-1"
                >
                  Kill switch is on. Lift it to approve.
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ApprovalsPage() {
  const { company } = useAuth()
  const killSwitch = !!company?.kill_switch
  const pending = useFetch(() => api.get<PurchaseRequest[]>('/approvals').then((r) => r.data), [])
  const [done, setDone] = useState<PurchaseRequest[]>([])

  const list = pending.data ?? []

  return (
    <div>
      <PageHeader
        title="Pending approvals"
        subtitle="Requests above an agent's approval threshold wait here. Only a human can approve."
        actions={
          <button className="btn-secondary" onClick={() => pending.refetch()} disabled={pending.loading}>
            {pending.loading && <Spinner />} Refresh
          </button>
        }
      />

      {killSwitch && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <Lock className="h-4 w-4" /> Approvals are frozen while the kill switch is on. You can still reject.
        </div>
      )}

      {pending.loading && !pending.data ? (
        <PageLoader />
      ) : pending.error && !pending.data ? (
        <ErrorNote message={pending.error} />
      ) : list.length === 0 && done.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CheckSquare className="h-5 w-5" />}
            title="Nothing waiting for you"
            description="When an AI employee asks for more than its approval threshold, the request shows up here."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((r) => (
            <ApprovalCard
              key={r.id}
              req={r}
              killSwitch={killSwitch}
              onDone={(res) => {
                setDone((d) => [res, ...d])
                // refetch after a moment so the user sees the result status first
                window.setTimeout(() => void pending.refetch(), 1200)
              }}
            />
          ))}
          {done.length > 0 && list.length === 0 && (
            <div className="card">
              <div className="px-5 py-4 border-b border-neutral-200 font-semibold text-sm">Decided this session</div>
              <ul className="divide-y divide-neutral-100">
                {done.map((r) => (
                  <li key={r.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.merchant}</div>
                      <div className="text-xs text-neutral-500 truncate">{r.agent_name}</div>
                    </div>
                    <Money halalas={r.amount} className="text-sm font-medium" />
                    <StatusPill status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

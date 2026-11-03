import { useState } from 'react'
import { Check, X, CheckSquare, Lock } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatTime } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import { sar } from '../lib/money'
import type { PurchaseRequest } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Money } from '../components/Money'
import { StatusPill } from '../components/StatusPill'
import { PolicyCheck } from '../components/PolicyCheck'
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
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [result, setResult] = useState<PurchaseRequest | null>(null)

  const act = async (action: 'approve' | 'reject') => {
    setBusy(action)
    try {
      const { data } = await api.post<PurchaseRequest>(`/approvals/${req.id}/${action}`, {
        note: note.trim() || undefined,
        password: password || undefined,
      })
      setPassword('')
      if (data.needs_second_approver && data.status === 'pending_approval') {
        toast.success('First approval recorded. A second approver must confirm before money moves.')
        onDone(data)
        return
      }
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
    <div
      className={`rounded-card-lg bg-white p-5 md:p-6 ${
        result ? 'border border-line opacity-90' : 'border-[1.5px] border-brand shadow-[0_8px_24px_-16px_rgba(123,47,242,.6)]'
      }`}
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] text-neutral-500 tracking-wide tnum">
            REQ-{shown.id} · {formatTime(shown.created_at)}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2.5 mt-1">
            <h3 className="text-lg font-bold truncate">{shown.merchant}</h3>
            <span className="text-xs text-neutral-500">
              {shown.category} · {shown.agent_name} · {shown.department_name}
            </span>
          </div>
        </div>
        <div className="text-right">
          <Money halalas={shown.amount} className="text-2xl font-extrabold tracking-tightest block" />
          <StatusPill status={shown.status} className="mt-1" />
        </div>
      </div>

      {shown.description && (
        <div className="mt-4 rounded-card bg-lavender-deep px-4 py-3.5">
          <div className="mono-label mb-1.5">AI employee's reason</div>
          <p className="text-sm text-ink leading-relaxed">{shown.description}</p>
        </div>
      )}

      <div className="mt-4">
        <PolicyCheck
          decision={shown.decision}
          label={shown.decision?.rule_id ? `Policy check · ${shown.decision.rule_id}` : 'Policy check'}
        />
      </div>

      {result ? (
        <div className="mt-4 text-sm flex flex-wrap items-center gap-2">
          <span className="text-neutral-500">Result:</span>
          <StatusPill status={result.status} />
          {result.transaction_id && (
            <span className="font-mono text-xs text-neutral-500 tnum">txn #{result.transaction_id}</span>
          )}
          {result.decision?.payment_error && (
            <ErrorNote message={`Payment error: ${result.decision.payment_error}`} className="mt-2 w-full" />
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {req.needs_second_approver && (
            <div className="flex items-center gap-2 rounded-input border border-amber-300 bg-warn-tint px-3 py-2 text-xs text-warn">
              <Lock className="h-4 w-4 shrink-0" />
              <span>
                Two-person rule. First approval by <strong>{req.approvals[0]?.full_name}</strong>. A different approver
                must confirm.
              </span>
            </div>
          )}
          <div className="flex flex-col lg:flex-row gap-2">
            <input
              className="input flex-1"
              placeholder="Optional note for the ledger"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <input
              className="input lg:w-56"
              type="password"
              autoComplete="current-password"
              placeholder="Your password to confirm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1 lg:flex-none" onClick={() => act('reject')} disabled={busy !== null}>
                {busy === 'reject' ? <Spinner /> : <X className="h-4 w-4" />} Decline
              </button>
              <span className="relative group flex-1 lg:flex-none">
                <button className="btn-success w-full" onClick={() => act('approve')} disabled={busy !== null || killSwitch}>
                  {busy === 'approve' ? <Spinner /> : killSwitch ? <Lock className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  Approve {sar(req.amount)}
                </button>
                {killSwitch && (
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover:block whitespace-nowrap rounded-input bg-ink text-white text-xs px-2 py-1"
                  >
                    Kill switch is on. Lift it to approve.
                  </span>
                )}
              </span>
            </div>
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
        title="Approvals"
        subtitle="Requests above an agent's approval threshold wait here. Only a human can approve."
        actions={
          <button className="btn-secondary" onClick={() => pending.refetch()} disabled={pending.loading}>
            {pending.loading && <Spinner />} Refresh
          </button>
        }
      />

      {killSwitch && (
        <div className="mb-4 flex items-center gap-2 rounded-input border border-red-200 bg-danger-tint px-3 py-2 text-sm text-danger">
          <Lock className="h-4 w-4" /> Approvals are frozen while the kill switch is on. You can still decline.
        </div>
      )}

      {pending.loading && !pending.data ? (
        <PageLoader />
      ) : pending.error && !pending.data ? (
        <ErrorNote message={pending.error} />
      ) : list.length === 0 && done.length === 0 ? (
        <div className="card-lg">
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
                if (res.needs_second_approver && res.status === 'pending_approval') {
                  void pending.refetch()
                  return
                }
                setDone((d) => [res, ...d])
                // refetch after a moment so the user sees the result status first
                window.setTimeout(() => void pending.refetch(), 1200)
              }}
            />
          ))}
          {done.length > 0 && list.length === 0 && (
            <div className="card-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-line font-bold text-sm">Decided this session</div>
              <ul className="divide-y divide-line">
                {done.map((r) => (
                  <li key={r.id} className="px-5 py-3 flex items-center gap-3">
                    <span className="font-mono text-xs text-neutral-500 w-11 shrink-0 tnum">{formatTime(r.created_at)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{r.merchant}</div>
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

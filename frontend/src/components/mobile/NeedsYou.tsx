import { useEffect, useState } from 'react'
import { Check, CheckCircle2, Lock, X, XCircle } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { sar } from '../../lib/money'
import type { PurchaseRequest } from '../../types'
import { BottomSheet } from './BottomSheet'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'

type Action = 'approve' | 'reject'

function ConfirmSheet({
  req,
  action,
  onClose,
  onDone,
}: {
  req: PurchaseRequest
  action: Action | null
  onClose: () => void
  onDone: (result: PurchaseRequest) => void
}) {
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (action) {
      setPassword('')
      setNote('')
      setError(null)
    }
  }, [action])

  const confirm = async () => {
    if (!action) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<PurchaseRequest>(`/approvals/${req.id}/${action}`, {
        note: note.trim() || undefined,
        password: password || undefined,
      })
      onDone(data)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const approving = action === 'approve'
  return (
    <BottomSheet open={!!action} onClose={onClose} title={approving ? `Approve ${sar(req.amount)}` : `Decline ${sar(req.amount)}`}>
      <p className="text-sm text-neutral-600 mb-4">
        {approving ? 'Pay' : 'Decline'} <strong className="text-ink">{req.merchant}</strong> for {req.agent_name}. Confirm with your password.
      </p>
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="m-password">Your password</label>
          <input
            id="m-password"
            className="input h-12 text-base"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="m-note">Note (optional)</label>
          <input
            id="m-note"
            className="input h-12 text-base"
            placeholder="For the ledger"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <ErrorNote message={error} />
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className={`w-full h-14 rounded-pill text-base font-bold inline-flex items-center justify-center gap-2 text-white ${
            approving ? 'bg-success hover:bg-[#0C8A45]' : 'bg-ink hover:bg-neutral-800'
          } disabled:opacity-50`}
        >
          {busy ? <Spinner className="h-5 w-5" /> : approving ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}
          {approving ? 'Confirm and pay' : 'Confirm decline'}
        </button>
      </div>
    </BottomSheet>
  )
}

function ApprovalCard({ req, killSwitch, onRemove, onSecond }: { req: PurchaseRequest; killSwitch: boolean; onRemove: (id: number) => void; onSecond: () => void }) {
  const [action, setAction] = useState<Action | null>(null)
  const [result, setResult] = useState<PurchaseRequest | null>(null)
  const [second, setSecond] = useState(req.needs_second_approver && req.approvals.length > 0)

  useEffect(() => {
    if (!result) return
    const t = window.setTimeout(() => onRemove(req.id), 1500)
    return () => window.clearTimeout(t)
  }, [result, req.id, onRemove])

  const lastReason = req.decision?.reasons?.length ? req.decision.reasons[req.decision.reasons.length - 1] : null

  if (result) {
    const paid = result.status !== 'rejected' && result.status !== 'denied' && result.status !== 'failed'
    return (
      <div className={`rounded-card-lg border p-5 flex items-center gap-3 ${paid ? 'bg-success-tint border-success/30 text-success' : 'bg-lavender-deep border-line text-neutral-600'}`}>
        {paid ? <CheckCircle2 className="h-6 w-6 shrink-0" /> : <XCircle className="h-6 w-6 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-bold">{paid ? (result.status === 'completed' ? 'Paid' : 'Approved') : 'Declined'}</div>
          <div className="text-xs truncate opacity-80">{result.merchant} · {sar(result.amount)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="card-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold truncate">{req.merchant}</div>
          <div className="text-xs text-neutral-500 truncate mt-0.5">
            {req.agent_name} · {req.category}
          </div>
        </div>
        <div className="text-[22px] leading-none font-extrabold tracking-tightest tnum whitespace-nowrap">{sar(req.amount)}</div>
      </div>

      {req.description && (
        <div className="mt-3 rounded-card bg-lavender-deep px-3.5 py-3 text-sm leading-relaxed">{req.description}</div>
      )}
      {lastReason && <div className="mt-2.5 text-xs text-neutral-500 leading-snug">{lastReason}</div>}

      {second && (
        <div className="mt-3 flex items-start gap-2 rounded-input border border-amber-300 bg-warn-tint px-3 py-2.5 text-xs text-warn">
          <Lock className="h-4 w-4 shrink-0 mt-px" />
          <span>First approval recorded. A second approver must confirm.</span>
        </div>
      )}
      {killSwitch && (
        <div className="mt-3 flex items-center gap-2 rounded-input border border-red-200 bg-danger-tint px-3 py-2.5 text-xs text-danger">
          <Lock className="h-4 w-4 shrink-0" /> Kill switch is on. Lift it to approve.
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => setAction('reject')}
          className="h-12 rounded-pill border border-line-strong bg-white text-ink text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:bg-lavender"
        >
          <X className="h-4 w-4" /> Decline
        </button>
        <button
          type="button"
          onClick={() => setAction('approve')}
          disabled={killSwitch}
          className="h-12 rounded-pill bg-success text-white text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[#0C8A45] disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> Approve
        </button>
      </div>

      <ConfirmSheet
        req={req}
        action={action}
        onClose={() => setAction(null)}
        onDone={(data) => {
          if (data.needs_second_approver && data.status === 'pending_approval') {
            setSecond(true)
            onSecond()
            return
          }
          setResult(data)
        }}
      />
    </div>
  )
}

export function NeedsYou({
  items,
  loading,
  killSwitch,
  onRemove,
  onChanged,
}: {
  items: PurchaseRequest[]
  loading: boolean
  killSwitch: boolean
  onRemove: (id: number) => void
  onChanged: () => void
}) {
  return (
    <section>
      <div className="flex items-center justify-between px-1 mb-2.5">
        <h2 className="text-sm font-bold">Needs you</h2>
        {items.length > 0 && (
          <span className="inline-flex min-w-[22px] h-[22px] items-center justify-center rounded-pill bg-brand px-1.5 text-[11px] font-bold text-white tnum">
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="card-lg p-6 text-center">
          <div className="mx-auto mb-2.5 h-11 w-11 rounded-full bg-success-tint text-success flex items-center justify-center">
            {loading ? <Spinner /> : <CheckCircle2 className="h-5 w-5" />}
          </div>
          <div className="text-sm font-bold">Nothing waiting for you.</div>
          <div className="text-xs text-neutral-500 mt-1">Holds show up here the moment an AI employee needs a human.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <ApprovalCard key={r.id} req={r} killSwitch={killSwitch} onRemove={onRemove} onSecond={onChanged} />
          ))}
        </div>
      )}
    </section>
  )
}

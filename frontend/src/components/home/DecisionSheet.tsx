import { useEffect, useState } from 'react'
import { Check, Lock, X } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { sar } from '../../lib/money'
import type { PurchaseRequest } from '../../types'
import { Sheet } from '../Sheet'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'

export type DecisionAction = 'approve' | 'reject'

export interface DecisionTarget {
  id: number
  merchant: string
  amount: number
  agent_name: string
  needs_second_approver?: boolean
  firstApprover?: string | null
}

/** Confirm an approve / decline with an optional note and the user's password. Sheet on phones, modal on desktop. */
export function DecisionSheet({
  target,
  action,
  onClose,
  onDone,
}: {
  target: DecisionTarget | null
  action: DecisionAction | null
  onClose: () => void
  onDone: (result: PurchaseRequest, action: DecisionAction) => void
}) {
  const { company } = useAuth()
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = !!target && !!action
  const needsPassword = company?.require_password_on_approve ?? true

  useEffect(() => {
    if (open) {
      setPassword('')
      setNote('')
      setError(null)
    }
  }, [open])

  const confirm = async () => {
    if (!target || !action) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<PurchaseRequest>(`/approvals/${target.id}/${action}`, {
        note: note.trim() || undefined,
        password: password || undefined,
      })
      onDone(data, action)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const approving = action === 'approve'
  const title = target ? (approving ? `Approve ${sar(target.amount)}` : `Decline ${sar(target.amount)}`) : ''

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <button
          type="button"
          onClick={confirm}
          disabled={busy || (needsPassword && !password)}
          className={`w-full h-12 rounded-pill text-sm font-bold inline-flex items-center justify-center gap-2 text-white disabled:opacity-50 ${
            approving ? 'bg-success hover:bg-[#0C8A45]' : 'bg-ink hover:bg-neutral-800'
          }`}
        >
          {busy ? <Spinner className="h-5 w-5" /> : approving ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {approving ? 'Confirm and pay' : 'Confirm decline'}
        </button>
      }
    >
      {target && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            {approving ? 'Pay' : 'Decline'} <strong className="text-ink">{target.merchant}</strong> for {target.agent_name}.
          </p>
          {target.needs_second_approver && (
            <div className="flex items-start gap-2 rounded-input border border-amber-300 bg-warn-tint px-3 py-2.5 text-xs text-warn">
              <Lock className="h-4 w-4 shrink-0 mt-px" />
              <span>
                Two-person rule. {target.firstApprover ? `First approval by ${target.firstApprover}. ` : ''}A different approver must confirm before money moves.
              </span>
            </div>
          )}
          <div>
            <label className="label" htmlFor="ds-note">Note (optional)</label>
            <input id="ds-note" className="input h-11" placeholder="For the ledger" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ds-password">
              Your password{needsPassword ? '' : ' (optional)'}
            </label>
            <input
              id="ds-password"
              className="input h-11"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirm()
              }}
              autoFocus
            />
          </div>
          <ErrorNote message={error} />
        </div>
      )}
    </Sheet>
  )
}

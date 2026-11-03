import { useState } from 'react'
import { Power, ShieldAlert, ShieldCheck, Square } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { Company } from '../types'
import { Modal } from './Modal'
import { Spinner } from './Spinner'

/** Shared kill switch state and the confirmation / reason modal. */
function useKillSwitch(onChanged?: (c: Company) => void) {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const on = !!company?.kill_switch

  const submit = async (enabled: boolean) => {
    setBusy(true)
    try {
      const { data } = await api.post<Company>('/company/kill-switch', {
        enabled,
        reason: enabled ? reason.trim() || 'Manual activation' : 'Lifted by owner',
      })
      setCompany(data)
      onChanged?.(data)
      toast.success(enabled ? 'Kill switch enabled. All AI spending is frozen.' : 'Kill switch lifted.')
      setOpen(false)
      setReason('')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const modal = (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={on ? 'Lift the kill switch?' : 'Enable the kill switch?'}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          {on ? (
            <button className="btn-primary" onClick={() => submit(false)} disabled={busy}>
              {busy && <Spinner />}
              Lift kill switch
            </button>
          ) : (
            <button className="btn-danger" onClick={() => submit(true)} disabled={busy}>
              {busy && <Spinner />}
              Freeze all AI spending
            </button>
          )}
        </>
      }
    >
      {on ? (
        <p className="text-sm text-neutral-600">
          AI employees will be able to request purchases again, subject to their normal limits and approvals.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            All new AI purchase requests will be denied instantly and pending approvals will be frozen. The reason is
            written to the audit ledger.
          </p>
          <div>
            <label className="label" htmlFor="ks-reason">
              Reason
            </label>
            <input
              id="ks-reason"
              className="input"
              placeholder="e.g. Suspicious activity on Marketing AI"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      )}
    </Modal>
  )

  return { on, openModal: () => setOpen(true), modal }
}

/** Red pill button for page headers. Opens the same confirmation modal as the panel. */
export function KillSwitchButton({ onChanged, className = '' }: { onChanged?: (c: Company) => void; className?: string }) {
  const { on, openModal, modal } = useKillSwitch(onChanged)
  return (
    <>
      <button
        type="button"
        onClick={openModal}
        role="switch"
        aria-checked={on}
        className={`btn ${on ? 'bg-ink text-white hover:bg-neutral-800' : 'bg-danger text-white hover:bg-[#C8262E]'} ${className}`}
      >
        <Square className="h-2.5 w-2.5 fill-current" />
        {on ? 'Lift kill switch' : 'Kill switch'}
      </button>
      {modal}
    </>
  )
}

/**
 * Emergency spending controls panel, used on the settings page.
 * Enabling asks for a reason; disabling confirms.
 */
export function KillSwitchPanel({ onChanged }: { onChanged?: (c: Company) => void }) {
  const { on, openModal, modal } = useKillSwitch(onChanged)

  return (
    <div className={`card p-5 ${on ? 'border-danger/40 bg-danger-tint/50' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className={`rounded-2xl p-3 shrink-0 self-start ${on ? 'bg-danger text-white' : 'bg-brand-light text-brand'}`}>
          {on ? <ShieldAlert className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold">Emergency spending controls</h3>
          <p className="text-sm text-neutral-600 mt-0.5">
            {on
              ? 'Kill switch is ON. Every new AI purchase request is denied instantly and pending approvals are frozen.'
              : 'One switch to freeze every AI employee. New requests are denied and pending approvals cannot be approved until it is lifted.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          role="switch"
          aria-checked={on}
          className={`shrink-0 inline-flex items-center gap-3 rounded-pill border px-2 py-1.5 pr-4 text-sm font-semibold transition-colors ${
            on ? 'bg-danger border-danger text-white hover:bg-[#C8262E]' : 'bg-white border-line-strong text-ink hover:bg-lavender'
          }`}
        >
          <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? 'bg-white/30' : 'bg-line-strong'}`}>
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
          </span>
          <Power className="h-4 w-4" />
          {on ? 'Kill switch ON' : 'Kill switch OFF'}
        </button>
      </div>
      {modal}
    </div>
  )
}

import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useKillSwitch } from '../KillSwitchPanel'
import type { Company } from '../../types'

/**
 * Big full-width kill switch for the phone view. Reuses the shared hook, whose confirmation
 * modal already renders as a bottom sheet on narrow screens and asks for a one-line reason.
 */
export function MobileKillSwitch({ onChanged }: { onChanged?: (c: Company) => void }) {
  const { company } = useAuth()
  const { on, openModal, modal } = useKillSwitch(onChanged)

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={openModal}
        className={`w-full text-left rounded-card-lg border p-4 transition-colors ${
          on ? 'bg-danger-tint border-danger/40' : 'bg-white border-line shadow-card'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <span className={`rounded-2xl p-2.5 shrink-0 ${on ? 'bg-danger text-white' : 'bg-brand-light text-brand'}`}>
            {on ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="mono-label mb-0.5">Kill switch</div>
            <div className={`text-base font-bold leading-tight ${on ? 'text-danger' : 'text-ink'}`}>
              {on ? 'All AI spending is stopped' : 'AI spending is live'}
            </div>
            {on && company?.kill_switch_reason && (
              <div className="text-xs text-danger/80 mt-0.5 truncate">{company.kill_switch_reason}</div>
            )}
            {!on && <div className="text-xs text-neutral-500 mt-0.5">Tap to freeze every AI employee instantly.</div>}
          </div>
          <span
            className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-danger' : 'bg-line-strong'}`}
            aria-hidden
          >
            <span
              className={`inline-block h-7 w-7 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[26px]' : 'translate-x-0.5'}`}
            />
          </span>
        </div>
      </button>
      {modal}
    </>
  )
}

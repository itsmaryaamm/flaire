import { useState } from 'react'
import { Check, CheckCircle2, Lock, X } from 'lucide-react'
import { sar } from '../../lib/money'
import { timeAgo } from '../../lib/useFetch'
import { useT } from '../../lib/i18n'
import { chainStatus } from '../../lib/chain'
import type { ChainState, PurchaseRequest } from '../../types'
import { Spinner } from '../Spinner'
import { DecisionSheet, type DecisionAction } from './DecisionSheet'

export type NeedsYouItem = PurchaseRequest & { chain?: ChainState | null }

function lastReason(r: PurchaseRequest): string | null {
  const reasons = r.decision?.reasons ?? []
  return reasons.length ? reasons[reasons.length - 1] : null
}

/** Requests waiting for a human. Approve / Decline open the confirm sheet. Rows from /me/view carry the chain status. */
export function NeedsYou({
  items,
  loading,
  killSwitch,
  onDecided,
  title,
}: {
  items: NeedsYouItem[]
  loading: boolean
  killSwitch: boolean
  onDecided: (result: PurchaseRequest) => void
  title?: string
}) {
  const t = useT()
  const [picked, setPicked] = useState<{ req: PurchaseRequest; action: DecisionAction } | null>(null)

  return (
    <section>
      <div className="flex items-center justify-between px-1 mb-2.5">
        <h2 className="text-sm font-bold">{title ?? t('home.needsYou')}</h2>
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
          <div className="text-sm font-bold">{t('home.nothingNeedsYou')}</div>
          <div className="text-xs text-neutral-500 mt-1">{t('home.holdsShowUp')}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const chainText = chainStatus(t, r.chain)
            const reason = chainText ?? lastReason(r)
            const second = !chainText && r.needs_second_approver && r.approvals.length > 0
            return (
              <div key={r.id} className="card-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-neutral-500 truncate">
                      {r.agent_name} · {timeAgo(r.created_at)}
                    </div>
                    <div className="text-base font-bold truncate mt-0.5">{r.merchant}</div>
                  </div>
                  <div className="text-[22px] leading-none font-extrabold tracking-tightest tnum whitespace-nowrap">{sar(r.amount)}</div>
                </div>
                {reason && <div className="mt-2.5 text-xs text-neutral-600 leading-snug">{reason}</div>}
                {second && (
                  <div className="mt-3 flex items-start gap-2 rounded-input border border-amber-300 bg-warn-tint px-3 py-2 text-xs text-warn">
                    <Lock className="h-4 w-4 shrink-0 mt-px" />
                    <span>{t('home.firstApprovalBy', { name: r.approvals[0]?.full_name ?? '' })}</span>
                  </div>
                )}
                {killSwitch && (
                  <div className="mt-3 flex items-center gap-2 rounded-input border border-red-200 bg-danger-tint px-3 py-2 text-xs text-danger">
                    <Lock className="h-4 w-4 shrink-0" /> {t('home.killSwitchOnLift')}
                  </div>
                )}
                <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPicked({ req: r, action: 'reject' })}
                    className="h-11 rounded-pill border border-line-strong bg-white text-ink text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:bg-lavender"
                  >
                    <X className="h-4 w-4" /> {t('common.decline')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPicked({ req: r, action: 'approve' })}
                    disabled={killSwitch}
                    className="h-11 rounded-pill bg-success text-white text-sm font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[#0C8A45] disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" /> {t('common.approve')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <DecisionSheet
        target={
          picked
            ? {
                id: picked.req.id,
                merchant: picked.req.merchant,
                amount: picked.req.amount,
                agent_name: picked.req.agent_name,
                needs_second_approver: picked.req.needs_second_approver,
                firstApprover: picked.req.approvals[0]?.full_name ?? null,
              }
            : null
        }
        action={picked?.action ?? null}
        onClose={() => setPicked(null)}
        onDone={onDecided}
      />
    </section>
  )
}

import { useState } from 'react'
import { ChevronDown, ChevronRight, UserCheck } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { money, sar } from '../../lib/money'
import { formatDate } from '../../lib/useFetch'
import type { PurchaseRequest, Transaction } from '../../types'
import { StatusPill } from '../StatusPill'
import { DecisionDetails } from '../DecisionDetails'
import { providerLabel } from '../employees/CardTile'
import { Spinner } from '../Spinner'
import { useT } from '../../lib/i18n'
import type { TFn } from '../../lib/i18n'
import { ReceiptsButton } from './ReceiptsSheet'

/**
 * Who answers for this payment. From the transaction's `accountable` when the backend sends it;
 * otherwise from the request's approver. Null when nothing is known.
 */
export function accountabilityLine(t: TFn, r: PurchaseRequest, tx: Transaction | null): string | null {
  const who = tx?.accountable?.full_name
  if (who) {
    return tx?.accountable_reason === 'auto_under_limits' ? t('activity.autoApprovedUnderLimitsBy', { name: who }) : t('activity.approvedBy', { name: who })
  }
  if (r.approved_by?.full_name) return t('activity.approvedBy', { name: r.approved_by.full_name })
  if (r.approvals.length > 0) return t('activity.approvedBy', { name: r.approvals.map((a) => a.full_name).join(', ') })
  if (r.status === 'completed' && r.decision?.verdict === 'approved') return t('activity.autoApprovedUnderLimits')
  return null
}

/** True when the issuer charged the card in another currency than the request. */
function chargedElsewhere(tx: Transaction | null): tx is Transaction & { issuer_amount: number; issuer_currency: string } {
  if (!tx || typeof tx.issuer_amount !== 'number' || !tx.issuer_currency) return false
  return tx.issuer_currency.toUpperCase() !== (tx.currency || 'SAR').toUpperCase()
}

/** "Card charged USD 80.00 at 3.75" */
export function ChargedLine({ tx, className = '' }: { tx: Transaction | null; className?: string }) {
  const t = useT()
  if (!chargedElsewhere(tx)) return null
  const rate = typeof tx.fx_rate === 'number' && tx.fx_rate > 0 ? ` ${t('activity.atRate', { rate: tx.fx_rate })}` : ''
  return <div className={`text-[11px] text-neutral-400 tnum whitespace-nowrap ${className}`}>{t('activity.cardCharged', { amount: money(tx.issuer_amount, tx.issuer_currency) }) + rate}</div>
}

function TransactionBlock({ tx, request, onSettled }: { tx: Transaction; request: PurchaseRequest; onSettled: () => void }) {
  const toast = useToast()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const settle = async () => {
    setBusy(true)
    try {
      await api.post(`/transactions/${tx.id}/settle`)
      toast.success(t('activity.settled'))
      onSettled()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const accountable = accountabilityLine(t, request, tx)
  return (
    <div className="rounded-card border border-line bg-white px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="mono-label">{t('activity.transaction')}</span>
        <StatusPill status={tx.status} />
        {tx.status === 'authorized' && (
          <button className="btn-secondary text-xs h-7 px-2.5" onClick={settle} disabled={busy}>
            {busy && <Spinner className="h-3 w-3" />} {t('activity.settleNow')}
          </button>
        )}
        <span className="ms-auto">
          <ReceiptsButton tx={tx} />
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="text-neutral-500">{t('activity.amount')}</dt>
          <dd className="font-semibold tnum">{sar(tx.amount)}</dd>
          <ChargedLine tx={tx} />
        </div>
        <div>
          <dt className="text-neutral-500">{t('activity.card')}</dt>
          <dd className="font-mono">
            {tx.card_label} <span className="text-neutral-400 font-sans">{providerLabel(tx.provider)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">{t('activity.providerRef')}</dt>
          <dd className="font-mono break-all">{tx.provider_ref}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">{t('activity.flaireFee')}</dt>
          <dd className="font-semibold tnum">
            {sar(tx.fee ?? 0)}
            {tx.fee_rate_bps ? <span className="text-neutral-400 font-normal"> ({(tx.fee_rate_bps / 100).toFixed(2)}%)</span> : null}
          </dd>
        </div>
      </dl>
      {accountable && (
        <div className="mt-2.5 pt-2.5 border-t border-line flex items-start gap-2 text-xs text-neutral-600">
          <UserCheck className="h-3.5 w-3.5 text-brand shrink-0 mt-px" />
          <span>
            {accountable}
            {tx.accountable?.role && <span className="text-neutral-400"> · {t(`role.${tx.accountable.role}`)}</span>}
          </span>
        </div>
      )}
      {tx.decline_reason && <div className="text-xs text-danger mt-2">{tx.decline_reason}</div>}
    </div>
  )
}

/** One purchase request, expandable to the decision, the transaction and who answers for it. */
export function ActivityRow({ request: r, transaction, onChanged }: { request: PurchaseRequest; transaction: Transaction | null; onChanged: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const accountable = accountabilityLine(t, r, transaction)
  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-lavender/60" aria-expanded={open}>
        <span className="text-neutral-400 shrink-0">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rtl-flip" />}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{r.merchant}</div>
          <div className="text-xs text-neutral-500 truncate">
            {r.agent_name} · {formatDate(r.created_at)}
          </div>
          {accountable && <div className="text-[11px] text-neutral-500 truncate mt-0.5">{accountable}</div>}
        </div>
        <div className="text-end">
          <div className="text-sm font-semibold tnum whitespace-nowrap">{sar(r.amount)}</div>
          <ChargedLine tx={transaction} />
        </div>
        <StatusPill status={r.status} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 bg-lavender/40 border-t border-line">
          {r.description && <p className="text-sm text-ink leading-relaxed pt-2">{r.description}</p>}
          <DecisionDetails request={r} />
          {transaction ? (
            <TransactionBlock tx={transaction} request={r} onSettled={onChanged} />
          ) : r.transaction_id ? (
            <div className="text-xs text-neutral-500">
              {t('activity.transaction')} #{r.transaction_id}
            </div>
          ) : null}
          {(r.approvals.length > 0 || (!transaction && accountable)) && (
            <div className="text-xs text-neutral-600 space-y-1">
              {r.approvals.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="mono-label">{t('activity.approvals')}</span>
                  {r.approvals.map((x, i) => (
                    <span key={x.id} className="inline-flex items-center gap-1 rounded-pill bg-white border border-line px-2 py-0.5">
                      <span className="font-mono text-[10px] text-neutral-400">{i + 1}</span> {x.full_name}
                    </span>
                  ))}
                  {r.decided_at && <span className="text-neutral-400">{formatDate(r.decided_at)}</span>}
                </div>
              ) : (
                <div>
                  {accountable}
                  {r.decided_at && <span className="text-neutral-400"> · {formatDate(r.decided_at)}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

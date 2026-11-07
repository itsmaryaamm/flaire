import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { sar } from '../../lib/money'
import { formatDate } from '../../lib/useFetch'
import type { PurchaseRequest, Transaction } from '../../types'
import { StatusPill } from '../StatusPill'
import { DecisionDetails } from '../DecisionDetails'
import { providerLabel } from '../employees/CardTile'
import { Spinner } from '../Spinner'

function TransactionBlock({ tx, onSettled }: { tx: Transaction; onSettled: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const settle = async () => {
    setBusy(true)
    try {
      await api.post(`/transactions/${tx.id}/settle`)
      toast.success('Settled with the card provider.')
      onSettled()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-card border border-line bg-white px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="mono-label">Transaction</span>
        <StatusPill status={tx.status} />
        {tx.status === 'authorized' && (
          <button className="btn-secondary text-xs h-7 px-2.5" onClick={settle} disabled={busy}>
            {busy && <Spinner className="h-3 w-3" />} Settle now
          </button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="text-neutral-500">Card</dt>
          <dd className="font-mono">{tx.card_label}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Provider</dt>
          <dd className="font-semibold">{providerLabel(tx.provider)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Provider ref</dt>
          <dd className="font-mono break-all">{tx.provider_ref}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Flaire fee</dt>
          <dd className="font-semibold tnum">
            {sar(tx.fee ?? 0)}
            {tx.fee_rate_bps ? <span className="text-neutral-400 font-normal"> ({(tx.fee_rate_bps / 100).toFixed(2)}%)</span> : null}
          </dd>
        </div>
      </dl>
      {tx.decline_reason && <div className="text-xs text-danger mt-2">{tx.decline_reason}</div>}
    </div>
  )
}

/** One purchase request, expandable to the decision, the transaction and the approver. */
export function ActivityRow({ request: r, transaction, onChanged }: { request: PurchaseRequest; transaction: Transaction | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-lavender/60"
        aria-expanded={open}
      >
        <span className="text-neutral-400 shrink-0">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{r.merchant}</div>
          <div className="text-xs text-neutral-500 truncate">
            {r.agent_name} · {formatDate(r.created_at)}
          </div>
        </div>
        <div className="text-sm font-semibold tnum whitespace-nowrap">{sar(r.amount)}</div>
        <StatusPill status={r.status} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 bg-lavender/40 border-t border-line">
          {r.description && <p className="text-sm text-ink leading-relaxed pt-2">{r.description}</p>}
          <DecisionDetails request={r} />
          {transaction ? (
            <TransactionBlock tx={transaction} onSettled={onChanged} />
          ) : r.transaction_id ? (
            <div className="text-xs text-neutral-500">Transaction #{r.transaction_id}</div>
          ) : null}
          {(r.approved_by || r.approvals.length > 0) && (
            <div className="text-xs text-neutral-600">
              <span className="mono-label mr-2">Approver</span>
              {r.approved_by?.full_name ?? r.approvals.map((x) => x.full_name).join(', ')}
              {r.decided_at && <span className="text-neutral-400"> · {formatDate(r.decided_at)}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

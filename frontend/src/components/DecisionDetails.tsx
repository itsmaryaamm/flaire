import { CheckCircle2, XCircle, Clock, ShieldCheck, AlertTriangle } from 'lucide-react'
import type { Decision, PurchaseRequest } from '../types'
import { StatusPill } from './StatusPill'

function ReasonIcon({ verdict }: { verdict: Decision['verdict'] }) {
  if (verdict === 'approved') return <CheckCircle2 className="h-4 w-4 text-mint-deep shrink-0 mt-0.5" />
  if (verdict === 'denied') return <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
  return <Clock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
}

export function ReasonsList({ decision, className = '' }: { decision: Decision | null | undefined; className?: string }) {
  if (!decision || !decision.reasons?.length)
    return <p className={`text-sm text-neutral-500 ${className}`}>No decision reasons recorded.</p>
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {decision.reasons.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
          <ReasonIcon verdict={decision.verdict} />
          <span>{r}</span>
        </li>
      ))}
    </ul>
  )
}

export function truncateMiddle(s: string, keep = 10): string {
  if (s.length <= keep * 2 + 3) return s
  return `${s.slice(0, keep)}...${s.slice(-keep)}`
}

/** Full decision panel: verdict, engine, rule, reasons checklist, receipt, payment error. */
export function DecisionDetails({ request }: { request: PurchaseRequest }) {
  const d = request.decision
  if (!d) return <p className="text-sm text-neutral-500">No decision has been recorded for this request.</p>
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 w-16">Verdict</span>
          <StatusPill status={d.verdict} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 w-16">Engine</span>
          <span className="font-medium">{d.engine === 'shotoku' ? 'Shotoku core (sidecar)' : 'Flaire native'}</span>
        </div>
        {d.rule_id && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 w-16">Rule</span>
            <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">{d.rule_id}</code>
          </div>
        )}
        {d.receipt && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 w-16">Receipt</span>
            <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded" title={d.receipt}>
              {truncateMiddle(d.receipt, 12)}
            </code>
            <span className="inline-flex items-center gap-1 rounded-full bg-mint text-brand-dark text-[10px] font-semibold px-1.5 py-0.5">
              <ShieldCheck className="h-3 w-3" /> signed
            </span>
          </div>
        )}
        {request.approved_by && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 w-16">By</span>
            <span>{request.approved_by.full_name}</span>
          </div>
        )}
        {request.transaction_id && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 w-16">Txn</span>
            <span className="tnum">#{request.transaction_id}</span>
          </div>
        )}
      </div>
      <div className="md:col-span-2">
        <div className="text-xs text-neutral-500 mb-1.5">Decision reasons</div>
        <ReasonsList decision={d} />
        {d.payment_error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>Payment error:</strong> {d.payment_error}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

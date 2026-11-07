import { ShieldCheck, AlertTriangle } from 'lucide-react'
import type { Decision, PurchaseRequest } from '../types'
import { StatusPill } from './StatusPill'
import { PolicyCheck } from './PolicyCheck'
import { useT } from '../lib/i18n'

export function ReasonsList({ decision, className = '' }: { decision: Decision | null | undefined; className?: string }) {
  return <PolicyCheck decision={decision} label={null} className={className} />
}

export function truncateMiddle(s: string, keep = 10): string {
  if (s.length <= keep * 2 + 3) return s
  return `${s.slice(0, keep)}...${s.slice(-keep)}`
}

/** Full decision panel: verdict, engine, rule, reasons checklist, receipt, payment error. */
export function DecisionDetails({ request }: { request: PurchaseRequest }) {
  const t = useT()
  const d = request.decision
  if (!d) return <p className="text-sm text-neutral-500">{t('decision.noDecision')}</p>
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="mono-label w-16">{t('decision.verdict')}</span>
          <StatusPill status={d.verdict} />
        </div>
        <div className="flex items-center gap-2">
          <span className="mono-label w-16">{t('decision.engine')}</span>
          <span className="font-medium">{d.engine === 'shotoku' ? 'Shotoku core (sidecar)' : 'Flaire native'}</span>
        </div>
        {d.rule_id && (
          <div className="flex items-center gap-2">
            <span className="mono-label w-16">{t('decision.rule')}</span>
            <code className="font-mono text-xs bg-lavender-deep px-1.5 py-0.5 rounded">{d.rule_id}</code>
          </div>
        )}
        {d.receipt && (
          <div className="flex items-center gap-2">
            <span className="mono-label w-16">{t('decision.receipt')}</span>
            <code className="font-mono text-xs bg-lavender-deep px-1.5 py-0.5 rounded" title={d.receipt}>
              {truncateMiddle(d.receipt, 12)}
            </code>
            <span className="inline-flex items-center gap-1 rounded-pill bg-success-tint text-success text-[10px] font-semibold px-1.5 py-0.5">
              <ShieldCheck className="h-3 w-3" /> {t('decision.signed')}
            </span>
          </div>
        )}
        {request.approved_by && (
          <div className="flex items-center gap-2">
            <span className="mono-label w-16">{t('decision.by')}</span>
            <span>{request.approved_by.full_name}</span>
          </div>
        )}
        {request.transaction_id && (
          <div className="flex items-center gap-2">
            <span className="mono-label w-16">{t('decision.txn')}</span>
            <span className="tnum font-mono text-xs">#{request.transaction_id}</span>
          </div>
        )}
      </div>
      <div className="md:col-span-2">
        <PolicyCheck decision={d} />
        {d.payment_error && (
          <div className="mt-3 flex items-start gap-2 rounded-input border border-red-200 bg-danger-tint px-3 py-2 text-xs text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>{t('decision.paymentError')}:</strong> {d.payment_error}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

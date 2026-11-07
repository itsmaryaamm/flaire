import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { downloadFile, errorMessage } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { sar } from '../../lib/money'
import type { Statement, StatementBucket } from '../../types'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { StatusPill } from '../StatusPill'

function Breakdown({ title, rows, sub }: { title: string; rows: StatementBucket[]; sub?: (b: StatementBucket) => string | null }) {
  const t = useT()
  return (
    <div>
      <h4 className="text-xs font-semibold text-neutral-600 mb-1.5">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-400">{t('finance.noRows')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {rows.map((b, i) => (
            <li key={`${b.key ?? 'none'}-${i}`} className="px-3 py-1.5 flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate">
                <span className="font-semibold text-ink">{b.label}</span>
                {sub?.(b) && <span className="text-neutral-500"> · {sub(b)}</span>}
                <span className="text-neutral-400 tnum"> · {b.count}</span>
              </span>
              <span className="tnum font-semibold">{sar(b.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Totals for one period, plus the three ERP exports for it. */
export function StatementCard({ statement, loading, error, periodLabel }: { statement: Statement | null; loading: boolean; error: string | null; periodLabel: string }) {
  const t = useT()
  const toast = useToast()
  const [exporting, setExporting] = useState<string | null>(null)

  const exportIt = async (kind: 'transactions' | 'sap' | 'oracle') => {
    if (!statement) return
    setExporting(kind)
    try {
      await downloadFile(`/finance/exports/${kind}.csv`, `flaire-${kind}-${statement.period}.csv`, { period: statement.period })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setExporting(null)
    }
  }

  return (
    <section id="statement" className="card-lg p-5 scroll-mt-20">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <FileText className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('finance.statement')}</h3>
        <span className="text-sm text-neutral-600">{periodLabel}</span>
        {statement?.closed && <StatusPill tone="neutral">{t('finance.closedBadge')}</StatusPill>}
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('finance.statementHint')}</p>

      {error && !statement ? (
        <ErrorNote message={error} />
      ) : loading && !statement ? (
        <div className="py-4 text-xs text-neutral-500 flex items-center gap-2">
          <Spinner className="h-3.5 w-3.5" /> {t('common.loading')}
        </div>
      ) : statement ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              [t('finance.volume'), sar(statement.volume)],
              [t('finance.vatWithRate', { rate: (statement.vat_rate_bps / 100).toFixed(0) }), sar(statement.vat)],
              [t('finance.net'), sar(statement.net)],
              [t('finance.feesInclVat'), sar(statement.fees_incl_vat)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card border border-line bg-lavender px-3 py-2.5">
                <div className="text-[11px] text-neutral-500">{label}</div>
                <div className="text-base font-extrabold tracking-tightest tnum">{value}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-neutral-500 tnum">
            {t('finance.nTransactions', { n: statement.transaction_count })}
            {statement.pending_settlement > 0 && ` · ${t('finance.pendingSettlement', { n: statement.pending_settlement })}`}
            {' · '}
            {t('finance.feeLine', { fee: sar(statement.fees), rate: (statement.fee_rate_bps / 100).toFixed(2), vat: sar(statement.fee_vat) })}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Breakdown title={t('finance.byDepartment')} rows={statement.by_department} />
            <Breakdown title={t('finance.byCostCenter')} rows={statement.by_cost_center} sub={(b) => [b.name, b.gl_code ? `GL ${b.gl_code}` : null].filter(Boolean).join(' · ') || null} />
            <Breakdown title={t('finance.byEmployee')} rows={statement.by_agent} />
            <Breakdown title={t('finance.byCategory')} rows={statement.by_category} />
          </div>

          <div className="pt-4 border-t border-line">
            <h4 className="text-sm font-bold mb-1">{t('finance.exports')}</h4>
            <p className="text-xs text-neutral-500 mb-2">{t('finance.exportsHint')}</p>
            <div className="flex flex-wrap gap-2">
              {(['transactions', 'sap', 'oracle'] as const).map((k) => (
                <button key={k} type="button" className="btn-secondary text-xs" onClick={() => exportIt(k)} disabled={exporting !== null}>
                  {exporting === k ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} {t(`finance.export.${k}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="font-mono text-[10px] text-neutral-400 break-all">{statement.hash}</div>
        </div>
      ) : null}
    </section>
  )
}

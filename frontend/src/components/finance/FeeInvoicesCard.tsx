import { useState } from 'react'
import { Download, Receipt } from 'lucide-react'
import { api, downloadFile, errorMessage } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { sar } from '../../lib/money'
import { formatDate } from '../../lib/useFetch'
import type { FeeInvoice } from '../../types'
import { Spinner } from '../Spinner'

/** Flaire's own fee invoices (simplified tax invoices): list, issue for the selected month, download the PDF. */
export function FeeInvoicesCard({
  invoices,
  period,
  periodLabel,
  canIssue,
  onChanged,
}: {
  invoices: FeeInvoice[]
  period: string
  periodLabel: string
  canIssue: boolean
  onChanged: () => void
}) {
  const t = useT()
  const toast = useToast()
  const [issuing, setIssuing] = useState(false)
  const [downloading, setDownloading] = useState<number | null>(null)
  const already = invoices.some((i) => i.period === period)

  const issue = async () => {
    setIssuing(true)
    try {
      const { data } = await api.post<FeeInvoice>(`/finance/fee-invoices/${period}`)
      toast.success(t('finance.invoiceIssued', { number: data.number }))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIssuing(false)
    }
  }

  const download = async (inv: FeeInvoice) => {
    setDownloading(inv.id)
    try {
      await downloadFile(`/finance/fee-invoices/${inv.id}.pdf`, `${inv.number}.pdf`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <section id="fee-invoices" className="card-lg p-5 scroll-mt-20">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Receipt className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('finance.feeInvoices')}</h3>
        {canIssue && (
          <button className="btn-secondary text-xs ms-auto" onClick={issue} disabled={issuing || already}>
            {issuing && <Spinner className="h-3.5 w-3.5" />} {already ? t('finance.invoiceExists', { period: periodLabel }) : t('finance.issueInvoice', { period: periodLabel })}
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('finance.feeInvoicesHint')}</p>
      {invoices.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">{t('finance.noInvoices')}</div>
      ) : (
        <ul className="divide-y divide-line">
          {invoices.map((inv) => (
            <li key={inv.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold font-mono truncate">{inv.number}</div>
                <div className="text-xs text-neutral-500 truncate tnum">
                  {inv.period} · {formatDate(inv.issued_at, false)} · {t('finance.nTransactions', { n: inv.transaction_count })}
                </div>
              </div>
              <div className="text-end">
                <div className="text-sm font-semibold tnum">{sar(inv.total)}</div>
                <div className="text-[11px] text-neutral-500 tnum">{t('finance.inclVat', { vat: sar(inv.vat) })}</div>
              </div>
              <button className="btn-secondary text-xs" onClick={() => download(inv)} disabled={downloading === inv.id}>
                {downloading === inv.id ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} PDF
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

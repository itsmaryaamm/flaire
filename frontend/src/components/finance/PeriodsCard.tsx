import { useState } from 'react'
import { CalendarCheck, Lock, Unlock } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { sar } from '../../lib/money'
import { formatDate } from '../../lib/useFetch'
import type { PeriodRow, PeriodsResponse } from '../../types'
import { Sheet } from '../Sheet'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { StatusPill } from '../StatusPill'

/** "2026-03" -> "Mar 2026" in the current language. */
export function periodLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  return new Date(y, m - 1, 1).toLocaleDateString(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { month: 'short', year: 'numeric' })
}

/** Months grouped by fiscal year, with close and reopen. */
export function PeriodsCard({
  data,
  selected,
  onSelect,
  onChanged,
  locale,
}: {
  data: PeriodsResponse | null
  selected: string
  onSelect: (p: string) => void
  onChanged: () => void
  locale: string
}) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const canClose = !!user?.role && ['owner', 'admin', 'finance'].includes(user.role)
  const isOwner = user?.role === 'owner'
  const [closing, setClosing] = useState<PeriodRow | null>(null)
  const [reopening, setReopening] = useState<PeriodRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = async () => {
    if (!closing) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/finance/periods/${closing.period}/close`)
      toast.success(t('finance.closed', { period: periodLabel(closing.period, locale) }))
      setClosing(null)
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const reopen = async () => {
    if (!reopening) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/finance/periods/${reopening.period}/reopen`)
      toast.success(t('finance.reopened', { period: periodLabel(reopening.period, locale) }))
      setReopening(null)
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="periods" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <CalendarCheck className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('finance.periods')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('finance.periodsHint')}</p>
      {!data ? (
        <div className="py-4 text-xs text-neutral-500 flex items-center gap-2">
          <Spinner className="h-3.5 w-3.5" /> {t('common.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          {data.fiscal_years.map((fy) => (
            <div key={fy.label}>
              <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                <span className="mono-label">{t('finance.fiscalYear', { label: fy.label })}</span>
                <span className="text-neutral-500 tnum">
                  {t('finance.nTransactions', { n: fy.transaction_count })} · {sar(fy.volume)}
                </span>
              </div>
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-lavender border-y border-line">
                    <tr>
                      <th className="th">{t('finance.month')}</th>
                      <th className="th text-end">{t('finance.volume')}</th>
                      <th className="th text-end">{t('finance.vat')}</th>
                      <th className="th text-end">{t('finance.fees')}</th>
                      <th className="th">{t('team.status')}</th>
                      <th className="th text-end"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {fy.periods.map((p) => (
                      <tr
                        key={p.period}
                        className={`cursor-pointer ${selected === p.period ? 'bg-brand-light/60' : 'hover:bg-lavender/70'}`}
                        onClick={() => onSelect(p.period)}
                        aria-selected={selected === p.period}
                      >
                        <td className="td font-semibold whitespace-nowrap">
                          {periodLabel(p.period, locale)}
                          {p.is_current && <span className="ms-2 text-[11px] font-normal text-neutral-500">{t('finance.current')}</span>}
                          <span className="block text-[11px] font-normal text-neutral-500 tnum">{t('finance.nTransactions', { n: p.transaction_count })}</span>
                        </td>
                        <td className="td text-end tnum">{sar(p.volume)}</td>
                        <td className="td text-end tnum">{sar(p.vat)}</td>
                        <td className="td text-end tnum">{sar(p.fees)}</td>
                        <td className="td">
                          {p.closed ? (
                            <StatusPill tone="neutral">
                              <Lock className="h-3 w-3" /> {t('finance.closedBadge')}
                            </StatusPill>
                          ) : p.pending_settlement > 0 ? (
                            <StatusPill tone="amber">{t('finance.pendingSettlement', { n: p.pending_settlement })}</StatusPill>
                          ) : (
                            <StatusPill tone="green" dot>
                              {t('finance.open')}
                            </StatusPill>
                          )}
                          {p.closed && p.closed_at && <span className="block text-[11px] text-neutral-500 mt-0.5">{formatDate(p.closed_at, false)}</span>}
                        </td>
                        <td className="td text-end whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {!p.closed && canClose && (
                            <button className="btn-secondary text-xs" onClick={() => setClosing(p)}>
                              <Lock className="h-3.5 w-3.5" /> {t('finance.closeMonth')}
                            </button>
                          )}
                          {p.closed && isOwner && (
                            <button className="btn-ghost text-xs" onClick={() => setReopening(p)}>
                              <Unlock className="h-3.5 w-3.5" /> {t('finance.reopen')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet
        open={!!closing}
        onClose={() => {
          setClosing(null)
          setError(null)
        }}
        title={closing ? t('finance.closeTitle', { period: periodLabel(closing.period, locale) }) : ''}
        footer={
          <button type="button" className="btn-primary w-full" onClick={close} disabled={busy}>
            {busy && <Spinner />} {t('finance.closeMonth')}
          </button>
        }
      >
        {closing && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600">{t('finance.closeExplain')}</p>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-neutral-500">{t('finance.volume')}</dt>
                <dd className="font-semibold tnum">{sar(closing.volume)}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">{t('finance.vat')}</dt>
                <dd className="font-semibold tnum">{sar(closing.vat)}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">{t('finance.fees')}</dt>
                <dd className="font-semibold tnum">{sar(closing.fees)}</dd>
              </div>
            </dl>
            {closing.pending_settlement > 0 && <p className="text-xs text-warn">{t('finance.pendingSettlementWarn', { n: closing.pending_settlement })}</p>}
            <ErrorNote message={error} />
          </div>
        )}
      </Sheet>

      <Sheet
        open={!!reopening}
        onClose={() => {
          setReopening(null)
          setError(null)
        }}
        title={reopening ? t('finance.reopenTitle', { period: periodLabel(reopening.period, locale) }) : ''}
        footer={
          <button type="button" className="btn-danger w-full" onClick={reopen} disabled={busy}>
            {busy && <Spinner />} {t('finance.reopen')}
          </button>
        }
      >
        <p className="text-sm text-neutral-600">{t('finance.reopenExplain')}</p>
        <ErrorNote message={error} className="mt-3" />
      </Sheet>
    </section>
  )
}

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/useFetch'
import { useI18n } from '../lib/i18n'
import type { CostCenter, FeeInvoice, PeriodsResponse, Statement } from '../types'
import { PageHeader } from '../components/PageHeader'
import { PeriodsCard, periodLabel } from '../components/finance/PeriodsCard'
import { StatementCard } from '../components/finance/StatementCard'
import { CostCentersCard } from '../components/finance/CostCentersCard'
import { FeeInvoicesCard } from '../components/finance/FeeInvoicesCard'

/** Finance: month close, statements, ERP exports, cost centers and Flaire's fee invoices. */
export default function FinancePage() {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const canManage = !!user?.role && ['owner', 'admin', 'finance'].includes(user.role)
  const [period, setPeriod] = useState<string>('')

  const periods = useFetch(() => api.get<PeriodsResponse>('/finance/periods').then((r) => r.data), [])
  const statement = useFetch(() => (period ? api.get<Statement>('/finance/statement', { params: { period } }).then((r) => r.data) : Promise.resolve(null)), [period])
  const costCenters = useFetch(() => api.get<CostCenter[]>('/finance/cost-centers', { params: { include_inactive: true } }).then((r) => r.data), [])
  const invoices = useFetch(() => api.get<FeeInvoice[]>('/finance/fee-invoices').then((r) => r.data), [])

  // Default to the current month once the periods arrive.
  useEffect(() => {
    if (!period && periods.data) setPeriod(periods.data.current_period)
  }, [periods.data, period])

  const label = period ? periodLabel(period, locale) : ''

  return (
    <div className="max-w-[860px]">
      <PageHeader title={t('finance.title')} subtitle={t('finance.subtitle')} />
      <div className="space-y-5">
        <PeriodsCard
          data={periods.data}
          selected={period}
          onSelect={setPeriod}
          locale={locale}
          onChanged={() => {
            void periods.refetch()
            void statement.refetch()
          }}
        />
        <StatementCard statement={statement.data} loading={statement.loading} error={statement.error} periodLabel={label} />
        <CostCentersCard items={costCenters.data ?? []} loading={costCenters.loading} canManage={canManage} onChanged={() => void costCenters.refetch()} />
        <FeeInvoicesCard invoices={invoices.data ?? []} period={period} periodLabel={label} canIssue={canManage && !!period} onChanged={() => void invoices.refetch()} />
      </div>
    </div>
  )
}

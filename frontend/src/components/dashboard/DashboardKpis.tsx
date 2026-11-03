import { sar } from '../../lib/money'
import type { DashboardSummary } from '../../types'
import { KpiTile } from '../KpiTile'
import { Money } from '../Money'
import { ProgressBar } from '../ProgressBar'

export function DashboardKpis({ data }: { data: DashboardSummary }) {
  const t = data.totals
  const autoApproved =
    t.completed_count ?? data.recent_requests.filter((r) => r.status === 'completed' && !r.approved_by).length
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiTile label="Spent this month" value={<><span className="sm:hidden">{sar(t.spent_this_period, { compact: true })}</span><span className="hidden sm:inline"><Money halalas={t.spent_this_period} /></span></>}>
        <ProgressBar value={t.spent_this_period} max={t.budget_total} thin />
        <div className="text-xs text-neutral-500 truncate -mt-1">of {sar(t.budget_total)} monthly budget</div>
      </KpiTile>
      <KpiTile label="Total budget" value={<><span className="sm:hidden">{sar(t.budget_total, { compact: true })}</span><span className="hidden sm:inline"><Money halalas={t.budget_total} /></span></>} hint={`${data.departments.length} department${data.departments.length === 1 ? '' : 's'}`} />
      <KpiTile label="Auto-approved" value={autoApproved} hint="Under threshold · paid instantly" />
      <KpiTile label="Awaiting you" value={t.pending_count} tone="violet" hint="Over the limit · needs a human" />
    </div>
  )
}

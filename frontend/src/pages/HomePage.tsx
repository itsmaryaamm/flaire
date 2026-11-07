import { useCallback, useEffect } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/useFetch'
import type { DashboardSummary, FeeStatement, PurchaseRequest } from '../types'
import { KillSwitchPill } from '../components/Layout'
import { ErrorNote } from '../components/ErrorNote'
import { GettingStartedCard } from '../components/dashboard/GettingStartedCard'
import { NeedsYou } from '../components/home/NeedsYou'
import { MonthCard } from '../components/home/MonthCard'
import { AssistantPanel } from '../components/home/AssistantPanel'
import { RecentActivity } from '../components/home/RecentActivity'

const REFRESH_MS = 30_000

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Home: what needs you, this month, the assistant, and recent activity. */
export default function HomePage() {
  const { company } = useAuth()
  const summary = useFetch(() => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data), [])
  const approvals = useFetch(() => api.get<PurchaseRequest[]>('/approvals').then((r) => r.data), [])
  const fees = useFetch(() => api.get<FeeStatement>('/fees/statement', { params: { month: thisMonth() } }).then((r) => r.data), [])

  const refreshAll = useCallback(() => {
    void summary.refetch()
    void approvals.refetch()
    void fees.refetch()
  }, [summary.refetch, approvals.refetch, fees.refetch]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh every 30 s while visible, and when the tab becomes visible again.
  useEffect(() => {
    let timer: number | null = null
    const start = () => {
      if (timer === null) timer = window.setInterval(refreshAll, REFRESH_MS)
    }
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshAll()
        start()
      } else stop()
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshAll])

  const onDecided = useCallback(
    (result: PurchaseRequest) => {
      // Drop it from the list right away, then reload everything.
      if (!(result.needs_second_approver && result.status === 'pending_approval')) {
        approvals.setData((prev) => (prev ? prev.filter((r) => r.id !== result.id) : prev))
      }
      refreshAll()
    },
    [approvals.setData, refreshAll], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const totals = summary.data?.totals
  const recent = (summary.data?.recent_requests ?? []).slice(0, 6)
  const error = approvals.error && !approvals.data ? approvals.error : summary.error && !summary.data ? summary.error : null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tightest truncate">{company?.name ?? 'Flaire'}</h1>
          {company?.kill_switch && company.kill_switch_reason && (
            <div className="text-xs text-danger truncate mt-0.5">{company.kill_switch_reason}</div>
          )}
        </div>
        <KillSwitchPill />
      </div>

      <GettingStartedCard />
      {error && <ErrorNote message={error} />}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <NeedsYou items={approvals.data ?? []} loading={approvals.loading && !approvals.data} killSwitch={!!company?.kill_switch} onDecided={onDecided} />
          <MonthCard spent={totals?.spent_this_period ?? 0} budget={totals?.budget_total ?? 0} fees={fees.data} />
          <RecentActivity items={recent} />
        </div>
        <AssistantPanel onDecided={onDecided} />
      </div>
    </div>
  )
}

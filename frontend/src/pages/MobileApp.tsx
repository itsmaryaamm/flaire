import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/useFetch'
import type { DashboardSummary, PurchaseRequest } from '../types'
import { MobileHeader } from '../components/mobile/MobileHeader'
import { MobileKillSwitch } from '../components/mobile/MobileKillSwitch'
import { MonthCard } from '../components/mobile/MonthCard'
import { NeedsYou } from '../components/mobile/NeedsYou'
import { RecentList } from '../components/mobile/RecentList'
import { NotifyCard } from '../components/mobile/NotifyCard'
import { ErrorNote } from '../components/ErrorNote'

const REFRESH_MS = 30_000

/** Phone view: the few things an approver needs on the go. No sidebar, no bottom nav. */
export default function MobileApp() {
  const { company } = useAuth()
  const summary = useFetch(() => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data), [])
  const approvals = useFetch(() => api.get<PurchaseRequest[]>('/approvals').then((r) => r.data), [])
  const [removed, setRemoved] = useState<number[]>([])

  const refreshAll = useCallback(() => {
    void summary.refetch()
    void approvals.refetch()
  }, [summary.refetch, approvals.refetch]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 30 s while the tab is visible, and immediately when it becomes visible again.
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

  const onRemove = useCallback(
    (id: number) => {
      setRemoved((r) => (r.includes(id) ? r : [...r, id]))
      refreshAll()
    },
    [refreshAll],
  )

  const pending = (approvals.data ?? []).filter((r) => !removed.includes(r.id))
  const totals = summary.data?.totals
  const recent = (summary.data?.recent_requests ?? []).slice(0, 8)
  const refreshing = summary.loading || approvals.loading
  const error = approvals.error && !approvals.data ? approvals.error : summary.error && !summary.data ? summary.error : null

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-[480px]">
        <MobileHeader onRefresh={refreshAll} refreshing={refreshing} />
        <main className="px-4 space-y-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <MobileKillSwitch onChanged={refreshAll} />
          {error && <ErrorNote message={error} />}
          <MonthCard spent={totals?.spent_this_period ?? 0} budget={totals?.budget_total ?? 0} />
          <NeedsYou
            items={pending}
            loading={approvals.loading && !approvals.data}
            killSwitch={!!company?.kill_switch}
            onRemove={onRemove}
            onChanged={refreshAll}
          />
          <RecentList items={recent} />
          <NotifyCard />
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-400 pt-2">Flaire · refreshes every 30s</p>
        </main>
      </div>
    </div>
  )
}

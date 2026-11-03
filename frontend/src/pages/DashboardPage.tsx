import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/useFetch'
import { sar } from '../lib/money'
import type { DashboardSummary, PurchaseRequest } from '../types'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import { PageLoader } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { KillSwitchButton } from '../components/KillSwitchPanel'
import { PageHeader } from '../components/PageHeader'
import { DashboardKpis } from '../components/dashboard/DashboardKpis'
import { PendingList } from '../components/dashboard/PendingList'
import { RecentActivity } from '../components/dashboard/RecentActivity'
import { RequestDetail } from '../components/dashboard/RequestDetail'
import { SpendChart } from '../components/dashboard/SpendChart'

function DepartmentBudgets({ data }: { data: DashboardSummary }) {
  return (
    <div className="card-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-bold">Department budgets</h3>
        <Link to="/budgets" className="text-xs text-brand font-semibold hover:underline">
          Manage
        </Link>
      </div>
      {data.departments.length === 0 ? (
        <EmptyState compact title="No departments yet" description="Create one to give AI employees a budget." />
      ) : (
        <ul className="space-y-4">
          {data.departments.map((d) => (
            <li key={d.id}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold">{d.name}</span>
                <span className="text-neutral-500 tnum text-xs">
                  {sar(d.spent_this_period)} / {sar(d.monthly_budget)}
                </span>
              </div>
              <ProgressBar value={d.spent_this_period} max={d.monthly_budget} className="mt-1.5" thin />
              <div className="text-xs text-neutral-500 mt-1 tnum">{sar(d.remaining)} remaining</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const { setCompany } = useAuth()
  const { data, loading, error, refetch } = useFetch(
    () => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
    [],
  )
  const [selected, setSelected] = useState<PurchaseRequest | null>(null)

  const requests = data?.recent_requests ?? []
  const pending = requests.filter((r) => r.status === 'pending_approval')
  const featured = pending[0] ?? requests[0] ?? null

  // Follow the freshest data unless the user picked a row that still exists.
  useEffect(() => {
    if (selected && requests.some((r) => r.id === selected.id)) return
    setSelected(featured)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (loading && !data) return <PageLoader />
  if (error && !data) return <ErrorNote message={error} />
  if (!data) return null

  const detail = selected ?? featured

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Purchase requests from your AI employees, approved in real time."
        actions={
          <>
            <Link to="/agents" className="btn-primary">
              Run a demo request
            </Link>
            <KillSwitchButton
              onChanged={(c) => {
                setCompany(c)
                void refetch()
              }}
            />
          </>
        }
      />

      <DashboardKpis data={data} />

      <div className="grid lg:grid-cols-[1fr_minmax(300px,0.72fr)] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <PendingList requests={pending} />
          <RecentActivity requests={requests} selectedId={detail?.id} onSelect={setSelected} />
        </div>
        {detail ? (
          <RequestDetail request={detail} />
        ) : (
          <div className="card-lg">
            <EmptyState compact title="Nothing to show yet" description="The latest request will appear here." />
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <SpendChart data={data.spend_by_day} />
        </div>
        <div className="lg:col-span-2">
          <DepartmentBudgets data={data} />
        </div>
      </div>
    </div>
  )
}

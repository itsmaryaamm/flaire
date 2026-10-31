import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Wallet, PiggyBank, Clock, Ban, Bot, CreditCard, ArrowRight } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatDate } from '../lib/useFetch'
import { sar } from '../lib/money'
import type { DashboardSummary } from '../types'
import { KpiTile } from '../components/KpiTile'
import { Money } from '../components/Money'
import { StatusPill } from '../components/StatusPill'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import { PageLoader } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { KillSwitchPanel } from '../components/KillSwitchPanel'
import { ProviderBadge } from '../components/ProviderBadge'
import { PageHeader } from '../components/PageHeader'

function SpendChart({ data }: { data: DashboardSummary['spend_by_day'] }) {
  const rows = data.map((d) => ({
    date: d.date,
    label: new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    sar: d.amount / 100,
  }))
  const total = data.reduce((a, b) => a + b.amount, 0)
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="font-semibold">Spend, last 14 days</h3>
          <p className="text-xs text-neutral-500 mt-0.5">Completed purchases by day</p>
        </div>
        <Money halalas={total} className="text-sm font-semibold" />
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#E8E8E4" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#737373' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#737373' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              cursor={{ fill: '#F0F0EC' }}
              contentStyle={{ borderRadius: 8, border: '1px solid #E5E5E5', fontSize: 12 }}
              formatter={(v: number) => [sar(Math.round(v * 100)), 'Spent']}
            />
            <Bar dataKey="sar" fill="#0F5132" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { company, setCompany } = useAuth()
  const { data, loading, error, refetch } = useFetch(
    () => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
    [],
  )

  if (loading && !data) return <PageLoader />
  if (error && !data) return <ErrorNote message={error} />
  if (!data) return null

  const t = data.totals

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good day, ${company?.name ?? data.company.name}`}
        subtitle="Here is what your AI employees are doing with company money."
      />

      <KillSwitchPanel
        onChanged={(c) => {
          setCompany(c)
          void refetch()
        }}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile label="Spent this period" value={<Money halalas={t.spent_this_period} compact />} icon={<Wallet className="h-4 w-4" />} />
        <KpiTile label="Total budget" value={<Money halalas={t.budget_total} compact />} icon={<PiggyBank className="h-4 w-4" />} hint={`${Math.round((t.spent_this_period / Math.max(1, t.budget_total)) * 100)}% used`} />
        <KpiTile label="Pending approvals" value={t.pending_count} tone="amber" icon={<Clock className="h-4 w-4" />} hint={<Link to="/approvals" className="text-brand hover:underline">Review</Link>} />
        <KpiTile label="Blocked" value={t.blocked_count} tone="red" icon={<Ban className="h-4 w-4" />} hint="denied or rejected" />
        <KpiTile label="AI employees" value={t.agent_count} tone="green" icon={<Bot className="h-4 w-4" />} />
        <KpiTile label="Cards" value={t.card_count} icon={<CreditCard className="h-4 w-4" />} />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <SpendChart data={data.spend_by_day} />
        </div>
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold">Department budgets</h3>
            <Link to="/budgets" className="text-xs text-brand font-medium hover:underline">Manage</Link>
          </div>
          {data.departments.length === 0 ? (
            <EmptyState compact title="No departments yet" description="Create one to give AI employees a budget." />
          ) : (
            <ul className="space-y-4">
              {data.departments.map((d) => (
                <li key={d.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-neutral-500 tnum text-xs">
                      {sar(d.spent_this_period)} / {sar(d.monthly_budget)}
                    </span>
                  </div>
                  <ProgressBar value={d.spent_this_period} max={d.monthly_budget} className="mt-1.5" />
                  <div className="text-xs text-neutral-500 mt-1 tnum">{sar(d.remaining)} remaining</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
            <h3 className="font-semibold">Recent purchase requests</h3>
            <Link to="/transactions" className="text-xs text-brand font-medium hover:underline inline-flex items-center gap-1">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {data.recent_requests.length === 0 ? (
            <EmptyState compact title="No requests yet" description="Give an AI employee a task to see requests here." />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {data.recent_requests.map((r) => (
                <li key={r.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.merchant}</div>
                    <div className="text-xs text-neutral-500 truncate">
                      {r.agent_name} · {r.category} · {formatDate(r.created_at)}
                    </div>
                  </div>
                  <Money halalas={r.amount} className="text-sm font-medium" />
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
            <h3 className="font-semibold">Recent transactions</h3>
            <Link to="/transactions" className="text-xs text-brand font-medium hover:underline inline-flex items-center gap-1">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {data.recent_transactions.length === 0 ? (
            <EmptyState compact title="No transactions yet" description="Approved purchases will settle here." />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {data.recent_transactions.map((tx) => (
                <li key={tx.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{tx.merchant}</div>
                    <div className="text-xs text-neutral-500 truncate flex items-center gap-1.5">
                      <ProviderBadge provider={tx.provider} /> {tx.card_label}
                    </div>
                  </div>
                  <Money halalas={tx.amount} className="text-sm font-medium" />
                  <StatusPill status={tx.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

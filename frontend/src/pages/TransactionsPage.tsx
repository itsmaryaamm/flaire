import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, ArrowLeftRight, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { useFetch, formatDate } from '../lib/useFetch'
import type { Agent, PurchaseRequest, PurchaseStatus, Transaction } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Money } from '../components/Money'
import { StatusPill } from '../components/StatusPill'
import { ProviderBadge } from '../components/ProviderBadge'
import { DecisionDetails } from '../components/DecisionDetails'
import { EmptyState } from '../components/EmptyState'
import { PageLoader } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'

const STATUSES: PurchaseStatus[] = ['pending_approval', 'approved', 'completed', 'denied', 'rejected', 'failed']

function RequestsTab() {
  const [status, setStatus] = useState<string>('')
  const [agentId, setAgentId] = useState<string>('')
  const [openId, setOpenId] = useState<number | null>(null)
  const agents = useFetch(() => api.get<Agent[]>('/agents').then((r) => r.data), [])
  const reqs = useFetch(
    () =>
      api
        .get<PurchaseRequest[]>('/purchase-requests', {
          params: { status: status || undefined, agent_id: agentId || undefined, limit: 200 },
        })
        .then((r) => r.data),
    [status, agentId],
  )
  const list = reqs.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Filter by agent">
          <option value="">All AI employees</option>
          {(agents.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="font-mono text-xs text-neutral-500 self-center ml-auto tnum">{list.length} requests</span>
      </div>

      {reqs.loading && !reqs.data ? (
        <PageLoader />
      ) : reqs.error && !reqs.data ? (
        <ErrorNote message={reqs.error} />
      ) : list.length === 0 ? (
        <div className="card-lg">
          <EmptyState title="No purchase requests" description="Try a different filter, or give an AI employee a task." />
        </div>
      ) : (
        <div className="card-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-lavender border-b border-line">
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Merchant</th>
                  <th className="th">AI employee</th>
                  <th className="th">Category</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                  <th className="th">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((r) => {
                  const open = openId === r.id
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-lavender/70 cursor-pointer" onClick={() => setOpenId(open ? null : r.id)}>
                        <td className="td text-neutral-400">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="td">
                          <div className="font-semibold">{r.merchant}</div>
                          <div className="text-xs text-neutral-500 truncate max-w-xs">{r.description}</div>
                        </td>
                        <td className="td">
                          <div>{r.agent_name}</div>
                          <div className="text-xs text-neutral-500">{r.department_name}</div>
                        </td>
                        <td className="td text-neutral-600">{r.category}</td>
                        <td className="td text-right">
                          <Money halalas={r.amount} className="font-medium" />
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-1.5">
                            <StatusPill status={r.status} />
                            {r.decision?.receipt && <ShieldCheck className="h-3.5 w-3.5 text-success" aria-label="signed receipt" />}
                          </div>
                        </td>
                        <td className="td text-neutral-500 font-mono text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                      </tr>
                      {open && (
                        <tr className="bg-lavender/60">
                          <td></td>
                          <td colSpan={6} className="px-4 py-4">
                            <DecisionDetails request={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TransactionsTab() {
  const txs = useFetch(() => api.get<Transaction[]>('/transactions', { params: { limit: 200 } }).then((r) => r.data), [])
  const list = txs.data ?? []
  if (txs.loading && !txs.data) return <PageLoader />
  if (txs.error && !txs.data) return <ErrorNote message={txs.error} />
  if (list.length === 0)
    return (
      <div className="card-lg">
        <EmptyState icon={<ArrowLeftRight className="h-5 w-5" />} title="No transactions yet" description="Approved purchases are charged to a card and show up here." />
      </div>
    )
  return (
    <div className="card-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-lavender border-b border-line">
            <tr>
              <th className="th">Card</th>
              <th className="th">Provider</th>
              <th className="th">Merchant</th>
              <th className="th text-right">Amount</th>
              <th className="th">Status</th>
              <th className="th">Provider ref</th>
              <th className="th">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((t) => (
              <tr key={t.id} className="hover:bg-lavender/70">
                <td className="td">
                  <div className="font-semibold">{t.card_label}</div>
                  <div className="font-mono text-xs text-neutral-500 tnum">request #{t.purchase_request_id}</div>
                </td>
                <td className="td">
                  <ProviderBadge provider={t.provider} />
                </td>
                <td className="td">{t.merchant}</td>
                <td className="td text-right">
                  <Money halalas={t.amount} className="font-medium" />
                </td>
                <td className="td">
                  <StatusPill status={t.status} />
                  {t.decline_reason && <div className="text-xs text-danger mt-1">{t.decline_reason}</div>}
                </td>
                <td className="td">
                  <code className="font-mono text-xs text-neutral-600">{t.provider_ref}</code>
                </td>
                <td className="td text-neutral-500 font-mono text-xs whitespace-nowrap">{formatDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function TransactionsPage() {
  const [tab, setTab] = useState<'requests' | 'transactions'>('requests')
  return (
    <div>
      <PageHeader title="Activity" subtitle="Every request an AI employee made, the decision it got, and the money that actually moved." />
      <div className="inline-flex rounded-pill border border-line bg-white p-1 mb-5">
        {(
          [
            ['requests', 'Purchase requests'],
            ['transactions', 'Transactions'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors ${tab === k ? 'bg-brand-light text-brand' : 'text-neutral-600 hover:bg-lavender'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'requests' ? <RequestsTab /> : <TransactionsTab />}
    </div>
  )
}

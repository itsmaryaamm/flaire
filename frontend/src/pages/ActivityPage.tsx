import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { api, downloadFile, errorMessage } from '../lib/api'
import { useT } from '../lib/i18n'
import { useFetch } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import { sar } from '../lib/money'
import type { Agent, FeeStatement, PurchaseRequest, Transaction } from '../types'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { ActivityRow } from '../components/activity/ActivityRow'
import { FeesModal } from '../components/activity/FeesModal'

type Chip = 'all' | 'paid' | 'waiting' | 'blocked'
const CHIPS: { key: Chip; label: string }[] = [
  { key: 'all', label: 'activity.all' },
  { key: 'paid', label: 'activity.paid' },
  { key: 'waiting', label: 'activity.waiting' },
  { key: 'blocked', label: 'activity.blocked' },
]

function matches(chip: Chip, r: PurchaseRequest): boolean {
  if (chip === 'all') return true
  if (chip === 'paid') return r.status === 'completed'
  if (chip === 'waiting') return r.status === 'pending_approval'
  return r.status === 'denied' || r.status === 'rejected'
}

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** One list of every purchase request, newest first. */
export default function ActivityPage() {
  const toast = useToast()
  const t = useT()
  const [chip, setChip] = useState<Chip>('all')
  const [agentId, setAgentId] = useState('')
  const [feesOpen, setFeesOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const agents = useFetch(() => api.get<Agent[]>('/agents').then((r) => r.data), [])
  const reqs = useFetch(
    () => api.get<PurchaseRequest[]>('/purchase-requests', { params: { agent_id: agentId || undefined, limit: 200 } }).then((r) => r.data),
    [agentId],
  )
  const txs = useFetch(() => api.get<Transaction[]>('/transactions', { params: { limit: 500 } }).then((r) => r.data), [])
  const fees = useFetch(() => api.get<FeeStatement>('/fees/statement', { params: { month: thisMonth() } }).then((r) => r.data), [])

  const txByRequest = useMemo(() => {
    const m = new Map<number, Transaction>()
    for (const t of txs.data ?? []) m.set(t.purchase_request_id, t)
    return m
  }, [txs.data])

  const list = useMemo(
    () =>
      [...(reqs.data ?? [])]
        .filter((r) => matches(chip, r))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [reqs.data, chip],
  )

  const refresh = () => {
    void reqs.refetch()
    void txs.refetch()
    void fees.refetch()
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      await downloadFile('/export/requests.csv', 'flaire-requests.csv')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('activity.title')}
        subtitle={t('activity.subtitle')}
        actions={
          <>
            <button type="button" className="btn-secondary text-xs" onClick={() => setFeesOpen(true)} disabled={!fees.data}>
              {t('activity.feesThisMonth', { amount: fees.data ? sar(fees.data.fees) : '...' })}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={exportCsv} disabled={exporting}>
              {exporting ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} {t('activity.exportCsv')}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-pill border border-line bg-white p-1">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${chip === c.key ? 'bg-brand-light text-brand' : 'text-neutral-600 hover:bg-lavender'}`}
            >
              {t(c.label)}
            </button>
          ))}
        </div>
        <select className="input w-auto h-9 py-0 text-xs" value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label={t('activity.filterByEmployee')}>
          <option value="">{t('activity.allEmployees')}</option>
          {(agents.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="font-mono text-xs text-neutral-500 ms-auto tnum">{t('activity.nRequests', { n: list.length })}</span>
      </div>

      {reqs.loading && !reqs.data ? (
        <PageLoader />
      ) : reqs.error && !reqs.data ? (
        <ErrorNote message={reqs.error} />
      ) : list.length === 0 ? (
        <div className="card-lg">
          <EmptyState title={t('activity.emptyTitle')} description={t('activity.emptyDesc')} />
        </div>
      ) : (
        <div className="card-lg overflow-hidden">
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <ActivityRow key={r.id} request={r} transaction={txByRequest.get(r.id) ?? null} onChanged={refresh} />
            ))}
          </ul>
        </div>
      )}

      <FeesModal open={feesOpen} onClose={() => setFeesOpen(false)} statement={fees.data} />
    </div>
  )
}

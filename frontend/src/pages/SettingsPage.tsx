import { useState } from 'react'
import type { FormEvent } from 'react'
import { ShieldCheck, ShieldAlert, Cpu, Link2, ScrollText, Bot, User, Server } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatDate } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import type { AuditEntry, AuditVerify, Company, Engine } from '../types'
import { PageHeader } from '../components/PageHeader'
import { KillSwitchPanel } from '../components/KillSwitchPanel'
import { ErrorNote } from '../components/ErrorNote'
import { PageLoader, Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'
import { StatusPill } from '../components/StatusPill'
import { truncateMiddle } from '../components/DecisionDetails'

const ENGINES: { value: Engine; label: string; description: string; icon: typeof Cpu }[] = [
  {
    value: 'native',
    label: 'Flaire native engine (Shotoku-style)',
    description: 'Built-in rules engine: limits, budgets, categories, merchants and thresholds evaluated in-process.',
    icon: Cpu,
  },
  {
    value: 'shotoku',
    label: 'Shotoku core via sidecar',
    description: 'Delegates every authorization to a Shotoku policy sidecar over HTTP, same verdict contract.',
    icon: Link2,
  },
]

function summariseDetails(details: Record<string, unknown> | null | undefined): string {
  if (!details || typeof details !== 'object') return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(details)) {
    if (v == null) continue
    let val: string
    if (typeof v === 'object') {
      try {
        val = JSON.stringify(v)
      } catch {
        val = String(v)
      }
    } else val = String(v)
    if (k === 'amount' && typeof v === 'number') val = `SAR ${(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    parts.push(`${k}: ${val}`)
  }
  const s = parts.join(', ')
  return s.length > 160 ? `${s.slice(0, 157)}...` : s
}

function ActorIcon({ type }: { type: AuditEntry['actor_type'] }) {
  if (type === 'agent') return <Bot className="h-3.5 w-3.5 text-brand" />
  if (type === 'user') return <User className="h-3.5 w-3.5 text-neutral-600" />
  return <Server className="h-3.5 w-3.5 text-neutral-400" />
}

export default function SettingsPage() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(company?.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [savingEngine, setSavingEngine] = useState(false)
  const [verify, setVerify] = useState<AuditVerify | null>(null)
  const [verifying, setVerifying] = useState(false)
  const audit = useFetch(() => api.get<AuditEntry[]>('/audit', { params: { limit: 100 } }).then((r) => r.data), [])

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    setSavingName(true)
    try {
      const { data } = await api.patch<Company>('/company', { name: name.trim() })
      setCompany(data)
      toast.success('Company name updated.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSavingName(false)
    }
  }

  const setEngine = async (engine: Engine) => {
    if (!company || company.engine === engine) return
    setSavingEngine(true)
    try {
      const { data } = await api.patch<Company>('/company', { engine })
      setCompany(data)
      toast.success(`Authorization engine set to ${engine === 'native' ? 'Flaire native' : 'Shotoku sidecar'}.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSavingEngine(false)
    }
  }

  const runVerify = async () => {
    setVerifying(true)
    setVerify(null)
    try {
      const { data } = await api.get<AuditVerify>('/audit/verify')
      setVerify(data)
      await audit.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Company, authorization engine, emergency controls and the audit ledger." />

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card p-5">
          <h3 className="font-semibold mb-3">Company</h3>
          <form onSubmit={saveName} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <label className="label" htmlFor="company-name">Company name</label>
              <input id="company-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary self-end" disabled={savingName || name.trim() === company?.name}>
              {savingName && <Spinner />} Save
            </button>
          </form>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-neutral-500">Currency</dt>
              <dd className="font-medium">{company?.currency ?? 'SAR'}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Created</dt>
              <dd className="font-medium">{formatDate(company?.created_at, false)}</dd>
            </div>
          </dl>
        </section>

        <section className="card p-5">
          <h3 className="font-semibold">Authorization engine</h3>
          <p className="text-xs text-neutral-500 mt-0.5 mb-3">Decides every purchase request. Both engines record the same verdict, reasons and rule id.</p>
          <div className="space-y-2">
            {ENGINES.map((e) => {
              const active = company?.engine === e.value
              return (
                <button
                  key={e.value}
                  type="button"
                  disabled={savingEngine}
                  onClick={() => setEngine(e.value)}
                  className={`w-full text-left flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${active ? 'border-brand bg-brand-light' : 'border-neutral-200 hover:bg-neutral-50'}`}
                  aria-pressed={active}
                >
                  <span className={`rounded-md p-1.5 ${active ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                    <e.icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1">
                    <span className="text-sm font-medium flex items-center gap-2">
                      {e.label}
                      {active && <StatusPill tone="green" dot={false}>active</StatusPill>}
                    </span>
                    <span className="block text-xs text-neutral-600 mt-0.5">{e.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      <KillSwitchPanel onChanged={() => void audit.refetch()} />

      <section className="card">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-neutral-200">
          <ScrollText className="h-4 w-4 text-neutral-500" />
          <h3 className="font-semibold">Audit ledger</h3>
          <span className="text-xs text-neutral-500">hash-chained, append-only</span>
          <div className="ml-auto flex items-center gap-2">
            {verify && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${verify.ok ? 'bg-mint text-brand-dark' : 'bg-red-100 text-red-700'}`}
              >
                {verify.ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                {verify.ok ? `Chain OK, ${verify.entries} entries` : `Chain broken at entry ${verify.broken_at}`}
              </span>
            )}
            <button className="btn-secondary text-xs" onClick={runVerify} disabled={verifying}>
              {verifying ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify chain
            </button>
          </div>
        </div>
        {audit.loading && !audit.data ? (
          <PageLoader />
        ) : audit.error && !audit.data ? (
          <div className="p-5">
            <ErrorNote message={audit.error} />
          </div>
        ) : (audit.data ?? []).length === 0 ? (
          <EmptyState compact title="Ledger is empty" description="Every decision, approval and setting change will be recorded here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="th">Time</th>
                  <th className="th">Actor</th>
                  <th className="th">Event</th>
                  <th className="th">Details</th>
                  <th className="th">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {(audit.data ?? []).map((e) => (
                  <tr key={e.id} className={verify && !verify.ok && verify.broken_at === e.id ? 'bg-red-50' : 'hover:bg-neutral-50'}>
                    <td className="td text-xs text-neutral-500 whitespace-nowrap">{formatDate(e.ts)}</td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <ActorIcon type={e.actor_type} />
                        {e.actor_name ?? e.actor_type}
                      </span>
                    </td>
                    <td className="td">
                      <code className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">{e.event}</code>
                    </td>
                    <td className="td text-xs text-neutral-600 max-w-md">{summariseDetails(e.details)}</td>
                    <td className="td">
                      <code className="font-mono text-[11px] text-neutral-400" title={e.hash}>
                        {truncateMiddle(e.hash, 6)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

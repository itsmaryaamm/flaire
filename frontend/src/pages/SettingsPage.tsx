import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ShieldCheck, ShieldAlert, Cpu, Link2, ScrollText, Bot, User, Server } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatDate } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import type { AuditEntry, AuditVerify, Company, Engine } from '../types'
import { PageHeader } from '../components/PageHeader'
import { PhoneAppPanel } from '../components/PhoneAppPanel'
import { KillSwitchPanel } from '../components/KillSwitchPanel'
import { ConnectClaudeCard } from '../components/settings/ConnectClaudeCard'
import { PaymentsCard } from '../components/settings/PaymentsCard'
import { NotifyThresholdCard } from '../components/settings/NotifyThresholdCard'
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

  const [twoPerson, setTwoPerson] = useState<string>(String((company?.two_person_threshold ?? 250000) / 100))
  useEffect(() => {
    if (company) setTwoPerson(String(company.two_person_threshold / 100))
  }, [company])

  const [trusted, setTrusted] = useState<string>((company?.trusted_merchants ?? []).join(', '))
  const [newMerchant, setNewMerchant] = useState<string>(String((company?.new_merchant_review_from ?? 20000) / 100))
  useEffect(() => {
    if (company) {
      setTrusted((company.trusted_merchants ?? []).join(', '))
      setNewMerchant(String(company.new_merchant_review_from / 100))
    }
  }, [company])

  const saveSecurity = async (patch: Partial<Pick<Company, 'require_password_on_approve' | 'two_person_threshold' | 'trusted_merchants' | 'new_merchant_review_from'>>) => {
    try {
      const { data } = await api.patch<Company>('/company', patch)
      setCompany(data)
      toast.success('Security settings saved.')
    } catch (err) {
      toast.error(errorMessage(err))
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
      <PageHeader title="Settings" subtitle="Company, Claude connections, payments, notifications, authorization engine, emergency controls and the audit ledger." />

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card-lg p-5">
          <h3 className="font-bold mb-3">Company</h3>
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
              <dd className="font-semibold">{company?.currency ?? 'SAR'}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Created</dt>
              <dd className="font-semibold">{formatDate(company?.created_at, false)}</dd>
            </div>
          </dl>
        </section>

        <PhoneAppPanel />

        <ConnectClaudeCard />

        <PaymentsCard />

        <NotifyThresholdCard />

        <section className="card-lg p-5">
          <h3 className="font-bold">Supplier policy</h3>
          <p className="text-xs text-neutral-500 mt-0.5 mb-3">
            How a finance team actually works: trusted suppliers get paid within limits, unknown suppliers get a look first.
          </p>
          <label className="label" htmlFor="trusted">Trusted suppliers</label>
          <textarea
            id="trusted"
            className="input min-h-[72px]"
            placeholder="Google Ads, Canva, Aramex"
            value={trusted}
            onChange={(e) => setTrusted(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1 mb-3">Comma separated. Purchases at these suppliers skip the category check (limits and thresholds still apply).</p>
          <label className="label" htmlFor="newm">Review first payment to a new supplier from (SAR)</label>
          <div className="flex gap-2">
            <input id="newm" className="input tnum sm:w-48" type="number" min={0} step={50} value={newMerchant} onChange={(e) => setNewMerchant(e.target.value)} />
            <button
              className="btn-secondary"
              onClick={() =>
                saveSecurity({
                  trusted_merchants: trusted.split(',').map((m) => m.trim()).filter(Boolean),
                  new_merchant_review_from: Math.round(Number(newMerchant) * 100),
                })
              }
            >
              Save policy
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-1">The first payment to a supplier the company has never paid waits for a human at or above this amount. 0 turns this off.</p>
        </section>

        <section className="card-lg p-5">
          <h3 className="font-bold">Approval security</h3>
          <p className="text-xs text-neutral-500 mt-0.5 mb-3">Enforced by the server on every approval, never by the AI.</p>
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 accent-brand"
              checked={company?.require_password_on_approve ?? true}
              onChange={(e) => saveSecurity({ require_password_on_approve: e.target.checked })}
            />
            <span>
              <span className="font-semibold">Password re-entry on every approval</span>
              <span className="block text-xs text-neutral-500">A stolen session or an unlocked laptop cannot approve spending.</span>
            </span>
          </label>
          <div className="mt-4">
            <label className="label" htmlFor="two-person">Two-person rule from (SAR)</label>
            <div className="flex gap-2">
              <input
                id="two-person"
                className="input tnum sm:w-48"
                type="number"
                min={0}
                step={100}
                value={twoPerson}
                onChange={(e) => setTwoPerson(e.target.value)}
              />
              <button
                className="btn-secondary"
                onClick={() => saveSecurity({ two_person_threshold: Math.round(Number(twoPerson) * 100) })}
                disabled={Math.round(Number(twoPerson) * 100) === company?.two_person_threshold}
              >
                Save
              </button>
            </div>
            <p className="text-xs text-neutral-500 mt-1">Approvals at or above this amount need two different humans before money moves. Set 0 to require it for everything.</p>
          </div>
          <ul className="mt-4 text-xs text-neutral-600 space-y-1 list-disc list-inside">
            <li>Agent keys are hashed, shown once, rotatable, and can expire.</li>
            <li>Agents and connector links are rate limited (60 requests per minute); repeated bad keys lock the sender out for 15 minutes.</li>
            <li>No agent endpoint can approve, change a limit or touch a card. Payments require a signed, single-use receipt.</li>
            <li>Every action is written to a hash-chained ledger (verify it below).</li>
          </ul>
        </section>

        <section className="card-lg p-5">
          <h3 className="font-bold">Authorization engine</h3>
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
                  className={`w-full text-left flex items-start gap-3 rounded-card border px-3 py-3 transition-colors ${active ? 'border-brand bg-brand-light' : 'border-line hover:bg-lavender'}`}
                  aria-pressed={active}
                >
                  <span className={`rounded-full p-1.5 ${active ? 'bg-brand text-white' : 'bg-lavender-deep text-neutral-600'}`}>
                    <e.icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1">
                    <span className="text-sm font-semibold flex items-center gap-2">
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

      <section className="card-lg overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-line">
          <ScrollText className="h-4 w-4 text-neutral-500" />
          <h3 className="font-bold">Audit ledger</h3>
          <span className="font-mono text-[11px] text-neutral-500">hash-chained · append-only</span>
          <div className="ml-auto flex items-center gap-2">
            {verify && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ${verify.ok ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`}
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
              <thead className="bg-lavender border-b border-line">
                <tr>
                  <th className="th">Time</th>
                  <th className="th">Actor</th>
                  <th className="th">Event</th>
                  <th className="th">Details</th>
                  <th className="th">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(audit.data ?? []).map((e) => (
                  <tr key={e.id} className={verify && !verify.ok && verify.broken_at === e.id ? 'bg-danger-tint' : 'hover:bg-lavender/70'}>
                    <td className="td font-mono text-xs text-neutral-500 whitespace-nowrap">{formatDate(e.ts)}</td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <ActorIcon type={e.actor_type} />
                        {e.actor_name ?? e.actor_type}
                      </span>
                    </td>
                    <td className="td">
                      <code className="font-mono text-xs bg-lavender-deep px-1.5 py-0.5 rounded">{e.event}</code>
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

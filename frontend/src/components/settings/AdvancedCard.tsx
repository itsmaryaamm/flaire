import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, ChevronDown, ChevronRight, Cpu, Link2, Scale, ScrollText, Server, ShieldAlert, ShieldCheck, User, Wrench } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch, formatDate } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import type { AuditEntry, AuditVerify, Company, Engine, Reconciliation } from '../../types'
import { StatusPill } from '../StatusPill'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { truncateMiddle } from '../DecisionDetails'
import { DepartmentsTable } from './DepartmentsTable'
import { useT } from '../../lib/i18n'
import { sar } from '../../lib/money'

const ENGINES: { value: Engine; label: string; description: string; icon: typeof Cpu }[] = [
  { value: 'native', label: 'settings.engineNative', description: 'settings.engineNativeDesc', icon: Cpu },
  { value: 'shotoku', label: 'settings.engineShotoku', description: 'settings.engineShotokuDesc', icon: Link2 },
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
    if (k === 'amount' && typeof v === 'number') val = sar(v)
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

function EngineSelector() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const t = useT()
  const [saving, setSaving] = useState(false)
  const setEngine = async (engine: Engine) => {
    if (!company || company.engine === engine) return
    setSaving(true)
    try {
      const { data } = await api.patch<Company>('/company', { engine })
      setCompany(data)
      toast.success(t('settings.engineSet', { engine: engine === 'native' ? 'Flaire native' : 'Shotoku sidecar' }))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">{t('settings.engine')}</h4>
      <div className="grid sm:grid-cols-2 gap-2">
        {ENGINES.map((e) => {
          const active = company?.engine === e.value
          return (
            <button
              key={e.value}
              type="button"
              disabled={saving}
              onClick={() => setEngine(e.value)}
              className={`text-start flex items-start gap-3 rounded-card border px-3 py-3 transition-colors ${active ? 'border-brand bg-brand-light' : 'border-line hover:bg-lavender'}`}
              aria-pressed={active}
            >
              <span className={`rounded-full p-1.5 ${active ? 'bg-brand text-white' : 'bg-lavender-deep text-neutral-600'}`}>
                <e.icon className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="text-sm font-semibold flex items-center gap-2">
                  {t(e.label)}
                  {active && <StatusPill tone="green">{t('status.active')}</StatusPill>}
                </span>
                <span className="block text-xs text-neutral-600 mt-0.5">{t(e.description)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AuditLedger() {
  const toast = useToast()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [verify, setVerify] = useState<AuditVerify | null>(null)
  const [verifying, setVerifying] = useState(false)
  const audit = useFetch(() => (open ? api.get<AuditEntry[]>('/audit', { params: { limit: 100 } }).then((r) => r.data) : Promise.resolve(null)), [open])

  const runVerify = async () => {
    setVerifying(true)
    setVerify(null)
    try {
      const { data } = await api.get<AuditVerify>('/audit/verify')
      setVerify(data)
      if (open) await audit.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <ScrollText className="h-4 w-4 text-neutral-500" />
        <h4 className="text-sm font-semibold">{t('settings.auditLedger')}</h4>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-400">{t('settings.hashChained')}</span>
        <div className="ms-auto flex items-center gap-2">
          {verify && (
            <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ${verify.ok ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`}>
              {verify.ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {verify.ok ? t('settings.chainOk', { n: verify.entries }) : t('settings.chainBroken', { n: verify.broken_at })}
            </span>
          )}
          <button className="btn-secondary text-xs" onClick={runVerify} disabled={verifying}>
            {verifying ? <Spinner className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} {t('settings.verify')}
          </button>
          <button className="btn-ghost text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl-flip" />} {open ? t('common.hide') : t('common.show')}
          </button>
        </div>
      </div>
      {open &&
        (audit.loading && !audit.data ? (
          <div className="py-4 text-xs text-neutral-500 flex items-center gap-2">
            <Spinner className="h-3.5 w-3.5" /> {t('common.loading')}
          </div>
        ) : audit.error && !audit.data ? (
          <ErrorNote message={audit.error} className="mt-3" />
        ) : (audit.data ?? []).length === 0 ? (
          <p className="text-xs text-neutral-500 mt-3">{t('settings.ledgerEmpty')}</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5 mt-3">
            <table className="w-full min-w-[640px]">
              <thead className="bg-lavender border-y border-line">
                <tr>
                  <th className="th">{t('settings.time')}</th>
                  <th className="th">{t('settings.actor')}</th>
                  <th className="th">{t('settings.event')}</th>
                  <th className="th">{t('settings.details')}</th>
                  <th className="th">{t('settings.hash')}</th>
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
        ))}
    </div>
  )
}

function ReconciliationRow() {
  const toast = useToast()
  const t = useT()
  const [result, setResult] = useState<Reconciliation | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const { data } = await api.get<Reconciliation>('/reconciliation')
      setResult(data)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="h-4 w-4 text-neutral-500" />
        <h4 className="text-sm font-semibold">{t('settings.reconciliation')}</h4>
        <span className="text-xs text-neutral-500">{t('settings.reconciliationHint')}</span>
        <button className="btn-secondary text-xs ms-auto" onClick={run} disabled={busy}>
          {busy && <Spinner className="h-3.5 w-3.5" />} {t('settings.runCheck')}
        </button>
      </div>
      {result && (
        <div className="mt-3 text-xs">
          <div className="flex items-center gap-2">
            {result.ok ? <StatusPill tone="green" dot>{t('settings.allMatched')}</StatusPill> : <StatusPill tone="red" dot>{t('settings.nIssues', { n: result.issues.length })}</StatusPill>}
            <span className="text-neutral-500 tnum">
              {t('activity.nRequests', { n: result.requests })} · {t('finance.nTransactions', { n: result.transactions })}
            </span>
          </div>
          {result.issues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.issues.map((i, idx) => (
                <li key={idx} className="rounded-input border border-red-200 bg-danger-tint px-3 py-2 text-danger">
                  <code className="font-mono">{i.type}</code>
                  {i.request_id ? ` (#${i.request_id})` : ''}: {i.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Settings card: the things most companies never touch. */
export function AdvancedCard() {
  const t = useT()
  return (
    <section id="advanced" className="card-lg p-5 scroll-mt-20 space-y-6">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('settings.advanced')}</h3>
      </div>
      <DepartmentsTable />
      <hr className="border-line" />
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="h-4 w-4 text-neutral-500" />
        <h4 className="text-sm font-semibold">{t('nav.policy')}</h4>
        <span className="text-xs text-neutral-500">{t('settings.policyLinkHint')}</span>
        <Link to="/policy" className="btn-secondary text-xs ms-auto">
          {t('policy.openPolicy')}
        </Link>
      </div>
      <hr className="border-line" />
      <EngineSelector />
      <hr className="border-line" />
      <AuditLedger />
      <hr className="border-line" />
      <ReconciliationRow />
    </section>
  )
}

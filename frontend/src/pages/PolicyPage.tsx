import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, GitCompare, History, ScrollText, X } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatDate } from '../lib/useFetch'
import { useT } from '../lib/i18n'
import type { TFn } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { sar } from '../lib/money'
import type { Agent, Department, PolicyChange, PolicyDiff, PolicyVersion } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { StatusPill } from '../components/StatusPill'

const MONEY_FIELDS = new Set(['per_transaction_limit', 'monthly_limit', 'approval_threshold', 'two_person_threshold', 'new_merchant_review_from', 'notify_threshold', 'monthly_budget', 'min_amount'])

/** Human value for a policy field: money for halala fields, On/Off for booleans, joined lists. */
export function formatPolicyValue(t: TFn, field: string, v: unknown): string {
  const leaf = field.split('.').pop() ?? field
  if (v === null || v === undefined) return t('policy.none')
  if (typeof v === 'boolean') return v ? t('common.on') : t('common.off')
  if (typeof v === 'number') return MONEY_FIELDS.has(leaf) ? sar(v) : String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return t('policy.empty')
    return v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join(', ')
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function fieldLabel(t: TFn, field: string): string {
  const leaf = field.split('.').pop() ?? field
  const key = `field.${leaf}`
  const hit = t(key)
  return hit === key ? leaf.replace(/_/g, ' ') : hit
}

function useTargetNames() {
  const agents = useFetch(() => api.get<Agent[]>('/agents').then((r) => r.data), [])
  const depts = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  return useMemo(() => {
    const a = new Map((agents.data ?? []).map((x) => [x.id, x.name]))
    const d = new Map((depts.data ?? []).map((x) => [x.id, x.name]))
    return { agents: a, departments: d }
  }, [agents.data, depts.data])
}

function targetLabel(t: TFn, ch: PolicyChange, names: { agents: Map<number, string>; departments: Map<number, string> }): string {
  if (ch.target_type === 'company') return t('policy.targetCompany')
  if (ch.target_type === 'agent') return t('policy.targetEmployee', { name: names.agents.get(ch.target_id ?? -1) ?? `#${ch.target_id}` })
  if (ch.target_type === 'department') return t('policy.targetDepartment', { name: names.departments.get(ch.target_id ?? -1) ?? `#${ch.target_id}` })
  return t('policy.targetRule', { id: ch.target_id ?? '' })
}

function ChangeCard({ change: ch, names, onChanged }: { change: PolicyChange; names: ReturnType<typeof useTargetNames>; onChanged: () => void }) {
  const t = useT()
  const toast = useToast()
  const { user, company } = useAuth()
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mine = ch.proposed_by?.id === user?.id
  const canDecide = !!user?.role && ['owner', 'admin'].includes(user.role) && !mine
  const needsPassword = company?.require_password_on_approve ?? true

  const act = async (kind: 'approve' | 'reject' | 'cancel') => {
    setBusy(true)
    setError(null)
    try {
      const body = kind === 'approve' ? { password: password || undefined, note: note.trim() || undefined } : kind === 'reject' ? { note: note.trim() || undefined } : {}
      await api.post(`/policy/changes/${ch.id}/${kind}`, body)
      toast.success(t(`policy.${kind}Done`))
      setApproveOpen(false)
      setRejectOpen(false)
      setPassword('')
      setNote('')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card-lg p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{targetLabel(t, ch, names)}</span>
        <StatusPill tone="amber">{t('policy.pendingBadge')}</StatusPill>
        <span className="ms-auto text-xs text-neutral-500">{formatDate(ch.created_at)}</span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {Object.entries(ch.changes).map(([field, d]) => (
          <li key={field} className="text-sm flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold">{fieldLabel(t, field)}</span>
            <span className="text-neutral-500 line-through tnum">{formatPolicyValue(t, field, d.from)}</span>
            <ArrowRight className="h-3.5 w-3.5 text-neutral-400 rtl-flip" />
            <span className="font-semibold text-brand tnum">{formatPolicyValue(t, field, d.to)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 text-xs text-neutral-600">
        {t('policy.proposedBy', { name: ch.proposed_by?.full_name ?? '' })}
        {ch.reason && (
          <span>
            {' '}
            · {t('policy.reason')}: <span className="text-ink">{ch.reason}</span>
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {canDecide && (
          <>
            <button className="btn-success text-xs" onClick={() => setApproveOpen(true)}>
              <Check className="h-3.5 w-3.5" /> {t('common.approve')}
            </button>
            <button className="btn-secondary text-xs" onClick={() => setRejectOpen(true)}>
              <X className="h-3.5 w-3.5" /> {t('policy.reject')}
            </button>
          </>
        )}
        {mine && (
          <button className="btn-ghost text-xs text-danger hover:bg-danger-tint" onClick={() => act('cancel')} disabled={busy}>
            {busy && <Spinner className="h-3.5 w-3.5" />} {t('policy.cancelChange')}
          </button>
        )}
        {!canDecide && !mine && <span className="text-xs text-neutral-500">{t('policy.waitingForAdmin')}</span>}
      </div>
      {!approveOpen && !rejectOpen && <ErrorNote message={error} className="mt-2" />}

      <Sheet
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={t('policy.approveTitle')}
        footer={
          <button type="button" className="btn-success w-full" onClick={() => act('approve')} disabled={busy || (needsPassword && !password)}>
            {busy && <Spinner />} {t('policy.approveApply')}
          </button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">{t('policy.approveExplain')}</p>
          <div>
            <label className="label" htmlFor={`pc-pw-${ch.id}`}>{needsPassword ? t('decision.yourPassword') : t('decision.yourPasswordOptional')}</label>
            <input id={`pc-pw-${ch.id}`} type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label" htmlFor={`pc-note-${ch.id}`}>{t('decision.noteOptional')}</label>
            <input id={`pc-note-${ch.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <ErrorNote message={error} />
        </div>
      </Sheet>

      <Sheet
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('policy.rejectTitle')}
        footer={
          <button type="button" className="btn-danger w-full" onClick={() => act('reject')} disabled={busy}>
            {busy && <Spinner />} {t('policy.reject')}
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor={`pc-rn-${ch.id}`}>{t('policy.rejectNote')}</label>
            <input id={`pc-rn-${ch.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus />
          </div>
          <ErrorNote message={error} />
        </div>
      </Sheet>
    </div>
  )
}

function VersionHistory({ versions }: { versions: PolicyVersion[] }) {
  const t = useT()
  const [picked, setPicked] = useState<number[]>([])
  const [diff, setDiff] = useState<PolicyDiff | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: number) => {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id)
      if (p.length >= 2) return [p[1], id]
      return [...p, id]
    })
  }

  useEffect(() => {
    if (picked.length !== 2) {
      setDiff(null)
      return
    }
    const byId = new Map(versions.map((v) => [v.id, v.version]))
    const [a, b] = [...picked].sort((x, y) => (byId.get(x) ?? 0) - (byId.get(y) ?? 0))
    let cancelled = false
    setBusy(true)
    setError(null)
    api
      .get<PolicyDiff>('/policy/diff', { params: { from: a, to: b } })
      .then((r) => !cancelled && setDiff(r.data))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setBusy(false))
    return () => {
      cancelled = true
    }
  }, [picked, versions])

  return (
    <section id="versions" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <History className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('policy.versionHistory')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('policy.versionHint')}</p>
      {versions.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">{t('policy.noVersions')}</div>
      ) : (
        <ul className="divide-y divide-line">
          {versions.map((v) => {
            const on = picked.includes(v.id)
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => toggle(v.id)}
                  aria-pressed={on}
                  className={`w-full flex items-start gap-3 px-2 py-2.5 text-start rounded-input transition-colors ${on ? 'bg-brand-light' : 'hover:bg-lavender/70'}`}
                >
                  <span className={`inline-flex h-7 min-w-[36px] px-1.5 items-center justify-center rounded-pill text-xs font-bold tnum ${on ? 'bg-brand text-white' : 'bg-lavender-deep text-neutral-600'}`}>
                    v{v.version}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate">{v.change_summary || t('policy.noSummary')}</span>
                    <span className="block text-xs text-neutral-500">
                      {formatDate(v.created_at)}
                      {v.created_by ? ` · ${v.created_by.full_name}` : ` · ${t('policy.system')}`}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {picked.length === 2 && (
        <div className="mt-4 pt-4 border-t border-line">
          <div className="flex items-center gap-2 mb-2">
            <GitCompare className="h-4 w-4 text-brand" />
            <h4 className="text-sm font-bold">{diff ? t('policy.compare', { a: diff.from.version, b: diff.to.version }) : t('policy.comparing')}</h4>
            {busy && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <ErrorNote message={error} />
          {diff && (
            <div className="overflow-x-auto -mx-5 px-5">
              {diff.changes.length === 0 ? (
                <p className="text-xs text-neutral-500">{t('policy.noDifferences')}</p>
              ) : (
                <table className="w-full min-w-[520px]">
                  <thead className="bg-lavender border-y border-line">
                    <tr>
                      <th className="th">{t('policy.field')}</th>
                      <th className="th">v{diff.from.version}</th>
                      <th className="th">v{diff.to.version}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {diff.changes.map((c) => (
                      <tr key={c.path}>
                        <td className="td font-mono text-xs">{c.path}</td>
                        <td className="td text-xs text-neutral-500 tnum break-all">{formatPolicyValue(t, c.path, c.from)}</td>
                        <td className="td text-xs font-semibold text-brand tnum break-all">{formatPolicyValue(t, c.path, c.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Policy: changes waiting for a second admin, and the version history with a diff viewer. */
export default function PolicyPage() {
  const t = useT()
  const { company } = useAuth()
  const names = useTargetNames()
  const changes = useFetch(() => api.get<PolicyChange[]>('/policy/changes', { params: { status: 'pending' } }).then((r) => r.data), [])
  const versions = useFetch(() => api.get<PolicyVersion[]>('/policy/versions', { params: { limit: 50 } }).then((r) => r.data), [])
  const refresh = () => {
    void changes.refetch()
    void versions.refetch()
  }
  const pending = changes.data ?? []

  return (
    <div className="max-w-[860px]">
      <PageHeader title={t('policy.title')} subtitle={t('policy.subtitle')} />
      <div className="space-y-5">
        <section id="pending" className="scroll-mt-20">
          <div className="flex items-center gap-2 px-1 mb-2.5">
            <ScrollText className="h-4 w-4 text-brand" />
            <h2 className="text-sm font-bold">{t('policy.pendingChanges')}</h2>
            {pending.length > 0 && (
              <span className="inline-flex min-w-[22px] h-[22px] items-center justify-center rounded-pill bg-brand px-1.5 text-[11px] font-bold text-white tnum">{pending.length}</span>
            )}
          </div>
          {changes.error && !changes.data ? (
            <ErrorNote message={changes.error} />
          ) : pending.length === 0 ? (
            <div className="card-lg p-6 text-center">
              <div className="text-sm font-bold">{t('policy.nothingPending')}</div>
              <div className="text-xs text-neutral-500 mt-1">{company?.require_change_approval ? t('policy.changeApprovalOn') : t('policy.changeApprovalOff')}</div>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((ch) => (
                <ChangeCard key={ch.id} change={ch} names={names} onChanged={refresh} />
              ))}
            </div>
          )}
        </section>
        <VersionHistory versions={versions.data ?? []} />
      </div>
    </div>
  )
}

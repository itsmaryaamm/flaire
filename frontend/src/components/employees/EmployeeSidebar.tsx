import { useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Pause, Play, Plug, RefreshCw, SlidersHorizontal, TerminalSquare, Trash2, UserCheck } from 'lucide-react'
import { api, API_URL, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch, timeAgo, formatDate } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import { sar } from '../../lib/money'
import { TEAM_ADMIN_ROLES } from '../../types'
import type { Agent, Connection, Department, Member, Role } from '../../types'
import { StatusPill } from '../StatusPill'
import { Spinner } from '../Spinner'
import { Modal } from '../Modal'
import { AgentForm } from '../AgentForm'
import { CopyBox } from '../CopyBox'
import { ErrorNote } from '../ErrorNote'
import { CardTile } from './CardTile'
import { useT } from '../../lib/i18n'

/** "Accountable: <owner>". Owners and admins pick another team member; everyone else reads it. PATCH owner_user_id. */
function AccountableRow({ agent: a, onChanged }: { agent: Agent; onChanged: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const t = useT()
  const canEdit = TEAM_ADMIN_ROLES.includes(String(user?.role) as Role)
  const members = useFetch(() => (canEdit ? api.get<Member[]>('/team/members').then((r) => r.data) : Promise.resolve([])), [canEdit])
  const [busy, setBusy] = useState(false)
  const options = (members.data ?? []).filter((m) => m.status === 'active' || m.id === a.owner?.id)

  const change = async (value: string) => {
    const id = Number(value)
    if (!id || id === a.owner?.id) return
    setBusy(true)
    try {
      await api.patch(`/agents/${a.id}`, { owner_user_id: id })
      const name = options.find((m) => m.id === id)?.full_name ?? ''
      toast.success(t('employees.accountableUpdated', { name }))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <UserCheck className="h-4 w-4 text-brand shrink-0" />
      <span className="text-xs text-neutral-500 shrink-0">{t('employees.accountable')}</span>
      {canEdit && options.length > 0 ? (
        <select
          className="input h-9 py-0 text-sm flex-1 min-w-0"
          value={a.owner?.id ?? ''}
          onChange={(e) => void change(e.target.value)}
          disabled={busy}
          aria-label={t('employees.accountable')}
        >
          {!a.owner && <option value="">{t('employees.nobodyYet')}</option>}
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name} ({t(`role.${m.role}`)})
            </option>
          ))}
        </select>
      ) : (
        <span className="font-semibold truncate">{a.owner?.full_name ?? t('employees.nobodyYet')}</span>
      )}
      {busy && <Spinner className="h-3.5 w-3.5" />}
    </div>
  )
}

/** Profile: name, role, status with Pause / Resume, and who answers for it. */
export function ProfileCard({ agent: a, onChanged, onDelete }: { agent: Agent; onChanged: () => void; onDelete: () => void }) {
  const toast = useToast()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try {
      await api.patch(`/agents/${a.id}`, { status: a.status === 'active' ? 'paused' : 'active' })
      toast.success(a.status === 'active' ? t('employees.pausedToast', { name: a.name }) : t('employees.resumedToast', { name: a.name }))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card-lg p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-brand-light text-brand p-2.5 shrink-0">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{a.name}</h1>
          <div className="text-sm text-neutral-500 truncate">
            {t(`agentRole.${a.role}`)} · {a.department_name}
          </div>
        </div>
        <StatusPill status={a.status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-neutral-500">{t('employees.spentThisMonth')}</div>
          <div className="font-semibold tnum">{sar(a.spent_this_period)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">{t('employees.lastActive')}</div>
          <div className="font-semibold">{timeAgo(a.last_active_at)}</div>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-line">
        <AccountableRow agent={a} onChanged={onChanged} />
      </div>
      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line">
        <button className="btn-secondary text-xs" onClick={toggle} disabled={busy}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : a.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {a.status === 'active' ? t('employees.pause') : t('employees.resume')}
        </button>
        <button className="btn-ghost text-xs text-danger hover:bg-danger-tint ms-auto" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
        </button>
      </div>
    </div>
  )
}

/** Card tile plus the limits editor (limits-only AgentForm in a modal). */
export function CardAndLimits({ agent: a, departments, lithicConfigured, onChanged }: { agent: Agent; departments: Department[]; lithicConfigured: boolean; onChanged: () => void }) {
  const toast = useToast()
  const t = useT()
  const [editOpen, setEditOpen] = useState(false)
  return (
    <div className="card-lg p-5 space-y-4">
      <CardTile agent={a} lithicConfigured={lithicConfigured} onChanged={onChanged} />
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold">{t('employees.limits')}</h3>
          <button className="btn-secondary text-xs" onClick={() => setEditOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t('common.edit')}
          </button>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">{t('employees.perPurchase')}</dt>
            <dd className="font-semibold tnum">{sar(a.per_transaction_limit, { compact: true })}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">{t('employees.monthly')}</dt>
            <dd className="font-semibold tnum">{sar(a.monthly_limit, { compact: true })}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">{t('employees.approvalFrom')}</dt>
            <dd className="font-semibold tnum">{sar(a.approval_threshold, { compact: true })}</dd>
          </div>
        </dl>
        <div className="mt-3 space-y-2">
          <div>
            <div className="text-xs text-neutral-500 mb-1">{t('employees.allowedCategories')}</div>
            <div className="flex flex-wrap gap-1">
              {a.allowed_categories.length === 0 ? (
                <span className="text-neutral-400 text-xs">{t('employees.any')}</span>
              ) : (
                a.allowed_categories.map((c) => (
                  <span key={c} className="rounded-pill bg-brand-light text-brand text-xs font-semibold px-2 py-0.5">
                    {c}
                  </span>
                ))
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 mb-1">{t('employees.blockedMerchants')}</div>
            <div className="flex flex-wrap gap-1">
              {a.blocked_merchants.length === 0 ? (
                <span className="text-neutral-400 text-xs">{t('employees.none')}</span>
              ) : (
                a.blocked_merchants.map((c) => (
                  <span key={c} className="rounded-pill bg-danger-tint text-danger text-xs font-semibold px-2 py-0.5">
                    {c}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('employees.limitsFor', { name: a.name })} size="lg">
        <AgentForm
          agent={a}
          limitsOnly
          departments={departments}
          onCancel={() => setEditOpen(false)}
          onSaved={(saved) => {
            setEditOpen(false)
            if (saved) toast.success(t('employees.limitsUpdated'))
            onChanged()
          }}
        />
      </Modal>
    </div>
  )
}

/** Claude clients connected as this employee, with revoke. */
export function ConnectedClaudes({ agentId }: { agentId: number }) {
  const toast = useToast()
  const t = useT()
  const connections = useFetch(() => api.get<Connection[]>('/connections').then((r) => r.data), [agentId])
  const [revoking, setRevoking] = useState<number | null>(null)
  const list = (connections.data ?? []).filter((c) => c.agent_id === agentId)

  const revoke = async (c: Connection) => {
    if (!window.confirm(t('employees.revokeConfirm'))) return
    setRevoking(c.id)
    try {
      await api.delete(`/connections/${c.id}`)
      toast.success(t('settings.connectionRevoked'))
      await connections.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="card-lg p-5">
      <div className="flex items-center gap-2 mb-1">
        <Plug className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-bold">{t('settings.connectedClaudes')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('employees.connectedHint')}</p>
      {connections.error && !connections.data ? (
        <ErrorNote message={connections.error} />
      ) : list.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">{t('settings.noClaudeYet')}</div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => (
            <li key={c.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{c.client}</div>
                <div className="text-xs text-neutral-500 truncate">
                  {c.connected_by} · {t('employees.since', { date: formatDate(c.created_at, false) })} · {t('employees.used', { when: timeAgo(c.last_used_at) })}
                </div>
              </div>
              <button className="btn-ghost text-xs text-danger hover:bg-danger-tint" onClick={() => revoke(c)} disabled={revoking === c.id}>
                {revoking === c.id ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />} {t('settings.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Collapsed: rotate key, curl snippet, connector URL. */
export function AdvancedSection({ agent: a, onRotated }: { agent: Agent; onRotated: (apiKey: string) => void }) {
  const toast = useToast()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rotate = async () => {
    if (!window.confirm(t('employees.rotateConfirm'))) return
    setBusy(true)
    try {
      const { data } = await api.post<{ api_key: string }>(`/agents/${a.id}/rotate-key`)
      onRotated(data.api_key)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const base = API_URL.replace(/\/$/, '')
  const curl = `curl -X POST ${base}/agent/purchase-requests \\
  -H "X-Agent-Key: ${a.key_prefix}_REPLACE_WITH_FULL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 50000, "merchant": "Google Ads", "category": "advertising", "description": "Ramadan launch campaign"}'`

  return (
    <div className="card-lg">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-5 py-4 text-start text-sm font-bold" aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400 rtl-flip" />}
        <TerminalSquare className="h-4 w-4 text-brand" /> {t('settings.advanced')}
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-line pt-4">
          <div>
            <div className="label">{t('employees.apiKey')}</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs text-neutral-600 flex-1" dir="ltr">{a.key_prefix}... ({t('employees.hashStored')})</code>
              <button className="btn-secondary text-xs" onClick={rotate} disabled={busy}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} {t('employees.rotateKey')}
              </button>
            </div>
          </div>
          <div>
            <div className="label">{t('settings.connectorUrl')}</div>
            <CopyBox value={`${base}/mcp`} />
          </div>
          <div>
            <div className="label">{t('employees.callApi')}</div>
            <pre dir="ltr" className="text-start text-[11px] font-mono bg-brand-deep text-white/90 rounded-card p-3 overflow-x-auto whitespace-pre">{curl}</pre>
            <div className="mt-2">
              <CopyBox value={curl.replace(/\\\n\s*/g, '')} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

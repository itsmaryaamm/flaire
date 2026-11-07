import { useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Pause, Play, Plug, RefreshCw, SlidersHorizontal, TerminalSquare, Trash2 } from 'lucide-react'
import { api, API_URL, errorMessage } from '../../lib/api'
import { useFetch, timeAgo, formatDate } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import { sar } from '../../lib/money'
import type { Agent, Connection, Department } from '../../types'
import { StatusPill } from '../StatusPill'
import { Spinner } from '../Spinner'
import { Modal } from '../Modal'
import { AgentForm } from '../AgentForm'
import { CopyBox } from '../CopyBox'
import { ErrorNote } from '../ErrorNote'
import { CardTile } from './CardTile'

/** Profile: name, role, status with Pause / Resume. */
export function ProfileCard({ agent: a, onChanged, onDelete }: { agent: Agent; onChanged: () => void; onDelete: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try {
      await api.patch(`/agents/${a.id}`, { status: a.status === 'active' ? 'paused' : 'active' })
      toast.success(a.status === 'active' ? `${a.name} paused.` : `${a.name} resumed.`)
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
          <div className="text-sm text-neutral-500 capitalize truncate">
            {a.role} · {a.department_name}
          </div>
        </div>
        <StatusPill status={a.status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-neutral-500">Spent this month</div>
          <div className="font-semibold tnum">{sar(a.spent_this_period)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Last active</div>
          <div className="font-semibold">{timeAgo(a.last_active_at)}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line">
        <button className="btn-secondary text-xs" onClick={toggle} disabled={busy}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : a.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {a.status === 'active' ? 'Pause' : 'Resume'}
        </button>
        <button className="btn-ghost text-xs text-danger hover:bg-danger-tint ml-auto" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  )
}

/** Card tile plus the limits editor (limits-only AgentForm in a modal). */
export function CardAndLimits({ agent: a, departments, onChanged }: { agent: Agent; departments: Department[]; onChanged: () => void }) {
  const toast = useToast()
  const [editOpen, setEditOpen] = useState(false)
  return (
    <div className="card-lg p-5 space-y-4">
      <CardTile card={a.card} />
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold">Limits</h3>
          <button className="btn-secondary text-xs" onClick={() => setEditOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">Per purchase</dt>
            <dd className="font-semibold tnum">{sar(a.per_transaction_limit, { compact: true })}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Monthly</dt>
            <dd className="font-semibold tnum">{sar(a.monthly_limit, { compact: true })}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Approval from</dt>
            <dd className="font-semibold tnum">{sar(a.approval_threshold, { compact: true })}</dd>
          </div>
        </dl>
        <div className="mt-3 space-y-2">
          <div>
            <div className="text-xs text-neutral-500 mb-1">Allowed categories</div>
            <div className="flex flex-wrap gap-1">
              {a.allowed_categories.length === 0 ? (
                <span className="text-neutral-400 text-xs">any</span>
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
            <div className="text-xs text-neutral-500 mb-1">Blocked merchants</div>
            <div className="flex flex-wrap gap-1">
              {a.blocked_merchants.length === 0 ? (
                <span className="text-neutral-400 text-xs">none</span>
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
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Limits: ${a.name}`} size="lg">
        <AgentForm
          agent={a}
          limitsOnly
          departments={departments}
          onCancel={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            toast.success('Limits updated. The card follows.')
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
  const connections = useFetch(() => api.get<Connection[]>('/connections').then((r) => r.data), [agentId])
  const [revoking, setRevoking] = useState<number | null>(null)
  const list = (connections.data ?? []).filter((c) => c.agent_id === agentId)

  const revoke = async (c: Connection) => {
    if (!window.confirm('Revoke this Claude connection? It will have to connect again.')) return
    setRevoking(c.id)
    try {
      await api.delete(`/connections/${c.id}`)
      toast.success('Connection revoked.')
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
        <h3 className="text-sm font-bold">Connected Claudes</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3">Claude clients acting as this employee. Connect a new one under Settings, Connect your Claude.</p>
      {connections.error && !connections.data ? (
        <ErrorNote message={connections.error} />
      ) : list.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">No Claude connected yet.</div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => (
            <li key={c.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{c.client}</div>
                <div className="text-xs text-neutral-500 truncate">
                  {c.connected_by} · since {formatDate(c.created_at, false)} · used {timeAgo(c.last_used_at)}
                </div>
              </div>
              <button className="btn-ghost text-xs text-danger hover:bg-danger-tint" onClick={() => revoke(c)} disabled={revoking === c.id}>
                {revoking === c.id ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />} Revoke
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
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rotate = async () => {
    if (!window.confirm('Rotate the API key? The current key and any direct connector link stop working immediately.')) return
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
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-5 py-4 text-left text-sm font-bold" aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
        <TerminalSquare className="h-4 w-4 text-brand" /> Advanced
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-line pt-4">
          <div>
            <div className="label">API key</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs text-neutral-600 flex-1">{a.key_prefix}... (hash stored)</code>
              <button className="btn-secondary text-xs" onClick={rotate} disabled={busy}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} Rotate key
              </button>
            </div>
          </div>
          <div>
            <div className="label">Connector URL</div>
            <CopyBox value={`${base}/mcp`} />
          </div>
          <div>
            <div className="label">Call the API as this employee</div>
            <pre className="text-[11px] font-mono bg-brand-deep text-white/90 rounded-card p-3 overflow-x-auto whitespace-pre">{curl}</pre>
            <div className="mt-2">
              <CopyBox value={curl.replace(/\\\n\s*/g, '')} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

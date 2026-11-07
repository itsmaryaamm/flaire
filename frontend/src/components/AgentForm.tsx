import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, errorMessage } from '../lib/api'
import { fromHalalas, toHalalas } from '../lib/money'
import type { Agent, AgentCreateInput, AgentUpdateInput, Department } from '../types'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'

interface FormState {
  name: string
  role: string
  department_id: string
  per_transaction_limit: string
  monthly_limit: string
  approval_threshold: string
  allowed_categories: string
  blocked_merchants: string
  max_requests_per_hour: string
  key_expires_in_days: string
}

const ROLES = ['marketing', 'operations', 'engineering', 'sales', 'finance', 'support', 'general']

function toForm(agent?: Agent | null, departments?: Department[]): FormState {
  return {
    name: agent?.name ?? '',
    role: agent?.role ?? 'marketing',
    department_id: String(agent?.department_id ?? departments?.[0]?.id ?? ''),
    per_transaction_limit: fromHalalas(agent?.per_transaction_limit ?? 100000),
    monthly_limit: fromHalalas(agent?.monthly_limit ?? 300000),
    approval_threshold: fromHalalas(agent?.approval_threshold ?? 100000),
    allowed_categories: (agent?.allowed_categories ?? ['advertising', 'software']).join(', '),
    blocked_merchants: (agent?.blocked_merchants ?? ['Gift card']).join(', '),
    max_requests_per_hour: String(agent?.max_requests_per_hour ?? 10),
    key_expires_in_days: '',
  }
}

function splitList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

/**
 * Create / edit form for an employee. When `agent` is provided it edits (PATCH),
 * otherwise it creates (POST) and passes the one-time api_key back via onCreated.
 */
export function AgentForm({
  agent,
  departments,
  onCancel,
  onSaved,
  onCreated,
  limitsOnly = false,
}: {
  agent?: Agent | null
  departments: Department[]
  onCancel: () => void
  onSaved: (agent: Agent) => void
  onCreated?: (agent: Agent, apiKey: string) => void
  limitsOnly?: boolean
}) {
  const [form, setForm] = useState<FormState>(() => toForm(agent, departments))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm(toForm(agent, departments))
  }, [agent, departments])

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const per = toHalalas(form.per_transaction_limit)
    const monthly = toHalalas(form.monthly_limit)
    const threshold = toHalalas(form.approval_threshold)
    if ([per, monthly, threshold].some((n) => Number.isNaN(n) || n < 0)) {
      setError('Limits must be valid SAR amounts.')
      return
    }
    if (!form.department_id) {
      setError('Pick a department. Create one under Settings, Advanced, if none exist.')
      return
    }
    const payload: AgentCreateInput = {
      name: form.name.trim(),
      role: form.role,
      department_id: Number(form.department_id),
      per_transaction_limit: per,
      monthly_limit: monthly,
      approval_threshold: threshold,
      allowed_categories: splitList(form.allowed_categories),
      blocked_merchants: splitList(form.blocked_merchants),
      max_requests_per_hour: Number(form.max_requests_per_hour) || 0,
      ...(form.key_expires_in_days !== '' ? { key_expires_in_days: Number(form.key_expires_in_days) } : {}),
    }
    setBusy(true)
    try {
      if (agent) {
        const body: AgentUpdateInput = limitsOnly
          ? {
              per_transaction_limit: payload.per_transaction_limit,
              monthly_limit: payload.monthly_limit,
              approval_threshold: payload.approval_threshold,
              allowed_categories: payload.allowed_categories,
              blocked_merchants: payload.blocked_merchants,
              max_requests_per_hour: payload.max_requests_per_hour,
            }
          : payload
        const { data } = await api.patch<Agent>(`/agents/${agent.id}`, body)
        onSaved(data)
      } else {
        const { data } = await api.post<{ agent: Agent; api_key: string }>('/agents', payload)
        onSaved(data.agent)
        onCreated?.(data.agent, data.api_key)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!limitsOnly && (
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3">
            <label className="label">Name</label>
            <input className="input" required value={form.name} onChange={set('name')} placeholder="Marketing AI" />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input text-xs" value={form.department_id} onChange={set('department_id')} required>
              {departments.length === 0 && <option value="">No departments yet</option>}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <fieldset className="rounded-card border border-line p-4 space-y-3">
        <legend className="px-1 mono-label">Spending limits (SAR)</legend>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Per purchase</label>
            <input className="input tnum" inputMode="decimal" required value={form.per_transaction_limit} onChange={set('per_transaction_limit')} />
          </div>
          <div>
            <label className="label">Monthly</label>
            <input className="input tnum" inputMode="decimal" required value={form.monthly_limit} onChange={set('monthly_limit')} />
          </div>
          <div>
            <label className="label">Human approval from</label>
            <input className="input tnum" inputMode="decimal" required value={form.approval_threshold} onChange={set('approval_threshold')} />
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          Anything above the approval threshold waits for a human. Anything above the per-purchase limit is blocked outright. Limits are mirrored to the employee's card.
        </p>
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Allowed categories</label>
          <input className="input" value={form.allowed_categories} onChange={set('allowed_categories')} placeholder="advertising, software" />
          <p className="text-xs text-neutral-400 mt-1">Comma separated. Empty means any.</p>
        </div>
        <div>
          <label className="label">Blocked merchants</label>
          <input className="input" value={form.blocked_merchants} onChange={set('blocked_merchants')} placeholder="Gift card, Crypto" />
          <p className="text-xs text-neutral-400 mt-1">Comma separated, matched by name.</p>
        </div>
        <div>
          <label className="label">Max requests per hour</label>
          <input className="input tnum" type="number" min={0} value={form.max_requests_per_hour} onChange={set('max_requests_per_hour')} />
        </div>
        <div>
          <label className="label">Connect link expires in (days)</label>
          <input className="input tnum" type="number" min={0} max={365} value={form.key_expires_in_days} onChange={set('key_expires_in_days')} placeholder="never" />
          <p className="text-xs text-neutral-400 mt-1">Blank keeps the current setting. 0 removes expiry.</p>
        </div>
      </div>

      <ErrorNote message={error} />

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner />}
          {agent ? 'Save changes' : 'Create employee'}
        </button>
      </div>
    </form>
  )
}

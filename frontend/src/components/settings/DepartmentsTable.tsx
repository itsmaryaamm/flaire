import { useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import { fromHalalas, sar, toHalalas } from '../../lib/money'
import type { Department } from '../../types'
import { Modal } from '../Modal'
import { ErrorNote } from '../ErrorNote'
import { Spinner } from '../Spinner'

function DepartmentForm({ dept, onCancel, onSaved }: { dept: Department | null; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(dept?.name ?? '')
  const [budget, setBudget] = useState(fromHalalas(dept?.monthly_budget ?? 500000))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const h = toHalalas(budget)
    if (Number.isNaN(h) || h < 0) {
      setError('Enter a valid SAR amount.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (dept) await api.patch(`/departments/${dept.id}`, { name: name.trim(), monthly_budget: h })
      else await api.post('/departments', { name: name.trim(), monthly_budget: h })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing" autoFocus />
      </div>
      <div>
        <label className="label">Monthly budget (SAR)</label>
        <input className="input tnum" inputMode="decimal" required value={budget} onChange={(e) => setBudget(e.target.value)} />
        <p className="text-xs text-neutral-400 mt-1">Resets each period. Employees in this department draw from it.</p>
      </div>
      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner />} {dept ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  )
}

/** Small departments table: name, budget, remaining, pause toggle, add / edit / delete. */
export function DepartmentsTable() {
  const toast = useToast()
  const depts = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const list = depts.data ?? []

  const togglePause = async (d: Department) => {
    setBusyId(d.id)
    try {
      await api.patch(`/departments/${d.id}`, { spending_paused: !d.spending_paused })
      toast.success(d.spending_paused ? `${d.name} resumed.` : `${d.name} paused.`)
      await depts.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (d: Department) => {
    if (!window.confirm(`Delete ${d.name}? The server refuses if employees still belong to it.`)) return
    setBusyId(d.id)
    try {
      await api.delete(`/departments/${d.id}`)
      toast.success(`${d.name} deleted.`)
      await depts.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">Departments</h4>
        <button className="btn-secondary text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {depts.error && !depts.data ? (
        <ErrorNote message={depts.error} />
      ) : list.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">
          {depts.loading ? 'Loading' : 'No departments yet. Employees need one.'}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[520px]">
            <thead className="bg-lavender border-y border-line">
              <tr>
                <th className="th">Name</th>
                <th className="th text-right">Budget</th>
                <th className="th text-right">Remaining</th>
                <th className="th">Spending</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((d) => (
                <tr key={d.id} className="hover:bg-lavender/70">
                  <td className="td font-semibold">
                    {d.name}
                    <span className="block text-[11px] font-normal text-neutral-500">
                      {d.agent_count} employee{d.agent_count === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="td text-right tnum">{sar(d.monthly_budget)}</td>
                  <td className={`td text-right tnum ${d.remaining <= 0 ? 'text-danger' : ''}`}>{sar(d.remaining)}</td>
                  <td className="td">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!d.spending_paused}
                      onClick={() => togglePause(d)}
                      disabled={busyId === d.id}
                      className="inline-flex items-center gap-2 text-xs font-semibold"
                      title={d.spending_paused ? 'Paused. Click to resume.' : 'Live. Click to pause.'}
                    >
                      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${d.spending_paused ? 'bg-amber-500' : 'bg-success'}`}>
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${d.spending_paused ? 'translate-x-0.5' : 'translate-x-[18px]'}`} />
                      </span>
                      {d.spending_paused ? 'Paused' : 'Live'}
                    </button>
                  </td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="btn-ghost p-1.5" onClick={() => setEditing(d)} aria-label="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn-ghost p-1.5 text-danger hover:bg-danger-tint" onClick={() => remove(d)} disabled={busyId === d.id} aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New department" size="sm">
        <DepartmentForm
          dept={null}
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false)
            toast.success('Department created.')
            void depts.refetch()
          }}
        />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit department" size="sm">
        {editing && (
          <DepartmentForm
            dept={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              toast.success('Department updated.')
              void depts.refetch()
            }}
          />
        )}
      </Modal>
    </div>
  )
}

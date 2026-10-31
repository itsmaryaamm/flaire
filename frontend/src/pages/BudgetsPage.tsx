import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Pencil, Trash2, PieChart } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import { fromHalalas, pct, sar, toHalalas } from '../lib/money'
import type { Department } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Modal } from '../components/Modal'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { Money } from '../components/Money'

function DepartmentForm({
  dept,
  onCancel,
  onSaved,
}: {
  dept: Department | null
  onCancel: () => void
  onSaved: () => void
}) {
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
        <label className="label">Department name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing" autoFocus />
      </div>
      <div>
        <label className="label">Monthly budget (SAR)</label>
        <input className="input tnum" inputMode="decimal" required value={budget} onChange={(e) => setBudget(e.target.value)} />
        <p className="text-xs text-neutral-400 mt-1">Resets each period. AI employees in this department draw from it.</p>
      </div>
      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner />} {dept ? 'Save' : 'Create department'}
        </button>
      </div>
    </form>
  )
}

export default function BudgetsPage() {
  const toast = useToast()
  const depts = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await api.delete(`/departments/${deleting.id}`)
      toast.success(`${deleting.name} deleted.`)
      setDeleting(null)
      await depts.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const list = depts.data ?? []
  const totalBudget = list.reduce((s, d) => s + d.monthly_budget, 0)
  const totalSpent = list.reduce((s, d) => s + d.spent_this_period, 0)

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle="Monthly budgets that AI employees draw from. A request that would overshoot the budget is denied."
        actions={
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New department
          </button>
        }
      />

      {list.length > 0 && (
        <div className="card p-5 mb-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <div className="text-xs text-neutral-500 uppercase tracking-wide">All departments</div>
            <div className="text-lg font-semibold tnum mt-0.5">
              {sar(totalSpent)} <span className="text-neutral-400 font-normal">of {sar(totalBudget)}</span>
            </div>
            <ProgressBar value={totalSpent} max={totalBudget} className="mt-2" />
          </div>
          <div className="text-sm text-neutral-600 tnum">{pct(totalSpent, totalBudget)}% used</div>
        </div>
      )}

      {depts.loading && !depts.data ? (
        <PageLoader />
      ) : depts.error && !depts.data ? (
        <ErrorNote message={depts.error} />
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<PieChart className="h-5 w-5" />}
            title="No departments yet"
            description="Create a department with a monthly budget before adding AI employees to it."
            action={
              <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> New department
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((d) => (
            <div key={d.id} className="card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{d.name}</h3>
                  <div className="text-xs text-neutral-500">
                    {d.agent_count} AI employee{d.agent_count === 1 ? '' : 's'} · period from {d.period_start}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost p-1.5" onClick={() => setEditing(d)} aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="btn-ghost p-1.5 text-red-600 hover:bg-red-50" onClick={() => setDeleting(d)} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <Money halalas={d.spent_this_period} className="text-xl font-semibold" />
                  <span className="text-xs text-neutral-500 tnum">{pct(d.spent_this_period, d.monthly_budget)}%</span>
                </div>
                <ProgressBar value={d.spent_this_period} max={d.monthly_budget} className="mt-2" />
              </div>
              <div className="grid grid-cols-2 text-sm pt-1">
                <div>
                  <div className="text-xs text-neutral-500">Budget</div>
                  <div className="font-medium tnum">{sar(d.monthly_budget)}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Remaining</div>
                  <div className={`font-medium tnum ${d.remaining <= 0 ? 'text-red-600' : 'text-mint-deep'}`}>{sar(d.remaining)}</div>
                </div>
              </div>
            </div>
          ))}
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
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete department?"
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn-danger" onClick={remove} disabled={busy}>
              {busy && <Spinner />} Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          <strong>{deleting?.name}</strong> has {deleting?.agent_count ?? 0} AI employee(s). The backend may refuse if agents still belong to it.
        </p>
      </Modal>
    </div>
  )
}

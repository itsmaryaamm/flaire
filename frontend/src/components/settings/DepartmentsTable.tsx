import { useState } from 'react'
import type { FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import { useT } from '../../lib/i18n'
import { usePendingChange } from '../../lib/pending'
import { fromHalalas, sar, toHalalas } from '../../lib/money'
import type { CostCenter, Department } from '../../types'
import { Modal } from '../Modal'
import { ErrorNote } from '../ErrorNote'
import { Spinner } from '../Spinner'
import { CostCenterFields } from '../CostCenterFields'

function DepartmentForm({ dept, onCancel, onSaved }: { dept: Department | null; onCancel: () => void; onSaved: (pending: boolean) => void }) {
  const t = useT()
  const pending = usePendingChange()
  const [name, setName] = useState(dept?.name ?? '')
  const [budget, setBudget] = useState(fromHalalas(dept?.monthly_budget ?? 500000))
  const [costCenterId, setCostCenterId] = useState<string>(dept?.cost_center_id ? String(dept.cost_center_id) : '')
  const [glCode, setGlCode] = useState(dept?.gl_code ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const h = toHalalas(budget)
    if (Number.isNaN(h) || h < 0) {
      setError(t('common.validAmount'))
      return
    }
    setBusy(true)
    setError(null)
    const body = { name: name.trim(), monthly_budget: h, cost_center_id: costCenterId ? Number(costCenterId) : null, gl_code: glCode.trim() || null }
    try {
      if (dept) {
        const res = await api.patch(`/departments/${dept.id}`, body)
        onSaved(pending(res))
      } else {
        await api.post('/departments', body)
        onSaved(false)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">{t('team.name')}</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.deptPlaceholder')} autoFocus />
      </div>
      <div>
        <label className="label">{t('settings.monthlyBudgetSar')}</label>
        <input className="input tnum" inputMode="decimal" required value={budget} onChange={(e) => setBudget(e.target.value)} />
        <p className="text-xs text-neutral-400 mt-1">{t('settings.budgetHint')}</p>
      </div>
      <CostCenterFields costCenterId={costCenterId} glCode={glCode} onCostCenter={setCostCenterId} onGlCode={setGlCode} />
      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner />} {dept ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>
  )
}

/** Small departments table: name, budget, remaining, cost center, pause toggle, add / edit / delete. */
export function DepartmentsTable() {
  const t = useT()
  const toast = useToast()
  const pending = usePendingChange()
  const depts = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const costCenters = useFetch(() => api.get<CostCenter[]>('/finance/cost-centers', { params: { include_inactive: true } }).then((r) => r.data), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const list = depts.data ?? []
  const ccName = (id: number | null | undefined) => (costCenters.data ?? []).find((c) => c.id === id)?.code

  const togglePause = async (d: Department) => {
    setBusyId(d.id)
    try {
      const res = await api.patch(`/departments/${d.id}`, { spending_paused: !d.spending_paused })
      if (!pending(res)) toast.success(d.spending_paused ? t('settings.deptResumed', { name: d.name }) : t('settings.deptPaused', { name: d.name }))
      await depts.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (d: Department) => {
    if (!window.confirm(t('settings.deptDeleteConfirm', { name: d.name }))) return
    setBusyId(d.id)
    try {
      await api.delete(`/departments/${d.id}`)
      toast.success(t('settings.deptDeleted', { name: d.name }))
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
        <h4 className="text-sm font-semibold">{t('settings.departments')}</h4>
        <button className="btn-secondary text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> {t('common.add')}
        </button>
      </div>
      {depts.error && !depts.data ? (
        <ErrorNote message={depts.error} />
      ) : list.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">
          {depts.loading ? t('common.loading') : t('settings.noDepartments')}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[560px]">
            <thead className="bg-lavender border-y border-line">
              <tr>
                <th className="th">{t('team.name')}</th>
                <th className="th text-end">{t('settings.budget')}</th>
                <th className="th text-end">{t('settings.remaining')}</th>
                <th className="th">{t('settings.spending')}</th>
                <th className="th text-end"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((d) => (
                <tr key={d.id} className="hover:bg-lavender/70">
                  <td className="td font-semibold">
                    {d.name}
                    <span className="block text-[11px] font-normal text-neutral-500">
                      {t(d.agent_count === 1 ? 'settings.nEmployeeOne' : 'settings.nEmployees', { n: d.agent_count })}
                      {ccName(d.cost_center_id) && <span className="font-mono"> · {ccName(d.cost_center_id)}</span>}
                      {d.gl_code && <span className="font-mono"> · GL {d.gl_code}</span>}
                    </span>
                  </td>
                  <td className="td text-end tnum">{sar(d.monthly_budget)}</td>
                  <td className={`td text-end tnum ${d.remaining <= 0 ? 'text-danger' : ''}`}>{sar(d.remaining)}</td>
                  <td className="td">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!d.spending_paused}
                      onClick={() => togglePause(d)}
                      disabled={busyId === d.id}
                      className="inline-flex items-center gap-2 text-xs font-semibold"
                      title={d.spending_paused ? t('settings.pausedClickResume') : t('settings.liveClickPause')}
                    >
                      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${d.spending_paused ? 'bg-amber-500' : 'bg-success'}`}>
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${d.spending_paused ? 'translate-x-0.5 rtl:-translate-x-0.5' : 'translate-x-[18px] rtl:-translate-x-[18px]'}`} />
                      </span>
                      {d.spending_paused ? t('settings.paused') : t('settings.live')}
                    </button>
                  </td>
                  <td className="td text-end whitespace-nowrap">
                    <button className="btn-ghost p-1.5" onClick={() => setEditing(d)} aria-label={t('common.edit')}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn-ghost p-1.5 text-danger hover:bg-danger-tint" onClick={() => remove(d)} disabled={busyId === d.id} aria-label={t('common.delete')}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('settings.newDepartment')} size="sm">
        <DepartmentForm
          dept={null}
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false)
            toast.success(t('settings.deptCreated'))
            void depts.refetch()
          }}
        />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('settings.editDepartment')} size="sm">
        {editing && (
          <DepartmentForm
            dept={editing}
            onCancel={() => setEditing(null)}
            onSaved={(wasPending) => {
              setEditing(null)
              if (!wasPending) toast.success(t('settings.deptUpdated'))
              void depts.refetch()
            }}
          />
        )}
      </Modal>
    </div>
  )
}

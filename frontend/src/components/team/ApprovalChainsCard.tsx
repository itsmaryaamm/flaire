import { useEffect, useState } from 'react'
import { GitBranch, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { fromHalalas, sar, toHalalas } from '../../lib/money'
import { stepRoleLabel } from '../../lib/chain'
import type { ApprovalRule, ApprovalStep, Department } from '../../types'
import { STEP_ROLES } from '../../types'
import { Sheet } from '../Sheet'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { StatusPill } from '../StatusPill'

type Draft = { department_id: string; min_amount: string; steps: ApprovalStep[]; active: boolean }

function toDraft(rule: ApprovalRule | null): Draft {
  return {
    department_id: rule?.department_id ? String(rule.department_id) : '',
    min_amount: fromHalalas(rule?.min_amount ?? 0),
    steps: rule?.steps.length ? rule.steps.map((s) => ({ ...s })) : [{ role: 'dept_head', count: 1 }],
    active: rule?.active ?? true,
  }
}

/** Step pills: "1 department head, then 2 finance". */
export function StepPills({ steps }: { steps: ApprovalStep[] }) {
  const t = useT()
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {steps.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-neutral-400">{t('chain.thenWord')}</span>}
          <span className="rounded-pill bg-brand-light text-brand text-xs font-semibold px-2 py-0.5 tnum">
            {s.count} {stepRoleLabel(t, s.role)}
          </span>
        </span>
      ))}
    </span>
  )
}

function RuleSheet({ rule, open, departments, onClose, onSaved }: { rule: ApprovalRule | null; open: boolean; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setDraft(toDraft(rule))
      setError(null)
    }
  }, [open, rule])

  const setStep = (i: number, patch: Partial<ApprovalStep>) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const addStep = () => setDraft((d) => ({ ...d, steps: [...d.steps, { role: 'finance', count: 1 }] }))
  const removeStep = (i: number) => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))

  const save = async () => {
    const min = toHalalas(draft.min_amount)
    if (Number.isNaN(min) || min < 0) {
      setError(t('common.validAmount'))
      return
    }
    if (draft.steps.length === 0) {
      setError(t('chains.needStep'))
      return
    }
    setBusy(true)
    setError(null)
    const body = { department_id: draft.department_id ? Number(draft.department_id) : null, min_amount: min, steps: draft.steps, active: draft.active }
    try {
      if (rule) await api.patch(`/team/approval-rules/${rule.id}`, body)
      else await api.post('/team/approval-rules', body)
      toast.success(rule ? t('chains.updated') : t('chains.created'))
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={rule ? t('chains.editChain') : t('chains.newChain')}
      size="md"
      footer={
        <button type="button" className="btn-primary w-full" onClick={save} disabled={busy}>
          {busy && <Spinner />} {rule ? t('common.save') : t('common.create')}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="rule-dept">{t('chains.appliesTo')}</label>
            <select id="rule-dept" className="input" value={draft.department_id} onChange={(e) => setDraft((d) => ({ ...d, department_id: e.target.value }))}>
              <option value="">{t('chains.companyWide')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rule-min">{t('chains.fromAmount')}</label>
            <input id="rule-min" className="input tnum" inputMode="decimal" value={draft.min_amount} onChange={(e) => setDraft((d) => ({ ...d, min_amount: e.target.value }))} />
          </div>
        </div>
        <div>
          <div className="label">{t('chains.steps')}</div>
          <div className="space-y-2">
            {draft.steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-card border border-line bg-lavender px-3 py-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-white text-[11px] font-bold tnum">{i + 1}</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="input w-16 tnum"
                  value={s.count}
                  onChange={(e) => setStep(i, { count: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                  aria-label={t('chains.count')}
                />
                <select className="input flex-1" value={s.role} onChange={(e) => setStep(i, { role: e.target.value })} aria-label={t('chains.stepRole')}>
                  {STEP_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {stepRoleLabel(t, r)}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-ghost p-1.5 text-danger" onClick={() => removeStep(i)} disabled={draft.steps.length === 1} aria-label={t('common.remove')}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary text-xs mt-2" onClick={addStep} disabled={draft.steps.length >= 6}>
            <Plus className="h-3.5 w-3.5" /> {t('chains.addStep')}
          </button>
          <p className="text-xs text-neutral-500 mt-2">{t('chains.stepsHint')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="accent-brand" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} />
          {t('chains.active')}
        </label>
        <ErrorNote message={error} />
      </div>
    </Sheet>
  )
}

/** Approval chains (ApprovalRules): who must sign off, in what order, from what amount. */
export function ApprovalChainsCard({ rules, departments, canManage, onChanged }: { rules: ApprovalRule[]; departments: Department[]; canManage: boolean; onChanged: () => void }) {
  const t = useT()
  const toast = useToast()
  const [editing, setEditing] = useState<ApprovalRule | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [deleting, setDeleting] = useState<ApprovalRule | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await api.delete(`/team/approval-rules/${deleting.id}`)
      toast.success(t('chains.deleted'))
      setDeleting(null)
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="chains" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('chains.title')}</h3>
        {canManage && (
          <button
            className="btn-secondary text-xs ms-auto"
            onClick={() => {
              setEditing(null)
              setSheetOpen(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" /> {t('common.add')}
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('chains.hint')}</p>
      {rules.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">{t('chains.none')}</div>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="min-w-[140px]">
                <div className="text-sm font-semibold">{r.department_name ?? t('chains.companyWide')}</div>
                <div className="text-xs text-neutral-500 tnum">{t('chains.from', { amount: sar(r.min_amount) })}</div>
              </div>
              <div className="flex-1 min-w-[200px]">
                <StepPills steps={r.steps} />
              </div>
              {!r.active && <StatusPill tone="neutral">{t('chains.inactive')}</StatusPill>}
              {canManage && (
                <div className="whitespace-nowrap">
                  <button
                    className="btn-ghost p-1.5"
                    onClick={() => {
                      setEditing(r)
                      setSheetOpen(true)
                    }}
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button className="btn-ghost p-1.5 text-danger hover:bg-danger-tint" onClick={() => setDeleting(r)} aria-label={t('common.delete')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <RuleSheet rule={editing} open={sheetOpen} departments={departments} onClose={() => setSheetOpen(false)} onSaved={onChanged} />
      <Sheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('chains.deleteChain')}
        footer={
          <button type="button" className="btn-danger w-full" onClick={remove} disabled={busy}>
            {busy && <Spinner />} {t('common.delete')}
          </button>
        }
      >
        <p className="text-sm text-neutral-600">{t('chains.deleteConfirm')}</p>
      </Sheet>
    </section>
  )
}

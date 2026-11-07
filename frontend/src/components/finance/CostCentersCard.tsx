import { useEffect, useState } from 'react'
import { Ban, Pencil, Plus, Tags } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import type { CostCenter } from '../../types'
import { Sheet } from '../Sheet'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { StatusPill } from '../StatusPill'

function CostCenterSheet({ cc, open, onClose, onSaved }: { cc: CostCenter | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [gl, setGl] = useState('')
  const [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setCode(cc?.code ?? '')
      setName(cc?.name ?? '')
      setGl(cc?.gl_code ?? '')
      setActive(cc?.active ?? true)
      setError(null)
    }
  }, [open, cc])

  const save = async () => {
    setBusy(true)
    setError(null)
    const body = { code: code.trim().toUpperCase(), name: name.trim(), gl_code: gl.trim() || null, active }
    try {
      if (cc) await api.patch(`/finance/cost-centers/${cc.id}`, body)
      else await api.post('/finance/cost-centers', body)
      toast.success(cc ? t('finance.ccUpdated') : t('finance.ccCreated'))
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
      title={cc ? t('finance.editCostCenter') : t('finance.newCostCenter')}
      footer={
        <button type="button" className="btn-primary w-full" onClick={save} disabled={busy || !code.trim() || !name.trim()}>
          {busy && <Spinner />} {cc ? t('common.save') : t('common.create')}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="cc-code">{t('finance.code')}</label>
            <input id="cc-code" className="input font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MKT" maxLength={40} required />
          </div>
          <div>
            <label className="label" htmlFor="cc-gl">{t('finance.glCode')}</label>
            <input id="cc-gl" className="input font-mono" value={gl} onChange={(e) => setGl(e.target.value)} placeholder="6100" maxLength={40} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="cc-name">{t('team.name')}</label>
          <input id="cc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('finance.ccNamePlaceholder')} maxLength={120} required />
        </div>
        {cc && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="accent-brand" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('finance.ccActive')}
          </label>
        )}
        <ErrorNote message={error} />
      </div>
    </Sheet>
  )
}

/** Cost centers: code, name, GL code, active. Deactivating keeps history on its code. */
export function CostCentersCard({ items, loading, canManage, onChanged }: { items: CostCenter[]; loading: boolean; canManage: boolean; onChanged: () => void }) {
  const t = useT()
  const toast = useToast()
  const [editing, setEditing] = useState<CostCenter | null>(null)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const deactivate = async (cc: CostCenter) => {
    setBusyId(cc.id)
    try {
      await api.delete(`/finance/cost-centers/${cc.id}`)
      toast.success(t('finance.ccDeactivated', { code: cc.code }))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const reactivate = async (cc: CostCenter) => {
    setBusyId(cc.id)
    try {
      await api.patch(`/finance/cost-centers/${cc.id}`, { active: true })
      toast.success(t('finance.ccReactivated', { code: cc.code }))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section id="cost-centers" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Tags className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('finance.costCenters')}</h3>
        {canManage && (
          <button
            className="btn-secondary text-xs ms-auto"
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" /> {t('common.add')}
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('finance.costCentersHint')}</p>
      {items.length === 0 ? (
        <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">{loading ? t('common.loading') : t('finance.noCostCenters')}</div>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[520px]">
            <thead className="bg-lavender border-y border-line">
              <tr>
                <th className="th">{t('finance.code')}</th>
                <th className="th">{t('team.name')}</th>
                <th className="th">{t('finance.glCode')}</th>
                <th className="th">{t('team.status')}</th>
                {canManage && <th className="th text-end"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((cc) => (
                <tr key={cc.id} className={`hover:bg-lavender/70 ${cc.active ? '' : 'opacity-60'}`}>
                  <td className="td font-mono text-xs font-semibold">{cc.code}</td>
                  <td className="td">{cc.name}</td>
                  <td className="td font-mono text-xs text-neutral-600">{cc.gl_code ?? <span className="text-neutral-400">{t('finance.noGl')}</span>}</td>
                  <td className="td">{cc.active ? <StatusPill tone="green" dot>{t('finance.ccActive')}</StatusPill> : <StatusPill tone="neutral">{t('finance.ccInactive')}</StatusPill>}</td>
                  {canManage && (
                    <td className="td text-end whitespace-nowrap">
                      <button
                        className="btn-ghost p-1.5"
                        onClick={() => {
                          setEditing(cc)
                          setOpen(true)
                        }}
                        aria-label={t('common.edit')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {cc.active ? (
                        <button className="btn-ghost p-1.5 text-warn" onClick={() => deactivate(cc)} disabled={busyId === cc.id} aria-label={t('finance.deactivate')} title={t('finance.deactivate')}>
                          {busyId === cc.id ? <Spinner className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        </button>
                      ) : (
                        <button className="btn-ghost text-xs" onClick={() => reactivate(cc)} disabled={busyId === cc.id}>
                          {busyId === cc.id && <Spinner className="h-3.5 w-3.5" />} {t('finance.reactivate')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CostCenterSheet cc={editing} open={open} onClose={() => setOpen(false)} onSaved={onChanged} />
    </section>
  )
}

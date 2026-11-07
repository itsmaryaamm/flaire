import { api } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import { useT } from '../lib/i18n'
import type { CostCenter } from '../types'

/** Cost center select plus GL code input, shared by the department and employee forms. */
export function CostCenterFields({
  costCenterId,
  glCode,
  onCostCenter,
  onGlCode,
}: {
  costCenterId: string
  glCode: string
  onCostCenter: (id: string) => void
  onGlCode: (code: string) => void
}) {
  const t = useT()
  const centers = useFetch(() => api.get<CostCenter[]>('/finance/cost-centers').then((r) => r.data), [])
  const list = centers.data ?? []
  const picked = list.find((c) => String(c.id) === costCenterId)
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">{t('finance.costCenter')}</label>
        <select className="input text-xs" value={costCenterId} onChange={(e) => onCostCenter(e.target.value)}>
          <option value="">{t('finance.noCostCenter')}</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{t('finance.glCode')}</label>
        <input className="input font-mono" value={glCode} onChange={(e) => onGlCode(e.target.value)} placeholder={picked?.gl_code ?? '6000'} maxLength={40} />
        <p className="text-xs text-neutral-400 mt-1">{t('finance.glHint')}</p>
      </div>
    </div>
  )
}

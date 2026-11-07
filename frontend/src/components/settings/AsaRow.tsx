import { useState } from 'react'
import { Zap } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import type { LithicStatus } from '../../types'
import { StatusPill } from '../StatusPill'
import { Spinner } from '../Spinner'

/** Payments row: Lithic real-time authorization (ASA) enrollment. */
export function AsaRow() {
  const toast = useToast()
  const status = useFetch(() => api.get<LithicStatus>('/settings/lithic/status').then((r) => r.data), [])
  const [busy, setBusy] = useState(false)
  const s = status.data

  const toggle = async () => {
    if (!s) return
    setBusy(true)
    try {
      if (s.asa_enrolled) {
        await api.delete('/settings/lithic/asa/enroll')
        toast.success('Real-time authorization disabled.')
      } else {
        const { data } = await api.post<{ ok: boolean; url: string; signed: boolean }>('/settings/lithic/asa/enroll')
        toast.success(data.signed ? 'Enrolled. Lithic now asks Flaire before every card transaction.' : 'Enrolled (unsigned). Lithic now asks Flaire before every card transaction.')
      }
      await status.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="flex flex-wrap items-center gap-2">
        <Zap className="h-4 w-4 text-brand" />
        <h4 className="text-sm font-semibold">Real-time authorization</h4>
        {s ? (
          s.asa_enrolled ? (
            <StatusPill tone="green" dot>
              {s.asa_signed ? 'On, signed' : 'On'}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">Off</StatusPill>
          )
        ) : status.loading ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : null}
        {s && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-400">{s.environment}</span>}
        <button type="button" className={`${s?.asa_enrolled ? 'btn-secondary' : 'btn-primary'} text-xs ml-auto`} onClick={toggle} disabled={busy || !s || !s.configured}>
          {busy && <Spinner className="h-3.5 w-3.5" />} {s?.asa_enrolled ? 'Disenroll' : 'Enroll'}
        </button>
      </div>
      <p className="text-xs text-neutral-500 mt-1.5">Lithic asks Flaire before every card transaction; only Flaire-approved purchases go through.</p>
      {s && !s.configured && <p className="text-xs text-warn mt-1">Add a Lithic key above first.</p>}
    </div>
  )
}

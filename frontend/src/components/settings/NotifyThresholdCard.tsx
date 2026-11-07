import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Bell } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { fromHalalas, toHalalas } from '../../lib/money'
import type { Company } from '../../types'
import { Spinner } from '../Spinner'

/** Settings card: minimum hold amount that triggers push + email to approvers. */
export function NotifyThresholdCard() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const [value, setValue] = useState(fromHalalas(company?.notify_threshold ?? 0))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (company) setValue(fromHalalas(company.notify_threshold ?? 0))
  }, [company])

  const halalas = toHalalas(value)
  const dirty = !Number.isNaN(halalas) && halalas !== (company?.notify_threshold ?? 0)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (Number.isNaN(halalas) || halalas < 0) {
      toast.error('Enter a valid SAR amount.')
      return
    }
    setSaving(true)
    try {
      const { data } = await api.patch<Company>('/company', { notify_threshold: halalas })
      setCompany(data)
      toast.success('Notification threshold saved.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card-lg p-5">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-brand" />
        <h3 className="font-bold">Notifications</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">Decide which holds are worth interrupting someone for.</p>
      <form onSubmit={save}>
        <label className="label" htmlFor="notify-threshold">Notify approvers from (SAR)</label>
        <div className="flex gap-2">
          <input
            id="notify-threshold"
            className="input tnum sm:w-48"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={saving || !dirty}>
            {saving && <Spinner />} Save
          </button>
        </div>
      </form>
      <p className="text-xs text-neutral-500 mt-1">
        Approvers are notified by phone and email only for holds at or above this amount. 0 notifies for everything.
      </p>
    </section>
  )
}

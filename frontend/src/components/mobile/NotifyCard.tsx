import { useEffect, useState } from 'react'
import { BellOff, BellRing, Share } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { usePush } from '../../lib/usePush'
import { fromHalalas, toHalalas } from '../../lib/money'
import type { Company } from '../../types'
import { Spinner } from '../Spinner'

export function NotifyCard() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const push = usePush()
  const [threshold, setThreshold] = useState(fromHalalas(company?.notify_threshold ?? 0))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (company) setThreshold(fromHalalas(company.notify_threshold ?? 0))
  }, [company])

  const halalas = toHalalas(threshold)
  const dirty = !Number.isNaN(halalas) && halalas !== (company?.notify_threshold ?? 0)

  const save = async () => {
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
    <section className="card-lg p-4">
      <h2 className="text-sm font-bold">Notifications</h2>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">A push the moment a hold needs you. Tap it, approve.</p>

      <button
        type="button"
        onClick={push.toggle}
        disabled={push.busy || (push.state === 'unsupported' && !push.ios)}
        className={`w-full h-12 rounded-pill text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 ${
          push.state === 'on' ? 'bg-white border border-line-strong text-ink hover:bg-lavender' : 'bg-brand text-white shadow-primary hover:bg-brand-dark'
        }`}
      >
        {push.busy ? <Spinner /> : push.state === 'on' ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
        {push.state === 'on' ? 'Turn off push on this phone' : 'Enable push on this phone'}
      </button>
      <div className="text-xs text-neutral-500 mt-2 px-1">{push.statusText}</div>
      {push.state === 'on' && (
        <button
          type="button"
          onClick={async () => {
            try {
              const { data } = await api.post<{ sent: number; failed: number; subscriptions: number; errors?: string[] }>('/push/test')
              if (data.sent > 0) toast.success(`Test sent to ${data.sent} device(s). Check your notifications.`)
              else toast.error(data.errors?.[0] ? `Push failed: ${data.errors[0]}` : `No device received it (${data.subscriptions} registered).`)
            } catch (err) {
              toast.error(errorMessage(err))
            }
          }}
          className="mt-2 w-full h-11 rounded-pill text-sm font-semibold border border-line bg-white text-ink hover:bg-lavender"
        >
          Send a test notification
        </button>
      )}

      {push.needsInstall && (
        <div className="mt-3 flex items-start gap-2 rounded-input border border-line bg-lavender px-3 py-2.5 text-xs text-neutral-600">
          <Share className="h-4 w-4 shrink-0 mt-0.5 text-brand" />
          <span>
            On iPhone, push only works from the installed app. In Safari tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and open Flaire from the icon.
          </span>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-line">
        <label className="label" htmlFor="m-threshold">Notify me from SAR</label>
        <div className="flex gap-2">
          <input
            id="m-threshold"
            className="input h-12 text-base tnum flex-1"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="h-12 px-5 rounded-pill bg-brand text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
          >
            {saving && <Spinner />} Save
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-1.5">Smaller holds wait quietly in the list above.</p>
      </div>
    </section>
  )
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Bell, BellOff, BellRing, Download, Share } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { usePush } from '../../lib/usePush'
import { sendTestPush } from '../../lib/push'
import { fromHalalas, toHalalas } from '../../lib/money'
import type { Company } from '../../types'
import { Spinner } from '../Spinner'
import { useT } from '../../lib/i18n'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** Settings card: push on this device, install hint, and the notify threshold. */
export function NotificationsCard() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const t = useT()
  const { state, busy, toggle, ios, standalone, statusText } = usePush()
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null)
  const [value, setValue] = useState(fromHalalas(company?.notify_threshold ?? 0))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (company) setValue(fromHalalas(company.notify_threshold ?? 0))
  }, [company])

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const install = async () => {
    if (!installEvt) return
    await installEvt.prompt()
    const { outcome } = await installEvt.userChoice
    if (outcome === 'accepted') setInstallEvt(null)
  }

  const test = async () => {
    try {
      const r = await sendTestPush()
      toast.success(t('settings.testSent', { n: r.subscriptions }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const halalas = toHalalas(value)
  const dirty = !Number.isNaN(halalas) && halalas !== (company?.notify_threshold ?? 0)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (Number.isNaN(halalas) || halalas < 0) {
      toast.error(t('common.validAmount'))
      return
    }
    setSaving(true)
    try {
      const { data } = await api.patch<Company>('/company', { notify_threshold: halalas })
      setCompany(data)
      toast.success(t('settings.notifySaved'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="notifications" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('settings.notifications')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">{t('settings.notificationsHint')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button className={state === 'on' ? 'btn-secondary text-xs' : 'btn-primary text-xs'} onClick={toggle} disabled={busy || (state === 'unsupported' && !ios)}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : state === 'on' ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
          {state === 'on' ? t('settings.pushOff') : t('settings.pushOn')}
        </button>
        {state === 'on' && (
          <button className="btn-ghost text-xs" onClick={test}>
            {t('settings.sendTest')}
          </button>
        )}
        {!standalone && installEvt && (
          <button className="btn-ghost text-xs" onClick={install}>
            <Download className="h-4 w-4" /> {t('settings.installFlaire')}
          </button>
        )}
      </div>
      <div className="text-xs text-neutral-500 mt-1.5">{statusText}</div>
      {ios && !standalone && (
        <div className="mt-3 flex items-start gap-2 rounded-input border border-line bg-lavender px-3 py-2.5 text-xs text-neutral-600">
          <Share className="h-4 w-4 shrink-0 mt-0.5 text-brand" />
          <span>{t('settings.iosHint')}</span>
        </div>
      )}

      <form onSubmit={save} className="mt-4 pt-4 border-t border-line">
        <label className="label" htmlFor="notify-threshold">{t('settings.notifyFrom')}</label>
        <div className="flex gap-2">
          <input id="notify-threshold" className="input tnum sm:w-48" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="btn-secondary" disabled={saving || !dirty}>
            {saving && <Spinner />} {t('common.save')}
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-1">{t('settings.notifyHint')}</p>
      </form>
    </section>
  )
}

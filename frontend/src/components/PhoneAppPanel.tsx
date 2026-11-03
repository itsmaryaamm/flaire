import { useEffect, useState } from 'react'
import { Smartphone, BellRing, BellOff, Share, Download } from 'lucide-react'
import { useToast } from '../lib/toast'
import { errorMessage } from '../lib/api'
import { disablePush, enablePush, getPushState, isIOS, isStandalone, sendTestPush, type PushState } from '../lib/push'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** Settings card: install Flaire on the phone and turn on approval notifications. */
export function PhoneAppPanel() {
  const toast = useToast()
  const [state, setState] = useState<PushState>('off')
  const [busy, setBusy] = useState(false)
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null)
  const standalone = isStandalone()
  const ios = isIOS()

  useEffect(() => {
    void getPushState().then(setState)
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const toggle = async () => {
    setBusy(true)
    try {
      const next = state === 'on' ? await disablePush() : await enablePush()
      setState(next)
      if (next === 'on') toast.success('Notifications on. You will be told when a request needs you.')
      if (next === 'denied') toast.error('Notifications are blocked for this site in your browser settings.')
      if (next === 'unsupported') toast.error(ios && !standalone ? 'On iPhone, add Flaire to your Home Screen first, then enable notifications from the installed app.' : 'This browser does not support push notifications.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    if (!installEvt) return
    await installEvt.prompt()
    const { outcome } = await installEvt.userChoice
    if (outcome === 'accepted') setInstallEvt(null)
  }

  const test = async () => {
    try {
      const r = await sendTestPush()
      toast.success(`Test sent to ${r.subscriptions} device(s).`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="card-lg p-5">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-brand" />
        <h3 className="font-bold">Flaire on your phone</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">
        Same website, installed as an app. Get a notification the moment an AI employee needs your approval, tap it, approve.
      </p>

      <div className="space-y-3">
        <div className="rounded-input border border-line bg-lavender px-3 py-2.5 text-sm">
          <div className="font-medium mb-1">1. Install</div>
          {standalone ? (
            <div className="text-xs text-success">Installed. You are using the Flaire app.</div>
          ) : installEvt ? (
            <button className="btn-secondary text-xs" onClick={install}>
              <Download className="h-4 w-4" /> Add Flaire to this device
            </button>
          ) : ios ? (
            <div className="text-xs text-neutral-600 flex items-start gap-1.5">
              <Share className="h-4 w-4 shrink-0 mt-0.5" />
              <span>In Safari tap the Share button, then <strong>Add to Home Screen</strong>. Open Flaire from the icon.</span>
            </div>
          ) : (
            <div className="text-xs text-neutral-600">In Chrome open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</div>
          )}
        </div>

        <div className="rounded-input border border-line bg-lavender px-3 py-2.5 text-sm">
          <div className="font-medium mb-1">2. Notifications</div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={state === 'on' ? 'btn-secondary text-xs' : 'btn-primary text-xs'} onClick={toggle} disabled={busy || state === 'unsupported' && !ios}>
              {state === 'on' ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
              {state === 'on' ? 'Turn off on this device' : 'Enable approval notifications'}
            </button>
            {state === 'on' && (
              <button className="btn-ghost text-xs" onClick={test}>
                Send a test
              </button>
            )}
          </div>
          <div className="text-xs text-neutral-500 mt-1.5">
            {state === 'on' && 'On for this device.'}
            {state === 'denied' && 'Blocked in browser settings for this site.'}
            {state === 'unsupported' && (ios && !standalone ? 'iPhone needs the app installed first (step 1).' : 'Not supported in this browser.')}
            {state === 'off' && 'Off. Approval emails still go to your inbox.'}
          </div>
        </div>
      </div>
    </section>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useToast } from './toast'
import { errorMessage } from './api'
import { disablePush, enablePush, getPushState, isIOS, isStandalone, type PushState } from './push'

/**
 * Shared push notification state + toggle, used by the settings panel and the phone view.
 * Handles the iPhone "install first" case and surfaces outcomes as toasts.
 */
export function usePush() {
  const toast = useToast()
  const [state, setState] = useState<PushState>('off')
  const [busy, setBusy] = useState(false)
  const standalone = isStandalone()
  const ios = isIOS()

  useEffect(() => {
    void getPushState().then(setState)
  }, [])

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      const next = state === 'on' ? await disablePush() : await enablePush()
      setState(next)
      if (next === 'on') toast.success('Notifications on. You will be told when a request needs you.')
      if (next === 'denied') toast.error('Notifications are blocked for this site in your browser settings.')
      if (next === 'unsupported')
        toast.error(
          ios && !standalone
            ? 'On iPhone, add Flaire to your Home Screen first, then enable notifications from the installed app.'
            : 'This browser does not support push notifications.',
        )
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [state, ios, standalone, toast])

  /** Short status line for the current state. */
  const statusText =
    state === 'on'
      ? 'On for this device.'
      : state === 'denied'
        ? 'Blocked in browser settings for this site.'
        : state === 'unsupported'
          ? ios && !standalone
            ? 'iPhone needs the app installed first.'
            : 'Not supported in this browser.'
          : 'Off. Approval emails still go to your inbox.'

  return { state, busy, toggle, ios, standalone, statusText, needsInstall: ios && !standalone }
}

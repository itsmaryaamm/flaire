import { useState } from 'react'
import { ProviderDisabledError, useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { useToast } from '../lib/toast'
import { Spinner } from './Spinner'

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
      <path fill="#34A853" d="M12 21.6c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6c1.6 3.2 5 5.4 8.9 5.4z" />
      <path fill="#FBBC05" d="M6.4 13.6c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.2H3.1C2.4 8.6 2 10.2 2 12s.4 3.4 1.1 4.8l3.3-2.6z" />
      <path fill="#EA4335" d="M12 6.2c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3.3 14.7 2.4 12 2.4 8.1 2.4 4.7 4.6 3.1 7.8l3.3 2.6c.8-2.4 3-4.2 5.6-4.2z" />
    </svg>
  )
}

/** "Continue with Google" for Supabase mode. Shows a toast when the Google provider is not switched on. */
export function GoogleButton() {
  const { signInWithGoogle } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    try {
      await signInWithGoogle()
      // The browser is being redirected to Google; keep the button busy until it leaves.
    } catch (err) {
      setBusy(false)
      if (err instanceof ProviderDisabledError) toast.toast('Google sign-in is not enabled yet')
      else toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-[0.14em] text-neutral-400">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <button type="button" className="btn-secondary w-full mt-4" onClick={go} disabled={busy}>
        {busy ? <Spinner /> : <GoogleMark />} Continue with Google
      </button>
    </div>
  )
}

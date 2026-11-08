import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { PENDING_EMAIL_KEY, useAuth } from '../lib/auth'
import { getSupabase, isExpiredLinkError, readAuthRedirect, supabaseErrorMessage } from '../lib/supabase'
import { errorMessage } from '../lib/api'
import { useT } from '../lib/i18n'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { AuthShell } from './AuthShell'

type Phase = 'working' | 'route' | 'error'

function readPendingEmail(): string {
  try {
    return localStorage.getItem(PENDING_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

function safeReturnTo(v: string | null): string | null {
  // Only same-origin paths; never an absolute URL from the query string.
  if (!v || !v.startsWith('/') || v.startsWith('//')) return null
  return v
}

/**
 * Where Supabase sends the browser after email confirmation, magic links, Google OAuth and password recovery.
 * Handles PKCE (?code=) and implicit (#access_token=) links, then routes: recovery to /reset, new accounts to /setup,
 * everyone else to the app (or the invite they came from).
 */
export default function AuthCallbackPage() {
  const t = useT()
  const navigate = useNavigate()
  const { loading, provider, isAuthenticated, setupRequired, refresh, resendConfirmation } = useAuth()
  const [phase, setPhase] = useState<Phase>('working')
  const [linkType, setLinkType] = useState<string | null>(null)
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    started.current = true
    const p = readAuthRedirect()
    setLinkType(p.type)
    setReturnTo(safeReturnTo(p.returnTo))

    const sb = getSupabase()
    if (provider !== 'supabase' || !sb) {
      // Nothing to exchange on the built-in auth backend.
      navigate('/login', { replace: true })
      return
    }

    let cancelled = false
    let recovery = p.type === 'recovery'
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true
    })

    const fail = (err: unknown) => {
      if (cancelled) return
      const msg = err instanceof Error ? err.message : String(err)
      setExpired(isExpiredLinkError(msg) || !!p.errorCode)
      setError(supabaseErrorMessage(msg))
      setPhase('error')
    }

    const run = async () => {
      if (p.error || p.errorCode) {
        throw new Error(p.errorDescription || p.error || 'expired')
      }
      let session = (await sb.auth.getSession()).data.session
      if (!session && p.code) {
        const { data, error: exErr } = await sb.auth.exchangeCodeForSession(p.code)
        if (exErr) throw exErr
        session = data.session
      }
      if (!session && p.hasHashTokens) {
        // detectSessionInUrl picks the hash up asynchronously; give it a moment.
        for (let i = 0; i < 20 && !session; i++) {
          await new Promise((r) => setTimeout(r, 250))
          session = (await sb.auth.getSession()).data.session
        }
      }
      if (!session) throw new Error('This link has expired or was already used.')
      // Strip tokens from the address bar.
      window.history.replaceState(null, '', '/auth/callback')
      if (recovery) {
        navigate('/reset', { replace: true })
        return
      }
      try {
        localStorage.removeItem(PENDING_EMAIL_KEY)
      } catch {
        // ignore
      }
      await refresh()
      if (!cancelled) setPhase('route')
    }

    run().catch(fail)
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loading, provider, navigate, refresh])

  // Route once the auth context has caught up with the fresh session.
  useEffect(() => {
    if (phase !== 'route') return
    if (!isAuthenticated) return
    if (returnTo && returnTo.startsWith('/invite/')) navigate(returnTo, { replace: true })
    else if (setupRequired) navigate('/setup', { replace: true })
    else navigate(returnTo || '/', { replace: true })
  }, [phase, isAuthenticated, setupRequired, returnTo, navigate])

  if (phase === 'error') return <CallbackError expired={expired} message={error} linkType={linkType} onResend={resendConfirmation} />

  return (
    <AuthShell title={t('callback.title')} subtitle={t('callback.subtitle')}>
      <div className="flex items-center gap-2 text-sm text-neutral-500 py-2">
        <Spinner /> {t('callback.working')}
      </div>
    </AuthShell>
  )
}

function CallbackError({
  expired,
  message,
  linkType,
  onResend,
}: {
  expired: boolean
  message: string | null
  linkType: string | null
  onResend: (email: string) => Promise<void>
}) {
  const t = useT()
  const [email, setEmail] = useState(readPendingEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isRecovery = linkType === 'recovery'

  const resend = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await onResend(email.trim())
      setSent(true)
    } catch (ex) {
      setErr(errorMessage(ex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title={expired ? t('callback.expiredTitle') : t('callback.failedTitle')} subtitle={expired ? t('callback.expiredSubtitle') : t('callback.failedSubtitle')}>
      {!expired && <ErrorNote message={message} className="mb-4" />}
      {isRecovery ? (
        <Link to="/forgot" className="btn-primary w-full">
          {t('reset.requestNew')}
        </Link>
      ) : sent ? (
        <div className="flex items-start gap-3 rounded-card border border-line bg-success-tint px-3.5 py-3 text-sm text-success">
          <MailCheck className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t('auth.sentConfirmation', { email: email.trim() })}</span>
        </div>
      ) : (
        <form onSubmit={resend} className="space-y-3">
          <div>
            <label className="label" htmlFor="cb-email">{t('auth.email')}</label>
            <input id="cb-email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <ErrorNote message={err} />
          <button type="submit" className="btn-primary w-full" disabled={busy || !email.trim()}>
            {busy && <Spinner />} {t('auth.resendConfirmation')}
          </button>
        </form>
      )}
      <p className="text-sm text-neutral-500 mt-6">
        <Link to="/login" className="text-brand font-semibold hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </AuthShell>
  )
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorMessage, isNetworkError, wakeServer } from '../lib/api'
import axios from 'axios'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { GoogleButton } from '../components/GoogleButton'
import { AuthShell } from './AuthShell'

export default function LoginPage() {
  const { login, provider } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waking, setWaking] = useState<number | null>(null)
  const builtin = provider === 'builtin'

  // The demo account only exists on the built-in auth backend.
  useEffect(() => {
    if (builtin) setEmail((e) => e || 'demo@flaire.sa')
  }, [builtin])

  // Warm the backend as soon as the page opens, so the first sign-in does not hit a sleeping server.
  useEffect(() => {
    let cancelled = false
    void wakeServer((sec) => !cancelled && setWaking(sec)).then(() => !cancelled && setWaking(null))
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const otp = needsCode ? code.trim() : undefined
    try {
      let result: { needs_onboarding: boolean }
      try {
        result = await login(email.trim(), password, otp)
      } catch (err) {
        if (!isNetworkError(err)) throw err
        // Server was asleep: wake it, then try once more.
        const ok = await wakeServer((sec) => setWaking(sec))
        setWaking(null)
        if (!ok) throw err
        result = await login(email.trim(), password, otp)
      }
      if (result.needs_onboarding) navigate('/welcome', { replace: true })
      else navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      const detail = axios.isAxiosError(err) ? (err.response?.data as { detail?: unknown } | undefined)?.detail : undefined
      if (detail === '2fa_required') {
        // Password was right; the account has 2FA on. Ask for the code and resubmit.
        setNeedsCode(true)
      } else {
        setError(isNetworkError(err) ? 'The server is not responding. It may be waking up; try again in a minute.' : errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Manage what your AI employees are allowed to spend.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="mt-1.5 text-right">
            <Link to="/forgot" className="text-xs text-brand font-semibold hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
        {needsCode && (
          <div>
            <label className="label" htmlFor="code">Authentication code</label>
            <input
              id="code"
              className="input tnum tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <p className="text-xs text-neutral-500 mt-1">Open your authenticator app</p>
          </div>
        )}
        {waking !== null && (
          <div className="flex items-center gap-2 rounded-input border border-line bg-lavender px-3 py-2 text-xs text-neutral-600">
            <Spinner /> Waking up the server ({waking}s). Free hosting sleeps when idle; this takes up to a minute.
          </div>
        )}
        <ErrorNote message={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner />} {needsCode ? 'Verify and sign in' : 'Sign in'}
        </button>
      </form>

      {provider === 'supabase' && <GoogleButton />}

      {builtin && (
        <div className="mt-5 rounded-card border border-dashed border-line-strong bg-lavender px-3.5 py-3 text-xs text-neutral-600">
          <div>
            Demo account: <code className="font-mono text-ink">demo@flaire.sa</code> /{' '}
            <code className="font-mono text-ink">demo1234</code>
          </div>
          <button
            type="button"
            className="text-brand font-semibold mt-1 hover:underline"
            onClick={() => {
              setEmail('demo@flaire.sa')
              setPassword('demo1234')
            }}
          >
            Fill demo credentials
          </button>
        </div>
      )}

      <p className="text-sm text-neutral-500 mt-6">
        New here?{' '}
        <Link to="/register" className="text-brand font-semibold hover:underline">
          Create a company
        </Link>
      </p>
    </AuthShell>
  )
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getSupabase, supabaseErrorMessage } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { AuthShell } from './AuthShell'

interface ResetResponse {
  ok: boolean
  message: string
}

type RecoveryState = 'waiting' | 'ready' | 'missing'

export default function ResetPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { provider, loading: authLoading, logout } = useAuth()
  const supabaseMode = provider === 'supabase'
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<RecoveryState>('waiting')

  // Supabase mode: the link from the email signs the user in with a recovery session. Wait for it.
  useEffect(() => {
    if (authLoading) return
    const sb = getSupabase()
    if (!sb) return
    let cancelled = false
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'PASSWORD_RECOVERY' || session) setRecovery('ready')
    })
    void sb.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) setRecovery('ready')
    })
    // If nothing arrives in a few seconds the link was probably opened without its tokens or has expired.
    const timer = window.setTimeout(() => {
      if (!cancelled) setRecovery((r) => (r === 'waiting' ? 'missing' : r))
    }, 6000)
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      window.clearTimeout(timer)
    }
  }, [authLoading])

  const mismatch = confirm.length > 0 && password !== confirm

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const sb = getSupabase()
      if (sb) {
        const { error: upErr } = await sb.auth.updateUser({ password })
        if (upErr) throw new Error(supabaseErrorMessage(upErr))
        await logout()
        toast.success('Password updated. Sign in with your new password.')
        navigate('/login', { replace: true })
        return
      }
      const { data } = await api.post<ResetResponse>('/auth/reset', { token, password })
      setDone(data.message)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) {
    return (
      <AuthShell title="Choose a new password" subtitle="One moment.">
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-2">
          <Spinner /> Checking your link
        </div>
      </AuthShell>
    )
  }

  const linkMissing = supabaseMode ? recovery === 'missing' : !token

  if (linkMissing) {
    return (
      <AuthShell title="This link is incomplete" subtitle="The reset link is missing its token or has expired. Request a fresh one and open it directly from the email.">
        <Link to="/forgot" className="btn-primary w-full">
          Request a new link
        </Link>
        <p className="text-sm text-neutral-500 mt-6">
          <Link to="/login" className="text-brand font-semibold hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    )
  }

  if (supabaseMode && recovery === 'waiting') {
    return (
      <AuthShell title="Choose a new password" subtitle="One moment while we verify your reset link.">
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-2">
          <Spinner /> Verifying your link
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Choose a new password" subtitle="At least 8 characters. You will be signed out everywhere else.">
      {done ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-card border border-line bg-success-tint px-3.5 py-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{done}</span>
          </div>
          <Link to="/login" className="btn-primary w-full">
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              minLength={8}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && <p className="text-xs text-danger mt-1">Passwords do not match.</p>}
          </div>
          <ErrorNote message={error} />
          <button type="submit" className="btn-primary w-full" disabled={busy || mismatch}>
            {busy && <Spinner />} Update password
          </button>
        </form>
      )}
      {!done && (
        <p className="text-sm text-neutral-500 mt-6">
          <Link to="/login" className="text-brand font-semibold hover:underline">
            Back to sign in
          </Link>
        </p>
      )}
    </AuthShell>
  )
}

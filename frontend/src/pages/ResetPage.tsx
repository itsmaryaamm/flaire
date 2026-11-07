import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { AuthShell } from './AuthShell'

interface ResetResponse {
  ok: boolean
  message: string
}

export default function ResetPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

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
      const { data } = await api.post<ResetResponse>('/auth/reset', { token, password })
      setDone(data.message)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthShell title="This link is incomplete" subtitle="The reset link is missing its token. Request a fresh one and open it directly from the email.">
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

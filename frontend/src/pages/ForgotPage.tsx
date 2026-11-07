import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { AuthShell } from './AuthShell'

interface ForgotResponse {
  ok: boolean
  message: string
  /** Only returned by a development backend, so the link can be opened without email. */
  reset_link?: string
}

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ForgotResponse | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<ForgotResponse>('/auth/forgot', { email: email.trim() })
      setResult(data)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your work email and we will send you a link to choose a new one.">
      {result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-card border border-line bg-success-tint px-3.5 py-3 text-sm text-success">
            <MailCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{result.message}</span>
          </div>
          {result.reset_link && (
            <div className="rounded-card border border-dashed border-line-strong bg-lavender px-3.5 py-3 text-xs text-neutral-600">
              <a href={result.reset_link} className="text-brand font-semibold hover:underline break-all">
                Dev only: open reset link
              </a>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <ErrorNote message={error} />
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />} Send link
          </button>
        </form>
      )}

      <p className="text-sm text-neutral-500 mt-6">
        Remembered it?{' '}
        <Link to="/login" className="text-brand font-semibold hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  )
}

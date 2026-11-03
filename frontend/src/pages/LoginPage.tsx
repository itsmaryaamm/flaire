import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { AuthShell } from './AuthShell'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('demo@flaire.sa')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
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
        </div>
        <ErrorNote message={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner />} Sign in
        </button>
      </form>

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

      <p className="text-sm text-neutral-500 mt-6">
        New here?{' '}
        <Link to="/register" className="text-brand font-semibold hover:underline">
          Create a company
        </Link>
      </p>
    </AuthShell>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { AuthShell } from './AuthShell'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ company_name: '', full_name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await register({ ...form, email: form.email.trim() })
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Create your company" subtitle="Takes thirty seconds. You can add AI employees right after.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="company">Company name</label>
          <input id="company" className="input" required value={form.company_name} onChange={set('company_name')} placeholder="Nawah Tech" />
        </div>
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" className="input" required value={form.full_name} onChange={set('full_name')} placeholder="Sara" autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="email">Work email</label>
          <input id="email" type="email" className="input" required value={form.email} onChange={set('email')} placeholder="owner@nawah.sa" autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
          <p className="text-xs text-neutral-400 mt-1">At least 8 characters.</p>
        </div>
        <ErrorNote message={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner />} Create company
        </button>
      </form>
      <p className="text-sm text-neutral-500 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-brand font-medium hover:underline">Sign in</Link>
      </p>
      <p className="text-xs text-neutral-400 mt-6">Simulation. No real money moves.</p>
    </AuthShell>
  )
}

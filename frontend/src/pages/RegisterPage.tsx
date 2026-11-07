import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { getSupabase, supabaseErrorMessage } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { GoogleButton } from '../components/GoogleButton'
import { AuthShell } from './AuthShell'

function CheckEmail({ email }: { email: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const resend = async () => {
    const sb = getSupabase()
    if (!sb) return
    setBusy(true)
    try {
      const { error } = await sb.auth.resend({ type: 'signup', email })
      if (error) throw error
      toast.success('Confirmation email sent again.')
    } catch (err) {
      toast.error(supabaseErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Check your email" subtitle="One more step before your company exists.">
      <div className="flex items-start gap-3 rounded-card border border-line bg-success-tint px-3.5 py-3 text-sm text-success">
        <MailCheck className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your account.
        </span>
      </div>
      <p className="text-xs text-neutral-500 mt-4">Nothing in your inbox after a minute? Check spam, or send it again.</p>
      <button type="button" className="btn-secondary w-full mt-3" onClick={resend} disabled={busy}>
        {busy && <Spinner />} Resend confirmation email
      </button>
      <p className="text-sm text-neutral-500 mt-6">
        Already confirmed?{' '}
        <Link to="/login" className="text-brand font-semibold hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  )
}

export default function RegisterPage() {
  const { register, provider } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ company_name: '', full_name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await register({ ...form, email: form.email.trim() })
      if (result.status === 'confirm_email') {
        setConfirmEmail(result.email)
      } else {
        // New accounts always start with the walkthrough (it skips the company step when one exists).
        navigate('/welcome', { replace: true })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (confirmEmail) return <CheckEmail email={confirmEmail} />

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
      {provider === 'supabase' && <GoogleButton />}
      <p className="text-sm text-neutral-500 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-brand font-semibold hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  )
}

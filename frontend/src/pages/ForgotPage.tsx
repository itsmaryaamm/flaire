import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { ForgotResult } from '../lib/auth'
import { useT } from '../lib/i18n'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { AuthShell } from './AuthShell'

export default function ForgotPage() {
  const { forgot, provider } = useAuth()
  const t = useT()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ForgotResult | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Builtin mode posts /auth/forgot; Supabase mode sends the reset email through Supabase.
      setResult(await forgot(email.trim()))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title={t('forgot.title')} subtitle={t('forgot.subtitle')}>
      {result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-card border border-line bg-success-tint px-3.5 py-3 text-sm text-success">
            <MailCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{provider === 'supabase' ? t('forgot.sent', { email: email.trim() }) : result.message}</span>
          </div>
          {result.reset_link && (
            <div className="rounded-card border border-dashed border-line-strong bg-lavender px-3.5 py-3 text-xs text-neutral-600">
              <a href={result.reset_link} className="text-brand font-semibold hover:underline break-all">
                {t('forgot.devLink')}
              </a>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">{t('auth.email')}</label>
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
            {busy && <Spinner />} {t('forgot.sendLink')}
          </button>
        </form>
      )}

      <p className="text-sm text-neutral-500 mt-6">
        {t('forgot.remembered')}{' '}
        <Link to="/login" className="text-brand font-semibold hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </AuthShell>
  )
}

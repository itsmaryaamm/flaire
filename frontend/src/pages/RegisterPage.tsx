import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { useToast } from '../lib/toast'
import { useT } from '../lib/i18n'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { GoogleButton } from '../components/GoogleButton'
import { AuthShell } from './AuthShell'

/** Shown after sign-up when the sign-in provider wants the email confirmed first. */
export function CheckEmail({ email }: { email: string }) {
  const { resendConfirmation } = useAuth()
  const toast = useToast()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const resend = async () => {
    setBusy(true)
    try {
      await resendConfirmation(email)
      setSent(true)
      toast.success(t('auth.confirmationResent'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title={t('auth.checkEmail')} subtitle={t('auth.checkEmailSubtitle')}>
      <div className="flex items-start gap-3 rounded-card border border-line bg-success-tint px-3.5 py-3 text-sm text-success">
        <MailCheck className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{t('auth.sentConfirmation', { email })}</span>
      </div>
      <p className="text-xs text-neutral-500 mt-4">{t('auth.nothingInInbox')}</p>
      <button type="button" className="btn-secondary w-full mt-3" onClick={resend} disabled={busy}>
        {busy && <Spinner />} {sent ? t('auth.sendAgain') : t('auth.resendConfirmation')}
      </button>
      <p className="text-sm text-neutral-500 mt-6">
        {t('auth.alreadyConfirmed')}{' '}
        <Link to="/login" className="text-brand font-semibold hover:underline">{t('auth.signIn')}</Link>
      </p>
    </AuthShell>
  )
}

export default function RegisterPage() {
  const { register } = useAuth()
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { email?: string } }
  const [params] = useSearchParams()
  const returnTo = params.get('returnTo') || ''
  // Invited people join an existing company: no company name to ask for.
  const invited = returnTo.startsWith('/invite/')
  const [form, setForm] = useState({ company_name: '', full_name: '', email: params.get('email') || location.state?.email || '', password: '' })
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
      const result = await register({ ...form, email: form.email.trim(), returnTo: returnTo || undefined })
      if (result.status === 'confirm_email') {
        setConfirmEmail(result.email)
      } else if (invited) {
        navigate(returnTo, { replace: true })
      } else {
        // New accounts always start with the setup wizard (it skips whatever already exists).
        navigate('/setup', { replace: true })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (confirmEmail) return <CheckEmail email={confirmEmail} />

  return (
    <AuthShell title={invited ? t('auth.createAccountTitle') : t('auth.createCompanyTitle')} subtitle={invited ? t('auth.createAccountSubtitle') : t('auth.createCompanySubtitle')}>
      <form onSubmit={submit} className="space-y-4">
        {!invited && (
          <div>
            <label className="label" htmlFor="company">{t('auth.companyName')}</label>
            <input id="company" className="input" required value={form.company_name} onChange={set('company_name')} placeholder="Nawah Tech" autoComplete="organization" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="name">{t('auth.yourName')}</label>
          <input id="name" className="input" required value={form.full_name} onChange={set('full_name')} placeholder="Sara" autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="email">{t('auth.workEmail')}</label>
          <input id="email" type="email" className="input" required value={form.email} onChange={set('email')} placeholder="owner@nawah.sa" autoComplete="email" readOnly={invited && !!params.get('email')} />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" type="password" className="input" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
          <p className="text-xs text-neutral-400 mt-1">{t('auth.atLeast8')}</p>
        </div>
        <ErrorNote message={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner />} {t('auth.createAccount')}
        </button>
      </form>
      <GoogleButton returnTo={returnTo || undefined} />
      <p className="text-sm text-neutral-500 mt-6">
        {t('auth.alreadyHaveAccount')}{' '}
        <Link to={returnTo ? `/login?${params.toString()}` : '/login'} className="text-brand font-semibold hover:underline">{t('auth.signIn')}</Link>
      </p>
    </AuthShell>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Building2, LogOut } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatDate } from '../lib/useFetch'
import { useT } from '../lib/i18n'
import type { AuthResponse, InviteAcceptResponse, InvitePreview } from '../types'
import { AuthShell } from './AuthShell'
import { ErrorNote } from '../components/ErrorNote'
import { PageLoader, Spinner } from '../components/Spinner'
import { RolePill } from '../components/team/RoleBits'

/** Public: /invite/:token. Signed in with the invited email -> join. Signed out -> sign in (Supabase) or create a password (builtin). */
export default function InviteAcceptPage() {
  const { token = '' } = useParams()
  const t = useT()
  const navigate = useNavigate()
  const { user, isAuthenticated, loading, provider, refresh, adoptSession, logout } = useAuth()
  const preview = useFetch(() => api.get<InvitePreview>(`/team/invites/preview/${token}`).then((r) => r.data), [token])
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const p = preview.data
  const returnTo = `/invite/${token}`
  const emailMatches = !!user && !!p && user.email.toLowerCase() === p.email.toLowerCase()

  const acceptSignedIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<InviteAcceptResponse>('/team/invites/accept', { token })
      // Builtin tokens carry the company id, so take the fresh one; Supabase sessions just re-read /auth/me.
      if (provider === 'builtin') adoptSession({ access_token: data.access_token, token_type: 'bearer', user: data.user, company: data.company } as AuthResponse)
      else await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const acceptBuiltin = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<InviteAcceptResponse>('/team/invites/accept', { token, full_name: fullName.trim(), password })
      adoptSession({ access_token: data.access_token, token_type: 'bearer', user: data.user, company: data.company } as AuthResponse)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (loading || (preview.loading && !p)) {
    return (
      <AuthShell title={t('invite.title')} subtitle={t('invite.checking')}>
        <PageLoader label={t('common.loading')} />
      </AuthShell>
    )
  }

  if (preview.error || !p) {
    return (
      <AuthShell title={t('invite.title')} subtitle={t('invite.invalid')}>
        <ErrorNote message={preview.error ?? t('invite.invalid')} />
        <Link to="/login" className="btn-secondary w-full mt-4">
          {t('auth.signIn')}
        </Link>
      </AuthShell>
    )
  }

  const summary = (
    <div className="rounded-card border border-line bg-lavender px-4 py-3 text-sm space-y-1.5">
      <div className="flex items-center gap-2 font-bold">
        <Building2 className="h-4 w-4 text-brand" /> {p.company_name}
      </div>
      <div className="flex items-center gap-2 text-neutral-600">
        <span>{t('team.role')}:</span> <RolePill role={p.role} />
      </div>
      {p.department_name && (
        <div className="text-neutral-600">
          {t('team.department')}: <span className="text-ink font-semibold">{p.department_name}</span>
        </div>
      )}
      <div className="text-neutral-600">
        {t('auth.email')}: <span className="text-ink font-semibold">{p.email}</span>
      </div>
      <div className="text-xs text-neutral-500">
        {p.invited_by ? `${t('team.invitedBy', { name: p.invited_by })} · ` : ''}
        {t('team.expires', { date: formatDate(p.expires_at, false) })}
      </div>
    </div>
  )

  // Signed in.
  if (isAuthenticated) {
    return (
      <AuthShell title={t('invite.title')} subtitle={t('invite.subtitle', { company: p.company_name })}>
        {summary}
        {emailMatches ? (
          <>
            <ErrorNote message={error} className="mt-4" />
            <button type="button" className="btn-primary w-full mt-4" onClick={acceptSignedIn} disabled={busy}>
              {busy && <Spinner />} {t('invite.join', { company: p.company_name })}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-600 mt-4">{t('invite.wrongAccount', { email: p.email, current: user?.email ?? '' })}</p>
            <button
              type="button"
              className="btn-secondary w-full mt-3"
              onClick={async () => {
                await logout()
                navigate('/login', { state: { from: returnTo, email: p.email } })
              }}
            >
              <LogOut className="h-4 w-4 rtl-flip" /> {t('invite.switchAccount')}
            </button>
          </>
        )}
      </AuthShell>
    )
  }

  // Signed out, Supabase: the account lives with the sign-in provider.
  if (provider === 'supabase' || p.auth === 'supabase') {
    const q = `?email=${encodeURIComponent(p.email)}&returnTo=${encodeURIComponent(returnTo)}`
    return (
      <AuthShell title={t('invite.title')} subtitle={t('invite.subtitle', { company: p.company_name })}>
        {summary}
        <p className="text-sm text-neutral-600 mt-4">{p.existing_account ? t('invite.signInFirst', { email: p.email }) : t('invite.signUpFirst', { email: p.email })}</p>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <Link to={`/login${q}`} state={{ from: returnTo, email: p.email }} className="btn-primary flex-1">
            {t('auth.signIn')}
          </Link>
          <Link to={`/register${q}`} state={{ email: p.email }} className="btn-secondary flex-1">
            {t('auth.createAccount')}
          </Link>
        </div>
      </AuthShell>
    )
  }

  // Signed out, builtin: create the account here.
  if (p.existing_account) {
    return (
      <AuthShell title={t('invite.title')} subtitle={t('invite.subtitle', { company: p.company_name })}>
        {summary}
        <p className="text-sm text-neutral-600 mt-4">{t('invite.signInFirst', { email: p.email })}</p>
        <Link to="/login" state={{ from: returnTo, email: p.email }} className="btn-primary w-full mt-4">
          {t('auth.signIn')}
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('invite.title')} subtitle={t('invite.subtitle', { company: p.company_name })}>
      {summary}
      <form onSubmit={acceptBuiltin} className="space-y-4 mt-4">
        <div>
          <label className="label" htmlFor="inv-name">{t('auth.yourName')}</label>
          <input id="inv-name" className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="inv-password">{t('auth.password')}</label>
          <input id="inv-password" type="password" className="input" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <p className="text-xs text-neutral-400 mt-1">{t('auth.atLeast8')}</p>
        </div>
        <ErrorNote message={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy || !fullName.trim() || password.length < 8}>
          {busy && <Spinner />} {t('invite.join', { company: p.company_name })}
        </button>
      </form>
    </AuthShell>
  )
}

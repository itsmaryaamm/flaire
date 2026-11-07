import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { ErrorNote } from '../ErrorNote'
import { Spinner } from '../Spinner'
import { useT } from '../../lib/i18n'

/** Settings card: permanently delete the signed-in account (and the company, when this user is its only owner). */
export function DangerZoneCard() {
  const { logout, provider } = useAuth()
  const toast = useToast()
  const t = useT()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = confirm === 'DELETE' && password.length > 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await api.delete<{ ok: boolean; removed: 'company' | 'user' }>('/account', { data: { confirm, password } })
      await logout()
      toast.success(t('settings.accountDeleted'))
      navigate('/login', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <section id="danger" className="card-lg p-5 border-red-200 bg-danger-tint/40">
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-4 w-4 text-danger" />
        <h3 className="font-bold text-danger">{t('settings.dangerZone')}</h3>
      </div>
      <p className="text-sm text-neutral-600 mt-2">{t('settings.dangerExplain')}</p>
      <form onSubmit={submit} className="mt-4 grid sm:grid-cols-2 gap-3 max-w-xl">
        <div>
          <label className="label" htmlFor="dz-confirm">
            {t('settings.typeDelete')} <span className="font-mono text-ink">DELETE</span>
          </label>
          <input
            id="dz-confirm"
            className="input font-mono"
            autoComplete="off"
            spellCheck={false}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
          />
        </div>
        <div>
          <label className="label" htmlFor="dz-password">{t('decision.yourPassword')}</label>
          <input
            id="dz-password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {provider === 'supabase' && <p className="text-xs text-neutral-500 mt-1">{t('settings.checkedAgainstSignIn')}</p>}
        </div>
        <div className="sm:col-span-2">
          <ErrorNote message={error} className="mb-3" />
          <button type="submit" className="btn-danger" disabled={!ready || busy}>
            {busy && <Spinner />} {t('settings.deleteMyAccount')}
          </button>
        </div>
      </form>
    </section>
  )
}

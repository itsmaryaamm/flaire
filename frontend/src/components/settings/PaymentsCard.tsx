import { useState } from 'react'
import type { FormEvent } from 'react'
import { CreditCard, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import type { Company } from '../../types'
import { StatusPill } from '../StatusPill'
import { Spinner } from '../Spinner'
import { AsaRow } from './AsaRow'
import { useT } from '../../lib/i18n'

/** Settings card: the company's Lithic sandbox key (write-only, stored encrypted on the server). */
export function PaymentsCard() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const t = useT()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const connected = !!company?.lithic_configured

  const patch = async (lithic_api_key: string, kind: 'save' | 'remove') => {
    setBusy(kind)
    try {
      const { data } = await api.patch<Company>('/company', { lithic_api_key })
      setCompany(data)
      setKey('')
      toast.success(kind === 'save' ? t('settings.lithicSaved') : t('settings.lithicRemoved'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    void patch(key.trim(), 'save')
  }

  const remove = () => {
    if (!window.confirm(t('settings.lithicRemoveConfirm'))) return
    void patch('', 'remove')
  }

  return (
    <section id="payments" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('settings.payments')}</h3>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="text-neutral-600">{t('settings.lithicSandbox')}:</span>
        {connected ? <StatusPill tone="green" dot>{t('settings.connected')}</StatusPill> : <StatusPill tone="neutral">{t('settings.notConnected')}</StatusPill>}
      </div>
      <form onSubmit={save} className="mt-3">
        <label className="label" htmlFor="lithic-key">{t('settings.lithicKey')}</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="lithic-key"
            className="input font-mono"
            type="password"
            autoComplete="off"
            placeholder={connected ? t('settings.lithicReplace') : t('settings.lithicPaste')}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={busy !== null || !key.trim()}>
              {busy === 'save' && <Spinner />} {t('common.save')}
            </button>
            {connected && (
              <button type="button" className="btn-secondary text-danger" onClick={remove} disabled={busy !== null}>
                {busy === 'remove' ? <Spinner /> : <Trash2 className="h-4 w-4" />} {t('common.remove')}
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="text-xs text-neutral-500 mt-2">
        {t('settings.lithicHint')}
      </p>
      <AsaRow />
    </section>
  )
}

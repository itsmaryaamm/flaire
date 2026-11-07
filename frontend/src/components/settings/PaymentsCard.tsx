import { useState } from 'react'
import type { FormEvent } from 'react'
import { CreditCard, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import type { Company } from '../../types'
import { StatusPill } from '../StatusPill'
import { Spinner } from '../Spinner'

/** Settings card: the company's Lithic sandbox key (write-only, stored encrypted on the server). */
export function PaymentsCard() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const connected = !!company?.lithic_configured

  const patch = async (lithic_api_key: string, kind: 'save' | 'remove') => {
    setBusy(kind)
    try {
      const { data } = await api.patch<Company>('/company', { lithic_api_key })
      setCompany(data)
      setKey('')
      toast.success(kind === 'save' ? 'Lithic key saved. New cards can now use the Lithic sandbox.' : 'Lithic key removed.')
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
    if (!window.confirm('Remove the stored Lithic key? Cards on the Lithic provider will stop working until a key is added again.')) return
    void patch('', 'remove')
  }

  return (
    <section className="card-lg p-5">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-brand" />
        <h3 className="font-bold">Payments</h3>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="text-neutral-600">Lithic sandbox:</span>
        {connected ? <StatusPill tone="green" dot>Connected</StatusPill> : <StatusPill tone="neutral">Not connected</StatusPill>}
      </div>
      <form onSubmit={save} className="mt-3">
        <label className="label" htmlFor="lithic-key">Lithic sandbox API key</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="lithic-key"
            className="input font-mono"
            type="password"
            autoComplete="off"
            placeholder={connected ? 'Paste a new key to replace the stored one' : 'Paste your sandbox key'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={busy !== null || !key.trim()}>
              {busy === 'save' && <Spinner />} Save
            </button>
            {connected && (
              <button type="button" className="btn-secondary text-danger" onClick={remove} disabled={busy !== null}>
                {busy === 'remove' ? <Spinner /> : <Trash2 className="h-4 w-4" />} Remove
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="text-xs text-neutral-500 mt-2">
        Get a free sandbox key at dashboard.lithic.com. Stored encrypted. Later this becomes your real card details.
      </p>
    </section>
  )
}

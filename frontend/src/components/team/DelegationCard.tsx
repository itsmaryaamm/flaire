import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plane, X } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { formatDate } from '../../lib/useFetch'
import type { Delegation, Member } from '../../types'
import { TEAM_ADMIN_ROLES } from '../../types'
import type { Role } from '../../types'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { StatusPill } from '../StatusPill'

function todayPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "I am away": hand approvals to someone for a while. Owners and admins can set one for anyone. */
export function DelegationCard({ delegations, members, onChanged }: { delegations: Delegation[]; members: Member[]; onChanged: () => void }) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const canSetForOthers = !!user?.role && TEAM_ADMIN_ROLES.includes(user.role as Role)
  const canDelegate = !!user?.role && !['viewer', 'auditor'].includes(user.role)
  const [fromId, setFromId] = useState<string>(String(user?.id ?? ''))
  const [toId, setToId] = useState('')
  const [starts, setStarts] = useState(todayPlus(0))
  const [ends, setEnds] = useState(todayPlus(7))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<number | null>(null)

  const active = members.filter((m) => m.status !== 'disabled')
  const delegators = active.filter((m) => !['viewer', 'auditor'].includes(m.role))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/team/delegations', {
        user_id: canSetForOthers && fromId ? Number(fromId) : undefined,
        delegate_id: Number(toId),
        starts_at: new Date(`${starts}T00:00:00`).toISOString(),
        ends_at: new Date(`${ends}T23:59:59`).toISOString(),
        note: note.trim() || undefined,
      })
      toast.success(t('delegation.created'))
      setNote('')
      setToId('')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (d: Delegation) => {
    setCancelling(d.id)
    try {
      await api.delete(`/team/delegations/${d.id}`)
      toast.success(t('delegation.cancelled'))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCancelling(null)
    }
  }

  const from = Number(fromId) || user?.id

  return (
    <section id="delegation" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Plane className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('delegation.title')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('delegation.hint')}</p>

      {canDelegate || canSetForOthers ? (
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
          {canSetForOthers && (
            <div>
              <label className="label" htmlFor="dl-from">{t('delegation.onBehalfOf')}</label>
              <select id="dl-from" className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {delegators.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === user?.id ? `${m.full_name} (${t('team.you')})` : m.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="dl-to">{t('delegation.delegateTo')}</label>
            <select id="dl-to" className="input" value={toId} onChange={(e) => setToId(e.target.value)} required>
              <option value="">{t('delegation.pickPerson')}</option>
              {active
                .filter((m) => m.id !== from)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} · {t(`role.${m.role}`)}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dl-start">{t('delegation.from')}</label>
            <input id="dl-start" type="date" className="input tnum" value={starts} onChange={(e) => setStarts(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="dl-end">{t('delegation.to')}</label>
            <input id="dl-end" type="date" className="input tnum" value={ends} min={starts} onChange={(e) => setEnds(e.target.value)} required />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="dl-note">{t('delegation.note')}</label>
            <input id="dl-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('delegation.notePlaceholder')} maxLength={300} />
          </div>
          <div className="sm:col-span-2">
            <ErrorNote message={error} className="mb-3" />
            <button type="submit" className="btn-primary" disabled={busy || !toId}>
              {busy && <Spinner />} {t('delegation.save')}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-neutral-500">{t('delegation.cannot')}</p>
      )}

      <div className="mt-5 pt-4 border-t border-line">
        <h4 className="text-sm font-bold mb-2">{t('delegation.list')}</h4>
        {delegations.length === 0 ? (
          <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">{t('delegation.none')}</div>
        ) : (
          <ul className="divide-y divide-line">
            {delegations.map((d) => {
              const mine = d.user_id === user?.id
              return (
                <li key={d.id} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {d.user_name} <span className="text-neutral-400 font-normal">{t('delegation.arrow')}</span> {d.delegate_name}
                    </div>
                    <div className="text-xs text-neutral-500 truncate">
                      {formatDate(d.starts_at, false)} {t('delegation.until')} {formatDate(d.ends_at, false)}
                      {d.note ? ` · ${d.note}` : ''}
                    </div>
                  </div>
                  {d.active ? <StatusPill tone="green" dot>{t('delegation.active')}</StatusPill> : <StatusPill tone="neutral">{t('delegation.scheduled')}</StatusPill>}
                  {(mine || canSetForOthers) && (
                    <button className="btn-ghost text-xs text-danger hover:bg-danger-tint" onClick={() => cancel(d)} disabled={cancelling === d.id}>
                      {cancelling === d.id ? <Spinner className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {t('common.cancel')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Mail, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { formatDate } from '../../lib/useFetch'
import type { Department, Invite } from '../../types'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { CopyBox } from '../CopyBox'
import { StatusPill } from '../StatusPill'
import { RolePill, RoleSelect } from './RoleBits'

/** Invite form plus the pending invites list with revoke. Owners and admins only. */
export function InviteCard({ invites, departments, onChanged }: { invites: Invite[]; departments: Department[]; onChanged: () => void }) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [deptId, setDeptId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<number | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setLink(null)
    try {
      const { data } = await api.post<Invite>('/team/invites', {
        email: email.trim(),
        role,
        department_id: deptId ? Number(deptId) : null,
      })
      if (data.accept_link) {
        setLink(data.accept_link)
        toast.info(t('team.inviteNotDelivered'))
      } else {
        toast.success(t('team.inviteSent', { email: email.trim() }))
      }
      setEmail('')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (inv: Invite) => {
    setRevoking(inv.id)
    try {
      await api.delete(`/team/invites/${inv.id}`)
      toast.success(t('team.inviteRevoked'))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRevoking(null)
    }
  }

  const pending = invites.filter((i) => i.status === 'pending')

  return (
    <section id="invite" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Mail className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('team.invite')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3">{t('team.inviteHint')}</p>
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="inv-email">{t('auth.email')}</label>
          <input id="inv-email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sara@nawah.sa" />
        </div>
        <div>
          <label className="label" htmlFor="inv-role">{t('team.role')}</label>
          <RoleSelect id="inv-role" value={role} onChange={setRole} allowOwner={user?.role === 'owner'} />
        </div>
        <div>
          <label className="label" htmlFor="inv-dept">{t('team.department')}</label>
          <select id="inv-dept" className="input" value={deptId} onChange={(e) => setDeptId(e.target.value)} required={role === 'dept_head'}>
            <option value="">{role === 'dept_head' ? t('team.pickDepartment') : t('team.noDepartmentOptional')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {role === 'dept_head' && <p className="text-xs text-neutral-500 mt-1">{t('team.deptHeadNeedsDept')}</p>}
        </div>
        <div className="sm:col-span-2">
          <ErrorNote message={error} className="mb-3" />
          {link && (
            <div className="mb-3">
              <div className="label">{t('team.acceptLink')}</div>
              <CopyBox value={link} />
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>
            {busy && <Spinner />} {t('team.sendInvite')}
          </button>
        </div>
      </form>

      <div className="mt-5 pt-4 border-t border-line">
        <h4 className="text-sm font-bold mb-2">
          {t('team.pendingInvites')} <span className="text-xs text-neutral-500 font-normal tnum">{pending.length}</span>
        </h4>
        {pending.length === 0 ? (
          <div className="rounded-input border border-dashed border-line-strong px-3 py-3 text-center text-xs text-neutral-500">{t('team.noPendingInvites')}</div>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((inv) => (
              <li key={inv.id} className="py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{inv.email}</div>
                  <div className="text-xs text-neutral-500 truncate">
                    {inv.department_name ? `${inv.department_name} · ` : ''}
                    {t('team.expires', { date: formatDate(inv.expires_at, false) })}
                    {inv.invited_by ? ` · ${t('team.invitedBy', { name: inv.invited_by })}` : ''}
                  </div>
                </div>
                <RolePill role={inv.role} />
                <StatusPill tone="amber">{t('team.pending')}</StatusPill>
                <button className="btn-ghost text-xs text-danger hover:bg-danger-tint" onClick={() => revoke(inv)} disabled={revoking === inv.id}>
                  {revoking === inv.id ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />} {t('team.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Ban, Building2, CheckCircle2, Shield, Trash2, Users } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { timeAgo } from '../../lib/useFetch'
import type { Department, Member } from '../../types'
import { TEAM_ADMIN_ROLES } from '../../types'
import type { Role } from '../../types'
import { Sheet } from '../Sheet'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { StatusPill } from '../StatusPill'
import { RolePill, RoleSelect } from './RoleBits'

function RoleSheet({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [role, setRole] = useState(member?.role ?? 'viewer')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (member) setRole(member.role)
  }, [member])
  const save = async () => {
    if (!member) return
    setBusy(true)
    try {
      await api.patch(`/team/members/${member.id}`, { role })
      toast.success(t('team.roleUpdated', { name: member.full_name }))
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={!!member}
      onClose={onClose}
      title={t('team.changeRole')}
      footer={
        <button type="button" className="btn-primary w-full" onClick={save} disabled={busy || role === member?.role}>
          {busy && <Spinner />} {t('common.save')}
        </button>
      }
    >
      {member && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            <strong className="text-ink">{member.full_name}</strong> · {member.email}
          </p>
          <RoleSelect value={role} onChange={setRole} allowOwner={user?.role === 'owner'} />
        </div>
      )}
    </Sheet>
  )
}

function DepartmentsSheet({
  member,
  departments,
  onClose,
  onSaved,
}: {
  member: Member | null
  departments: Department[]
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const toast = useToast()
  const [primary, setPrimary] = useState<string>('')
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (member) {
      setPrimary(member.department_id ? String(member.department_id) : '')
      setPicked(member.departments)
    }
  }, [member])
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const save = async () => {
    if (!member) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = { departments: picked }
      if (primary) body.department_id = Number(primary)
      await api.patch(`/team/members/${member.id}`, body)
      toast.success(t('team.departmentsUpdated', { name: member.full_name }))
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={!!member}
      onClose={onClose}
      title={t('team.changeDepartments')}
      footer={
        <button type="button" className="btn-primary w-full" onClick={save} disabled={busy}>
          {busy && <Spinner />} {t('common.save')}
        </button>
      }
    >
      {member && (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="m-primary">{t('team.primaryDepartment')}</label>
            <select id="m-primary" className="input" value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">{t('team.noPrimary')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-neutral-500 mt-1">{t('team.primaryHint')}</p>
          </div>
          <div>
            <div className="label">{t('team.departmentsScope')}</div>
            {departments.length === 0 ? (
              <p className="text-xs text-neutral-500">{t('team.noDepartmentsYet')}</p>
            ) : (
              <div className="space-y-1.5">
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="accent-brand" checked={picked.includes(d.id)} onChange={() => toggle(d.id)} />
                    {d.name}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-neutral-500 mt-1">{t('team.scopeHint')}</p>
          </div>
        </div>
      )}
    </Sheet>
  )
}

/** Members table. Owners and admins manage; everyone else sees their own row. */
export function MembersCard({ members, departments, loading, error, onChanged }: { members: Member[]; departments: Department[]; loading: boolean; error: string | null; onChanged: () => void }) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const canManage = !!user?.role && TEAM_ADMIN_ROLES.includes(user.role as Role)
  const isOwner = user?.role === 'owner'
  const [roleFor, setRoleFor] = useState<Member | null>(null)
  const [deptFor, setDeptFor] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const toggleStatus = async (m: Member) => {
    setBusyId(m.id)
    try {
      const status = m.status === 'disabled' ? 'active' : 'disabled'
      await api.patch(`/team/members/${m.id}`, { status })
      toast.success(status === 'disabled' ? t('team.memberDisabled', { name: m.full_name }) : t('team.memberEnabled', { name: m.full_name }))
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusyId(removing.id)
    try {
      await api.delete(`/team/members/${removing.id}`)
      toast.success(t('team.memberRemoved', { name: removing.full_name }))
      setRemoving(null)
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section id="members" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Users className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('team.members')}</h3>
        <span className="text-xs text-neutral-500 tnum">{members.length}</span>
      </div>
      <p className="text-xs text-neutral-500 mb-3">{canManage ? t('team.membersHint') : t('team.membersReadOnly')}</p>
      {error && !members.length ? (
        <ErrorNote message={error} />
      ) : loading && !members.length ? (
        <div className="py-4 text-xs text-neutral-500 flex items-center gap-2">
          <Spinner className="h-3.5 w-3.5" /> {t('common.loading')}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[720px]">
            <thead className="bg-lavender border-y border-line">
              <tr>
                <th className="th">{t('team.name')}</th>
                <th className="th">{t('team.role')}</th>
                <th className="th">{t('team.department')}</th>
                <th className="th">{t('team.status')}</th>
                {canManage && <th className="th text-end">{t('team.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((m) => {
                const me = m.id === user?.id
                const scope = m.departments.map((id) => departments.find((d) => d.id === id)?.name).filter(Boolean) as string[]
                return (
                  <tr key={m.id} className="hover:bg-lavender/70">
                    <td className="td">
                      <div className="font-semibold">
                        {m.full_name} {me && <span className="text-xs text-neutral-500 font-normal">({t('team.you')})</span>}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {m.email}
                        {m.totp_enabled && (
                          <span className="inline-flex items-center gap-0.5 ms-2 text-success">
                            <Shield className="h-3 w-3" /> 2FA
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="td">
                      <RolePill role={m.role} />
                    </td>
                    <td className="td text-xs">
                      <div>{m.department_name ?? <span className="text-neutral-400">{t('team.noPrimary')}</span>}</div>
                      {scope.length > 0 && <div className="text-neutral-500 truncate max-w-[220px]">{scope.join(', ')}</div>}
                    </td>
                    <td className="td">
                      {m.status === 'disabled' ? <StatusPill tone="red">{t('team.disabled')}</StatusPill> : <StatusPill tone="green" dot>{t('team.active')}</StatusPill>}
                      <div className="text-[11px] text-neutral-500 mt-0.5">{t('team.lastSeen', { when: timeAgo(m.last_seen_at) })}</div>
                    </td>
                    {canManage && (
                      <td className="td text-end whitespace-nowrap">
                        <button className="btn-ghost p-1.5" onClick={() => setRoleFor(m)} aria-label={t('team.changeRole')} title={t('team.changeRole')} disabled={me}>
                          <Shield className="h-3.5 w-3.5" />
                        </button>
                        <button className="btn-ghost p-1.5" onClick={() => setDeptFor(m)} aria-label={t('team.changeDepartments')} title={t('team.changeDepartments')}>
                          <Building2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="btn-ghost p-1.5"
                          onClick={() => toggleStatus(m)}
                          disabled={busyId === m.id || me}
                          aria-label={m.status === 'disabled' ? t('team.enable') : t('team.disable')}
                          title={m.status === 'disabled' ? t('team.enable') : t('team.disable')}
                        >
                          {busyId === m.id ? <Spinner className="h-3.5 w-3.5" /> : m.status === 'disabled' ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Ban className="h-3.5 w-3.5 text-warn" />}
                        </button>
                        {isOwner && (
                          <button className="btn-ghost p-1.5 text-danger hover:bg-danger-tint" onClick={() => setRemoving(m)} disabled={me} aria-label={t('team.remove')} title={t('team.remove')}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <RoleSheet member={roleFor} onClose={() => setRoleFor(null)} onSaved={onChanged} />
      <DepartmentsSheet member={deptFor} departments={departments} onClose={() => setDeptFor(null)} onSaved={onChanged} />
      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t('team.removeMember')}
        footer={
          <button type="button" className="btn-danger w-full" onClick={remove} disabled={busyId !== null}>
            {busyId !== null && <Spinner />} {t('team.remove')}
          </button>
        }
      >
        {removing && <p className="text-sm text-neutral-600">{t('team.removeConfirm', { name: removing.full_name })}</p>}
      </Sheet>
    </section>
  )
}

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch } from '../lib/useFetch'
import { useT } from '../lib/i18n'
import { hasAdminView } from '../lib/view'
import type { ApprovalRule, Delegation, Department, Invite, Member } from '../types'
import { TEAM_ADMIN_ROLES } from '../types'
import type { Role } from '../types'
import { PageHeader } from '../components/PageHeader'
import { MembersCard } from '../components/team/MembersCard'
import { InviteCard } from '../components/team/InviteCard'
import { ApprovalChainsCard } from '../components/team/ApprovalChainsCard'
import { DelegationCard } from '../components/team/DelegationCard'

/** Team: members, invites, approval chains and delegation. Owners and admins manage; others see what concerns them. */
export default function TeamPage() {
  const t = useT()
  const { user } = useAuth()
  const adminView = hasAdminView(user?.role)
  const canManage = !!user?.role && TEAM_ADMIN_ROLES.includes(user.role as Role)

  const members = useFetch(() => api.get<Member[]>('/team/members').then((r) => r.data), [])
  const departments = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const invites = useFetch(() => (adminView ? api.get<Invite[]>('/team/invites').then((r) => r.data) : Promise.resolve([])), [adminView])
  const rules = useFetch(() => api.get<ApprovalRule[]>('/team/approval-rules').then((r) => r.data), [])
  const delegations = useFetch(() => api.get<Delegation[]>('/team/delegations').then((r) => r.data), [])

  const allMembers = members.data ?? []
  // Department heads and viewers see their own row only.
  const visibleMembers = adminView ? allMembers : allMembers.filter((m) => m.id === user?.id)

  return (
    <div className="max-w-[860px]">
      <PageHeader title={t('team.title')} subtitle={t('team.subtitle')} />
      <div className="space-y-5">
        <MembersCard members={visibleMembers} departments={departments.data ?? []} loading={members.loading} error={members.error} onChanged={() => void members.refetch()} />
        {canManage && <InviteCard invites={invites.data ?? []} departments={departments.data ?? []} onChanged={() => void invites.refetch()} />}
        <ApprovalChainsCard rules={rules.data ?? []} departments={departments.data ?? []} canManage={canManage} onChanged={() => void rules.refetch()} />
        <DelegationCard delegations={delegations.data ?? []} members={allMembers} onChanged={() => void delegations.refetch()} />
      </div>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, Users } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { sar } from '../../lib/money'
import { chainStatus } from '../../lib/chain'
import { timeAgo } from '../../lib/useFetch'
import type { AdminView } from '../../types'
import { StatusPill } from '../StatusPill'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card border border-line bg-lavender px-3 py-2.5">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-lg font-extrabold tracking-tightest tnum">{value}</div>
    </div>
  )
}

/** Company block for the Admin view: pending by department, approvers and their open counts, members, stuck holds. */
export function AdminBlock({ view }: { view: AdminView }) {
  const t = useT()
  return (
    <section className="card-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">{t('admin.company')}</h2>
        <Link to="/team" className="text-xs font-semibold text-brand hover:underline">
          {t('nav.team')}
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label={t('admin.pending')} value={view.pending_total} />
        <Stat label={t('admin.pendingAmount')} value={sar(view.pending_amount, { compact: true })} />
        <Stat label={t('admin.members')} value={`${view.members.active} / ${view.members.count}`} />
        <Stat label={t('admin.pendingInvites')} value={view.pending_invites} />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Building2 className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-bold">{t('admin.pendingByDepartment')}</h3>
        </div>
        {view.pending_by_department.length === 0 ? (
          <p className="text-xs text-neutral-500">{t('admin.nothingPending')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {view.pending_by_department.map((d) => (
              <li key={d.department_id} className="py-1.5 flex items-center gap-2 text-xs">
                <span className="flex-1 font-semibold truncate">{d.department_name}</span>
                <span className="text-neutral-500 tnum">{t('admin.nRequests', { n: d.count })}</span>
                <span className="font-semibold tnum">{sar(d.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-3 border-t border-line">
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-bold">{t('admin.approvers')}</h3>
          <span className="text-xs text-neutral-500">
            {t('admin.rulesAndDelegations', { rules: view.approval_rules, delegations: view.active_delegations })}
          </span>
        </div>
        {view.approvers.length === 0 ? (
          <p className="text-xs text-neutral-500">{t('admin.noApprovers')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {view.approvers.map((a) => (
              <li key={a.id} className="py-1.5 flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-semibold text-ink">{a.full_name}</span>
                  <span className="text-neutral-500"> · {t(`role.${a.role}`)}</span>
                </span>
                {a.status !== 'active' && <StatusPill tone="neutral">{t('team.disabled')}</StatusPill>}
                <span className={`tnum font-semibold ${a.open_count > 0 ? 'text-brand' : 'text-neutral-400'}`}>{t('admin.nOpen', { n: a.open_count })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-3 border-t border-line">
        <div className="flex items-center gap-2 mb-1.5">
          <AlertTriangle className={`h-4 w-4 ${view.stuck_holds.length ? 'text-warn' : 'text-neutral-400'}`} />
          <h3 className="text-sm font-bold">{t('admin.stuckHolds')}</h3>
        </div>
        {view.stuck_holds.length === 0 ? (
          <p className="text-xs text-neutral-500">{t('admin.noStuck')}</p>
        ) : (
          <ul className="space-y-2">
            {view.stuck_holds.map((r) => (
              <li key={r.id} className="rounded-input border border-amber-300 bg-warn-tint px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-semibold truncate">
                    {r.merchant} · {r.agent_name}
                  </span>
                  <span className="tnum font-semibold">{sar(r.amount)}</span>
                  <span className="text-warn whitespace-nowrap">{timeAgo(r.created_at)}</span>
                </div>
                {chainStatus(t, r.chain) && <div className="text-neutral-600 mt-0.5">{chainStatus(t, r.chain)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

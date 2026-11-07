import { Building2, CheckCircle2, UserCheck } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { formatDate } from '../../lib/useFetch'
import { sar } from '../../lib/money'
import type { MyView } from '../../types'

function approvalLine(ev: MyView['my_recent_approvals'][number]): { what: string; amount: number | null; requestId: number | null; note: string | null } {
  const d = ev.details ?? {}
  const amount = typeof d.amount === 'number' ? d.amount : null
  const requestId = typeof d.request_id === 'number' ? d.request_id : null
  const note = typeof d.note === 'string' && d.note ? d.note : null
  return { what: ev.event.replace('approval.', ''), amount, requestId, note }
}

/** My departments, delegations I hold, and my recent approvals. Compact, under "Needs you" in My view. */
export function MyViewPanel({ view }: { view: MyView }) {
  const t = useT()
  return (
    <section className="card-lg p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Building2 className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-bold">{t('my.departments')}</h3>
          <span className="text-xs text-neutral-500">{t(`role.${view.my_role}`)}</span>
        </div>
        {view.my_departments.length === 0 ? (
          <p className="text-xs text-neutral-500">{t('my.allDepartments')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {view.my_departments.map((d) => (
              <span key={d.id} className="rounded-pill bg-brand-light text-brand text-xs font-semibold px-2.5 py-0.5">
                {d.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-line">
        <div className="flex items-center gap-2 mb-1.5">
          <UserCheck className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-bold">{t('my.delegations')}</h3>
        </div>
        {view.delegations_active_for_me.length === 0 ? (
          <p className="text-xs text-neutral-500">{t('my.noDelegations')}</p>
        ) : (
          <ul className="space-y-1.5">
            {view.delegations_active_for_me.map((d) => (
              <li key={d.id} className="text-xs text-neutral-600">
                <span className="font-semibold text-ink">{d.user_name}</span> ({d.user_role ? t(`role.${d.user_role}`) : ''}) · {t('my.until', { date: formatDate(d.ends_at, false) })}
                {d.note && <span className="text-neutral-500"> · {d.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-3 border-t border-line">
        <div className="flex items-center gap-2 mb-1.5">
          <CheckCircle2 className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-bold">{t('my.recentApprovals')}</h3>
        </div>
        {view.my_recent_approvals.length === 0 ? (
          <p className="text-xs text-neutral-500">{t('my.noApprovalsYet')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {view.my_recent_approvals.slice(0, 6).map((ev) => {
              const line = approvalLine(ev)
              return (
                <li key={ev.id} className="py-1.5 flex items-center gap-2 text-xs">
                  <span className="font-mono text-neutral-500 whitespace-nowrap">{formatDate(ev.ts)}</span>
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-semibold text-ink">{t(`approvalEvent.${line.what}`)}</span>
                    {line.requestId !== null && <span className="text-neutral-600 font-mono"> #{line.requestId}</span>}
                    {line.note && <span className="text-neutral-500"> · {line.note}</span>}
                  </span>
                  {line.amount !== null && <span className="tnum font-semibold">{sar(line.amount)}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

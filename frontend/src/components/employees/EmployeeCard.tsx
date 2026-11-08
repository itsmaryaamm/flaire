import { Link } from 'react-router-dom'
import { Bot, MessageSquare, ChevronRight } from 'lucide-react'
import { sar } from '../../lib/money'
import type { Agent } from '../../types'
import { CardLine } from './CardTile'
import { useT } from '../../lib/i18n'

/** Grid card for one employee: who it is, its card, what it spent, who answers for it. */
export function EmployeeCard({ agent: a, lithicConfigured, onChanged }: { agent: Agent; lithicConfigured: boolean; onChanged: () => void }) {
  const t = useT()
  const active = a.status === 'active'
  return (
    <div className="card-lg p-4 flex flex-col gap-3.5">
      <Link to={`/employees/${a.id}`} className="flex items-start gap-3 group">
        <div className="rounded-xl bg-brand-light text-brand p-2.5 shrink-0">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold group-hover:text-brand truncate">{a.name}</div>
          <div className="text-xs text-neutral-500 truncate flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${active ? 'bg-success' : 'bg-amber-500'}`} aria-label={active ? t('status.active') : t('status.paused')} />
            {t(`agentRole.${a.role}`)}
            {!active && <span className="text-warn">({t('status.paused').toLowerCase()})</span>}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-neutral-400 rtl-flip shrink-0 mt-1" />
      </Link>

      <CardLine agent={a} lithicConfigured={lithicConfigured} onChanged={onChanged} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="text-neutral-500">{t('employees.spentThisMonth')}</dt>
          <dd className="font-semibold tnum text-sm">{sar(a.spent_this_period)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">{t('employees.humanApprovalFrom')}</dt>
          <dd className="font-semibold tnum text-sm">{sar(a.approval_threshold)}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 pt-3 border-t border-line mt-auto text-xs">
        <span className="flex-1 min-w-0 truncate text-neutral-600">
          {t('employees.accountable')}: <span className="font-semibold text-ink">{a.owner?.full_name ?? t('employees.nobodyYet')}</span>
        </span>
        <Link to={`/employees/${a.id}?chat=1`} className="btn-secondary text-xs h-8 px-3 shrink-0">
          <MessageSquare className="h-3.5 w-3.5" /> {t('employees.chat')}
        </Link>
      </div>
    </div>
  )
}

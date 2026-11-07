import { Link } from 'react-router-dom'
import { Bot, MessageSquare, ChevronRight } from 'lucide-react'
import { sar } from '../../lib/money'
import type { Agent } from '../../types'
import { CardLine } from './CardTile'

/** Grid card for one employee. */
export function EmployeeCard({ agent: a }: { agent: Agent }) {
  const active = a.status === 'active'
  return (
    <div className="card-lg p-4 flex flex-col gap-3.5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-brand-light text-brand p-2.5 shrink-0">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <Link to={`/employees/${a.id}`} className="font-bold hover:text-brand truncate block">
            {a.name}
          </Link>
          <div className="text-xs text-neutral-500 truncate capitalize flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${active ? 'bg-success' : 'bg-amber-500'}`} aria-label={active ? 'Active' : 'Paused'} />
            {a.role}
            {!active && <span className="text-warn normal-case">(paused)</span>}
          </div>
        </div>
      </div>

      <CardLine card={a.card} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="text-neutral-500">Spent this month</dt>
          <dd className="font-semibold tnum text-sm">{sar(a.spent_this_period)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Human approval from</dt>
          <dd className="font-semibold tnum text-sm">{sar(a.approval_threshold)}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 pt-3 border-t border-line mt-auto">
        <Link to={`/employees/${a.id}?chat=1`} className="btn-primary text-xs flex-1">
          <MessageSquare className="h-3.5 w-3.5" /> Chat
        </Link>
        <Link to={`/employees/${a.id}`} className="btn-secondary text-xs flex-1">
          Open <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

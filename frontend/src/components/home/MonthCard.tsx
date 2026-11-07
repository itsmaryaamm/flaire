import { Link } from 'react-router-dom'
import { sar } from '../../lib/money'
import type { FeeStatement } from '../../types'
import { ProgressBar } from '../ProgressBar'

/** Spent vs budget this month, with the Flaire fee line underneath. */
export function MonthCard({ spent, budget, fees }: { spent: number; budget: number; fees: FeeStatement | null }) {
  const remaining = Math.max(0, budget - spent)
  return (
    <section className="card-lg p-4">
      <div className="mono-label">This month</div>
      <div className="flex items-end justify-between gap-3 mt-1.5">
        <div>
          <div className="text-[28px] leading-none font-extrabold tracking-tightest tnum">{sar(spent, { compact: true })}</div>
          <div className="text-xs text-neutral-500 mt-1.5">spent by employees</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold tnum">{sar(remaining, { compact: true })}</div>
          <div className="text-xs text-neutral-500">left of {sar(budget, { compact: true })}</div>
        </div>
      </div>
      <ProgressBar value={spent} max={budget} thin className="mt-3" />
      <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-xs">
        <span className="text-neutral-500">Flaire fee this month</span>
        <Link to="/activity" className="font-semibold tnum text-ink hover:text-brand">
          {fees ? sar(fees.fees) : 'SAR 0.00'}
          {fees && fees.fee_rate_bps > 0 && <span className="text-neutral-400 font-normal"> ({(fees.fee_rate_bps / 100).toFixed(2)}%)</span>}
        </Link>
      </div>
    </section>
  )
}

import { sar } from '../../lib/money'
import { ProgressBar } from '../ProgressBar'

export function MonthCard({ spent, budget }: { spent: number; budget: number }) {
  const remaining = Math.max(0, budget - spent)
  return (
    <section className="card-lg p-4">
      <div className="mono-label">This month</div>
      <div className="flex items-end justify-between gap-3 mt-1.5">
        <div>
          <div className="text-[30px] leading-none font-extrabold tracking-tightest tnum">{sar(spent, { compact: true })}</div>
          <div className="text-xs text-neutral-500 mt-1.5">spent by AI employees</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold tnum">{sar(remaining, { compact: true })}</div>
          <div className="text-xs text-neutral-500">left of {sar(budget, { compact: true })}</div>
        </div>
      </div>
      <ProgressBar value={spent} max={budget} thin className="mt-3.5" />
    </section>
  )
}

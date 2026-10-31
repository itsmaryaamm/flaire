import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand text-white p-12">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand font-bold text-xl">
            F
          </span>
          <span className="text-xl font-semibold tracking-tight">Flaire</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">
            The finance department for your AI employees.
          </h2>
          <p className="mt-4 text-white/80 leading-relaxed">
            Give agents a company card without giving them the company bank account. Per-transaction
            limits, department budgets, approval thresholds, signed receipts and a kill switch that
            freezes everything in one click.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/90">
            {[
              'Agents request, humans decide. Agents can never approve.',
              'Every decision has a reason and lives in a hash-chained ledger.',
              'Simulated SNB, Al Rajhi and Riyad cards, or a Lithic sandbox.',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <ShieldCheck className="h-4 w-4 mt-0.5 text-mint shrink-0" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-white/60">Simulation. No real money moves.</div>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white font-bold text-lg">
              F
            </span>
            <span className="text-lg font-semibold tracking-tight">Flaire</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-neutral-500 mt-1 mb-6">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

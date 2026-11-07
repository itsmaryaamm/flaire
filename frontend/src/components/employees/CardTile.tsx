import { CreditCard } from 'lucide-react'
import { sar } from '../../lib/money'
import type { AgentCard } from '../../types'
import { StatusPill } from '../StatusPill'
import { ProgressBar } from '../ProgressBar'
import { useT } from '../../lib/i18n'
import { translate } from '../../lib/i18n'
import { moneyLocale } from '../../lib/money'

export function providerLabel(provider: string | undefined | null): string {
  return provider === 'lithic' ? 'Lithic' : translate(moneyLocale(), 'card.simulated')
}

/** The employee's own card: provider, last4, available of limit, status. */
export function CardTile({ card, compact = false }: { card: AgentCard | null; compact?: boolean }) {
  const t = useT()
  if (!card) {
    return (
      <div className={`rounded-card border border-dashed border-line-strong px-3.5 py-3 text-xs text-neutral-500 ${compact ? '' : 'mt-1'}`}>
        {t('card.noneYetLong')}
      </div>
    )
  }
  const used = Math.max(0, card.credit_limit - card.available_balance)
  return (
    <div className="rounded-card-lg bg-gradient-to-br from-ink to-brand-deep text-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
          <CreditCard className="h-4 w-4" />
          {t('card.card')}
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">{providerLabel(card.provider)}</span>
        </div>
        <StatusPill status={card.status} className={card.status === 'active' ? '!bg-white/15 !text-white' : ''} />
      </div>
      <div className="font-mono text-lg tracking-[0.2em] mt-3">•••• {card.last4}</div>
      <div className="mt-3 flex items-baseline justify-between text-xs text-white/80">
        <span>
          <span className="text-white font-bold text-sm tnum">{sar(card.available_balance)}</span> {t('card.available')}
        </span>
        <span className="tnum">{t('card.of', { amount: sar(card.credit_limit) })}</span>
      </div>
      <div className="h-1.5 w-full rounded-pill bg-white/15 overflow-hidden mt-2" aria-hidden>
        <div className="h-full rounded-pill bg-white/80" style={{ width: `${card.credit_limit ? Math.min(100, Math.round((used / card.credit_limit) * 100)) : 0}%` }} />
      </div>
      {!compact && <p className="text-[11px] text-white/60 mt-3">{t('card.mirrored')}</p>}
    </div>
  )
}

/** One-line card summary for grid cards. */
export function CardLine({ card }: { card: AgentCard | null }) {
  const t = useT()
  if (!card) return <div className="text-xs text-neutral-400">{t('card.noneYet')}</div>
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono">
          {t('card.card')} •••• {card.last4} <span className="text-neutral-400 ms-1">{providerLabel(card.provider)}</span>
        </span>
        <span className="tnum text-neutral-600">
          {sar(card.available_balance, { compact: true })} {t('card.of', { amount: sar(card.credit_limit, { compact: true }) })}
        </span>
      </div>
      <ProgressBar value={Math.max(0, card.credit_limit - card.available_balance)} max={card.credit_limit} thin className="mt-1.5" />
    </div>
  )
}

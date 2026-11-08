import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, Plus } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useFetch } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import { sar } from '../../lib/money'
import { useT } from '../../lib/i18n'
import type { Agent, AgentCard, LithicStatus } from '../../types'
import { StatusPill } from '../StatusPill'
import { ProgressBar } from '../ProgressBar'
import { Spinner } from '../Spinner'

const PROVIDER_NAMES: Record<string, string> = {
  lithic: 'Lithic',
  mock_snb: 'SNB',
  mock_rajhi: 'Al Rajhi',
  mock_riyad: 'Riyad Bank',
}

/** Human name of the card issuer. */
export function providerLabel(provider: string | undefined | null): string {
  if (!provider) return ''
  return PROVIDER_NAMES[provider] ?? provider.replace(/^mock_/, '').replace(/_/g, ' ')
}

const ISSUE_ROLES = ['owner', 'admin', 'finance']

/** Whether this company can issue cards: GET /settings/lithic/status, falling back to the company flag. Call once per page. */
export function useLithicConfigured(): boolean {
  const { company } = useAuth()
  const status = useFetch(() => api.get<LithicStatus>('/settings/lithic/status').then((r) => r.data), [company?.lithic_configured])
  return status.data ? !!status.data.configured : !!company?.lithic_configured
}

export type CardState = 'issued' | 'issuing' | 'none' | 'noKey'

export function cardState(card: AgentCard | null, lithicConfigured: boolean, issuing = false): CardState {
  if (issuing) return 'issuing'
  if (card) return card.last4 && !['issuing', 'pending'].includes(String(card.status)) ? 'issued' : 'issuing'
  return lithicConfigured ? 'none' : 'noKey'
}

/** "Issue card" button: POST /agents/{id}/card. Shown to owner, admin and finance when the company has a Lithic key. */
export function IssueCardButton({ agent, onIssued, onBusy, className = '' }: { agent: Agent; onIssued: () => void; onBusy?: (busy: boolean) => void; className?: string }) {
  const { user } = useAuth()
  const toast = useToast()
  const t = useT()
  const [busy, setBusy] = useState(false)
  if (!ISSUE_ROLES.includes(String(user?.role))) return null
  const issue = async () => {
    setBusy(true)
    onBusy?.(true)
    try {
      await api.post(`/agents/${agent.id}/card`)
      toast.success(t('card.issued', { name: agent.name }))
      onIssued()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }
  return (
    <button type="button" className={`btn-primary text-xs ${className}`} onClick={issue} disabled={busy}>
      {busy ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {t('card.issue')}
    </button>
  )
}

/** The honest one-line state of the card. */
export function CardStateText({ state, last4 }: { state: CardState; last4?: string }) {
  const t = useT()
  if (state === 'issued') return <>{t('card.issuedEnding', { last4: last4 ?? '' })}</>
  if (state === 'issuing') return <>{t('card.issuing')}</>
  if (state === 'none') return <>{t('card.none')}</>
  return (
    <>
      {t('card.noneNoKey')}{' '}
      <Link to="/settings#payments" className="font-semibold text-brand hover:underline">
        {t('nav.settings')}
      </Link>
    </>
  )
}

/** The employee's own card on the detail page: issuer, last4, available of limit, status. Honest about missing cards. */
export function CardTile({ agent, lithicConfigured: configured, onChanged }: { agent: Agent; lithicConfigured: boolean; onChanged: () => void }) {
  const t = useT()
  const [issuing, setIssuing] = useState(false)
  const card = agent.card
  const state = cardState(card, configured, issuing)

  if (state !== 'issued' || !card) {
    return (
      <div className="rounded-card border border-dashed border-line-strong px-3.5 py-3 flex flex-wrap items-center gap-3">
        <CreditCard className="h-4 w-4 text-neutral-400 shrink-0" />
        <div className="text-xs text-neutral-600 flex-1 min-w-[160px]">
          <CardStateText state={state} />
        </div>
        {state === 'none' && <IssueCardButton agent={agent} onIssued={onChanged} onBusy={setIssuing} />}
        {state === 'issuing' && <Spinner className="h-4 w-4" />}
      </div>
    )
  }
  const used = Math.max(0, card.credit_limit - card.available_balance)
  return (
    <div className="rounded-card-lg bg-gradient-to-br from-ink to-brand-deep text-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
          <CreditCard className="h-4 w-4" />
          <CardStateText state="issued" last4={card.last4} />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">{providerLabel(card.provider)}</span>
        </div>
        <StatusPill status={card.status} className={card.status === 'active' ? '!bg-white/15 !text-white' : ''} />
      </div>
      <div className="mt-3 flex items-baseline justify-between text-xs text-white/80">
        <span>
          <span className="text-white font-bold text-sm tnum">{sar(card.available_balance)}</span> {t('card.available')}
        </span>
        <span className="tnum">{t('card.of', { amount: sar(card.credit_limit) })}</span>
      </div>
      <div className="h-1.5 w-full rounded-pill bg-white/15 overflow-hidden mt-2" aria-hidden>
        <div className="h-full rounded-pill bg-white/80" style={{ width: `${card.credit_limit ? Math.min(100, Math.round((used / card.credit_limit) * 100)) : 0}%` }} />
      </div>
    </div>
  )
}

/** One-line card state for grid cards, with the usage bar when a card exists. */
export function CardLine({ agent, lithicConfigured: configured, onChanged }: { agent: Agent; lithicConfigured: boolean; onChanged: () => void }) {
  const t = useT()
  const [issuing, setIssuing] = useState(false)
  const card = agent.card
  const state = cardState(card, configured, issuing)
  if (state !== 'issued' || !card) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span className="min-w-0">
          <CardStateText state={state} />
        </span>
        {state === 'none' && <IssueCardButton agent={agent} onIssued={onChanged} onBusy={setIssuing} className="h-7 px-2.5 shrink-0" />}
        {state === 'issuing' && <Spinner className="h-3.5 w-3.5 shrink-0" />}
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate">
          <CardStateText state="issued" last4={card.last4} /> <span className="text-neutral-400 ms-1">{providerLabel(card.provider)}</span>
        </span>
        <span className="tnum text-neutral-600 whitespace-nowrap">
          {sar(card.available_balance, { compact: true })} {t('card.of', { amount: sar(card.credit_limit, { compact: true }) })}
        </span>
      </div>
      <ProgressBar value={Math.max(0, card.credit_limit - card.available_balance)} max={card.credit_limit} thin className="mt-1.5" />
    </div>
  )
}

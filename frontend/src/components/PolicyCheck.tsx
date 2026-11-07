import { Check, X } from 'lucide-react'
import type { Decision } from '../types'
import { useT } from '../lib/i18n'

export type CheckKind = 'pass' | 'hold' | 'fail'

const HOLD = /approv|threshold|requir|exceed|above|over |review|two-person|second|human|new (supplier|merchant)/
const FAIL =
  /denied|block|not in|not allowed|not an allowed|exceed|insufficient|kill switch|paused|over budget|overshoot|rate limit|expired|unknown category/

/** Simple text heuristics: which line caused the hold or the denial. */
export function checkKind(reason: string, verdict: Decision['verdict'] | undefined): CheckKind {
  const t = reason.toLowerCase()
  if (verdict === 'denied' && FAIL.test(t)) return 'fail'
  if (verdict === 'pending_approval' && HOLD.test(t)) return 'hold'
  return 'pass'
}

export function CheckIcon({ kind }: { kind: CheckKind }) {
  if (kind === 'fail') return <X className="h-3.5 w-3.5 text-danger shrink-0" strokeWidth={2.5} />
  if (kind === 'hold')
    return (
      <span className="w-3.5 text-center font-mono text-sm font-medium leading-none text-brand shrink-0">!</span>
    )
  return <Check className="h-3.5 w-3.5 text-success shrink-0" strokeWidth={2.5} />
}

/** Policy check list rendered from decision.reasons, styled like the design. */
export function PolicyCheck({
  decision,
  label,
  className = '',
}: {
  decision: Decision | null | undefined
  /** null hides the heading; undefined uses the default "Policy check". */
  label?: string | null
  className?: string
}) {
  const t = useT()
  const heading = label === undefined ? t('decision.policyCheck') : label
  return (
    <div className={className}>
      {heading && <div className="mono-label mb-2">{heading}</div>}
      {!decision || !decision.reasons?.length ? (
        <p className="text-sm text-neutral-500">{t('decision.noReasons')}</p>
      ) : (
        <ul className="space-y-2">
          {decision.reasons.map((r, i) => {
            const kind = checkKind(r, decision.verdict)
            return (
              <li key={i} className="flex items-start gap-2.5 text-sm text-neutral-700">
                <span className="mt-[3px] inline-flex w-3.5 justify-center">
                  <CheckIcon kind={kind} />
                </span>
                <span className={kind === 'hold' ? 'text-ink font-medium' : ''}>{r}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

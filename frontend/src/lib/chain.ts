import type { TFn } from './i18n'
import type { ApprovalStep, ChainState } from '../types'

/** "department head", "finance", "admin", "owner" in the current language. */
export function stepRoleLabel(t: TFn, role: string): string {
  return t(`stepRole.${role}`)
}

function approvers(t: TFn, n: number, role: string): string {
  return t(n === 1 ? 'chain.approverOne' : 'chain.approverMany', { n, role: stepRoleLabel(t, role) })
}

/** Same wording as the backend's progress_message, built client side so it can be translated. */
export function chainStatus(t: TFn, chain: ChainState | null | undefined): string | null {
  if (!chain) return null
  const total = chain.total_steps
  const done = chain.satisfied.length
  const nxt = chain.next
  if (!nxt) return t('chain.allDone', { total })
  if (done === 0 && nxt.have === 0) return t('chain.firstStep', { total, waiting: approvers(t, nxt.waiting_for, nxt.role) })
  if (nxt.have > 0)
    return t('chain.inProgress', { step: nxt.step, total, have: nxt.have, count: nxt.count, role: stepRoleLabel(t, nxt.role), waiting: approvers(t, nxt.waiting_for, nxt.role) })
  const prev = chain.steps[done - 1]
  return t('chain.stepDone', { done, total, prevRole: stepRoleLabel(t, prev?.role ?? ''), waiting: approvers(t, nxt.waiting_for, nxt.role) })
}

/** "1 department head, then 2 finance" for a rule's steps. */
export function stepsSummary(t: TFn, steps: ApprovalStep[]): string {
  return steps.map((s) => `${s.count} ${stepRoleLabel(t, s.role)}`).join(t('chain.then'))
}

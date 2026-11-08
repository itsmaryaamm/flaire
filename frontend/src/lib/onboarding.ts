/**
 * Setup wizard contract (GET /onboarding/status, GET /connector-info) with defensive normalisation,
 * so the UI renders the same whether the backend already returns the new field names or still the old ones.
 */
import type { User } from '../types'

export type SetupStepKey = 'company' | 'twofa' | 'card' | 'employee' | 'connected' | 'first_purchase'

export interface SetupSteps {
  company: boolean
  twofa: boolean
  card: boolean
  employee: boolean
  connected: boolean
  first_purchase: boolean
}

/** GET /onboarding/status, as the wizard sees it. */
export interface SetupStatus {
  has_company: boolean
  onboarding_done: boolean
  complete: boolean
  twofa_required: boolean
  next_step: SetupStepKey | string | null
  steps: SetupSteps
}

type RawSteps = Partial<Record<string, boolean>>

interface RawStatus {
  has_company?: boolean
  onboarding_done?: boolean
  complete?: boolean
  next_step?: string | null
  steps?: RawSteps
}

const ORDER: SetupStepKey[] = ['company', 'twofa', 'card', 'employee', 'connected', 'first_purchase']

/** Accepts the new shape ({twofa, employee, connected, first_purchase}) and the old one ({two_factor, agent, claude_connected, first_request}). */
export function normalizeStatus(raw: unknown, user?: User | null): SetupStatus {
  const r = (raw ?? {}) as RawStatus
  const s = r.steps ?? {}
  const hasCompany = r.has_company ?? !!s.company
  const steps: SetupSteps = {
    company: !!(s.company ?? hasCompany),
    twofa: !!(s.twofa ?? s.two_factor ?? user?.totp_enabled ?? false),
    card: !!(s.card ?? false),
    employee: !!(s.employee ?? s.agent ?? false),
    connected: !!(s.connected ?? s.claude_connected ?? false),
    first_purchase: !!(s.first_purchase ?? s.first_request ?? false),
  }
  const complete = r.complete ?? ORDER.every((k) => steps[k])
  const next_step = r.next_step ?? ORDER.find((k) => !steps[k]) ?? null
  return {
    has_company: hasCompany,
    onboarding_done: !!r.onboarding_done,
    complete,
    twofa_required: (r as { twofa_required?: boolean }).twofa_required ?? true,
    next_step,
    steps,
  }
}

/**
 * Whether the person must still go through /setup before they see the app.
 * Company and 2FA are hard requirements; the rest is required until the owner finishes (or dismisses) the wizard.
 */
export function setupRequired(status: SetupStatus | null, user: User | null, hasCompany: boolean): boolean {
  if (!hasCompany) return true
  if (!status) return !!user && !user.totp_enabled
  if (status.twofa_required && !status.steps.twofa) return true
  if (status.complete || status.onboarding_done) return false
  return true
}

/** GET /connector-info: new fields first, old ones as fallback. */
export interface ConnectorDetails {
  mcp_url: string
  agent_instructions: string
  claude_steps: string[]
  chatgpt_steps: string[]
}

interface RawConnectorInfo {
  mcp_url?: string
  url?: string
  agent_instructions?: string
  claude_steps?: string[]
  chatgpt_steps?: string[]
  steps?: string[]
}

export function normalizeConnectorInfo(raw: unknown, fallback: { claude: string[]; chatgpt: string[]; instructions: string }): ConnectorDetails {
  const r = (raw ?? {}) as RawConnectorInfo
  const mcp_url = r.mcp_url || r.url || ''
  const claude = Array.isArray(r.claude_steps) && r.claude_steps.length > 0 ? r.claude_steps : Array.isArray(r.steps) && r.steps.length > 0 ? r.steps : fallback.claude
  const chatgpt = Array.isArray(r.chatgpt_steps) && r.chatgpt_steps.length > 0 ? r.chatgpt_steps : fallback.chatgpt
  return {
    mcp_url,
    agent_instructions: r.agent_instructions || fallback.instructions.replace('{url}', mcp_url),
    claude_steps: claude,
    chatgpt_steps: chatgpt,
  }
}

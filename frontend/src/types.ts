// Types matching docs/API.md. All money values are integer halalas.

export type Engine = 'native' | 'shotoku'

export interface User {
  id: number
  email: string
  full_name: string
  role?: string
  totp_enabled: boolean
  company_id?: number
  created_at?: string
}

export interface Company {
  id: number
  name: string
  currency: 'SAR'
  kill_switch: boolean
  kill_switch_reason?: string | null
  engine: Engine
  require_password_on_approve: boolean
  two_person_threshold: number
  trusted_merchants: string[]
  new_merchant_review_from: number
  /** Approvers are notified (push + email) only for holds at or above this amount, in halalas. */
  notify_threshold: number
  /** True when a Lithic sandbox API key is stored for this company. The key itself is never returned. */
  lithic_configured: boolean
  /** When true, owners and finance users without 2FA cannot approve or reject until they enable it. */
  require_2fa_for_approvers: boolean
  /** True once the owner finished or dismissed the welcome walkthrough. */
  onboarding_done?: boolean
  created_at: string
}

/** GET /connector-info: how to connect a Claude client to this company's Flaire MCP endpoint. */
export interface ConnectorInfo {
  url: string
  auth: string
  steps: string[]
}

/** GET /connections: a Claude client linked to one AI employee. */
export interface Connection {
  id: number
  agent_id: number
  agent_name: string
  connected_by: string
  client: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
  company: Company
}

/** GET /auth/config (public): which sign-in system the backend uses. */
export interface AuthConfig {
  provider: 'supabase' | 'builtin'
  supabase_url?: string | null
  supabase_anon_key?: string | null
}

/** GET /auth/me */
export interface MeResponse {
  user: User
  company: Company | null
  needs_onboarding: boolean
}

/** GET /onboarding/status */
export interface OnboardingStatus {
  has_company: boolean
  onboarding_done: boolean
  steps: {
    company: boolean
    department: boolean
    card: boolean
    agent: boolean
    claude_connected: boolean
    first_request: boolean
    two_factor: boolean
  }
  complete: boolean
}

export interface Department {
  id: number
  name: string
  monthly_budget: number
  spent_this_period: number
  remaining: number
  period_start: string
  /** When true, every request from this department is held until a human lifts the pause. */
  spending_paused?: boolean
  agent_count: number
}

export type AgentStatus = 'active' | 'paused'

/** The card that belongs to one employee. Issued automatically when the employee is created. */
export interface AgentCard {
  id: number
  provider: CardProvider | string
  last4: string
  status: CardStatus | string
  available_balance: number
  credit_limit: number
}

export interface Agent {
  id: number
  name: string
  role: string
  department_id: number
  department_name: string
  status: AgentStatus
  per_transaction_limit: number
  monthly_limit: number
  spent_this_period: number
  approval_threshold: number
  allowed_categories: string[]
  blocked_merchants: string[]
  max_requests_per_hour: number
  key_expires_in_days?: number | null
  key_prefix: string
  key_expires_at?: string | null
  last_active_at: string | null
  card: AgentCard | null
  created_at: string
}

export interface AgentCreateInput {
  name: string
  role: string
  department_id: number
  per_transaction_limit: number
  monthly_limit: number
  approval_threshold: number
  allowed_categories: string[]
  blocked_merchants: string[]
  max_requests_per_hour: number
  key_expires_in_days?: number | null
}

export type AgentUpdateInput = Partial<AgentCreateInput> & { status?: AgentStatus }

export interface AgentCreateResponse {
  agent: Agent
  api_key: string
}

export type PurchaseStatus =
  | 'approved'
  | 'pending_approval'
  | 'denied'
  | 'completed'
  | 'failed'
  | 'rejected'

export type Verdict = 'approved' | 'denied' | 'pending_approval'

export interface Decision {
  verdict: Verdict
  engine: Engine
  reasons: string[]
  rule_id?: string | null
  receipt?: string | null
  payment_error?: string | null
}

export interface PurchaseRequest {
  id: number
  agent_id: number
  agent_name: string
  department_id: number
  department_name: string
  amount: number
  currency: string
  merchant: string
  category: string
  description: string
  status: PurchaseStatus
  decision: Decision | null
  transaction_id: number | null
  approved_by: { id: number; full_name: string } | null
  approvals: { id: number; full_name: string }[]
  needs_second_approver: boolean
  created_at: string
  decided_at: string | null
}

export type CardProvider = 'mock_snb' | 'mock_rajhi' | 'mock_riyad' | 'lithic'

export type TransactionStatus = 'authorized' | 'settled' | 'declined' | 'reversed'

export interface Transaction {
  id: number
  purchase_request_id: number
  card_id: number
  card_label: string
  provider: CardProvider
  provider_ref: string
  amount: number
  currency: string
  merchant: string
  status: TransactionStatus
  decline_reason: string | null
  /** Flaire's fee on this transaction, in halalas. */
  fee: number
  fee_rate_bps: number
  agent_name: string | null
  created_at: string
}

export type CardStatus = 'active' | 'frozen'

export interface Card {
  id: number
  label: string
  provider: CardProvider
  last4: string
  currency: string
  available_balance: number
  credit_limit: number
  status: CardStatus
  is_default: boolean
  department_id: number | null
}

export interface CardCreateInput {
  label: string
  provider: CardProvider
  last4?: string
  credit_limit: number
  department_id?: number | null
  is_default?: boolean
}

export interface SpendByDay {
  date: string
  amount: number
}

export interface DashboardSummary {
  company: Company
  kill_switch: boolean
  totals: {
    spent_this_period: number
    budget_total: number
    pending_count: number
    completed_count?: number
    blocked_count: number
    agent_count: number
    card_count: number
  }
  departments: Department[]
  agents: Agent[]
  recent_requests: PurchaseRequest[]
  recent_transactions: Transaction[]
  spend_by_day: SpendByDay[]
}

export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system'

/** One entry of an employee thread or assistant transcript. Tool entries carry name/input/output. */
export interface TranscriptEntry {
  role: TranscriptRole | string
  content?: unknown
  name?: string
  tool_name?: string
  input?: unknown
  output?: unknown
  [key: string]: unknown
}

export type RunMode = 'claude' | 'scripted'

/** POST /agents/{id}/chat and GET /agents/{id}/runs: one conversation thread with an employee. */
export interface RunOut {
  run_id: number
  agent_id: number
  task: string
  mode: RunMode | string
  transcript: TranscriptEntry[]
  purchase_requests: PurchaseRequest[]
  created_at: string
}

/** Kept as an alias for older imports. */
export type AgentRun = RunOut

export interface AssistantDecisionAction {
  type: 'decision'
  request_id: number
  action: 'approve' | 'reject'
  note?: string | null
  merchant: string
  amount: number
  agent: string
}

export type AssistantAction = AssistantDecisionAction | { type: string; [key: string]: unknown }

/** POST /assistant/chat */
export interface AssistantResponse {
  reply: string
  actions: AssistantAction[]
  transcript: TranscriptEntry[]
  mode: RunMode | string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** GET /fees/statement?month=YYYY-MM */
export interface FeeStatement {
  month: string
  fee_rate_bps: number
  transactions: number
  volume: number
  fees: number
  lines: { id: number; created_at: string; merchant: string; amount: number; fee: number }[]
}

/** GET /settings/lithic/status */
export interface LithicStatus {
  configured: boolean
  asa_enrolled: boolean
  asa_signed: boolean
  fee_rate_bps: number
  environment: string
}

/** GET /reconciliation */
export interface Reconciliation {
  ok: boolean
  requests: number
  transactions: number
  issues: { request_id: number | null; type: string; detail: string }[]
}

export interface AuditEntry {
  id: number
  ts: string
  actor_type: 'user' | 'agent' | 'system'
  actor_id: number | null
  actor_name: string | null
  event: string
  details: Record<string, unknown>
  prev_hash: string | null
  hash: string
}

export type AuditVerify = { ok: true; entries: number } | { ok: false; broken_at: number }

export interface Health {
  status: string
  engine: Engine
  payments: string[]
  claude: boolean
}

export interface ApiError {
  detail: string
}

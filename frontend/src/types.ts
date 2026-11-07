// Types matching docs/API.md. All money values are integer halalas.

export type Engine = 'native' | 'shotoku'

export interface User {
  id: number
  email: string
  full_name: string
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

export interface Department {
  id: number
  name: string
  monthly_budget: number
  spent_this_period: number
  remaining: number
  period_start: string
  agent_count: number
}

export type AgentStatus = 'active' | 'paused'

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

export type TranscriptRole = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'tool' | 'system'

// The transcript entry shape is loosely typed on purpose: the backend returns
// {role, content} where content can be a string or structured tool data.
export interface TranscriptEntry {
  role: TranscriptRole | string
  content: unknown
  name?: string
  tool_name?: string
  input?: unknown
  output?: unknown
  [key: string]: unknown
}

export type RunMode = 'claude' | 'scripted'

export interface AgentRun {
  run_id?: number
  id?: number
  mode: RunMode
  task?: string
  transcript: TranscriptEntry[]
  purchase_requests: PurchaseRequest[]
  created_at?: string
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

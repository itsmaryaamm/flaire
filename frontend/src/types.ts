// Types matching docs/API.md. All money values are integer halalas.

export type Engine = 'native' | 'shotoku'

export interface User {
  id: number
  email: string
  full_name: string
  role?: Role | string
  totp_enabled: boolean
  company_id?: number
  created_at?: string
  /** True for Flaire staff who may open the platform console at /platform. */
  is_platform_admin?: boolean
}

export type Role = 'owner' | 'admin' | 'finance' | 'dept_head' | 'viewer' | 'auditor'
export const ROLES: Role[] = ['owner', 'admin', 'finance', 'dept_head', 'viewer', 'auditor']
/** Roles that see the Admin view, Team, Finance and Policy pages. */
export const ADMIN_VIEW_ROLES: Role[] = ['owner', 'admin', 'finance', 'auditor']
export const TEAM_ADMIN_ROLES: Role[] = ['owner', 'admin']

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
  /** When true, a loosening policy change waits for a second admin (see /policy). */
  require_change_approval?: boolean
  policy_version?: number
  /** True once the owner finished or dismissed the welcome walkthrough. */
  onboarding_done?: boolean
  created_at: string
}

/** PATCH on company, department or agent may answer 202 with this body instead of the object. */
export interface PendingChangeResponse {
  pending_change_id: number
  message: string
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
  cost_center_id?: number | null
  gl_code?: string | null
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
  /** The human accountable for this employee's spending. */
  owner?: { id: number; full_name: string } | null
  cost_center_id?: number | null
  gl_code?: string | null
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
  cost_center_id?: number | null
  gl_code?: string | null
}

export type AgentUpdateInput = Partial<AgentCreateInput> & { status?: AgentStatus; owner_user_id?: number | null }

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
  vat_amount?: number
  vat_rate_bps?: number
  cost_center_id?: number | null
  gl_code?: string | null
  period?: string | null
  /** True once the month was closed; receipts cannot change. */
  locked?: boolean
  /** What the card issuer charged, in the issuer's minor units (e.g. US cents), and the rate used. */
  issuer_amount?: number | null
  issuer_currency?: string | null
  fx_rate?: number | null
  /** The human who answers for this payment: the approver, or the person who set the limits it passed under. */
  accountable?: { id: number; full_name: string; role?: string | null } | null
  accountable_reason?: 'approved' | 'auto_under_limits' | string | null
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
  asa_signed?: boolean
  asa_error?: string | null
  fee_rate_bps?: number
  environment: string
}

/** GET /notifications */
export interface AppNotification {
  id: number
  type: string
  title: string
  body: string | null
  request_id: number | null
  url: string | null
  created_at: string
  read: boolean
}

// ====================================================== platform console (Flaire staff)

export interface PlatformOverview {
  companies: number
  users: number
  agents: number
  active_agents: number
  transactions_30d: number
  volume_30d: number
  fees_total: number
  fees_30d: number
  signups_by_week: { week: string; companies: number }[]
  volume_by_week: { week: string; volume: number; fees: number }[]
  top_companies: { id: number; name: string; volume_30d: number; fees_30d: number }[]
}

export interface PlatformCompany {
  id: number
  name: string
  created_at: string
  users: number
  agents: number
  transactions_30d: number
  volume_30d: number
  fees_30d: number
  last_activity: string | null
  lithic_configured: boolean
  kill_switch: boolean
}

/** GET /platform/companies/{id}. Members and agents are best effort: the shape may grow. */
export interface PlatformCompanyDetail extends PlatformCompany {
  members?: { id: number; full_name: string; email?: string; role?: string; status?: string; last_seen_at?: string | null }[]
  agents_list?: { id: number; name: string; status?: string; spent_this_period?: number; last_active_at?: string | null }[]
  volume_total?: number
  fees_total?: number
  transactions_total?: number
  [key: string]: unknown
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

// ====================================================== team layer

export interface Member {
  id: number
  email: string
  full_name: string
  role: Role | string
  status: 'active' | 'disabled' | string
  department_id: number | null
  department_name: string | null
  /** Membership rows: departments this person reads or heads. */
  departments: number[]
  totp_enabled: boolean
  last_seen_at: string | null
  created_at: string
}

export interface Invite {
  id: number
  email: string
  role: Role | string
  department_id: number | null
  department_name: string | null
  invited_by: string | null
  status: 'pending' | 'accepted' | 'expired' | string
  accepted_at: string | null
  expires_at: string
  created_at: string
  email_delivered?: boolean
  /** Only on a dev backend when email was not delivered. */
  accept_link?: string
  token?: string
}

export interface InvitePreview {
  company_name: string
  role: Role | string
  email: string
  department_name: string | null
  invited_by: string | null
  expires_at: string
  existing_account: boolean
  auth: 'supabase' | 'builtin'
}

export interface InviteAcceptResponse {
  access_token: string
  user: Member
  company: Company
}

export type StepRole = 'dept_head' | 'finance' | 'admin' | 'owner'
export const STEP_ROLES: StepRole[] = ['dept_head', 'finance', 'admin', 'owner']

export interface ApprovalStep {
  role: StepRole | string
  count: number
}

export interface ApprovalRule {
  id: number
  department_id: number | null
  department_name: string | null
  /** Halalas, inclusive. */
  min_amount: number
  steps: ApprovalStep[]
  active: boolean
  created_at: string
}

export interface Delegation {
  id: number
  user_id: number
  user_name: string | null
  user_role: string | null
  delegate_id: number
  delegate_name: string | null
  starts_at: string
  ends_at: string
  note: string | null
  active: boolean
  created_at: string
}

export interface ChainState {
  rule_id: number
  steps: ApprovalStep[]
  satisfied: number[]
  next: { step: number; role: string; count: number; have: number; waiting_for: number; label: string } | null
  complete: boolean
  total_steps: number
}

export type NeedsMeRequest = PurchaseRequest & { chain: ChainState | null }

/** GET /me/view */
export interface MyView {
  my_role: Role | string
  my_departments: { id: number; name: string }[]
  needs_me: NeedsMeRequest[]
  my_recent_approvals: { id: number; ts: string; event: string; details: Record<string, unknown> }[]
  delegations_active_for_me: Delegation[]
}

/** GET /admin/view */
export interface AdminView {
  pending_total: number
  pending_amount: number
  pending_by_department: { department_id: number; department_name: string; count: number; amount: number }[]
  approvers: { id: number; full_name: string; role: string; status: string; open_count: number }[]
  members: { count: number; active: number; by_role: Record<string, number> }
  pending_invites: number
  stuck_holds: (NeedsMeRequest & { age_hours: number })[]
  approval_rules: number
  active_delegations: number
}

// ====================================================== finance layer

export interface CostCenter {
  id: number
  code: string
  name: string
  gl_code: string | null
  active: boolean
}

export interface Attachment {
  id: number
  transaction_id: number
  filename: string
  content_type: string
  size: number
  sha256: string
  uploaded_by_id: number
  created_at: string
}

export interface PeriodRow {
  period: string
  transaction_count: number
  volume: number
  vat: number
  fees: number
  net: number
  pending_settlement: number
  fiscal_year: string
  closed: boolean
  closed_at: string | null
  closed_by_id: number | null
  is_current: boolean
}

/** GET /finance/periods */
export interface PeriodsResponse {
  fiscal_year_start_month: number
  current_period: string
  periods: PeriodRow[]
  fiscal_years: { label: string; volume: number; vat: number; fees: number; transaction_count: number; periods: PeriodRow[] }[]
}

export interface StatementBucket {
  key: string | number | null
  label: string
  id?: number | null
  name?: string | null
  gl_code?: string | null
  amount: number
  vat: number
  net: number
  fee: number
  count: number
}

/** GET /finance/statement?period= */
export interface Statement {
  period: string
  fiscal_year: string
  currency: string
  transaction_count: number
  pending_settlement: number
  volume: number
  vat: number
  net: number
  vat_rate_bps: number
  fees: number
  fee_rate_bps: number
  fee_vat: number
  fees_incl_vat: number
  by_department: StatementBucket[]
  by_cost_center: StatementBucket[]
  by_agent: StatementBucket[]
  by_category: StatementBucket[]
  hash: string
  closed: boolean
  closed_at: string | null
  closed_by_id: number | null
}

export interface FeeInvoice {
  id: number
  period: string
  number: string
  subtotal: number
  vat: number
  total: number
  transaction_count: number
  qr_payload: string
  issued_at: string
}

// ====================================================== policy

export interface PolicyChange {
  id: number
  target_type: 'company' | 'agent' | 'department' | 'approval_rule' | string
  target_id: number | null
  changes: Record<string, { from: unknown; to: unknown }>
  reason: string | null
  status: 'pending' | 'applied' | 'rejected' | 'cancelled' | string
  proposed_by: { id: number; full_name: string } | null
  decided_by: { id: number; full_name: string } | null
  decision_note: string | null
  policy_version_id: number | null
  created_at: string
  decided_at: string | null
}

export interface PolicyVersion {
  id: number
  version: number
  hash: string
  change_summary: string
  created_at: string
  created_by: { id: number; full_name: string } | null
  snapshot?: Record<string, unknown>
}

export interface PolicyDiff {
  from: PolicyVersion
  to: PolicyVersion
  changes: { path: string; from: unknown; to: unknown }[]
}

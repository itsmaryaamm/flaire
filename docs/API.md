# Flaire API contract (v1)

Base URL: `http://localhost:8000/api/v1` (dev). All JSON. Money is in **halalas** (integer, 1 SAR = 100 halalas) in the API; the UI formats as SAR.

## Auth

Two kinds of callers:

- **Humans** (business owner / finance): `Authorization: Bearer <jwt>` from `/auth/login`.
- **AI employees (agents)**: `X-Agent-Key: flk_...` issued when an agent is created. Agents can only call the `/agent/*` endpoints. They can never approve anything.

### POST /auth/register
```json
{ "company_name": "Nawah Tech", "email": "owner@nawah.sa", "password": "secret123", "full_name": "Sara" }
```
→ `201 { "access_token": "...", "token_type": "bearer", "user": {...}, "company": {...} }`

### POST /auth/login
```json
{ "email": "demo@flaire.sa", "password": "demo1234" }
```
→ `200 { "access_token", "token_type", "user", "company" }`

### GET /auth/me → `{ user, company }`

## Company / settings

### GET /company → `{ id, name, currency: "SAR", kill_switch: bool, engine: "native"|"shotoku", created_at }`
### PATCH /company `{ name?, engine? }`
### POST /company/kill-switch `{ "enabled": true, "reason": "Suspicious activity" }` → company
Kill switch ON = every new agent purchase request is **denied** instantly, pending approvals are frozen (cannot be approved until it is lifted).

## Departments (budgets)

Department object:
```json
{ "id": 1, "name": "Marketing", "monthly_budget": 500000, "spent_this_period": 50000,
  "remaining": 450000, "period_start": "2026-10-01", "agent_count": 1 }
```
- GET /departments
- POST /departments `{ name, monthly_budget }`
- PATCH /departments/{id} `{ name?, monthly_budget? }`
- DELETE /departments/{id}

## Agents (AI employees)

Agent object:
```json
{ "id": 1, "name": "Marketing AI", "role": "marketing", "department_id": 1, "department_name": "Marketing",
  "status": "active" | "paused",
  "per_transaction_limit": 100000, "monthly_limit": 300000, "spent_this_period": 50000,
  "approval_threshold": 100000,
  "allowed_categories": ["advertising","software"],
  "blocked_merchants": ["Gift card"],
  "max_requests_per_hour": 10,
  "key_prefix": "flk_a1b2", "last_active_at": "...", "created_at": "..." }
```
- GET /agents
- POST /agents `{ name, role, department_id, per_transaction_limit, monthly_limit, approval_threshold, allowed_categories, blocked_merchants, max_requests_per_hour }` → `201 { agent, api_key }` (**api_key shown once**)
- GET /agents/{id}
- PATCH /agents/{id} (any field above, plus `status`)
- POST /agents/{id}/rotate-key → `{ api_key }`
- DELETE /agents/{id}
- POST /agents/{id}/run `{ "task": "Set up a Google Ads campaign for the Ramadan launch, budget around SAR 500" }`
  → `200 { "run_id": 7, "mode": "claude" | "scripted", "transcript": [ {role, content} ... ], "purchase_requests": [ PurchaseRequest... ] }`
  Runs a real Claude agent (when `ANTHROPIC_API_KEY` is set) that can call the `request_purchase` tool. `mode: "scripted"` means no key was configured and a deterministic plan ran instead.
- GET /agents/{id}/runs → list of runs

## Agent-facing endpoints (X-Agent-Key)

### GET /agent/me → agent object + `{ department: {...}, kill_switch }`
### POST /agent/purchase-requests
```json
{ "amount": 50000, "merchant": "Google Ads", "category": "advertising",
  "description": "Ramadan launch campaign", "card_id": null }
```
→ `201 PurchaseRequest`. Note the agent gets a decision but can never override it.

PurchaseRequest object:
```json
{ "id": 12, "agent_id": 1, "agent_name": "Marketing AI", "department_id": 1, "department_name": "Marketing",
  "amount": 50000, "currency": "SAR", "merchant": "Google Ads", "category": "advertising",
  "description": "...",
  "status": "approved" | "pending_approval" | "denied" | "completed" | "failed" | "rejected",
  "decision": {
     "verdict": "approved" | "denied" | "pending_approval",
     "engine": "native" | "shotoku",
     "reasons": ["Within per-transaction limit (SAR 1,000)", "Department budget OK (SAR 4,500 remaining)"],
     "rule_id": "marketing-ads",
     "receipt": "fl_rcpt_..."  (signed, only when approved)
  },
  "transaction_id": 9 | null,
  "approved_by": null | { id, full_name },
  "created_at": "...", "decided_at": "..."
}
```
### GET /agent/purchase-requests → the agent's own requests
### GET /agent/purchase-requests/{id}

## Purchases, approvals, transactions (human)

- GET /purchase-requests?status=&agent_id=&limit= → list
- GET /purchase-requests/{id}
- GET /approvals → pending_approval requests
- POST /approvals/{id}/approve `{ note? }` → request (status becomes `completed` after payment, or `failed`)
- POST /approvals/{id}/reject `{ note? }` → request (`rejected`)

Transaction object:
```json
{ "id": 9, "purchase_request_id": 12, "card_id": 1, "card_label": "SNB Business •••• 4471",
  "provider": "mock_snb" | "lithic", "provider_ref": "snb_auth_...",
  "amount": 50000, "currency": "SAR", "merchant": "Google Ads",
  "status": "authorized" | "settled" | "declined" | "reversed",
  "decline_reason": null, "created_at": "..." }
```
- GET /transactions?limit=&card_id=
- GET /transactions/{id}

## Cards (simulated)

Card object:
```json
{ "id": 1, "label": "SNB Business", "provider": "mock_snb" | "mock_rajhi" | "mock_riyad" | "lithic",
  "last4": "4471", "currency": "SAR", "available_balance": 1000000, "credit_limit": 1000000,
  "status": "active" | "frozen", "is_default": true, "department_id": null }
```
- GET /cards
- POST /cards `{ label, provider, last4?, credit_limit, department_id?, is_default? }` (for `lithic`, backend creates a sandbox card and stores its token)
- PATCH /cards/{id} `{ status?, is_default?, label? }`
- POST /cards/{id}/top-up `{ amount }` (mock providers only)

## Dashboard

### GET /dashboard/summary
```json
{ "company": {...}, "kill_switch": false,
  "totals": { "spent_this_period": 50000, "budget_total": 1500000, "pending_count": 1, "blocked_count": 1, "agent_count": 3, "card_count": 2 },
  "departments": [ Department... ],
  "agents": [ Agent... ],
  "recent_requests": [ PurchaseRequest... (last 10) ],
  "recent_transactions": [ Transaction... (last 10) ],
  "spend_by_day": [ { "date": "2026-10-25", "amount": 120000 } ... ]  (last 14 days)
}
```

## Audit

- GET /audit?limit= → `[ { id, ts, actor_type: "user"|"agent"|"system", actor_id, actor_name, event, details: {...}, prev_hash, hash } ]` hash-chained ledger.
- GET /audit/verify → `{ ok: true, entries: 42 }` or `{ ok: false, broken_at: 17 }`

## Health
- GET /health → `{ status: "ok", engine: "native", payments: ["mock_snb", "lithic"], claude: true|false }`

## Errors
`{ "detail": "message" }` with 400/401/403/404/409/422.

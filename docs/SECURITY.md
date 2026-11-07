# Flaire security model

Principle: the AI explains and requests. The server decides. Money moves only on a server-issued, signed, single-use receipt.

## Implemented and tested (backend/tests/test_flaire.py, 21 tests)

| Control | Where | Test |
|---|---|---|
| Agent keys hashed (SHA-256), shown once, rotatable, optional expiry | core/security.py, api/routes.py | test_key_expiry |
| Connector sign-in: OAuth 2.1, PKCE S256 required, single-use 10 min codes, hashed 90-day tokens bound to one agent, revocable from Settings, redirect URIs validated | api/oauth.py | test_oauth_connector_sign_in_flow |
| Payment provider keys stored encrypted per company (Fernet), write-only in the API | core/crypto.py | test_company_lithic_key_and_notify_threshold |
| Agent keys cannot reach any human endpoint (approvals, limits, cards, kill switch) | security.get_current_user vs get_current_agent | test_agent_key_cannot_reach_human_routes |
| Rate limit 60/min per agent key on /agent/* and /mcp/*; 10 logins per 15 min per IP | core/guard.py | test_bad_key_lockout_and_rate_limit |
| Bad-key lockout: 8 wrong keys from one IP locks it for 15 min | core/guard.py | same |
| Two-factor authentication (TOTP) per user; company policy can require it for all approvers; connector sign-in and login both enforce it | api/auth_extra.py, api/oauth.py | test_password_reset_change_and_2fa |
| Password reset by emailed single-use token (1 h, hashed); reset revokes every connected Claude for that user | api/auth_extra.py | test_password_reset_change_and_2fa |
| Password re-entry on every approve/reject | services.resolve_approval | test_needs_approval_then_approve |
| Two-person rule at/above company threshold (default SAR 2,500), different humans only | services.resolve_approval | test_two_person_rule |
| Rules re-evaluated at approval time (budget, kill switch) | engine.approve | test_kill_switch |
| Kill switch: denies new requests, freezes approvals, pauses every card (Lithic PAUSED), restores on lift | services.set_kill_switch | test_kill_switch_freezes_cards_and_restores |
| Duplicate purchase (same agent, merchant, amount within 10 min) goes to a human | native_engine | test_duplicate_purchase_goes_to_human |
| Supplier policy: trusted suppliers skip category checks; first payment to a new supplier at/above a review amount waits for a human | native_engine, Settings | test_trusted_and_new_merchant_policy |
| Budget and card rows locked during payment (SELECT FOR UPDATE on Postgres) | services.execute_payment | milestone test on SQLite; lock is Postgres-only |
| Signed receipts bound to agent + merchant + amount, 5 min TTL, constant-time compare | integrations/shotoku/receipts.py | test_bad_key_and_tampered_receipt |
| Hash-chained audit ledger with verify endpoint; records source and caller IP for agent requests | core/audit.py | test_audit_chain_intact |
| Lithic webhooks: Standard Webhooks HMAC-SHA256 over raw body, 5 min window, duplicate-id protection | api/webhooks.py | test_lithic_webhook_signature_and_dedupe |
| No card number storage (Lithic token only; PAN fetched at use and discarded) | integrations/payments/lithic.py | by construction |
| Idempotency-Key on Lithic card creation | lithic.create_card | by construction |
| Security headers (nosniff, DENY frames, no-referrer, no-store, HSTS on https) | core/guard.py | test_security_headers |
| Roles: only owner and finance can approve or change settings | security.require_approver | by construction |
| Secrets from environment only; Render generates JWT and receipt secrets | render.yaml | by construction |

## Connector links

A connector link is a credential. Treat it like a password: one link per recipient (create one AI employee per
person or system), set an expiry when you create it, never paste it in public documents or screenshots, rotate
to revoke. Everyone using a link acts within that agent's limits and nothing more.

## Recommended setup for a company

1. One Flaire company per business. Owners and finance approve; everyone else is a viewer.
2. Every person connects their own Claude with **Sign in now** and **Use Claude's published identity**. No shared links. The ledger then shows which person's Claude did what.
3. Settings → Security: turn on **Require 2FA for everyone who can approve**.
4. Keep the two-person rule for large amounts, department budgets, and the notification threshold tuned to what matters.
5. Revoke a connection the moment someone leaves (Settings → Connected Claudes). Changing a password also revokes that person's connections.

Roadmap for enterprise: SSO (Google Workspace, Microsoft Entra) via OIDC, SCIM user provisioning, MFA to lift the kill switch, IP allowlists.

## Not implemented (production list)

- SSO / SCIM; MFA to lift the kill switch
- Field-level encryption and backup/restore drills
- Anomaly alerting (denied-request spikes, new merchants, approval bursts) and admin notifications
- Full Lithic lifecycle reconciliation (refunds, disputes, force-post clearing) and daily reconciliation jobs
- Distributed rate limiting (current limiter is per process)
- Real SAR currency handling on the card rail (sandbox maps halalas to cents 1:1)
- Any real money. Real Saudi payment services need a licensed partner and SAMA compliance.

## Policy versioning and change approval (four-eyes on the rules)

Every purchase decision is judged against a numbered, hashed snapshot of the company's spending policy: security
settings (two-person threshold, password on approve, trusted suppliers, new-supplier review amount, notification
threshold, 2FA for approvers, fee rate, kill switch), every department's budget and pause state, every AI employee's
limits, categories, blocked merchants and rate limits, and every active approval rule. The request stores
`policy_version_id` and the decision carries `policy_version`, so an auditor can answer "which rules allowed this"
months later. A change that leaves the policy identical does not create a new version (same sha256, same version).

Endpoints: `GET /policy/versions`, `GET /policy/versions/{id}` (snapshot), `GET /policy/diff?from=&to=` (field-level
diff), `GET /policy/changes?status=`, `POST /policy/changes/{id}/approve|reject|cancel`.

With **Settings → Security → Require a second admin for policy changes** (`require_change_approval`) on, a change to
limits or rules is split by direction:

| Direction | Examples | What happens |
|---|---|---|
| Tightening (reduces risk) | lowering a per-transaction, monthly or department limit; pausing an AI employee or department; adding a blocked merchant; narrowing allowed categories; removing a trusted supplier; lowering the two-person or notification threshold; lowering the new-supplier review amount; turning a security check on; lowering an approval rule's minimum amount or adding steps to it | applies immediately, new policy version, audit `policy.change_applied` |
| Loosening (lets more money move) | raising any limit, budget or rate limit; resuming a paused employee or department; removing a blocked merchant; widening allowed categories; adding a trusted supplier; raising the two-person, notification or new-supplier review amount; turning a security check off; raising an approval rule's minimum amount, reducing its steps or deactivating it; turning change approval itself off | `202 {"pending_change_id", "message": "Needs a second admin"}`; nothing applied until a different owner or admin approves it (password re-entry when the company requires it); then applied, new policy version, audit `policy.change_approved` |

The rule in one line: an attacker who has one admin account can only make the company safer; anything that opens the
tap needs a second pair of eyes. Turning change approval off is treated as loosening while it is on, otherwise the
control would be a one-line bypass. Turning it on applies immediately. The proposer cannot approve their own change,
pending changes are re-checked against current values at approval time (stale proposals are refused), and every
proposal, approval, rejection and cancellation lands in the hash-chained audit ledger. The kill switch and every
directly applied change also bump the policy version with a human summary such as
`Marketing AI monthly limit 400,000 -> 600,000 by Sara`.

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

## Not implemented (production list)

- MFA for dashboard users and MFA to lift the kill switch
- Field-level encryption and backup/restore drills
- Anomaly alerting (denied-request spikes, new merchants, approval bursts) and admin notifications
- Full Lithic lifecycle reconciliation (refunds, disputes, force-post clearing) and daily reconciliation jobs
- Distributed rate limiting (current limiter is per process)
- Real SAR currency handling on the card rail (sandbox maps halalas to cents 1:1)
- Any real money. Real Saudi payment services need a licensed partner and SAMA compliance.

# Flaire threat model

Scope: the Flaire API, dashboard, AI connector, card issuer integration and the humans who approve. Method: STRIDE per trust boundary, with the control that exists today and the test that proves it. Items marked Gap are open.

## Assets

1. Money on the company's cards (one virtual card per AI employee).
2. Spending policy (limits, thresholds, trusted suppliers, approval chains).
3. Approval authority (who can say yes).
4. Audit ledger integrity.
5. Secrets: issuer API key, ASA secret, TOTP seeds, JWT and receipt secrets.
6. Personal data: names, emails, roles, receipts.

## Trust boundaries

```
 AI client (Claude, script)  --B1-->  Flaire API  --B2-->  Postgres
                                         |  \
 Dashboard user (browser)    --B3-->      |   --B4--> Lithic (issuer, ASA callbacks --B5-->)
                                         |
 Supabase Auth               --B6-->      |
 Anthropic API               <--B7--      |
```

## Threats and controls

### B1: AI client to API

| Threat | Control | Evidence |
|---|---|---|
| Stolen agent key or connector token used to spend | Key hashed at rest, optional expiry, 90 day OAuth tokens revocable, rate limit 60/min, bad-key lockout | test_key_expiry, test_bad_key_lockout_and_rate_limit |
| Prompt-injected agent tries to approve or raise limits | Agent credentials cannot reach any human endpoint; approvals need a user token plus password | test_agent_key_cannot_reach_human_routes |
| Agent splits a purchase to stay under a limit | Duplicate and velocity checks, per-day request cap, split detection on merchant within window, new supplier review | test_duplicate_purchase_goes_to_human, abuse suite |
| Agent relabels category to pass the allow list | Server-side categorization of merchant overrides the agent's label when known; unknown merchants go to review above threshold | core/categorize.py, test_trusted_and_new_merchant_policy |
| Replayed approval receipt | Receipt bound to agent, merchant, amount, 5 min TTL, single use | test_bad_key_and_tampered_receipt |
| Flooding to exhaust budget review capacity | Rate limits, per employee hourly and daily caps, kill switch | guard.py |

### B3: Dashboard user to API

| Threat | Control | Evidence |
|---|---|---|
| Session theft used to approve | Password re-entry on every approval; optional mandatory TOTP; two-person rule and approval chains above thresholds | test_needs_approval_then_approve, test_two_person_rule, test_team |
| Insider loosens limits then spends | Policy versioning; change approval by a second admin for any loosening; every decision stamped with policy version | test_policy |
| Insider removes the only owner or escalates self | Last owner protected; users cannot change their own role | test_team |
| Viewer reads other departments | Department scoping via Membership | test_team |
| XSS or clickjacking | Security headers, React escaping, API no-store | test_security_headers |
| CSRF | Bearer tokens only, no cookies | by construction |

### B2: API to database

| Threat | Control | Evidence |
|---|---|---|
| Tampering with the ledger | Hash chain with verify endpoint; backups verified by replaying the chain | test_audit_chain_intact, ops/backup.py verify |
| Race between two approvals or double payment | Row locks on budget and card (Postgres SELECT FOR UPDATE); status set and committed before issuer call | services.execute_payment |
| Secrets read from a database dump | Per-company secrets Fernet encrypted; dump encrypted before upload | core/crypto.py, ops/backup.py |
| SQL injection | ORM with bound parameters | by construction |

### B4 and B5: Issuer integration

| Threat | Control | Evidence |
|---|---|---|
| Card used outside Flaire (leaked PAN) | ASA: issuer asks Flaire before every transaction; approved only if a matching, unconsumed Flaire approval exists within 10 min | test_asa |
| Forged ASA or webhook call | Standard Webhooks HMAC over raw body, timestamp window, idempotent event ids | test_lithic_webhook_signature_and_dedupe |
| Issuer key leak | Stored encrypted, write-only API, rotatable in Settings | test_company_lithic_key_and_notify_threshold |
| Card creation retried into duplicates | Idempotency-Key on card creation | lithic.create_card |
| Kill switch bypass | Kill switch pauses every card at the issuer, not only in Flaire | test_kill_switch_freezes_cards_and_restores |

### B6: Identity provider

| Threat | Control | Evidence |
|---|---|---|
| Forged Supabase JWT | ES256 verified against JWKS, audience and expiry checked | core/supabase.py |
| Account takeover via password reset | Single-use hashed token, one hour, resets revoke connected AI clients | test_password_reset_change_and_2fa |
| Invite token leak | Hashed, 7 day expiry, bound to email, single acceptance | test_team |

### B7: Anthropic API

| Threat | Control | Evidence |
|---|---|---|
| Assistant approves on its own | Assistant only returns a prepared action; approval endpoint requires a human password | test_assistant |
| Data leakage to the model | Only the company's own records are placed in context; no cross-company data; API terms exclude training | chat.py |
| Model outage | Scripted fallback mode keeps the product usable | chat.py |

## Gaps (open)

1. Rate limiter is per process; multi-instance deployments need a shared store (Redis).
2. No third-party penetration test yet.
3. Data residency outside KSA.
4. No anomaly detection beyond velocity caps (for example, a sudden change in merchant mix).
5. MFA is not required to lift the kill switch (planned: require TOTP to restore).
6. Receipt attachments stored in Postgres; move to object storage with virus scanning before large customers.

## Abuse test suite

`backend/tests/test_abuse.py` exercises: splitting one purchase into several under the limit, relabeling a known advertising merchant as "services", replaying a receipt, hammering the connector past the hourly cap, an agent calling human endpoints, a viewer calling approve, a department head approving another department, a proposer approving their own policy change.

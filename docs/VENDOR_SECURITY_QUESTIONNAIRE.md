# Flaire vendor security questionnaire (answers from the codebase)

Prepared for procurement and IT security reviews. Every answer below points to the code or configuration that makes it true. Items marked **Planned** are not in place yet and should be read as such; do not present them as done.

Last reviewed: November 2026. Product: Flaire, the finance department for AI employees. Hosting at review time: API on Render (US), database on Render Postgres (US), web app on Vercel (global CDN), identity on Supabase (ap-south-1). See section 9 for the KSA hosting plan.

## 1. Company and product

| Question | Answer |
|---|---|
| What does the product do? | AI agents (Claude or any MCP client, or scripts with a key) ask Flaire for permission to buy. Flaire evaluates the request against company policy, pays with a virtual card it controls, and routes anything above thresholds to named humans. Everything is logged in a hash-chained ledger. |
| What data do you process? | Company name, user names and emails, roles, spending policy, purchase requests (merchant, amount, reason), transaction records, receipts uploaded by users, Lithic card tokens, audit logs. |
| Do you store card numbers? | No. Lithic holds the PAN. Flaire stores a card token and last four digits only. The PAN is fetched at the moment of payment and discarded (`backend/app/integrations/payments/lithic.py`). |
| Do you move money? | Flaire instructs the card issuer (Lithic) to authorize a payment. Funds sit with the issuer, not Flaire. Flaire never holds client money. |
| Sub-processors | Lithic (card issuing), Supabase (identity), Render (compute, Postgres), Vercel (static web), Anthropic (AI assistant and employee chat, only when the company enables real AI mode), SMTP provider of the company's choice (email), Web Push via the browser vendor (Apple, Google, Mozilla). |

## 2. Identity and access

| Question | Answer |
|---|---|
| Authentication | Supabase Auth (email and password, Google; Microsoft Entra via OIDC is a configuration switch in Supabase). Tokens are ES256 JWTs verified against Supabase JWKS (`backend/app/core/supabase.py`). Built-in password auth with bcrypt exists for self-hosted installs. |
| MFA | TOTP per user (`backend/app/api/auth_extra.py`). Company policy can require MFA for everyone who can approve (`Company.require_2fa_for_approvers`). |
| Password policy | Minimum 8 characters, bcrypt hashed, reset by single-use emailed token valid one hour. Password change revokes every connected AI client for that user. |
| Roles | owner, admin, finance, dept_head, viewer, auditor (`backend/app/models.py` ROLES). Department heads are scoped to their departments. Auditors are read-only including the ledger. Last owner cannot be removed or demoted. |
| Least privilege for AI | An AI employee's credential can only call four tools: check budget, request purchase, get status, list own requests. It cannot approve, change limits, see card details, or read other employees' data (`backend/app/api/mcp.py`, `get_current_agent` vs `get_current_user`). |
| Session and token lifetime | Dashboard JWT 12 hours. AI connector tokens 90 days, hashed at rest, revocable from Settings. Raw agent keys can be given an expiry. |
| Rate limiting and lockout | 60 requests per minute per AI key, 10 logins per 15 minutes per IP, 8 bad keys from one IP locks it for 15 minutes (`backend/app/core/guard.py`). Per employee: max requests per hour and per day. |
| SSO / SCIM | SSO via Supabase OIDC providers (Google live, Microsoft Entra configurable). SCIM: **Planned**. |

## 3. Authorization of spend

| Question | Answer |
|---|---|
| Who decides a purchase? | A server-side rules engine, never the AI. Verdicts: approved, denied, pending human. Default is pending; unknown conditions fail closed (`backend/app/integrations/shotoku/native_engine.py`). |
| What is checked? | Agent active and credential valid, kill switch, blocked merchants, allowed categories or trusted supplier, per-purchase limit, monthly limit per employee, department budget, first payment to a new supplier above a review amount, duplicate within 30 days, approval threshold, velocity. |
| Human approval | Password re-entry on every approval. Approval chains by amount and department (for example department head, then two finance approvers). Two-person rule above a threshold. Delegation while out of office is explicit and logged as "on behalf of". |
| Can rules be changed silently? | No. Every policy state is versioned and hashed; every decision records the policy version it was judged under. With change approval on, any loosening of a limit needs a second admin with password. Tightening applies immediately (`backend/app/policy.py`). |
| Real-time card control | With Lithic ASA enrolled, the issuer asks Flaire before every card transaction. Flaire only approves if it approved a matching purchase for that card and amount in the last 10 minutes and that approval has not been used (`backend/app/api/asa.py`). A leaked card cannot be used outside Flaire. |
| Kill switch | One action pauses every card at the issuer, denies new requests and freezes approvals. Restoring is logged. Available on phone. |

## 4. Data protection

| Question | Answer |
|---|---|
| Encryption in transit | TLS 1.2+ everywhere (Render, Vercel, Supabase, Lithic). HSTS set by the API on https. |
| Encryption at rest | Postgres disk encryption by the host. Per-company secrets (Lithic key, ASA secret, TOTP seeds) are additionally encrypted with Fernet under `APP_ENCRYPTION_KEY` (`backend/app/core/crypto.py`). Backups are gzip and optionally Fernet encrypted before upload (`backend/ops/backup.py`). |
| Secrets management | Environment variables on the host, never in the repo. Generated secrets on first deploy. **Planned**: move to a managed vault (AWS Secrets Manager) with the KSA hosting. |
| Data residency | Today US (Render, Vercel) and India (Supabase). **Planned**: AWS me-south-1 (Bahrain) or a KSA region for API, Postgres and identity; Vercel remains a CDN for static files only, no personal data. |
| Retention | Audit ledger is append-only and kept for the life of the company. Transactions kept indefinitely for accounting. Receipts kept until the company deletes them or the account. Backups 35 days. |
| Deletion | Self-service account deletion wipes the company (employees, cards, requests, ledger) when the last owner deletes (`backend/app/api/account.py`). Supabase identity deleted via service role. |
| Logging | Structured JSON logs with request id, no request bodies, Authorization headers never logged (`backend/app/core/logging.py`). |

## 5. Application security

| Question | Answer |
|---|---|
| Input validation | Pydantic v2 schemas on every endpoint. Amounts are integers in halalas. |
| Injection | SQLAlchemy ORM with bound parameters throughout. No string-built SQL on user input. |
| Security headers | nosniff, X-Frame-Options DENY, no-referrer, Cache-Control no-store on API, HSTS (`backend/app/core/guard.py`). |
| CORS | Explicit allow list from configuration. |
| Webhooks | Lithic webhooks verified with Standard Webhooks HMAC-SHA256 over the raw body, 5 minute timestamp window, duplicate event ids ignored (`backend/app/api/webhooks.py`). |
| Signed receipts | Every approved purchase carries an HMAC receipt bound to agent, merchant, amount, 5 minute TTL. Payment refuses without a valid receipt. |
| Dependency management | Pinned Python and npm dependencies, GitHub CI runs the test suite on every push (`.github/workflows/ci.yml`). **Planned**: Dependabot and SCA scanning in CI. |
| Testing | 31 core tests plus team, finance and policy suites covering authorization, approvals, lockouts, webhook verification, chain integrity, abuse cases (split purchases, relabeling, replay). |
| Penetration testing | **Planned**: third-party test before first enterprise customer. Internal threat model in `docs/THREAT_MODEL.md`. |

## 6. Audit and compliance

| Question | Answer |
|---|---|
| Audit trail | Hash-chained ledger: every entry stores the previous hash; a verify endpoint detects tampering (`backend/app/core/audit.py`). Records actor (person, AI employee or system), source and caller IP. |
| Exportable | Audit JSON and CSV, transactions CSV, SAP and Oracle journal formats, period statements. |
| Financial controls | Month-end close locks a period and stores a signed statement snapshot; reopen is owner-only and logged. VAT (15%) recorded on each transaction. Flaire fee invoices are ZATCA simplified format with QR. |
| Certifications | None yet. **Planned**: ISO 27001 readiness in year one; SOC 2 Type I after. |
| PDPL (Saudi data protection) | Data map in this document. Consent at sign-up, deletion on request, breach notification process in `docs/INCIDENT_RESPONSE.md`. Residency gap noted above. |

## 7. Availability and operations

| Question | Answer |
|---|---|
| Hosting tier | Review-time deployment is on free tiers for demonstration. Production tier: paid Render or AWS with autoscaling, managed Postgres with point-in-time recovery. |
| Backups | Nightly encrypted dump to S3-compatible storage, 35 day retention, scripted restore and automated verify that replays the audit chain (`backend/ops/backup.py`). |
| Monitoring | `/api/v1/health` reports database, engine, auth mode. Structured logs for any log platform. **Planned**: uptime monitor and alerting to on-call. |
| RTO / RPO | Target RPO 24 hours (nightly) today, 5 minutes with managed Postgres PITR. Target RTO 4 hours. |
| Incident response | `docs/INCIDENT_RESPONSE.md`. Customers notified within 72 hours of a confirmed breach affecting their data. |

## 8. AI-specific

| Question | Answer |
|---|---|
| Can the AI be tricked into spending? | The AI only asks; the server decides. Prompt injection on the agent cannot raise limits, approve, or move money. Split purchases, category relabeling and replayed receipts are blocked and tested. |
| Does Flaire train on our data? | No. Anthropic API usage is under the API terms (no training on API data). The assistant sees only the company's own records. |
| Can the assistant approve? | No. It prepares an approval; a human confirms with their password. |
| Model provider | Anthropic Claude via API. Optional; without a key the product runs in a scripted mode with no external AI calls. |

## 9. Roadmap items a large enterprise should expect before go-live

1. KSA or GCC hosting for API, database and identity.
2. SAR card program through a SAMA-licensed issuing partner (today: Lithic USD, sandbox then production after KYB).
3. Third-party penetration test and remediation report.
4. SCIM provisioning and Microsoft Entra SSO configured for the customer tenant.
5. Managed secrets vault, uptime monitoring and on-call rota.
6. ISO 27001 readiness assessment.

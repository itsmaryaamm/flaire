# Flaire

**The finance department for AI employees.**

Businesses give AI agents permission to make purchases without giving them unrestricted access to company money.
A real Claude AI employee asks to buy something, Flaire checks identity, budgets, permissions, limits and approval rules, a simulated Saudi bank (or the Lithic sandbox) processes the payment, and the business dashboard updates immediately.

> Simulation only. No real bank accounts, no real money, no real cards. See "What we are not building yet".

```
Claude AI employee ──request SAR 500──▶ Flaire backend ──▶ Authorization engine ──▶ allow / review / deny
                                                                  (native or Shotoku)
                                             │
                                             ▼ only valid, receipt-signed authorizations
                                      Flaire payment service ──▶ Mock Saudi banks (SAR) / Lithic sandbox
                                             │
                                             ▼
                                      Dashboard: budgets, approvals, transactions, kill switch, audit ledger
```

## Run it locally (5 minutes)

**Backend** (Python 3.11+)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # optional: add ANTHROPIC_API_KEY for real Claude agents
python seed.py                                         # demo company + 3 AI employees + 2 simulated cards
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs

**Frontend** (Node 20+)
```bash
cd frontend
npm install
npm run dev                                            # http://localhost:5173
```
Login: `demo@flaire.sa` / `demo1234`

**Tests**
```bash
cd backend && python -m pytest -q                      # 12 end-to-end tests: milestone flow, every rule, bypass attempts, audit chain
```

### The first milestone, in one go
1. Login, open **AI employees → Marketing AI**.
2. Give it the task: *"Set up a Google Ads campaign for the Ramadan launch, budget around SAR 500"*.
3. The agent calls `check_budget`, then `request_purchase`. Flaire approves (below the SAR 1,000 approval threshold), issues a signed receipt, the mock SNB card is debited SAR 500, and the dashboard shows the settled transaction.
4. Try *"Buy campaign tools for SAR 1,800"* → blocked (per-transaction limit SAR 1,000). Try SAR 1,000 exactly → **Needs approval** → approve it in **Approvals**. Try *"Buy SAR 4,950 of gift cards"* → **Blocked** (company-wide fraud category).
5. Flip the **kill switch** on the dashboard. Every new request is denied instantly and approvals freeze.

Without `ANTHROPIC_API_KEY` the agent runs a deterministic "scripted" plan through the same pipeline, so the demo always works. With the key set, a real Claude model plans and calls the tools.

## Use Flaire from anyone's Claude (MCP connector)

Every AI employee has a shareable connector link: `https://<your-api>/api/v1/mcp/<agent_key>`.

1. In the dashboard open an AI employee and click **Get connect link** (or copy it from the key-issued dialog when you create one).
2. Send the link to anyone. In Claude they go to **Settings → Connectors → Add custom connector**, paste the link, done.
3. Their Claude now has four tools: `check_budget`, `request_purchase`, `get_purchase_status`, `list_my_requests`. When they ask it to buy something, the request shows up in your dashboard with Flaire's decision. There is no approve tool, so a human in the dashboard stays in control. Rotate the key to revoke the link instantly.

The endpoint speaks MCP Streamable HTTP (JSON responses, stateless), implemented in `backend/app/api/mcp.py`, so it also works with Claude Desktop, Claude Code (`claude mcp add --transport http flaire <link>`) and any other MCP client. The backend must be deployed (Render) for links to work outside your laptop.

## Keeping it fast on every device

Render's free tier sleeps after 15 minutes idle and takes up to a minute to wake. Two things handle that:
- The login page wakes the server automatically and shows "Waking up the server" instead of an error.
- `.github/workflows/keepalive.yml` pings the API every 10 minutes once the repo is on GitHub (Actions must be enabled). Any free uptime pinger (UptimeRobot, cron-job.org) hitting `/api/v1/health` every 10 minutes does the same job.

## Flaire on your phone

The dashboard is a responsive web app and installable: on iPhone open it in Safari, Share, Add to Home Screen; on Android Chrome choose Install app. Settings → "Flaire on your phone" turns on push notifications, so approvers get "Approval needed: SAR 3,000 at Jarir" on their phone, tap it, and land on the Approvals page. Approval emails (SMTP in `.env`) carry the same link. Push keys are generated automatically on first boot.

## What's in the box

| Piece | Where | Status |
|---|---|---|
| A. Business dashboard (agents, budgets, cards, approvals, transactions, kill switch, audit) | `frontend/` | built |
| B. Real Claude AI employees (Marketing, Procurement, Operations) with `check_budget` and `request_purchase` tools, no self-approval possible. Also exposed as an MCP connector so anyone's Claude can be an employee | `backend/app/agents/runner.py`, `backend/app/api/mcp.py` | built |
| C. Spending authorization engine, Shotoku evaluated and integrated | `backend/app/integrations/shotoku/` | built, two engines |
| D. Mock Saudi banks (SNB, Al Rajhi, Riyad Bank) with SAR balances | `backend/app/integrations/payments/mock_bank.py` | built, primary demo rail |
| E. Lithic sandbox adapter (virtual cards, simulated authorization + clearing) | `backend/app/integrations/payments/lithic.py` | built, needs a sandbox key |
| F. GitHub repo, CI, Render + Vercel deployment | `render.yaml`, `frontend/vercel.json`, `.github/workflows/ci.yml` | ready |

## Shotoku: what we reuse and what we built

[Shotoku](https://github.com/shotoku-dev/shotoku) (MIT) is a TypeScript spend-control library. Flaire's backend is Python, so the integration is isolated in `backend/app/integrations/shotoku/` behind one interface (`interface.py`) and can be swapped without touching the rest of Flaire:

| Engine | How | When to use |
|---|---|---|
| `native` (default) | Python port of Shotoku's policy model: three verdicts, default `pending_approval`, fail closed, reasons on every check, receipts in Shotoku's exact `rcpt.<payload>.<hmac>` format, hash-chained ledger | zero setup, demos, tests |
| `shotoku` | The real `@shotoku/core` package running in a 60-line Node sidecar (`service/server.mjs`) exposing `/authorize`, `/approve`, `/deny`. Flaire runs its business pre-checks, then Shotoku evaluates the spending policy, writes its own ledger and signs the receipt | showing genuine reuse, comparing engines |

Division of responsibility, exactly as planned: Shotoku decides whether an agent is allowed to act (policy, limits, ledger, receipts). Flaire manages the company's AI finances (identity, departments, budgets, approvals UI, cards, payment execution, reporting, kill switch).

Receipts are cross-verified: a receipt minted by Shotoku's Node core verifies in Flaire's Python payment service with the same shared secret, and the payment service refuses to move money without a valid, unexpired receipt that matches the exact agent, merchant and amount.

To run the Shotoku engine:
```bash
cd backend/app/integrations/shotoku/service && npm install && npm start     # sidecar on :8788
# then in Settings → Authorization engine → Shotoku, or AUTH_ENGINE=shotoku in .env
```
License notices: `backend/app/integrations/shotoku/NOTICE.md`.

## Architecture

```
backend/
  app/main.py                      FastAPI app, CORS, health
  app/api/routes.py                all endpoints (contract in docs/API.md)
  app/services.py                  purchase pipeline: request → authorize → verify receipt → pay → ledger
  app/models.py                    SQLAlchemy models (halalas everywhere)
  app/core/{config,db,security,audit}.py   settings, DB, JWT + agent keys (hashed), hash-chained audit
  app/integrations/shotoku/        authorization component (interface, native engine, Shotoku adapter, Node sidecar)
  app/integrations/payments/       payment adapters (mock Saudi banks, Lithic sandbox)
  app/agents/runner.py             Claude AI employees (tool use) + scripted fallback
  seed.py, tests/, agent_sdk_example.py
frontend/                          React + Vite + Tailwind dashboard
docs/API.md                        API contract
```

**Security model** (full table in `docs/SECURITY.md`)
- Humans use JWT. Agents use `X-Agent-Key` (stored hashed, shown once, rotatable). Agent keys only work on `/agent/*` routes: there is no endpoint an agent can call to approve, change a limit, or touch a card.
- The engine fails closed. A sidecar outage, a malformed policy or an internal error is a denial.
- Payment needs a signed receipt bound to agent + merchant + amount with a 5-minute TTL. A tampered or replayed receipt is rejected before any adapter is called.
- Managers are notified by email and phone push when a request needs approval. Approvals need password re-entry; amounts at or above the company's two-person threshold need two different humans.
- Kill switch denies all new requests, freezes approvals and pauses every card (Lithic cards are PAUSED at the issuer) until lifted.
- Rate limits and bad-key lockout on agent and connector endpoints; connector links can expire.
- Duplicate purchases go to a human. Budget rows are locked during payment.
- Lithic webhooks are signature-verified (Standard Webhooks HMAC) with duplicate protection. No card numbers are stored.
- Every event (request, decision, payment, approval, kill switch, key rotation) is appended to a hash-chained ledger; `GET /audit/verify` detects tampering.

## Deploy

- **Backend on Render**: New → Blueprint → this repo (`render.yaml` creates Postgres, the API and the Shotoku sidecar). Set `ANTHROPIC_API_KEY` and optionally `LITHIC_API_KEY` in the dashboard. Update `CORS_ORIGINS` with your Vercel URL. Run `python seed.py` once from the Render shell.
- **Frontend on Vercel**: import the repo, root directory `frontend`, env `VITE_API_URL=https://<your-render-service>.onrender.com/api/v1`.
- Dockerfiles are included for both the API and the sidecar if you prefer containers.

## What we are not building yet
No real Saudi bank connections, no real money movement, no real card issuance, no AI agents using real company credentials, no AI-driven financial optimization, no automatic supplier payments. Those need partnerships, security work and potentially regulatory review (SAMA).

## Order of work (done)
1. Foundation: repo, database, backend, secure auth
2. Core Flaire: companies, agents, budgets, policies, approval engine
3. First real agent: Claude requests a purchase through Flaire
4. Mock banks: simulated SAR card transactions with enforceable authorizations
5. Dashboard: controls, live transaction history, approvals
6. Lithic: sandbox adapter and simulated authorization events
7. Deployment and testing, including bypass attempts (bad keys, tampered receipts, kill switch, paused agents, over-limit, blocked categories)

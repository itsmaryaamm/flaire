# Shotoku evaluation (Oct 2026)

Repo: https://github.com/shotoku-dev/shotoku, MIT, TypeScript. Published package: `@shotoku/core` 0.2.2 (npm).

## What it gives us
- Policy model: YAML rules matched by actor/resource/action with `verdict`, `maxAmount`, `maxDailyAmount`, `defaultVerdict` (defaults to `pending_approval`).
- `authorize()` returns approved / denied / pending_approval with typed reasons and a plain-English explanation.
- `approve()` / `deny()` append approval entries to the ledger; originals are never mutated.
- Hash-chained JSONL ledger with snapshot verification.
- HMAC-SHA256 receipts (`rcpt.<payload>.<sig>`, 300s TTL) so downstream systems can verify an approval before executing.
- MCP server and an HTTP forward-proxy gateway (the gateway proxies agent traffic; it is not a REST authorize API).

## What it does not give us
- No Python SDK, no REST API for `authorize()`. Integration options were: subprocess around the CLI, an MCP client, or a small HTTP wrapper around `@shotoku/core`. We chose the HTTP wrapper (`backend/app/integrations/shotoku/service/server.mjs`, ~60 lines).
- Amounts are USD-oriented and per-transaction / rolling-24h only. No monthly budgets, no departments, no category or merchant restrictions, no company identity, no kill switch. Those stay in Flaire.
- Published 0.2.2 does not support the `overLimit: pending_approval` rule option that exists on `main`, so Flaire's approval threshold is enforced in Python before Shotoku runs.
- Very early project (single-digit stars at evaluation time). We keep it behind an interface so it can be replaced.

## Decision
Build Flaire's business logic ourselves and use Shotoku for policy evaluation, ledger and receipts through the sidecar when we want to demonstrate reuse. Ship the Python native engine as the default so the demo has zero extra setup. Both engines produce receipts in the same format and the same secret, verified by the same Python code before any payment.

## Where the code lives
```
backend/app/integrations/shotoku/
  interface.py        AuthorizationEngine protocol, request/decision dataclasses
  native_engine.py    Python port of the Shotoku model + Flaire business rules (default)
  shotoku_engine.py   HTTP adapter to the sidecar (pre-checks in Flaire, policy in Shotoku)
  receipts.py         Shotoku-compatible receipt create/verify
  service/            Node sidecar: package.json (@shotoku/core), server.mjs, Dockerfile
  NOTICE.md           MIT attribution
```

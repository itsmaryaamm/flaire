# Flaire

Spend controls for AI agents, built for Saudi Arabia. Runs on your own laptop. **Simulated SAR only, no real money.**

> Early version (v0.2). Not security audited, not SAMA reviewed, sandbox money only.

An agent asks Flaire before it spends. Flaire answers **allow**, **deny** or **review** (a human decides), with a clear
reason in English and Arabic. The owner can pause any agent, or all agents, instantly.

## Install (one line)

Needs Node.js 18 or newer (https://nodejs.org, the LTS button). Works on Windows, Mac and Linux.

```
npm install -g github:YOUR-USERNAME/flaire
flaire demo
```

No install, just look first: `npx github:YOUR-USERNAME/flaire demo`

Your data (policy, log, secret) lives in `~/.flaire` (on Windows: `C:\Users\you\.flaire`). Change it with the `FLAIRE_HOME` variable.

## Put Flaire in front of your agent

**Option 1: MCP (Claude Desktop, Cursor, any MCP agent).** Run `flaire mcp --print-config`, paste the block it prints into
your MCP client's config, and restart the client. Your agent now has the tool `authorize_action` and asks before it spends.
Tell the agent in its instructions: "Before any payment, call authorize_action. Only pay if it says allow."

**Option 2: any language, one line.** Flaire answers with an exit code: 0 allow, 2 needs the owner, 3 deny.

```
flaire authorize --agent my-agent --merchant jarir.com --amount 120 --json
```

Ready-made wrappers: `examples/guard.js` (Node) and `examples/guard.py` (Python):

```python
from guard import guard
r = guard("my-agent", "jarir.com", 120)
if r["allowed"]:
    pay()          # your own payment step
else:
    print(r["verdict"], r["reasons"])
```

**Fake money held by Lithic:** set `LITHIC_API_KEY` (a Lithic SANDBOX key) before running anything above, and every approved request charges a
Lithic sandbox card. See LITHIC.md.

**Owner controls:** `flaire serve` opens the dashboard at http://localhost:4747 (approve held requests, pause agents, Arabic and English).
`flaire pause` is the kill switch.

## Try it yourself

```
flaire agent add ops-agent --fund 2000
flaire authorize --agent ops-agent --merchant jarir.com --amount 120
flaire authorize --agent ops-agent --merchant shady-site.xyz --amount 4800
flaire status
flaire serve
```

(From a downloaded zip instead of the install, replace `flaire` with `node src/cli.js` inside the folder.)

## What it does

| Control | Where you set it |
|---|---|
| Per-transaction, daily and 30-day limits | `limits` in policy.json |
| Merchant rules: allow, deny, or review, with their own max amount and daily cap | `rules` |
| Anything not covered by a rule goes to the owner | `defaultVerdict` |
| Owner must approve anything above an amount | `reviewAbove` |
| Blocked merchants and categories | `blockedMerchants`, `blockedCategories` |
| Duplicate and retry protection (same request within 2 minutes, plus idempotency keys) | `duplicateWindowSeconds` |
| Government payments (`*.gov.sa`) always need the owner | rule `gov-fees` |
| Saudi working week (Sun to Thu, Riyadh time) | `schedule` (example in src/policy.js) |
| Kill switch: pause one agent or all, also kills outstanding receipts and held requests | `flaire pause` or the dashboard |

The policy file is `flaire-data/policy.json` (created on first run). Edit it, and changes apply on the next request.
`flaire policy check` validates it.

## Simulated money from Lithic (optional)

By default the fake money is just a number in a local file. To have a real card platform hold the fake money instead, connect the
**Lithic sandbox**: each agent gets a virtual card, Flaire approves first, and only then Lithic's sandbox charges the card. The kill switch
also pauses the card. Setup is in **LITHIC.md**. Quick version: `node src/cli.js lithic check`, then `node src/cli.js demo --lithic`.

## Built in

* **Money is exact.** Integer halalas, never decimals. USD converts at the 3.75 peg.
* **Fail toward a human.** Unknown merchant, over threshold, outside hours: the owner decides. Deny always beats review.
* **Re-checked at approval.** If you pause an agent or its budget runs out while a request waits, approving it still fails.
* **Signed receipts.** Each approval gives a 5 minute receipt tied to one agent, merchant and amount. Whatever executes
  the payment should verify it (`flaire receipt verify <token>`). Pausing the agent kills receipts already issued.
* **Tamper-evident log.** Every record contains the hash of the one before. `flaire verify` detects edits.
* **Look-alike protection.** `evil-jarir.com` and `jarir.com.evil.xyz` never match a `jarir.com` rule. Non-ASCII (homoglyph) domains are rejected.
* **MCP server** so any AI agent can ask Flaire before spending. Agents can only ask. Approving and the kill switch are owner-only.

## Connect an AI agent (MCP)

```
node src/cli.js mcp --print-config
```
Paste the printed block into your MCP client's config (for example Claude Desktop). Tools: `authorize_action`, `get_decision`,
`get_pending_approvals`, `get_balance`.

## Honest limits

* No real money, no bank, no card. An "allow" is a simulation decision, not a bank authorization.
* The kill switch stops future requests that go through Flaire. It cannot reverse a payment already made or stop an agent
  that never asks Flaire.
* This has not had a security audit. The dashboard listens on this computer only. Do not expose it to a network.
* Not SAMA approved or reviewed. Any real-money version needs Saudi legal advice and a licensed partner first.

## Tests

```
npm test        # 27 tests (Lithic is tested against a fake copy of its API)
```

## Layout

```
src/engine.js    the decision function (pure, same inputs give same answer)
src/policy.js    policy format, validation, default Saudi policy
src/store.js     hash-chained event log, balances rebuilt from it
src/service.js   authorize, approve, pause, receipts
src/rail.js      Lithic sandbox adapter
src/mcp.js       MCP server     src/server.js + web/   dashboard
src/cli.js       command line   src/demo.js            the 10 step story
```

---

## بالعربية

Flaire طبقة ضوابط إنفاق لوكلاء الذكاء الاصطناعي، تعمل على جهازك. **ريال سعودي تجريبي فقط، بدون أي أموال حقيقية.**
الوكيل يسأل Flaire قبل أي عملية صرف، والرد: **موافقة** أو **رفض** أو **مراجعة** (القرار للمالك)، مع السبب بالعربية والإنجليزية.
زر الطوارئ يوقف أي وكيل أو جميع الوكلاء فورا.

التشغيل: ثبّت Node.js (الإصدار 18 أو أحدث)، ثم من داخل المجلد:
```
node src/cli.js demo --lang ar
node src/cli.js serve
```
ثم افتح http://localhost:4747 واضغط زر "العربية".

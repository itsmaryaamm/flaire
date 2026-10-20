# Flaire + Lithic sandbox: simulated money held by a real card platform

Without Lithic, Flaire's "money" is just a number in a file on your laptop. With Lithic, the fake money lives on a
**Lithic sandbox card**, and Flaire is the gatekeeper in front of it:

```
Agent asks Flaire  ->  Flaire checks your rules  ->  allow / review / deny
                                  |
                       approved (by rules or by you)
                                  |
              Flaire signs a 5 minute receipt (single use)
                                  |
     Flaire presents the receipt, then Lithic sandbox charges the agent's fake card
```

* Each agent gets its own **virtual card** in your Lithic sandbox. Its spend limit equals the agent's funded budget.
* A charge only happens after Flaire approves. Denied or waiting requests never reach Lithic.
* **Kill switch pauses the card at Lithic too**, not just inside Flaire.
* If Lithic refuses a charge, Flaire returns the budget and marks the decision "payment failed".
* Flaire refuses to connect to anything except `sandbox.lithic.com`. It cannot touch production.
* SAR is converted to USD at the 3.75 peg, because Lithic cards are in USD.

Nothing here is real money, a real bank, or a SAMA-approved product.

## Setup (10 minutes)

1. Make a free Lithic account at https://app.lithic.com. (If it asks for business details, use your team or university project.
   I could not test sign-up from here, so if it blocks you, tell me what it says.)
2. In the Lithic dashboard open **Program Settings** and copy your **Sandbox API key**. Never use a production key.
3. Put the key in your terminal, in the same window where you run Flaire.

   Windows PowerShell:
   ```
   $env:LITHIC_API_KEY="paste-your-sandbox-key-here"
   ```
   Mac or Linux:
   ```
   export LITHIC_API_KEY="paste-your-sandbox-key-here"
   ```
4. Test the connection:
   ```
   node src/cli.js lithic check
   ```
   Good result: `Lithic sandbox is connected and working.` You will also see a new card and a SAR 15 (USD 4.00) test
   charge in your Lithic dashboard under Sandbox.
5. Run the whole story against Lithic:
   ```
   node src/cli.js demo --lithic
   ```
6. Use your own data folder and dashboard (the key is read automatically):
   ```
   node src/cli.js agent add ops-agent --fund 2000
   node src/cli.js authorize --agent ops-agent --merchant jarir.com --amount 120
   node src/cli.js serve
   ```
   The dashboard header says "payment rail: Lithic sandbox" when it is connected, and each charge shows its USD amount.

If something fails, the error is printed as `Lithic said no: <their message>`. Send me that exact line.

## Things to know

* **Not yet tested against the live Lithic sandbox.** I built it from Lithic's public docs and tested it against a fake copy of their API
  (27 tests). The first `lithic check` is the real test. Two details I could not confirm from the docs: whether a card can be created with a
  zero limit, and the exact response fields. If `lithic check` shows an error, send it to me and I will fix it.
* Lithic says its sandbox is for exploring and integration work, not load testing. Do not run it in a loop.
* The agent's remaining budget is tracked in Flaire's log, and the cap is also set on the Lithic card. If you edit one and not the other they
  can drift. Funding through `flaire fund` updates both.
* Each `demo --lithic` run creates a fresh card in your sandbox. That is fine, it is fake.
* Lithic is a US card issuer. This proves the idea (Flaire in front of a card rail). It is not a Saudi payment path. A Saudi route still needs
  a licensed local partner and legal advice.

## Where the real Saudi bank would plug in later

The Lithic code is one small file, `src/rail.js`. A future Saudi partner would be another file with the same four jobs:
create an account or card, set its limit, pause it, and charge it when shown a Flaire receipt. The rules engine does not change.

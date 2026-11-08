"""Conversations.

Two kinds:
  * Employee chat  (POST /agents/{id}/chat): talk to an AI employee like a colleague. It asks clarifying questions,
    checks what the company already paid for, plans, buys through Flaire, and reports. Multi-turn; the thread is
    stored on the AgentRun so it continues across requests.
  * Assistant chat (POST /assistant/chat): the owner's finance assistant. Read-only on money by itself: it can
    explain holds, summarise spend, list what needs you, and *prepare* an approval, which the UI then confirms
    with the password. It never approves on its own.

With ANTHROPIC_API_KEY set both use Claude with tools. Without it, a small intent router answers the common
questions so the product still works in a demo.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Agent, AgentRun, Company, Department, PurchaseRequest, Transaction, User
from app.services import submit_purchase_request

settings = get_settings()
MAX_ROUNDS = 8


def _sar(h: int) -> str:
    return f"SAR {h / 100:,.0f}" if h % 100 == 0 else f"SAR {h / 100:,.2f}"


# ===================================================================== employee chat
EMPLOYEE_SYSTEM = """You are {name}, the {role} AI employee at {company}. You work with people like a sharp, friendly colleague.

How you work:
- Before spending, make sure you understand the goal. If the request is vague (no audience, no channel, no amount, no deadline), ask one or two short, specific questions first. Do not ask what you can reasonably decide yourself.
- Call check_budget early and read it: your limits, the department's remaining budget, trusted suppliers, and the company's rules.
- Call list_my_requests before buying anything that might already be paid for. Never buy the same thing twice.
- Prefer trusted suppliers. Pick real vendor names and realistic amounts in SAR. Buy only what the task needs.
- Use request_purchase for every payment. Flaire decides: paid means proceed; pending_approval means a human will review it, say so and continue with what does not depend on it; denied means read the reason and propose a compliant alternative or stop.
- Never split a purchase to dodge a limit, never relabel a category, never try gift cards, crypto or cash.
- Be concise. Plain language, no corporate filler. End with a short status: paid, waiting, blocked.
Money is in Saudi Riyals. Today is {today}."""

EMPLOYEE_TOOLS = [
    {"name": "check_budget", "description": "Your limits, department budget, trusted suppliers and company rules.", "input_schema": {"type": "object", "properties": {}}},
    {"name": "list_my_requests", "description": "Your recent purchase requests and their status, to avoid duplicates and to report.", "input_schema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 10}}}},
    {"name": "request_purchase", "description": "Buy something through Flaire. Amount in SAR.",
     "input_schema": {"type": "object", "required": ["amount_sar", "merchant", "category", "description"],
                      "properties": {"amount_sar": {"type": "number"}, "merchant": {"type": "string"}, "category": {"type": "string", "description": "advertising, software, equipment, services, travel, logistics, utilities, office, other"}, "description": {"type": "string"}}}},
]


def budget_view(db: Session, agent: Agent) -> dict:
    dept = db.get(Department, agent.department_id)
    company = db.get(Company, agent.company_id)
    return {"agent": agent.name, "status": agent.status, "per_purchase_limit_sar": agent.per_transaction_limit / 100, "monthly_limit_sar": agent.monthly_limit / 100,
            "spent_this_month_sar": agent.spent_this_period / 100, "human_approval_from_sar": agent.approval_threshold / 100,
            "allowed_categories": agent.allowed_categories or "any", "blocked_merchants": agent.blocked_merchants,
            "department": dept.name if dept else None, "department_remaining_sar": dept.remaining / 100 if dept else None,
            "trusted_suppliers": list(company.trusted_merchants or []), "new_supplier_review_from_sar": company.new_merchant_review_from / 100,
            "kill_switch_on": company.kill_switch}


def request_view(pr: PurchaseRequest) -> dict:
    d = pr.decision or {}
    return {"request_id": pr.id, "status": pr.status, "amount_sar": pr.amount / 100, "merchant": pr.merchant, "category": pr.category, "description": pr.description,
            "reasons": d.get("reasons", []), "payment_error": d.get("payment_error"), "created_at": pr.created_at.isoformat()}


def employee_tool(db: Session, company: Company, agent: Agent, name: str, args: dict, created: list[int]) -> dict:
    if name == "check_budget":
        return budget_view(db, agent)
    if name == "list_my_requests":
        rows = db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id).order_by(PurchaseRequest.id.desc()).limit(int(args.get("limit", 10))).all()
        return {"requests": [request_view(p) for p in rows]}
    if name == "request_purchase":
        amount = int(round(float(args.get("amount_sar", 0)) * 100))
        if amount <= 0:
            return {"error": "amount_sar must be positive"}
        pr = submit_purchase_request(db, company, agent, amount=amount, merchant=str(args.get("merchant", "Unknown"))[:200], category=str(args.get("category", "other"))[:60],
                                     description=str(args.get("description", ""))[:2000], card_id=None, source="chat")
        created.append(pr.id)
        v = request_view(pr)
        v["what_to_do"] = {"completed": "Paid. Proceed.", "pending_approval": "A human must approve. Do not retry.", "denied": "Blocked. Read reasons.", "failed": "Approved but payment failed."}.get(pr.status, "")
        return v
    return {"error": f"unknown tool {name}"}


def _claude():
    import anthropic
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _run_claude(system: str, tools: list, messages: list[dict], tool_fn) -> tuple[list[dict], list[dict]]:
    """Runs a tool loop. Returns (new transcript entries, updated API messages)."""
    client = _claude()
    transcript: list[dict] = []
    api_messages = list(messages)
    for _ in range(MAX_ROUNDS):
        resp = client.messages.create(model=settings.claude_model, max_tokens=1800, system=system, tools=tools, messages=api_messages)
        api_messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        results = []
        for block in resp.content:
            if block.type == "text" and block.text.strip():
                transcript.append({"role": "assistant", "content": block.text})
            elif block.type == "tool_use":
                out = tool_fn(block.name, dict(block.input))
                transcript.append({"role": "tool", "name": block.name, "input": dict(block.input), "output": out})
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out, default=str)})
        if resp.stop_reason != "tool_use" or not results:
            break
        api_messages.append({"role": "user", "content": results})
    return transcript, api_messages


def _to_api_messages(transcript: list[dict]) -> list[dict]:
    """Rebuild a compact message history for Claude from the stored transcript (text only, tools summarised)."""
    msgs: list[dict] = []
    for e in transcript:
        if e["role"] == "user":
            msgs.append({"role": "user", "content": e["content"]})
        elif e["role"] == "assistant":
            msgs.append({"role": "assistant", "content": e["content"]})
        elif e["role"] == "tool":
            msgs.append({"role": "assistant", "content": f"[I called {e['name']} with {json.dumps(e.get('input', {}))[:300]} and got: {json.dumps(e.get('output', {}), default=str)[:800]}]"})
    # Claude requires alternating roles starting with user; merge consecutive same-role entries.
    merged: list[dict] = []
    for m in msgs:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append(dict(m))
    if merged and merged[0]["role"] != "user":
        merged.insert(0, {"role": "user", "content": "(conversation start)"})
    return merged


def employee_chat(db: Session, company: Company, agent: Agent, user: User, run: AgentRun | None, message: str) -> AgentRun:
    if run is None:
        run = AgentRun(company_id=company.id, agent_id=agent.id, task=message[:200], mode="claude" if settings.claude_enabled else "scripted", transcript=[], purchase_request_ids=[])
        db.add(run)
        db.flush()
    transcript = list(run.transcript or [])
    transcript.append({"role": "user", "content": message})
    created: list[int] = list(run.purchase_request_ids or [])
    dept = db.get(Department, agent.department_id)
    if settings.claude_enabled:
        system = EMPLOYEE_SYSTEM.format(name=agent.name, role=agent.role, company=company.name, today=datetime.now(timezone.utc).date().isoformat())
        try:
            new, _ = _run_claude(system, EMPLOYEE_TOOLS, _to_api_messages(transcript), lambda n, a: employee_tool(db, company, agent, n, a, created))
            transcript += new
            run.mode = "claude"
        except Exception as exc:
            transcript.append({"role": "assistant", "content": f"I could not reach my model ({str(exc)[:80]}). Running the simple plan instead."})
            transcript += _scripted_employee(db, company, agent, message, created, transcript)
            run.mode = "scripted"
    else:
        transcript += _scripted_employee(db, company, agent, message, created, transcript)
        run.mode = "scripted"
    run.transcript = transcript
    run.purchase_request_ids = created
    db.commit()
    db.refresh(run)
    return run


# ---------------------------------------------------------------- scripted employee: intent router with purchase state in the transcript
VENDORS = {"google ads": ("Google Ads", "advertising"), "snapchat": ("Snapchat Ads", "advertising"), "snap ads": ("Snapchat Ads", "advertising"), "tiktok": ("TikTok Ads", "advertising"),
           "meta": ("Meta Ads", "advertising"), "facebook": ("Meta Ads", "advertising"), "instagram": ("Meta Ads", "advertising"), "linkedin": ("LinkedIn Ads", "advertising"),
           "twitter": ("X Ads", "advertising"), "x ads": ("X Ads", "advertising"),
           "canva": ("Canva", "software"), "notion": ("Notion", "software"), "slack": ("Slack", "software"), "aws": ("AWS", "software"), "figma": ("Figma", "software"),
           "zoom": ("Zoom", "software"), "google workspace": ("Google Workspace", "software"), "microsoft": ("Microsoft 365", "software"), "hubspot": ("HubSpot", "software"),
           "aramex": ("Aramex", "logistics"), "smsa": ("SMSA Express", "logistics"), "laptop": ("Jarir Bookstore", "equipment"), "jarir": ("Jarir Bookstore", "equipment"),
           "gift card": ("Gift card", "gift_card"), "collabstr": ("Collabstr", "services"), "upwork": ("Upwork", "services"), "fiverr": ("Fiverr", "services"),
           "freelancer": ("Upwork", "services"), "stc": ("STC", "utilities"), "mobily": ("Mobily", "utilities")}
PURCHASE_VERBS = ("buy", "purchase", "pay", "order", "launch", "run", "subscribe", "renew", "book", "hire", "boost", "promote", "advertise", "get", "need", "want", "procure")
PURCHASE_PHRASES = ("run a campaign", "run campaign", "run ads", "run some ads", "top up", "sign up for", "new campaign")
QUESTION_STARTS = ("what", "how", "why", "which", "did", "was", "were", "is", "are", "show", "list", "tell", "when", "who", "explain", "status")
GREETINGS = ("hi", "hello", "hey", "salam", "salaam", "marhaba", "good morning", "good afternoon", "good evening", "assalam", "yo", "hola")


def _amount_in(text: str, allow_bare: bool) -> float | None:
    """SAR 300, 300 SAR, 300 riyals, 1,200.50. With allow_bare, a plain number not prefixed by # counts too."""
    low = text.lower()
    m = re.search(r"(?:sar|riyals?|ريال|rs\.?)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:k\b)?\s*(?:sar|riyals?|ريال)", low)
    if m:
        return float((m.group(1) or m.group(2)).replace(",", ""))
    if allow_bare:
        m = re.search(r"(?<![#\w])([0-9][0-9,]*(?:\.[0-9]+)?)(k)?(?![\w#])", low)
        if m:
            val = float(m.group(1).replace(",", ""))
            return val * 1000 if m.group(2) else val
    return None


def _vendor_in(text: str) -> tuple[str, str] | None:
    low = text.lower()
    hit = next(((v, c) for k, (v, c) in VENDORS.items() if k in low), None)
    if hit:
        return hit
    # "on Acme Studio", "at Jarir", "from Fresh Prints": a capitalised name after a preposition
    m = re.search(r"\b(?:on|at|from|to|with|via)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})", text)
    if m:
        from app.core.categorize import categorize
        name = m.group(1).strip()
        return name, categorize(name, None, text)[0]
    return None


def _draft_from(transcript: list[dict] | None) -> dict | None:
    """The open purchase draft, if the last purchase-related entry was a question for a missing detail."""
    for e in reversed(transcript or []):
        if e.get("role") == "tool" and e.get("name") == "request_purchase":
            return None  # last purchase completed; nothing open
        if e.get("role") == "tool" and e.get("name") == "draft_purchase":
            return dict(e.get("input") or {})
    return None


def _month_transactions(db: Session, agent: Agent) -> list[Transaction]:
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (db.query(Transaction).join(PurchaseRequest, PurchaseRequest.id == Transaction.purchase_request_id)
            .filter(PurchaseRequest.agent_id == agent.id, Transaction.status.in_(["settled", "authorized"]), Transaction.created_at >= month_start)
            .order_by(Transaction.id.desc()).all())


def _say(text: str) -> dict:
    return {"role": "assistant", "content": text}


def _reason_text(pr: PurchaseRequest) -> str:
    d = pr.decision or {}
    reasons = [r for r in d.get("reasons", []) if r]
    if d.get("payment_error"):
        reasons.append(d["payment_error"])
    return " ".join(reasons[-2:]) if reasons else "No reason was recorded."


def _scripted_employee(db: Session, company: Company, agent: Agent, message: str, created: list[int], transcript: list[dict] | None = None) -> list[dict]:
    """No model available: answer questions from Flaire's data, and buy only when clearly asked to.

    Intents: greeting, help, what did you buy / spending this month, budget / how much is left, status of my last request,
    why was it held or denied, list pending, purchase (with one question for the single missing detail, remembered in the
    transcript as a draft_purchase entry so the next message completes it)."""
    text = message.strip()
    low = text.lower()
    words = re.findall(r"[a-z']+", low)
    out: list[dict] = []
    ids = [int(x) for x in re.findall(r"#\s*(\d+)", low)]
    mine = db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id)
    last_pr = mine.order_by(PurchaseRequest.id.desc()).first()

    draft = _draft_from(transcript)
    vendor = _vendor_in(text)
    verb = any(v in words for v in PURCHASE_VERBS) or any(p in low for p in PURCHASE_PHRASES)
    amount = _amount_in(text, allow_bare=bool(draft) or verb or vendor is not None)
    question_start = bool(words) and words[0] in QUESTION_STARTS
    # Only a clear ask to buy, pay, order, launch or run something, or an amount, moves to the purchase flow.
    wants_purchase = ((amount is not None) and not question_start) or (verb and not question_start) or (verb and vendor is not None)

    # 1. continuation of an open draft: the user supplied the missing detail
    if draft and (amount is not None or vendor is not None) and not question_start:
        merged = {"merchant": draft.get("merchant") or (vendor[0] if vendor else None), "category": draft.get("category") or (vendor[1] if vendor else None),
                  "amount_sar": draft.get("amount_sar") or amount, "description": draft.get("description") or text, "force": bool(draft.get("force")) or "again" in low}
        return _purchase_flow(db, company, agent, merged, text, created, low)

    # 2. greetings
    if words and words[0] in GREETINGS and len(words) <= 8 and not wants_purchase:
        return [_say(f"Hi, I am {agent.name}, the {agent.role} AI employee at {company.name}. Ask me what I bought this month, how much budget is left, the status of my last request, "
                     f"or tell me what to buy (for example \"SAR 300 on Google Ads for the Riyadh launch\").")]

    # 3. help
    if "help" in words or "what can you do" in low or "what do you do" in low or "capabilities" in low:
        return [_say("I spend company money through Flaire, within my limits. I can: tell you what I bought this month and the totals; show my budget and how much is left; "
                     "report the status of my last request; explain why a request was held or denied; list requests waiting for a human; and buy things you ask for "
                     "(say the vendor and the amount in SAR). I cannot approve holds or change limits; a human does that in the Flaire dashboard.")]

    # 4. why held / denied / blocked
    if ("why" in words or any(k in low for k in ("held", "on hold", "denied", "blocked", "rejected", "declined", "refused"))) and not wants_purchase:
        target = db.get(PurchaseRequest, ids[0]) if ids else mine.filter(PurchaseRequest.status.in_(["pending_approval", "denied", "rejected", "failed"])).order_by(PurchaseRequest.id.desc()).first()
        if target and target.agent_id != agent.id:
            target = None
        if not target:
            return [_say("Nothing of mine has been held or denied recently." + (f" My last request, #{last_pr.id} {last_pr.merchant} {_sar(last_pr.amount)}, is {last_pr.status}." if last_pr else ""))]
        out.append({"role": "tool", "name": "get_purchase_status", "input": {"request_id": target.id}, "output": request_view(target)})
        state = {"pending_approval": "is waiting for a human", "denied": "was denied by Flaire", "rejected": "was rejected by a human", "failed": "was approved but the payment failed"}.get(target.status, f"is {target.status}")
        out.append(_say(f"Request #{target.id} ({target.merchant}, {_sar(target.amount)}) {state}: {_reason_text(target)}"))
        return out

    # 5. spending / what did you buy
    if any(k in low for k in ("what did you buy", "what have you bought", "bought", "purchases", "spending", "spent", "what did you pay", "paid for", "transactions")) and not wants_purchase:
        txs = _month_transactions(db, agent)
        out.append({"role": "tool", "name": "list_my_requests", "input": {"limit": 10}, "output": {"requests": [request_view(p) for p in mine.order_by(PurchaseRequest.id.desc()).limit(10).all()]}})
        if not txs:
            out.append(_say("I have not paid for anything this month yet."))
            return out
        total = sum(t.amount for t in txs)
        lines = "; ".join(f"{t.merchant} {_sar(t.amount)} on {t.created_at.date()}" for t in txs[:8])
        more = f" and {len(txs) - 8} more" if len(txs) > 8 else ""
        out.append(_say(f"This month I completed {len(txs)} purchase{'s' if len(txs) != 1 else ''} totalling {_sar(total)}: {lines}{more}. Flaire fees on these: {_sar(sum(t.fee or 0 for t in txs))}."))
        return out

    # 6. budget / how much is left
    if any(k in low for k in ("budget", "how much is left", "how much do i have", "how much can", "remaining", "left to spend", "my limit", "limits", "allowance")) and not wants_purchase:
        b = budget_view(db, agent)
        out.append({"role": "tool", "name": "check_budget", "input": {}, "output": b})
        left = max(b["monthly_limit_sar"] - b["spent_this_month_sar"], 0)
        dept = f" My department ({b['department']}) has {_sar(int(round((b['department_remaining_sar'] or 0) * 100)))} left." if b.get("department") else ""
        out.append(_say(f"I have {_sar(int(round(left * 100)))} left of my {_sar(int(round(b['monthly_limit_sar'] * 100)))} monthly limit (spent {_sar(int(round(b['spent_this_month_sar'] * 100)))}). "
                        f"Per purchase I can spend up to {_sar(int(round(b['per_purchase_limit_sar'] * 100)))}; anything from {_sar(int(round(b['human_approval_from_sar'] * 100)))} needs a human.{dept}"
                        + (" The kill switch is ON, so nothing can be paid right now." if b["kill_switch_on"] else "")))
        return out

    # 7. pending list
    if any(k in low for k in ("pending", "waiting", "awaiting", "on hold", "holds", "need approval", "needs approval")) and not wants_purchase:
        rows = mine.filter(PurchaseRequest.status == "pending_approval").order_by(PurchaseRequest.id).all()
        out.append({"role": "tool", "name": "list_my_requests", "input": {"status": "pending_approval"}, "output": {"requests": [request_view(p) for p in rows]}})
        if not rows:
            out.append(_say("Nothing of mine is waiting for approval."))
        else:
            out.append(_say(f"{len(rows)} waiting for a human: " + "; ".join(f"#{p.id} {p.merchant} {_sar(p.amount)} ({(p.decision or {}).get('reasons', ['held'])[0]})" for p in rows)))
        return out

    # 8. status of my last request
    if any(k in low for k in ("status", "last request", "my request", "latest request", "did it go through", "was it paid", "update on")) and not wants_purchase:
        target = db.get(PurchaseRequest, ids[0]) if ids else last_pr
        if target and target.agent_id != agent.id:
            target = None
        if not target:
            return [_say("I have not made any requests yet.")]
        out.append({"role": "tool", "name": "get_purchase_status", "input": {"request_id": target.id}, "output": request_view(target)})
        label = {"completed": "paid", "pending_approval": "waiting for a human", "denied": "denied", "rejected": "rejected by a human", "failed": "approved but the payment failed", "approved": "approved, payment in progress"}.get(target.status, target.status)
        extra = f" Reason: {_reason_text(target)}" if target.status != "completed" else ""
        out.append(_say(f"My last request, #{target.id}: {_sar(target.amount)} at {target.merchant}, is {label}.{extra}"))
        return out

    # 9. purchase
    if wants_purchase:
        return _purchase_flow(db, company, agent, {"merchant": vendor[0] if vendor else None, "category": vendor[1] if vendor else None, "amount_sar": amount, "description": text,
                                                   "force": "again" in low}, text, created, low)

    # 10. fallback
    recent = mine.order_by(PurchaseRequest.id.desc()).limit(3).all()
    return [_say("I can tell you what I bought this month, how much budget is left, the status of my last request, why something was held, or buy something for you "
                 "(say the vendor and the amount in SAR)." + (" Recent: " + "; ".join(f"#{p.id} {p.merchant} {_sar(p.amount)} ({p.status})" for p in recent) + "." if recent else ""))]


def _purchase_flow(db: Session, company: Company, agent: Agent, draft: dict, text: str, created: list[int], low: str) -> list[dict]:
    """Ask one question for the single missing detail, or buy once everything is known."""
    out = [{"role": "tool", "name": "check_budget", "input": {}, "output": budget_view(db, agent)}]
    merchant, amount = draft.get("merchant"), draft.get("amount_sar")
    if not merchant:
        out.append({"role": "tool", "name": "draft_purchase", "input": {**draft, "description": (draft.get("description") or text)[:200]}, "output": {"missing": "merchant"}})
        what = f" for {_sar(int(round(float(amount) * 100)))}" if amount else ""
        out.append(_say(f"Happy to. Which vendor or channel should I pay{what}? (For example Google Ads, Snapchat Ads, Canva or Notion.)"))
        return out
    if not amount:
        out.append({"role": "tool", "name": "draft_purchase", "input": {**draft, "description": (draft.get("description") or text)[:200]}, "output": {"missing": "amount"}})
        out.append(_say(f"How much should I spend on {merchant}, in SAR?"))
        return out
    amount = float(amount)
    category = draft.get("category") or "other"
    recent = db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id, PurchaseRequest.merchant == merchant, PurchaseRequest.status == "completed",
                                               PurchaseRequest.created_at >= datetime.now(timezone.utc) - timedelta(days=30)).first()
    if recent and not draft.get("force") and "again" not in low:
        out.append(_say(f"We already paid {merchant} {_sar(recent.amount)} on {recent.created_at.date()} (request #{recent.id}). I will not buy it twice. Say \"buy again\" if this is a separate purchase."))
        return out
    res = employee_tool(db, company, agent, "request_purchase", {"amount_sar": amount, "merchant": merchant, "category": category, "description": (draft.get("description") or text)[:200]}, created)
    out.append({"role": "tool", "name": "request_purchase", "input": {"amount_sar": amount, "merchant": merchant, "category": category}, "output": res})
    status = res.get("status")
    money = _sar(int(round(amount * 100)))
    if status == "completed":
        out.append(_say(f"Done: {money} paid to {merchant} (request #{res['request_id']}). Status: paid."))
    elif status == "pending_approval":
        out.append(_say(f"Submitted {money} for {merchant} (request #{res['request_id']}). Flaire held it for a human: {(res.get('reasons') or ['needs approval'])[-1]} I will carry on with everything that does not depend on it. Status: waiting."))
    else:
        out.append(_say(f"Flaire blocked {money} at {merchant}: {(res.get('reasons') or [res.get('payment_error') or 'no reason given'])[-1]} Tell me if you want a different supplier or amount. Status: blocked."))
    return out


# ===================================================================== owner assistant
ASSISTANT_SYSTEM = """You are the Flaire assistant for {name} ({role}) at {company}. Flaire is the finance department for the company's AI employees.
You help the owner understand and control spending in plain language. You can read everything and you can PREPARE an approval or a rejection, but you never execute one: the app asks the person for their password. Be brief, specific, and honest. Use SAR. Today is {today}.
When asked to approve or reject something, call prepare_decision with the request id; the app takes it from there. If there are several candidates, ask which one.
If asked about anything you cannot see, say so."""

ASSISTANT_TOOLS = [
    {"name": "pending_approvals", "description": "Requests waiting for a human.", "input_schema": {"type": "object", "properties": {}}},
    {"name": "recent_activity", "description": "Recent purchase requests with status and reasons.", "input_schema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 10}}}},
    {"name": "spend_summary", "description": "Spend this month by employee and department, budgets, remaining, Flaire fees.", "input_schema": {"type": "object", "properties": {}}},
    {"name": "explain_request", "description": "Full decision trail for one request id.", "input_schema": {"type": "object", "required": ["request_id"], "properties": {"request_id": {"type": "integer"}}}},
    {"name": "prepare_decision", "description": "Prepare an approve or reject for a pending request; the app will ask the user to confirm with their password.",
     "input_schema": {"type": "object", "required": ["request_id", "action"], "properties": {"request_id": {"type": "integer"}, "action": {"type": "string", "enum": ["approve", "reject"]}, "note": {"type": "string"}}}},
    {"name": "employees", "description": "The company's AI employees with limits, status and card.", "input_schema": {"type": "object", "properties": {}}},
]


def assistant_tool(db: Session, company: Company, user: User, name: str, args: dict, actions: list[dict]) -> dict:
    cid = company.id
    if name == "pending_approvals":
        rows = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == cid, PurchaseRequest.status == "pending_approval").order_by(PurchaseRequest.id).all()
        return {"pending": [{**request_view(p), "agent": p.agent.name} for p in rows]}
    if name == "recent_activity":
        rows = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == cid).order_by(PurchaseRequest.id.desc()).limit(int(args.get("limit", 10))).all()
        return {"requests": [{**request_view(p), "agent": p.agent.name} for p in rows]}
    if name == "spend_summary":
        agents = db.query(Agent).filter(Agent.company_id == cid).all()
        depts = db.query(Department).filter(Department.company_id == cid).all()
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        fees = db.query(func.coalesce(func.sum(Transaction.fee), 0)).filter(Transaction.company_id == cid, Transaction.created_at >= month_start, Transaction.status.in_(["settled", "authorized"])).scalar() or 0
        return {"employees": [{"name": a.name, "spent_sar": a.spent_this_period / 100, "monthly_limit_sar": a.monthly_limit / 100, "status": a.status} for a in agents],
                "departments": [{"name": d.name, "spent_sar": d.spent_this_period / 100, "budget_sar": d.monthly_budget / 100, "remaining_sar": d.remaining / 100, "paused": d.spending_paused} for d in depts],
                "flaire_fees_this_month_sar": fees / 100, "fee_rate_percent": (company.fee_rate_bps or 0) / 100, "kill_switch_on": company.kill_switch}
    if name == "explain_request":
        pr = db.get(PurchaseRequest, int(args["request_id"]))
        if not pr or pr.company_id != cid:
            return {"error": "not found"}
        return {**request_view(pr), "agent": pr.agent.name, "decision": pr.decision, "approved_by": pr.approved_by.full_name if pr.approved_by else None}
    if name == "prepare_decision":
        pr = db.get(PurchaseRequest, int(args["request_id"]))
        if not pr or pr.company_id != cid or pr.status != "pending_approval":
            return {"error": "That request is not pending."}
        act = {"type": "decision", "request_id": pr.id, "action": args["action"], "note": args.get("note"), "merchant": pr.merchant, "amount": pr.amount, "agent": pr.agent.name}
        actions.append(act)
        return {"prepared": act, "next": "The app will ask the user to confirm with their password."}
    if name == "employees":
        agents = db.query(Agent).filter(Agent.company_id == cid).all()
        return {"employees": [{"id": a.id, "name": a.name, "role": a.role, "status": a.status, "per_purchase_limit_sar": a.per_transaction_limit / 100, "monthly_limit_sar": a.monthly_limit / 100,
                               "spent_sar": a.spent_this_period / 100, "has_card": bool(a.card_id)} for a in agents]}
    return {"error": f"unknown tool {name}"}


def assistant_chat(db: Session, company: Company, user: User, history: list[dict], message: str) -> dict:
    """history: prior [{role, content}] text turns from the client. Returns {reply, actions, transcript}."""
    actions: list[dict] = []
    transcript = [{"role": "user", "content": message}]
    if settings.claude_enabled:
        system = ASSISTANT_SYSTEM.format(name=user.full_name, role=user.role, company=company.name, today=datetime.now(timezone.utc).date().isoformat())
        msgs = [{"role": h["role"], "content": h["content"]} for h in history if h.get("role") in ("user", "assistant") and h.get("content")][-12:]
        msgs.append({"role": "user", "content": message})
        try:
            new, _ = _run_claude(system, ASSISTANT_TOOLS, _to_api_messages(msgs), lambda n, a: assistant_tool(db, company, user, n, a, actions))
            transcript += new
            reply = "\n\n".join(e["content"] for e in new if e["role"] == "assistant") or "Done."
            return {"reply": reply, "actions": actions, "transcript": transcript, "mode": "claude"}
        except Exception as exc:
            transcript.append({"role": "system", "content": f"model unavailable: {str(exc)[:80]}"})
    reply = _scripted_assistant(db, company, user, message, actions)
    transcript.append({"role": "assistant", "content": reply})
    return {"reply": reply, "actions": actions, "transcript": transcript, "mode": "scripted"}


def _scripted_assistant(db: Session, company: Company, user: User, message: str, actions: list[dict]) -> str:
    low = message.lower().strip()
    words = re.findall(r"[a-z']+", low)
    pending = assistant_tool(db, company, user, "pending_approvals", {}, actions)["pending"]
    ids = re.findall(r"#?(\d+)", low)
    if any(k in low for k in ("approve", "reject", "decline", "deny")):
        act = "reject" if any(k in low for k in ("reject", "decline", "deny")) else "approve"
        cand = [p for p in pending if str(p["request_id"]) in ids] or [p for p in pending if any(w in low for w in p["merchant"].lower().split())]
        if len(cand) == 1:
            assistant_tool(db, company, user, "prepare_decision", {"request_id": cand[0]["request_id"], "action": act}, actions)
            return f"Ready to {act} {cand[0]['merchant']} {_sar(int(cand[0]['amount_sar'] * 100))} from {cand[0]['agent']}. Confirm with your password."
        if not pending:
            return "Nothing is waiting for approval right now."
        return "Which one? Waiting: " + "; ".join(f"#{p['request_id']} {p['merchant']} {_sar(int(p['amount_sar'] * 100))}" for p in pending)
    if words and words[0] in GREETINGS and len(words) <= 8:
        waiting = f" {len(pending)} request{'s' if len(pending) != 1 else ''} waiting for you." if pending else " Nothing needs you right now."
        return f"Hi {user.full_name.split()[0]}.{waiting} Ask me what was bought this month, how much budget is left, why something was held, or tell me to prepare an approval."
    if "help" in words or "what can you do" in low:
        return ("I can tell you what needs you, why a request was held or denied, what the AI employees bought this month and the totals, how much budget is left per "
                "employee and department, the status of the latest request, and prepare an approval or rejection (you confirm with your password). I never approve on my own.")
    if any(k in low for k in ("pending", "waiting", "need", "approval")):
        if not pending:
            return "Nothing needs you right now."
        return "Waiting for you: " + "; ".join(f"#{p['request_id']} {p['agent']} wants {_sar(int(p['amount_sar'] * 100))} at {p['merchant']} ({p['reasons'][-1] if p['reasons'] else ''})" for p in pending)
    if any(k in low for k in ("what did", "bought", "buy", "purchases", "paid for", "transactions", "spending")):
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        txs = (db.query(Transaction).filter(Transaction.company_id == company.id, Transaction.status.in_(["settled", "authorized"]), Transaction.created_at >= month_start)
               .order_by(Transaction.id.desc()).all())
        if not txs:
            return "Nothing has been paid this month yet."
        names = {}
        for t in txs:
            pr = db.get(PurchaseRequest, t.purchase_request_id)
            names[t.id] = pr.agent.name if pr and pr.agent else "?"
        total = sum(t.amount for t in txs)
        return (f"This month: {len(txs)} purchase{'s' if len(txs) != 1 else ''} totalling {_sar(total)}. "
                + "; ".join(f"{names[t.id]} paid {t.merchant} {_sar(t.amount)} on {t.created_at.date()}" for t in txs[:8]) + ("." if len(txs) <= 8 else f" and {len(txs) - 8} more."))
    if any(k in low for k in ("left", "remaining", "budget", "spend", "spent", "how much", "fee", "limit")):
        s_ = assistant_tool(db, company, user, "spend_summary", {}, actions)
        emp = ", ".join(f"{e['name']} {_sar(int(e['spent_sar'] * 100))} of {_sar(int(e['monthly_limit_sar'] * 100))} ({_sar(int((e['monthly_limit_sar'] - e['spent_sar']) * 100))} left)" for e in s_["employees"]) or "no employees yet"
        dep = ", ".join(f"{d['name']} {_sar(int(d['remaining_sar'] * 100))} left of {_sar(int(d['budget_sar'] * 100))}" for d in s_["departments"]) or "no departments yet"
        return f"Employees this month: {emp}. Departments: {dep}. Flaire fees so far: {_sar(int(s_['flaire_fees_this_month_sar'] * 100))} ({s_['fee_rate_percent']}%). Kill switch is {'ON' if s_['kill_switch_on'] else 'off'}."
    if "why" in words or "explain" in words or any(k in low for k in ("held", "denied", "blocked", "rejected")):
        target = None
        if ids:
            e = assistant_tool(db, company, user, "explain_request", {"request_id": int(ids[0])}, actions)
            target = e if "error" not in e else None
        if target is None:
            row = (db.query(PurchaseRequest).filter(PurchaseRequest.company_id == company.id, PurchaseRequest.status.in_(["pending_approval", "denied", "rejected", "failed"]))
                   .order_by(PurchaseRequest.id.desc()).first())
            target = assistant_tool(db, company, user, "explain_request", {"request_id": row.id}, actions) if row else None
        if target:
            return f"#{target['request_id']} {target['agent']} at {target['merchant']} {_sar(int(target['amount_sar'] * 100))} is {target['status']}. " + (" ".join(target["reasons"][-3:]) or target.get("payment_error") or "No reason recorded.")
        recent = assistant_tool(db, company, user, "recent_activity", {"limit": 3}, actions)["requests"]
        return "Nothing has been held or denied. Recent: " + "; ".join(f"#{r['request_id']} {r['merchant']} ({r['status']})" for r in recent)
    if any(k in low for k in ("status", "last request", "latest")):
        recent = assistant_tool(db, company, user, "recent_activity", {"limit": 1}, actions)["requests"]
        if not recent:
            return "No requests yet."
        r = recent[0]
        return f"Latest: #{r['request_id']} {r['agent']} {r['merchant']} {_sar(int(r['amount_sar'] * 100))} is {r['status']}." + (f" {r['reasons'][-1]}" if r["reasons"] and r["status"] != "completed" else "")
    recent = assistant_tool(db, company, user, "recent_activity", {"limit": 5}, actions)["requests"]
    return ("I can tell you what needs you, why something was held, what was bought, how much is left, or prepare an approval. Recent activity: "
            + ("; ".join(f"#{r['request_id']} {r['agent']} {r['merchant']} {_sar(int(r['amount_sar'] * 100))} ({r['status']})" for r in recent) or "nothing yet") + ".")

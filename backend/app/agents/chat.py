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
            transcript += _scripted_employee(db, company, agent, message, created)
            run.mode = "scripted"
    else:
        transcript += _scripted_employee(db, company, agent, message, created)
        run.mode = "scripted"
    run.transcript = transcript
    run.purchase_request_ids = created
    db.commit()
    db.refresh(run)
    return run


def _scripted_employee(db: Session, company: Company, agent: Agent, message: str, created: list[int]) -> list[dict]:
    """No model available: ask one clarifying question if the ask is vague, otherwise buy the obvious thing once."""
    low = message.lower()
    m = re.search(r"(?:sar|riyals?|ريال)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:sar|riyals?|ريال)", low)
    amount = float((m.group(1) or m.group(2)).replace(",", "")) if m else None
    vendors = {"google ads": ("Google Ads", "advertising"), "snapchat": ("Snapchat Ads", "advertising"), "meta": ("Meta Ads", "advertising"), "linkedin": ("LinkedIn Ads", "advertising"),
               "canva": ("Canva", "software"), "notion": ("Notion", "software"), "slack": ("Slack", "software"), "aws": ("AWS", "software"), "aramex": ("Aramex", "logistics"),
               "laptop": ("Jarir Bookstore", "equipment"), "gift card": ("Gift card", "gift_card"), "collabstr": ("Collabstr", "services")}
    hit = next(((v, c) for k, (v, c) in vendors.items() if k in low), None)
    out = [{"role": "tool", "name": "check_budget", "input": {}, "output": budget_view(db, agent)}]
    if not hit or amount is None:
        out.append({"role": "assistant", "content": "Happy to. Two quick things so I buy the right thing: which vendor or channel, and roughly how much in SAR? (Example: \"SAR 300 on Google Ads for the Riyadh launch\".)"})
        return out
    recent = db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id, PurchaseRequest.merchant == hit[0], PurchaseRequest.status == "completed",
                                               PurchaseRequest.created_at >= datetime.now(timezone.utc) - timedelta(days=30)).first()
    if recent and "again" not in low:
        out.append({"role": "assistant", "content": f"We already paid {hit[0]} {_sar(recent.amount)} on {recent.created_at.date()} (request #{recent.id}). I will not buy it twice. Say \"buy again\" if this is a separate purchase."})
        return out
    res = employee_tool(db, company, agent, "request_purchase", {"amount_sar": amount, "merchant": hit[0], "category": hit[1], "description": message[:200]}, created)
    out.append({"role": "tool", "name": "request_purchase", "input": {"amount_sar": amount, "merchant": hit[0], "category": hit[1]}, "output": res})
    status = res.get("status")
    if status == "completed":
        out.append({"role": "assistant", "content": f"Done: {_sar(int(amount * 100))} paid to {hit[0]} (request #{res['request_id']}). Status: paid."})
    elif status == "pending_approval":
        out.append({"role": "assistant", "content": f"Submitted {_sar(int(amount * 100))} for {hit[0]}. Flaire held it for a human: {res['reasons'][-1]} I will carry on with everything that does not depend on it. Status: waiting."})
    else:
        out.append({"role": "assistant", "content": f"Flaire blocked {_sar(int(amount * 100))} at {hit[0]}: {(res.get('reasons') or [res.get('payment_error') or 'no reason given'])[-1]} Tell me if you want a different supplier or amount. Status: blocked."})
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
    low = message.lower()
    pending = assistant_tool(db, company, user, "pending_approvals", {}, actions)["pending"]
    if any(k in low for k in ("approve", "reject", "decline", "deny")):
        act = "reject" if any(k in low for k in ("reject", "decline", "deny")) else "approve"
        ids = re.findall(r"#?(\d+)", low)
        cand = [p for p in pending if str(p["request_id"]) in ids] or [p for p in pending if any(w in low for w in p["merchant"].lower().split())]
        if len(cand) == 1:
            assistant_tool(db, company, user, "prepare_decision", {"request_id": cand[0]["request_id"], "action": act}, actions)
            return f"Ready to {act} {cand[0]['merchant']} {_sar(int(cand[0]['amount_sar'] * 100))} from {cand[0]['agent']}. Confirm with your password."
        if not pending:
            return "Nothing is waiting for approval right now."
        return "Which one? Waiting: " + "; ".join(f"#{p['request_id']} {p['merchant']} {_sar(int(p['amount_sar'] * 100))}" for p in pending)
    if any(k in low for k in ("pending", "waiting", "need", "approval")):
        if not pending:
            return "Nothing needs you right now."
        return "Waiting for you: " + "; ".join(f"#{p['request_id']} {p['agent']} wants {_sar(int(p['amount_sar'] * 100))} at {p['merchant']} ({p['reasons'][-1] if p['reasons'] else ''})" for p in pending)
    if any(k in low for k in ("spend", "spent", "budget", "how much", "fee")):
        s = assistant_tool(db, company, user, "spend_summary", {}, actions)
        emp = ", ".join(f"{e['name']} {_sar(int(e['spent_sar'] * 100))} of {_sar(int(e['monthly_limit_sar'] * 100))}" for e in s["employees"]) or "no employees yet"
        return f"This month: {emp}. Flaire fees so far: {_sar(int(s['flaire_fees_this_month_sar'] * 100))} ({s['fee_rate_percent']}%). Kill switch is {'ON' if s['kill_switch_on'] else 'off'}."
    if "why" in low or "explain" in low:
        ids = re.findall(r"#?(\d+)", low)
        if ids:
            e = assistant_tool(db, company, user, "explain_request", {"request_id": int(ids[0])}, actions)
            if "error" not in e:
                return f"#{e['request_id']} {e['merchant']} {_sar(int(e['amount_sar'] * 100))} is {e['status']}. " + " ".join(e["reasons"][-3:])
        recent = assistant_tool(db, company, user, "recent_activity", {"limit": 3}, actions)["requests"]
        return "Tell me the request number. Recent: " + "; ".join(f"#{r['request_id']} {r['merchant']} ({r['status']})" for r in recent)
    recent = assistant_tool(db, company, user, "recent_activity", {"limit": 5}, actions)["requests"]
    return ("I can tell you what needs you, why something was held, how much was spent, or prepare an approval. Recent activity: "
            + ("; ".join(f"#{r['request_id']} {r['agent']} {r['merchant']} {_sar(int(r['amount_sar'] * 100))} ({r['status']})" for r in recent) or "nothing yet") + ".")

"""Real Claude AI employees.

Each agent is a Claude conversation with two tools:
  check_budget()                 read-only: what can I spend?
  request_purchase(amount, ...)  submits a purchase request through Flaire's authorization pipeline.

The agent sees the decision (approved / held for approval / blocked) and must adapt. It has no tool that
approves, no card access, and no way to change limits. That separation is the whole point of Flaire.

Without ANTHROPIC_API_KEY the runner falls back to a deterministic "scripted" plan so the demo still works.
"""
from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Agent, AgentRun, Company, Department, PurchaseRequest
from app.services import submit_purchase_request

settings = get_settings()

ROLE_PROMPTS = {
    "marketing": "You are the Marketing AI employee. You run campaigns, buy ad inventory and marketing tools.",
    "procurement": "You are the Procurement AI employee. You buy software subscriptions, equipment and supplier services.",
    "operations": "You are the Operations AI employee. You keep the company running: logistics, utilities, office services, SaaS ops tools.",
    "general": "You are an AI employee at the company.",
}

SYSTEM = """{role_prompt}

You work for {company}. Your department is {department}. Money is in Saudi Riyals (SAR).

You can plan and you can REQUEST purchases through Flaire, the company's finance department for AI employees.
You cannot approve purchases, you cannot see or use card numbers, and you cannot change any limit.
Flaire evaluates every request against your permissions, your department budget and company policy, and returns one of:
  approved          the payment was executed, you are done with that item
  pending_approval  a human must sign off; do not retry it, tell the user it is waiting
  denied            blocked; read the reasons, and either pick a compliant alternative or report back honestly

How to behave, like a good employee working with a real finance department:
- Call check_budget first. It tells you your limits, the department's remaining budget and the company's trusted suppliers.
- Prefer trusted suppliers. A first payment to a new supplier above a small amount will be held for review; say so instead of trying another supplier to get around it.
- Choose the merchant, amount and category yourself from the task. Be specific (the real vendor name, a sensible category) and keep the amount to what the task needs.
- Never split a purchase into smaller pieces to dodge a limit, never relabel a category to pass a check, never try gift cards, crypto or cash equivalents.
- If Flaire holds or denies something, report the reason in plain words and suggest what the human can do (approve it, raise a limit, add the supplier as trusted).
- Finish with a short plain-text summary: what was paid, what is waiting for approval, and what was blocked and why."""

TOOLS = [
    {"name": "check_budget", "description": "Check your spending permissions and the department's remaining budget before buying anything.", "input_schema": {"type": "object", "properties": {}}},
    {"name": "request_purchase", "description": "Request a purchase through Flaire. Amount is in SAR (e.g. 500 means SAR 500).",
     "input_schema": {"type": "object", "required": ["amount_sar", "merchant", "category", "description"],
                      "properties": {"amount_sar": {"type": "number"}, "merchant": {"type": "string"},
                                     "category": {"type": "string", "description": "one of: advertising, software, equipment, services, travel, logistics, utilities, office, other"},
                                     "description": {"type": "string"}}}},
]


def _budget_view(db: Session, agent: Agent) -> dict:
    dept = db.get(Department, agent.department_id)
    return {"agent": agent.name, "status": agent.status, "per_transaction_limit_sar": agent.per_transaction_limit / 100,
            "monthly_limit_sar": agent.monthly_limit / 100, "spent_this_month_sar": agent.spent_this_period / 100,
            "needs_human_approval_at_or_above_sar": agent.approval_threshold / 100, "allowed_categories": agent.allowed_categories or "any",
            "blocked_merchants": agent.blocked_merchants, "department": dept.name, "department_remaining_sar": dept.remaining / 100,
            "trusted_suppliers": list(db.get(Company, agent.company_id).trusted_merchants or []),
            "new_supplier_review_from_sar": db.get(Company, agent.company_id).new_merchant_review_from / 100,
            "kill_switch": db.get(Company, agent.company_id).kill_switch}


def _purchase_view(pr: PurchaseRequest) -> dict:
    return {"request_id": pr.id, "status": pr.status, "verdict": pr.decision.get("verdict"), "reasons": pr.decision.get("reasons", []),
            "payment_error": pr.decision.get("payment_error"), "amount_sar": pr.amount / 100, "merchant": pr.merchant}


def _handle_tool(db: Session, company: Company, agent: Agent, name: str, args: dict, created: list[int]) -> dict:
    if name == "check_budget":
        return _budget_view(db, agent)
    if name == "request_purchase":
        amount = int(round(float(args.get("amount_sar", 0)) * 100))
        pr = submit_purchase_request(db, company, agent, amount=amount, merchant=str(args.get("merchant", "Unknown")), category=str(args.get("category", "other")),
                                     description=str(args.get("description", "")), card_id=None)
        created.append(pr.id)
        return _purchase_view(pr)
    return {"error": f"unknown tool {name}"}


def run_agent_task(db: Session, company: Company, agent: Agent, task: str) -> AgentRun:
    created: list[int] = []
    transcript: list[dict] = []
    mode = "claude" if settings.claude_enabled else "scripted"
    if mode == "claude":
        try:
            transcript = _run_claude(db, company, agent, task, created)
        except Exception as exc:  # API outage, bad key, etc. Keep the demo alive.
            transcript = [{"role": "system", "content": f"Claude call failed ({exc}); running scripted fallback."}]
            mode = "scripted"
            transcript += _run_scripted(db, company, agent, task, created)
    else:
        transcript = _run_scripted(db, company, agent, task, created)

    run = AgentRun(company_id=company.id, agent_id=agent.id, task=task, mode=mode, transcript=transcript, purchase_request_ids=created)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


# ---------------- real Claude ----------------
def _run_claude(db: Session, company: Company, agent: Agent, task: str, created: list[int]) -> list[dict]:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    dept = db.get(Department, agent.department_id)
    system = SYSTEM.format(role_prompt=ROLE_PROMPTS.get(agent.role, ROLE_PROMPTS["general"]), company=company.name, department=dept.name)
    messages: list[dict] = [{"role": "user", "content": task}]
    transcript: list[dict] = [{"role": "user", "content": task}]

    for _ in range(8):  # hard cap on tool rounds
        resp = client.messages.create(model=settings.claude_model, max_tokens=1500, system=system, tools=TOOLS, messages=messages)
        messages.append({"role": "assistant", "content": resp.content})
        tool_results = []
        for block in resp.content:
            if block.type == "text" and block.text.strip():
                transcript.append({"role": "assistant", "content": block.text})
            elif block.type == "tool_use":
                result = _handle_tool(db, company, agent, block.name, dict(block.input), created)
                transcript.append({"role": "tool", "name": block.name, "input": dict(block.input), "output": result})
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)})
        if resp.stop_reason != "tool_use" or not tool_results:
            break
        messages.append({"role": "user", "content": tool_results})
    return transcript


# ---------------- scripted fallback ----------------
def _run_scripted(db: Session, company: Company, agent: Agent, task: str, created: list[int]) -> list[dict]:
    """Deterministic plan: parse an amount and a merchant from the task, otherwise use a role default."""
    transcript = [{"role": "user", "content": task}]
    budget = _budget_view(db, agent)
    transcript.append({"role": "tool", "name": "check_budget", "input": {}, "output": budget})

    # Prefer a number next to a currency word ("SAR 350", "350 riyals"); otherwise the largest number in the task.
    m = re.search(r"(?:SAR|sar|ريال|riyals?)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:SAR|sar|riyals?|ريال)", task)
    if m:
        amount = float((m.group(1) or m.group(2)).replace(",", ""))
    else:
        nums = [float(n.replace(",", "")) for n in re.findall(r"[0-9][0-9,]*(?:\.[0-9]+)?", task)]
        amount = max(nums) if nums else {"marketing": 500, "procurement": 1200, "operations": 350}.get(agent.role, 400)
    defaults = {"marketing": ("Google Ads", "advertising"), "procurement": ("Notion", "software"), "operations": ("Aramex", "logistics")}
    merchant, category = defaults.get(agent.role, ("Supplier", "services"))
    low = task.lower()
    for key, (mer, cat) in {"google ads": ("Google Ads", "advertising"), "campaign tools": ("HubSpot", "software"), "subscription": ("Canva", "software"), "meta": ("Meta Ads", "advertising"), "snapchat": ("Snapchat Ads", "advertising"),
                            "canva": ("Canva", "software"), "notion": ("Notion", "software"), "slack": ("Slack", "software"), "aws": ("AWS", "software"),
                            "gift card": ("Gift card", "gift_card"), "aramex": ("Aramex", "logistics"), "laptop": ("Jarir Bookstore", "equipment")}.items():
        if key in low:
            merchant, category = mer, cat
            break

    transcript.append({"role": "assistant", "content": f"Plan: the task needs roughly SAR {amount:,.0f} at {merchant} ({category}). Department has SAR {budget['department_remaining_sar']:,.0f} left. Submitting the request to Flaire."})
    result = _handle_tool(db, company, agent, "request_purchase", {"amount_sar": amount, "merchant": merchant, "category": category, "description": task[:200]}, created)
    transcript.append({"role": "tool", "name": "request_purchase", "input": {"amount_sar": amount, "merchant": merchant, "category": category}, "output": result})
    status = result["status"]
    if status == "completed":
        summary = f"Done. SAR {amount:,.0f} paid to {merchant} (request #{result['request_id']})."
    elif status == "pending_approval":
        summary = f"Submitted. SAR {amount:,.0f} at {merchant} is waiting for a human approval (request #{result['request_id']})."
    else:
        summary = f"Blocked. Flaire refused SAR {amount:,.0f} at {merchant}: {result['reasons'][-1] if result['reasons'] else result.get('payment_error')}"
    transcript.append({"role": "assistant", "content": summary})
    return transcript

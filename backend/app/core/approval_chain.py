"""Multi-step approval chains.

An ApprovalRule has ordered steps, each {"role": "dept_head" | "finance" | "admin" | "owner", "count": n}.
Progress lives in pr.decision["approvals"] (one entry per human, each counted once) and pr.decision["chain"]
(rule id, steps, which steps are satisfied, and what the next step still needs). Money moves only when every step is satisfied.

Role matching: owner satisfies any step; admin satisfies admin and finance steps; everyone else must match exactly.
Delegates act with the delegator's role and scope and are recorded "on behalf of".
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.security import active_delegations_for, approval_identities, role_can_approve
from app.models import ApprovalRule, Company, PurchaseRequest, User, utcnow

STEP_ROLES = ("dept_head", "finance", "admin", "owner")
ROLE_LABELS = {"dept_head": "department head", "finance": "finance", "admin": "admin", "owner": "owner"}


def role_satisfies(role: str, step_role: str) -> bool:
    if role == "owner":
        return True
    if role == "admin":
        return step_role in ("admin", "finance")
    return role == step_role


def pick_rule(db: Session, company: Company, pr: PurchaseRequest) -> ApprovalRule | None:
    """Department-specific rule beats company-wide; among those, the highest min_amount at or below the amount wins."""
    rules = db.query(ApprovalRule).filter(ApprovalRule.company_id == company.id, ApprovalRule.active.is_(True), ApprovalRule.min_amount <= pr.amount).all()
    rules = [r for r in rules if r.steps and r.department_id in (None, pr.department_id)]
    if not rules:
        return None
    rules.sort(key=lambda r: (r.department_id == pr.department_id, r.min_amount, -r.id), reverse=True)
    return rules[0]


def _label(step: dict) -> str:
    n = int(step.get("count", 1))
    role = ROLE_LABELS.get(step.get("role", ""), step.get("role", ""))
    return f"{n} {role} approver{'s' if n != 1 else ''}"


def chain_state(rule: ApprovalRule, approvals: list[dict]) -> dict:
    steps = [{"role": s.get("role"), "count": int(s.get("count", 1))} for s in (rule.steps or [])]
    satisfied: list[int] = []
    nxt = None
    for i, step in enumerate(steps, start=1):
        have = sum(1 for a in approvals if a.get("step") == i)
        if have >= step["count"]:
            satisfied.append(i)
        elif nxt is None:
            nxt = {"step": i, "role": step["role"], "count": step["count"], "have": have, "waiting_for": step["count"] - have, "label": _label(step)}
    return {"rule_id": rule.id, "steps": steps, "satisfied": satisfied, "next": nxt, "complete": nxt is None, "total_steps": len(steps)}


def progress_message(state: dict) -> str:
    nxt = state.get("next")
    total = state.get("total_steps", 0)
    done = len(state.get("satisfied", []))
    if nxt is None:
        return f"All {total} approval steps done."
    role = ROLE_LABELS.get(nxt["role"], nxt["role"])
    waiting = nxt["waiting_for"]
    if done == 0 and nxt["have"] == 0:
        return f"Step 1 of {total}: waiting for {waiting} {role} approver{'s' if waiting != 1 else ''}."
    if nxt["have"] > 0:
        return f"Step {nxt['step']} of {total} in progress ({nxt['have']} of {nxt['count']} {role}). Waiting for {waiting} more {role} approver{'s' if waiting != 1 else ''}."
    prev_role = ROLE_LABELS.get(state["steps"][done - 1]["role"], state["steps"][done - 1]["role"])
    return f"Step {done} of {total} done ({prev_role}). Waiting for {waiting} {role} approver{'s' if waiting != 1 else ''}."


def attach_chain(db: Session, company: Company, pr: PurchaseRequest) -> ApprovalRule | None:
    """Called when a hold is created: pick the rule and record the empty chain so the dashboard can show what is needed."""
    rule = pick_rule(db, company, pr)
    if not rule:
        return None
    pr.approval_rule_id = rule.id
    state = chain_state(rule, list((pr.decision or {}).get("approvals", [])))
    pr.decision = {**(pr.decision or {}), "approvals": [], "chain": state, "reasons": list((pr.decision or {}).get("reasons", [])) + [progress_message(state)]}
    return rule


def record_step_approval(db: Session, company: Company, user: User, pr: PurchaseRequest, rule: ApprovalRule, note: str | None) -> tuple[dict, dict, bool]:
    """Counts this user's approval against the current step. Returns (new decision meta, state, complete).
    Raises 403 if no identity of the user fits the current step, 409 if the user already counted."""
    from fastapi import HTTPException
    from app.core import audit

    meta = dict(pr.decision or {})
    approvals: list[dict] = list(meta.get("approvals", []))
    if any(a.get("user_id") == user.id or a.get("id") == user.id for a in approvals):
        raise HTTPException(409, "You already approved this request. Each person counts once.")
    state = chain_state(rule, approvals)
    nxt = state["next"]
    if nxt is None:
        return meta, state, True
    identities = approval_identities(db, user, pr)
    if not identities:
        raise HTTPException(403, "You cannot approve requests for this department.")
    fit = next((i for i in identities if role_satisfies(i["role"], nxt["role"])), None)
    if fit is None:
        yours = ", ".join(sorted({i["role"] for i in identities}))
        raise HTTPException(403, f"Step {nxt['step']} of {state['total_steps']} needs a {ROLE_LABELS.get(nxt['role'], nxt['role'])} approver. Your role here is {yours}.")
    obo = fit["on_behalf_of"]
    entry = {"user_id": user.id, "name": user.full_name, "role": fit["role"], "at": utcnow().isoformat(), "step": nxt["step"],
             "on_behalf_of": {"id": obo.id, "full_name": obo.full_name} if obo else None,
             # legacy keys read by older clients
             "id": user.id, "full_name": user.full_name}
    approvals.append(entry)
    state = chain_state(rule, approvals)
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="approval.step",
                 details={"request_id": pr.id, "rule_id": rule.id, "step": nxt["step"], "role": fit["role"], "note": note,
                          "on_behalf_of": {"id": obo.id, "full_name": obo.full_name} if obo else None, "complete": state["complete"]})
    meta = {**meta, "approvals": approvals, "chain": state, "needs_second_approver": not state["complete"]}
    return meta, state, state["complete"]


def eligible_users_for_request(db: Session, company: Company, pr: PurchaseRequest) -> list[User]:
    """Who can act on this hold right now: people whose own role fits the current step, plus their active delegates."""
    users = db.query(User).filter(User.company_id == company.id).all()
    active = [u for u in users if (u.status or "active") == "active"]
    chain = (pr.decision or {}).get("chain") or {}
    nxt = chain.get("next")
    already = {a.get("user_id") for a in (pr.decision or {}).get("approvals", [])}
    direct: list[User] = []
    for u in active:
        if u.id in already or not role_can_approve(db, u, pr):
            continue
        if nxt and not role_satisfies(u.role, nxt["role"]):
            continue
        direct.append(u)
    direct_ids = {u.id for u in direct}
    out = list(direct)
    for u in active:
        if u.id in direct_ids or u.id in already:
            continue
        if any(d.user_id in direct_ids for d in active_delegations_for(db, u)):
            out.append(u)
    return out

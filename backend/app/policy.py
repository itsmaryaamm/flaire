"""Policy versioning and change approval (four-eyes on the rules themselves).

Every purchase decision is judged against a snapshot of the company's spending policy. The snapshot covers company
security settings, departments, agent limits and active approval rules. Snapshots are hashed; a change that leaves
the policy identical does not create a new version.

Change approval: when company.require_change_approval is on, a LOOSENING change (one that lets more money move or
removes a check) does not apply directly. It becomes a pending PolicyChange that a second, different admin must
approve. A TIGHTENING change (lower limit, pause, extra blocked merchant, higher threshold that requires more
approvals) always applies immediately, because it reduces risk and an attacker gains nothing from it.

Money is integer halalas throughout.
"""
from __future__ import annotations

import hashlib
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import audit
from app.core.audit import canonical_json
from app.models import Agent, ApprovalRule, Company, Department, PolicyChange, PolicyVersion, User, utcnow

COMPANY_POLICY_FIELDS = ("two_person_threshold", "require_password_on_approve", "trusted_merchants", "new_merchant_review_from", "notify_threshold",
                         "require_2fa_for_approvers", "require_2fa_for_all", "fee_rate_bps", "kill_switch", "require_change_approval")
AGENT_POLICY_FIELDS = ("per_transaction_limit", "monthly_limit", "approval_threshold", "allowed_categories", "blocked_merchants", "max_requests_per_hour",
                       "max_requests_per_day", "status")
DEPARTMENT_POLICY_FIELDS = ("monthly_budget", "spending_paused")
RULE_POLICY_FIELDS = ("department_id", "min_amount", "steps", "active")

# Fields governed by change approval, by target type. Anything not listed here (names, roles, engine, key expiry) applies directly.
GOVERNED_FIELDS = {
    "company": ("two_person_threshold", "require_password_on_approve", "trusted_merchants", "new_merchant_review_from", "notify_threshold",
                "require_2fa_for_approvers", "require_2fa_for_all", "require_change_approval"),
    "agent": AGENT_POLICY_FIELDS,
    "department": DEPARTMENT_POLICY_FIELDS,
    "approval_rule": RULE_POLICY_FIELDS,
}


# ---------------- snapshots and versions ----------------
def snapshot_policy(db: Session, company: Company) -> dict:
    """Canonical, JSON-serialisable picture of everything the rules engine reads when it judges a purchase."""
    depts = db.query(Department).filter(Department.company_id == company.id).order_by(Department.id).all()
    agents = db.query(Agent).filter(Agent.company_id == company.id).order_by(Agent.id).all()
    rules = db.query(ApprovalRule).filter(ApprovalRule.company_id == company.id, ApprovalRule.active.is_(True)).order_by(ApprovalRule.id).all()
    return {
        "company": {
            "two_person_threshold": company.two_person_threshold,
            "require_password_on_approve": bool(company.require_password_on_approve),
            "trusted_merchants": sorted(company.trusted_merchants or []),
            "new_merchant_review_from": company.new_merchant_review_from,
            "notify_threshold": company.notify_threshold,
            "require_2fa_for_approvers": bool(company.require_2fa_for_approvers),
            "require_2fa_for_all": bool(company.require_2fa_for_all),
            "fee_rate_bps": company.fee_rate_bps,
            "kill_switch": bool(company.kill_switch),
        },
        "departments": [{"id": d.id, "name": d.name, "monthly_budget": d.monthly_budget, "spending_paused": bool(d.spending_paused)} for d in depts],
        "agents": [{"id": a.id, "name": a.name, "status": a.status, "per_transaction_limit": a.per_transaction_limit, "monthly_limit": a.monthly_limit,
                    "approval_threshold": a.approval_threshold, "allowed_categories": sorted(a.allowed_categories or []),
                    "blocked_merchants": sorted(a.blocked_merchants or []), "max_requests_per_hour": a.max_requests_per_hour,
                    "max_requests_per_day": a.max_requests_per_day} for a in agents],
        "approval_rules": [{"id": r.id, "department_id": r.department_id, "min_amount": r.min_amount, "steps": r.steps or []} for r in rules],
    }


def policy_hash(snapshot: dict) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(snapshot).encode()).hexdigest()


def latest_version(db: Session, company: Company) -> PolicyVersion | None:
    return db.query(PolicyVersion).filter(PolicyVersion.company_id == company.id).order_by(PolicyVersion.version.desc()).first()


def bump_policy(db: Session, company: Company, user: User | None, summary: str) -> PolicyVersion:
    """Record a new PolicyVersion if the policy actually changed. Returns the latest version either way."""
    db.flush()
    snap = snapshot_policy(db, company)
    h = policy_hash(snap)
    latest = latest_version(db, company)
    if latest and latest.hash == h:
        return latest
    version = (company.policy_version or 0) + 1
    if latest and latest.version >= version:
        version = latest.version + 1
    pv = PolicyVersion(company_id=company.id, version=version, snapshot=snap, hash=h, created_by_id=user.id if user else None, change_summary=(summary or "")[:500])
    db.add(pv)
    company.policy_version = version
    db.flush()
    audit.record(db, company.id, actor_type="user" if user else "system", actor_id=user.id if user else None, actor_name=user.full_name if user else "policy",
                 event="policy.version", details={"policy_version_id": pv.id, "version": version, "hash": h, "summary": pv.change_summary})
    return pv


def current_policy_version_id(db: Session, company: Company) -> int:
    """Id of the version that matches the live policy. Creates version 1 lazily, or a fresh version if something changed outside the patch endpoints."""
    latest = latest_version(db, company)
    if latest is None:
        return bump_policy(db, company, None, "Initial policy").id
    snap = snapshot_policy(db, company)
    if latest.hash != policy_hash(snap):
        return bump_policy(db, company, None, "Policy refreshed at decision time (agents, departments or rules were added or removed)").id
    return latest.id


def diff_snapshots(a: dict, b: dict) -> list[dict]:
    """Field-level diff between two snapshots: [{"path": "agents.3.monthly_limit", "from": x, "to": y}]."""
    out: list[dict] = []

    def by_id(items: list) -> dict:
        return {str(i.get("id")): i for i in items}

    for key in ("company",):
        for f in sorted(set(a.get(key, {})) | set(b.get(key, {}))):
            va, vb = a.get(key, {}).get(f), b.get(key, {}).get(f)
            if va != vb:
                out.append({"path": f"{key}.{f}", "from": va, "to": vb})
    for key in ("departments", "agents", "approval_rules"):
        ia, ib = by_id(a.get(key, [])), by_id(b.get(key, []))
        for item_id in sorted(set(ia) | set(ib), key=lambda s: int(s) if s.isdigit() else 0):
            xa, xb = ia.get(item_id), ib.get(item_id)
            if xa is None:
                out.append({"path": f"{key}.{item_id}", "from": None, "to": xb})
            elif xb is None:
                out.append({"path": f"{key}.{item_id}", "from": xa, "to": None})
            else:
                for f in sorted(set(xa) | set(xb)):
                    if xa.get(f) != xb.get(f):
                        out.append({"path": f"{key}.{item_id}.{f}", "from": xa.get(f), "to": xb.get(f)})
    return out


# ---------------- loosening vs tightening ----------------
def _as_set(v: Any) -> set:
    return {str(x).strip().lower() for x in (v or [])}


def is_loosening(target_type: str, field: str, old: Any, new: Any) -> bool:
    """True when a change lets more money move, removes a check, or widens what an agent may do.

    Rule of thumb documented in docs/SECURITY.md:
      tightening (applies immediately, even with change approval on): lowering a limit or budget, pausing an agent or
      department, adding a blocked merchant, removing an allowed category, removing a trusted supplier, raising the
      two-person threshold's reach (that is, lowering it), turning a security check on, lowering the new-supplier review amount.
      loosening (needs a second admin): the opposite of each of the above.
    Unknown fields are treated as loosening so nothing slips through by default.
    """
    if old == new:
        return False
    if target_type == "agent":
        if field in ("per_transaction_limit", "monthly_limit", "approval_threshold", "max_requests_per_hour", "max_requests_per_day"):
            return (new or 0) > (old or 0)
        if field == "status":
            return new == "active"  # resuming a paused agent lets money move again
        if field == "allowed_categories":
            old_s, new_s = _as_set(old), _as_set(new)
            if not old_s and new_s:
                return False  # empty means "all categories" in the engine, so naming some is a restriction
            if old_s and not new_s:
                return True
            return bool(new_s - old_s)
        if field == "blocked_merchants":
            return bool(_as_set(old) - _as_set(new))  # removing a block loosens
        return True
    if target_type == "department":
        if field == "monthly_budget":
            return (new or 0) > (old or 0)
        if field == "spending_paused":
            return new is False
        return True
    if target_type == "company":
        if field in ("two_person_threshold", "notify_threshold"):
            return (new or 0) > (old or 0)  # higher threshold means fewer purchases get the extra check
        if field == "new_merchant_review_from":
            if (old or 0) == 0:
                return False  # 0 disables review; any positive amount enables it
            return new == 0 or (new or 0) > (old or 0)
        if field in ("require_password_on_approve", "require_2fa_for_approvers", "require_2fa_for_all", "require_change_approval"):
            return new is False
        if field == "trusted_merchants":
            return bool(_as_set(new) - _as_set(old))  # trusting a new supplier skips its category checks
        if field == "fee_rate_bps":
            return False
        if field == "kill_switch":
            return new is False
        return True
    if target_type == "approval_rule":
        if field == "min_amount":
            return (new or 0) > (old or 0)  # rule kicks in later, so fewer purchases need the chain
        if field == "active":
            return new is False
        if field == "steps":
            def weight(steps):
                return sum(int(s.get("count", 1)) for s in (steps or []) if isinstance(s, dict))
            return weight(new) < weight(old)
        if field == "department_id":
            return True
        return True
    return True


# ---------------- change proposals ----------------
def _apply_changes(target_obj: Any, changes: dict) -> None:
    for field, delta in changes.items():
        setattr(target_obj, field, delta["to"])


def _target_label(target_type: str, target_obj: Any) -> str:
    if target_type == "company":
        return "Company"
    name = getattr(target_obj, "name", None)
    if target_type == "approval_rule":
        return f"Approval rule {target_obj.id}"
    return name or f"{target_type} {getattr(target_obj, 'id', '?')}"


def _fmt(v: Any) -> str:
    if isinstance(v, bool) or v is None:
        return str(v)
    if isinstance(v, int):
        return f"{v:,}"
    if isinstance(v, list):
        return "[" + ", ".join(str(x) for x in v) + "]"
    return str(v)


def change_summary(target_type: str, target_obj: Any, changes: dict, user: User | None) -> str:
    parts = [f"{field.replace('_', ' ')} {_fmt(d['from'])} -> {_fmt(d['to'])}" for field, d in changes.items()]
    who = f" by {user.full_name}" if user else ""
    return f"{_target_label(target_type, target_obj)} {'; '.join(parts)}{who}"[:500]


def propose_or_apply(db: Session, company: Company, user: User, target_type: str, target_obj: Any, changes: dict, reason: str = "") -> tuple[bool, PolicyChange | None]:
    """Apply a policy change directly, or park it as a pending PolicyChange for a second admin.

    `changes` is {field: {"from": old, "to": new}} and must only hold fields that actually differ. Returns
    (applied, change). When change approval is off, or every field in the change is a tightening, the change is
    applied, the policy version is bumped and (True, None) comes back. When at least one field loosens the policy and
    company.require_change_approval is on, nothing is applied: a PolicyChange(status=pending) is stored and
    (False, change) comes back. Tightening fields bundled with a loosening one wait with it, so the proposal stays
    one coherent unit for the reviewer.

    Special case: turning require_change_approval OFF while it is on is itself a loosening and needs the second admin,
    otherwise the control would be a trivial bypass. Turning it ON applies immediately.
    """
    changes = {f: d for f, d in changes.items() if d.get("from") != d.get("to")}
    if not changes:
        # Nothing governed changed, but a rename or similar may still alter the snapshot; bump is a no-op when the hash matches.
        bump_policy(db, company, user, f"{_target_label(target_type, target_obj)} updated by {user.full_name}")
        return True, None
    target_id = None if target_type == "company" else getattr(target_obj, "id", None)
    needs_second = bool(company.require_change_approval) and any(is_loosening(target_type, f, d["from"], d["to"]) for f, d in changes.items())
    if needs_second:
        pending = PolicyChange(company_id=company.id, target_type=target_type, target_id=target_id, changes=changes, reason=(reason or "")[:500],
                               status="pending", proposed_by_id=user.id)
        db.add(pending)
        db.flush()
        audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="policy.change_proposed",
                     details={"change_id": pending.id, "target_type": target_type, "target_id": target_id, "changes": changes, "reason": reason})
        from app.core.notify import notify_policy_change
        notify_policy_change(db, company, pending, user)
        return False, pending
    _apply_changes(target_obj, changes)
    db.flush()
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="policy.change_applied",
                 details={"target_type": target_type, "target_id": target_id, "changes": changes, "direct": True})
    bump_policy(db, company, user, change_summary(target_type, target_obj, changes, user))
    return True, None


def resolve_target(db: Session, company: Company, change: PolicyChange) -> Any:
    if change.target_type == "company":
        return company
    model = {"agent": Agent, "department": Department, "approval_rule": ApprovalRule}.get(change.target_type)
    obj = db.get(model, change.target_id) if model else None
    if obj is None or getattr(obj, "company_id", None) != company.id:
        raise HTTPException(409, f"The {change.target_type} this change targets no longer exists")
    return obj


def approve_change(db: Session, company: Company, user: User, change: PolicyChange, password: str | None, note: str | None) -> PolicyChange:
    """Second admin applies a pending change. Different user than the proposer; password re-entry when the company requires it."""
    from app.core.security import verify_user_password

    if change.status != "pending":
        raise HTTPException(409, f"Change is {change.status}, not pending")
    if change.proposed_by_id == user.id:
        raise HTTPException(403, "You proposed this change. A different admin must approve it.")
    if company.require_password_on_approve and not verify_user_password(user, password):
        audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="policy.change_password_failed", details={"change_id": change.id})
        db.commit()
        raise HTTPException(403, "Password confirmation failed. Re-enter your password to approve this change.")
    target = resolve_target(db, company, change)
    # Re-check the "from" side so a change proposed against stale values does not silently overwrite something newer.
    stale = {f: getattr(target, f) for f, d in change.changes.items() if getattr(target, f, None) != d.get("from")}
    if stale:
        raise HTTPException(409, f"Current values changed since this was proposed: {stale}. Reject it and propose again.")
    _apply_changes(target, change.changes)
    change.status = "applied"
    change.decided_by_id = user.id
    change.decision_note = (note or "")[:500] or None
    change.decided_at = utcnow()
    db.flush()
    proposer = db.get(User, change.proposed_by_id)
    summary = change_summary(change.target_type, target, change.changes, proposer) + f", approved by {user.full_name}"
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="policy.change_approved",
                 details={"change_id": change.id, "target_type": change.target_type, "target_id": change.target_id, "changes": change.changes, "note": note})
    pv = bump_policy(db, company, user, summary[:500])
    change.policy_version_id = pv.id
    if change.target_type == "agent":
        from app.cards import sync_card_with_agent
        sync_card_with_agent(db, company, target)
    return change


def reject_change(db: Session, company: Company, user: User, change: PolicyChange, note: str | None) -> PolicyChange:
    if change.status != "pending":
        raise HTTPException(409, f"Change is {change.status}, not pending")
    change.status = "rejected"
    change.decided_by_id = user.id
    change.decision_note = (note or "")[:500] or None
    change.decided_at = utcnow()
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="policy.change_rejected", details={"change_id": change.id, "note": note})
    return change


def cancel_change(db: Session, company: Company, user: User, change: PolicyChange) -> PolicyChange:
    if change.status != "pending":
        raise HTTPException(409, f"Change is {change.status}, not pending")
    if change.proposed_by_id != user.id:
        raise HTTPException(403, "Only the person who proposed this change can cancel it")
    change.status = "cancelled"
    change.decided_by_id = user.id
    change.decided_at = utcnow()
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="policy.change_cancelled", details={"change_id": change.id})
    return change


def change_out(db: Session, change: PolicyChange) -> dict:
    proposer = db.get(User, change.proposed_by_id)
    decider = db.get(User, change.decided_by_id) if change.decided_by_id else None
    return {"id": change.id, "target_type": change.target_type, "target_id": change.target_id, "changes": change.changes, "reason": change.reason,
            "status": change.status, "proposed_by": {"id": proposer.id, "full_name": proposer.full_name} if proposer else None,
            "decided_by": {"id": decider.id, "full_name": decider.full_name} if decider else None, "decision_note": change.decision_note,
            "policy_version_id": change.policy_version_id, "created_at": change.created_at, "decided_at": change.decided_at}


def version_out(db: Session, pv: PolicyVersion, with_snapshot: bool = False) -> dict:
    who = db.get(User, pv.created_by_id) if pv.created_by_id else None
    out = {"id": pv.id, "version": pv.version, "hash": pv.hash, "change_summary": pv.change_summary, "created_at": pv.created_at,
           "created_by": {"id": who.id, "full_name": who.full_name} if who else None}
    if with_snapshot:
        out["snapshot"] = pv.snapshot
    return out

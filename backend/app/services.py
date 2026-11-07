"""Flaire business services: the purchase pipeline (request → authorize → pay → ledger) and period rollovers.

Flow for one purchase request:
  1. Agent calls POST /agent/purchase-requests with its key.
  2. build_authorization_request() packs agent permissions + department budget + company state.
  3. The configured engine (native or Shotoku) returns a Decision.
  4. approved         → execute_payment(): verify the receipt, pick a card, run the payment adapter, update budgets.
     pending_approval → request waits for a human (POST /approvals/{id}/approve).
     denied           → stored with reasons; nothing moves.
Every step appends to the hash-chained audit ledger.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.integrations.payments import get_adapter
from app.integrations.shotoku import get_engine
from app.integrations.shotoku.interface import AgentPolicy, AuthorizationRequest, Decision, DepartmentBudget
from app.integrations.shotoku.native_engine import sar
from app.models import Agent, Card, Company, Department, PurchaseRequest, Transaction, User, utcnow

settings = get_settings()


# ---------------- period rollover ----------------
def ensure_period(db: Session, company: Company) -> None:
    """Reset monthly spend counters when a new calendar month starts."""
    first = date.today().replace(day=1)
    for dept in db.query(Department).filter(Department.company_id == company.id).all():
        if dept.period_start < first:
            dept.period_start = first
            dept.spent_this_period = 0
            for ag in dept.agents:
                ag.spent_this_period = 0
    db.flush()


# ---------------- authorization ----------------
def build_authorization_request(db: Session, company: Company, agent: Agent, pr: PurchaseRequest) -> AuthorizationRequest:
    dept = db.get(Department, agent.department_id)
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = (db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id, PurchaseRequest.created_at >= one_hour_ago, PurchaseRequest.id != pr.id).count())
    ten_min_ago = datetime.now(timezone.utc) - timedelta(minutes=10)
    duplicate = (db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id, PurchaseRequest.id != pr.id, PurchaseRequest.created_at >= ten_min_ago,
                                                  PurchaseRequest.merchant == pr.merchant, PurchaseRequest.amount == pr.amount,
                                                  PurchaseRequest.status.in_(["completed", "approved", "pending_approval"])).count() > 0)
    merchant_is_new = (db.query(PurchaseRequest).filter(PurchaseRequest.company_id == company.id, PurchaseRequest.id != pr.id,
                                                        PurchaseRequest.status == "completed", func.lower(PurchaseRequest.merchant) == pr.merchant.lower()).count() == 0)
    return AuthorizationRequest(
        request_id=str(pr.id), company_id=company.id,
        company_trusted_merchants=list(company.trusted_merchants or []), merchant_is_new=merchant_is_new,
        new_merchant_review_from=company.new_merchant_review_from, amount=pr.amount, currency=pr.currency, merchant=pr.merchant, category=pr.category,
        description=pr.description or "",
        agent=AgentPolicy(agent_id=agent.id, agent_name=agent.name, status=agent.status, per_transaction_limit=agent.per_transaction_limit,
                          monthly_limit=agent.monthly_limit, spent_this_period=agent.spent_this_period, approval_threshold=agent.approval_threshold,
                          allowed_categories=list(agent.allowed_categories or []), blocked_merchants=list(agent.blocked_merchants or []),
                          max_requests_per_hour=agent.max_requests_per_hour, requests_last_hour=recent, duplicate_recent=duplicate),
        department=DepartmentBudget(department_id=dept.id, name=dept.name, monthly_budget=dept.monthly_budget, spent_this_period=dept.spent_this_period, spending_paused=dept.spending_paused),
        kill_switch=company.kill_switch,
    )


def decision_to_dict(d: Decision) -> dict:
    return {"verdict": d.verdict, "engine": d.engine, "reasons": d.reasons, "rule_id": d.rule_id, "receipt": d.receipt, "summary": d.summary, "decision_id": d.decision_id}


def submit_purchase_request(db: Session, company: Company, agent: Agent, *, amount: int, merchant: str, category: str, description: str, card_id: int | None,
                            source: str = "api", client_ip: str | None = None) -> PurchaseRequest:
    ensure_period(db, company)
    from app.core.categorize import categorize
    category_final, how = categorize(merchant, category, description)
    pr = PurchaseRequest(company_id=company.id, agent_id=agent.id, department_id=agent.department_id, card_id=card_id, amount=amount,
                         currency=company.currency, merchant=merchant.strip(), category=category_final, description=description or "", status="pending_approval")
    db.add(pr)
    db.flush()
    agent.last_active_at = utcnow()
    audit.record(db, company.id, actor_type="agent", actor_id=agent.id, actor_name=agent.name, event="purchase.requested",
                 details={"request_id": pr.id, "amount": amount, "merchant": merchant, "category": category_final, "category_given": category, "categorized_by": how, "source": source, "ip": client_ip})

    engine = get_engine(company.engine or settings.auth_engine)
    decision = engine.authorize(build_authorization_request(db, company, agent, pr))
    pr.decision = decision_to_dict(decision)
    pr.decided_at = utcnow()
    pr.status = {"approved": "approved", "denied": "denied", "pending_approval": "pending_approval"}[decision.verdict]
    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name=f"engine:{decision.engine}", event=f"decision.{decision.verdict}",
                 details={"request_id": pr.id, "rule_id": decision.rule_id, "reasons": decision.reasons})

    if decision.approved:
        execute_payment(db, company, pr, decision)
    elif decision.verdict == "pending_approval" and pr.amount >= (company.notify_threshold or 0):
        from app.core.notify import notify_approval_needed
        db.flush()
        notify_approval_needed(db, company, pr)
    db.commit()
    db.refresh(pr)
    return pr


# ---------------- payment ----------------
def pick_card(db: Session, company: Company, pr: PurchaseRequest) -> Card | None:
    q = db.query(Card).filter(Card.company_id == company.id, Card.status == "active")
    if pr.card_id:
        return q.filter(Card.id == pr.card_id).first()
    dept_card = q.filter(Card.department_id == pr.department_id).first()
    if dept_card:
        return dept_card
    return q.filter(Card.is_default.is_(True)).first() or q.first()


def execute_payment(db: Session, company: Company, pr: PurchaseRequest, decision: Decision) -> Transaction | None:
    """Flaire payment service: executes only valid authorizations."""
    agent = db.get(Agent, pr.agent_id)
    engine = get_engine(decision.engine if decision.engine in ("native", "shotoku") else company.engine)
    auth_req = build_authorization_request(db, company, agent, pr)

    # Gate 1: the receipt must be present, correctly signed, unexpired and match this exact agent/merchant/amount.
    valid, reasons = engine.verify_receipt(decision.receipt or "", auth_req) if decision.receipt else (False, ["No authorization receipt."])
    if not valid:
        pr.status = "failed"
        pr.decision = {**pr.decision, "payment_error": "; ".join(reasons)}
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="payment.rejected", details={"request_id": pr.id, "reasons": reasons})
        return None

    # Gate 2: a card.
    card = pick_card(db, company, pr)
    if not card:
        pr.status = "failed"
        pr.decision = {**pr.decision, "payment_error": "No active card available."}
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="payment.failed", details={"request_id": pr.id, "reason": "no card"})
        return None

    # Lock the budget and card rows so two agents paying at the same instant cannot both pass the same remaining balance.
    dept = db.query(Department).filter(Department.id == pr.department_id).with_for_update().one()
    card = db.query(Card).filter(Card.id == card.id).with_for_update().one()
    if pr.amount > dept.remaining:
        pr.status = "failed"
        pr.decision = {**pr.decision, "payment_error": "Budget was consumed by a concurrent purchase."}
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="payment.rejected", details={"request_id": pr.id, "reasons": ["concurrent budget exhaustion"]})
        return None
    adapter = get_adapter(card.provider, company)
    result = adapter.authorize(card, pr.amount, pr.merchant, f"FLAIRE*{pr.merchant}")
    tx = Transaction(company_id=company.id, purchase_request_id=pr.id, card_id=card.id, provider=card.provider, provider_ref=result.provider_ref,
                     amount=pr.amount, currency=pr.currency, merchant=pr.merchant, status=result.status, decline_reason=result.decline_reason)
    db.add(tx)
    db.flush()
    pr.transaction_id = tx.id
    if result.ok:
        pr.status = "completed"
        dept.spent_this_period += pr.amount
        agent.spent_this_period += pr.amount
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="payment.settled" if result.status == "settled" else "payment.authorized",
                     details={"request_id": pr.id, "transaction_id": tx.id, "card": f"{card.label} {card.last4}", "amount": pr.amount, "provider_ref": result.provider_ref,
                              "clearing_error": (result.raw or {}).get("clearing_error") if isinstance(result.raw, dict) else None})
    else:
        pr.status = "failed"
        pr.decision = {**pr.decision, "payment_error": result.decline_reason}
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="payment.declined",
                     details={"request_id": pr.id, "transaction_id": tx.id, "reason": result.decline_reason})
    return tx


# ---------------- human approvals ----------------
def resolve_approval(db: Session, company: Company, user: User, pr: PurchaseRequest, approve: bool, note: str | None, password: str | None = None) -> PurchaseRequest:
    """Human approval with server-enforced security rules:
      1. password re-entry (company.require_password_on_approve)
      2. two-person rule at/above company.two_person_threshold: two different humans must approve
      3. kill switch freezes approvals; budgets and limits are re-checked by the engine at approval time
    """
    from app.core.security import verify_user_password

    if pr.status != "pending_approval":
        raise HTTPException(409, f"Request is {pr.status}, not pending approval")
    if company.kill_switch and approve:
        raise HTTPException(409, "Kill switch is ON. Lift it before approving any spending.")
    if company.require_password_on_approve:
        if not verify_user_password(user, password):
            audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="approval.password_failed", details={"request_id": pr.id})
            db.commit()
            raise HTTPException(403, "Password confirmation failed. Re-enter your password to approve or reject.")

    ensure_period(db, company)
    decision_meta = dict(pr.decision or {})
    approvals: list[dict] = list(decision_meta.get("approvals", []))

    # Two-person rule: first approval is recorded, money moves only after a second, different human approves.
    if approve and pr.amount >= company.two_person_threshold:
        if any(a["id"] == user.id for a in approvals):
            raise HTTPException(409, "You already approved this. A different approver must give the second approval.")
        approvals.append({"id": user.id, "full_name": user.full_name})
        audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="approval.first_of_two" if len(approvals) == 1 else "approval.second_of_two",
                     details={"request_id": pr.id, "note": note, "threshold": company.two_person_threshold})
        if len(approvals) < 2:
            pr.decision = {**decision_meta, "approvals": approvals, "needs_second_approver": True,
                           "reasons": decision_meta.get("reasons", []) + [f"First approval by {user.full_name}. Amount is at or above the two-person threshold ({sar(company.two_person_threshold)}); a second approver is required."]}
            pr.approval_note = note
            db.commit()
            db.refresh(pr)
            return pr
        decision_meta = {**decision_meta, "approvals": approvals, "needs_second_approver": False}

    agent = db.get(Agent, pr.agent_id)
    engine = get_engine(decision_meta.get("engine") or company.engine)
    auth_req = build_authorization_request(db, company, agent, pr)
    decision_id = decision_meta.get("decision_id")
    decision = engine.approve(auth_req, decision_id, user.full_name) if approve else engine.deny(auth_req, decision_id, user.full_name)

    pr.approved_by_id = user.id
    pr.approval_note = note
    pr.decided_at = utcnow()
    pr.decision = {**decision_meta, **decision_to_dict(decision), "approvals": approvals, "reasons": decision_meta.get("reasons", []) + decision.reasons}
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name,
                 event="approval.approved" if approve else "approval.rejected", details={"request_id": pr.id, "note": note})

    if decision.approved:
        pr.status = "approved"
        execute_payment(db, company, pr, decision)
    else:
        pr.status = "rejected" if not approve else "denied"
    db.commit()
    db.refresh(pr)
    return pr


# ---------------- kill switch ----------------
def set_kill_switch(db: Session, company: Company, user: User, enabled: bool, reason: str | None) -> Company:
    """Company-wide emergency stop. Besides denying new requests and freezing approvals, it pauses every active card
    (Lithic cards are PAUSED at the issuer) and restores exactly those cards when lifted."""
    company.kill_switch = enabled
    company.kill_switch_reason = reason if enabled else None
    frozen_ids: list[int] = []
    if enabled:
        for card in db.query(Card).filter(Card.company_id == company.id, Card.status == "active").all():
            card.status = "frozen"
            frozen_ids.append(card.id)
            if card.provider == "lithic":
                try:
                    get_adapter("lithic", company).set_state(card, "PAUSED")
                except Exception as exc:  # issuer unreachable: Flaire's own freeze still blocks payment
                    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="card.pause_failed", details={"card_id": card.id, "error": str(exc)})
        company.kill_switch_frozen_cards = frozen_ids
    else:
        for cid in list(company.kill_switch_frozen_cards or []):
            card = db.get(Card, cid)
            if card and card.status == "frozen":
                card.status = "active"
                if card.provider == "lithic":
                    try:
                        get_adapter("lithic", company).set_state(card, "OPEN")
                    except Exception as exc:
                        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="card.unpause_failed", details={"card_id": card.id, "error": str(exc)})
        company.kill_switch_frozen_cards = []
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name,
                 event="kill_switch.on" if enabled else "kill_switch.off", details={"reason": reason, "cards_frozen": frozen_ids if enabled else None})
    db.commit()
    db.refresh(company)
    return company

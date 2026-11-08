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
from app.models import Agent, ApprovalRule, Card, Company, Department, PurchaseRequest, Transaction, User, utcnow

settings = get_settings()


# ---------------- period rollover ----------------
def ensure_period(db: Session, company: Company) -> None:
    """Reset monthly spend counters when a new calendar month starts (and carry unspent budget when rollover is on)."""
    from app.finance import roll_period
    roll_period(db, company)


# ---------------- authorization ----------------
def build_authorization_request(db: Session, company: Company, agent: Agent, pr: PurchaseRequest, category_given: str | None = None) -> AuthorizationRequest:
    from app.core.velocity import anomaly_flags, velocity_snapshot
    dept = db.get(Department, agent.department_id)
    velocity = velocity_snapshot(db, agent, pr)
    flags = anomaly_flags(db, company, agent, pr.merchant, pr.amount, exclude_request_id=pr.id)
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
        description=pr.description or "", category_given=category_given, flags=flags,
        agent=AgentPolicy(agent_id=agent.id, agent_name=agent.name, status=agent.status, per_transaction_limit=agent.per_transaction_limit,
                          monthly_limit=agent.monthly_limit, spent_this_period=agent.spent_this_period, approval_threshold=agent.approval_threshold,
                          allowed_categories=list(agent.allowed_categories or []), blocked_merchants=list(agent.blocked_merchants or []),
                          max_requests_per_hour=agent.max_requests_per_hour, duplicate_recent=duplicate, max_requests_per_day=agent.max_requests_per_day or 50, **velocity),
        department=DepartmentBudget(department_id=dept.id, name=dept.name, monthly_budget=dept.monthly_budget, spent_this_period=dept.spent_this_period, spending_paused=dept.spending_paused),
        kill_switch=company.kill_switch,
    )


def decision_to_dict(d: Decision) -> dict:
    return {"verdict": d.verdict, "engine": d.engine, "reasons": d.reasons, "rule_id": d.rule_id, "receipt": d.receipt, "summary": d.summary, "decision_id": d.decision_id,
            "flags": list(d.flags or [])}


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
    decision = engine.authorize(build_authorization_request(db, company, agent, pr, category_given=category if how != "given" else None))
    from app.policy import current_policy_version_id
    pr.policy_version_id = current_policy_version_id(db, company)  # the exact rules this decision was judged against
    pr.decision = {**decision_to_dict(decision), "policy_version": company.policy_version}
    pr.decided_at = utcnow()
    pr.status = {"approved": "approved", "denied": "denied", "pending_approval": "pending_approval"}[decision.verdict]
    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name=f"engine:{decision.engine}", event=f"decision.{decision.verdict}",
                 details={"request_id": pr.id, "rule_id": decision.rule_id, "reasons": decision.reasons})

    if decision.approved:
        execute_payment(db, company, pr, decision)
    elif decision.verdict == "pending_approval":
        from app.core.approval_chain import attach_chain, eligible_users_for_request
        attach_chain(db, company, pr)
        if pr.amount >= (company.notify_threshold or 0):
            from app.core.notify import notify_approval_needed
            db.flush()
            notify_approval_needed(db, company, pr, recipients=eligible_users_for_request(db, company, pr))
    db.commit()
    db.refresh(pr)
    return pr


# ---------------- accountability ----------------
def first_owner(db: Session, company: Company) -> User | None:
    return (db.query(User).filter(User.company_id == company.id, User.role == "owner", User.status == "active").order_by(User.id).first()
            or db.query(User).filter(User.company_id == company.id, User.role == "owner").order_by(User.id).first())


def accountable_for(db: Session, company: Company, agent: Agent | None, pr: PurchaseRequest) -> tuple[User | None, str]:
    """Every transaction carries exactly one accountable human.
    A human approved it: that human ("approved"). Auto approved under limits: the employee's owner, or the company's first
    owner when the owner left ("auto_under_limits")."""
    if pr.approved_by_id:
        u = db.get(User, pr.approved_by_id)
        if u:
            return u, "approved"
    owner = db.get(User, agent.owner_user_id) if agent and agent.owner_user_id else None
    if owner is None or owner.company_id != company.id or (owner.status or "active") != "active":
        owner = first_owner(db, company)
    return owner, "auto_under_limits"


# ---------------- payment ----------------
def pick_card(db: Session, company: Company, pr: PurchaseRequest) -> Card | None:
    """Every AI employee pays with its own card and nothing else. Issue one on the fly if it is missing."""
    agent = db.get(Agent, pr.agent_id)
    card = db.get(Card, agent.card_id) if agent and agent.card_id else None
    if card is None and agent is not None:
        from app.cards import issue_card_for_agent
        card = issue_card_for_agent(db, company, agent)
    if card and card.status == "active":
        return card
    return None


def execute_payment(db: Session, company: Company, pr: PurchaseRequest, decision: Decision) -> Transaction | None:
    """Flaire payment service: executes only valid authorizations."""
    agent = db.get(Agent, pr.agent_id)
    engine = get_engine(decision.engine if decision.engine in ("native", "shotoku") else company.engine)
    auth_req = build_authorization_request(db, company, agent, pr)

    # Gate 0: one payment per request. A replayed receipt cannot pay the same request twice.
    if pr.transaction_id is not None or pr.status in ("completed", "failed", "denied", "rejected"):
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="payment-service", event="payment.rejected",
                     details={"request_id": pr.id, "reasons": [f"Request is already {pr.status}; receipt replay refused."]})
        return None

    # Gate 1: the receipt must be present, correctly signed, unexpired, match this exact agent/merchant/amount and never have been used before.
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
        pr.decision = {**pr.decision, "payment_error": "This AI employee has no active card. Connect Lithic in Settings → Payments or unpause the employee."}
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
    # The purchase is approved by Flaire before the card is touched, so the issuer's real-time check (ASA) can match it.
    pr.status = "approved"
    pr.decided_at = utcnow()
    db.flush()
    db.commit()
    adapter = get_adapter(card.provider, company)
    result = adapter.authorize(card, pr.amount, pr.merchant, f"FLAIRE*{pr.merchant}")
    fee = round(pr.amount * (company.fee_rate_bps or 0) / 10_000) if result.ok else 0
    from app.finance import stamp_transaction
    accountable, why = accountable_for(db, company, agent, pr)
    tx = Transaction(company_id=company.id, purchase_request_id=pr.id, card_id=card.id, provider=card.provider, provider_ref=result.provider_ref,
                     amount=pr.amount, currency=pr.currency, merchant=pr.merchant, status=result.status, decline_reason=result.decline_reason,
                     fee=fee, fee_rate_bps=company.fee_rate_bps or 0, created_at=utcnow(),
                     issuer_amount=result.issuer_amount if result.issuer_amount is not None else pr.amount,
                     issuer_currency=result.issuer_currency or pr.currency, fx_rate=result.fx_rate if result.fx_rate is not None else 1.0,
                     accountable_user_id=accountable.id if accountable else None, accountable_reason=why)
    stamp_transaction(db, company, tx, agent, dept)
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
    from app.core.approval_chain import pick_rule, progress_message, record_step_approval
    from app.core.security import approval_identities
    identities = approval_identities(db, user, pr)
    if not identities:
        raise HTTPException(403, "You can only act on requests for your own departments.")
    acting_as = next((i for i in identities if i["on_behalf_of"] is None), identities[0])
    on_behalf_of = acting_as["on_behalf_of"]
    decision_meta = dict(pr.decision or {})
    approvals: list[dict] = list(decision_meta.get("approvals", []))

    # Approval chain (ApprovalRule): every step must be satisfied, in order, before money moves. A decline by any eligible approver rejects at once.
    rule = db.get(ApprovalRule, pr.approval_rule_id) if pr.approval_rule_id else pick_rule(db, company, pr)
    if rule and not (rule.active and rule.steps):
        rule = None
    if approve and rule:
        pr.approval_rule_id = rule.id
        decision_meta, state, complete = record_step_approval(db, company, user, pr, rule, note)
        approvals = list(decision_meta.get("approvals", []))
        if not complete:
            pr.decision = {**decision_meta, "reasons": decision_meta.get("reasons", []) + [progress_message(state)]}
            pr.approval_note = note
            db.commit()
            db.refresh(pr)
            return pr
        decision_meta = {**decision_meta, "reasons": decision_meta.get("reasons", []) + [progress_message(state)]}
    # Two-person rule (no chain configured): first approval is recorded, money moves only after a second, different human approves.
    elif approve and pr.amount >= company.two_person_threshold:
        if any(a.get("user_id", a.get("id")) == user.id for a in approvals):
            raise HTTPException(409, "You already approved this. A different approver must give the second approval.")
        approvals.append({"user_id": user.id, "name": user.full_name, "role": acting_as["role"], "at": utcnow().isoformat(), "step": None,
                          "on_behalf_of": {"id": on_behalf_of.id, "full_name": on_behalf_of.full_name} if on_behalf_of else None, "id": user.id, "full_name": user.full_name})
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
                 event="approval.approved" if approve else "approval.rejected",
                 details={"request_id": pr.id, "note": note, "role": acting_as["role"], "rule_id": rule.id if rule else None,
                          "on_behalf_of": {"id": on_behalf_of.id, "full_name": on_behalf_of.full_name} if on_behalf_of else None})

    if decision.approved:
        pr.status = "approved"
        execute_payment(db, company, pr, decision)
    else:
        pr.status = "rejected" if not approve else "denied"
    from app.core.notify import notify_decision
    notify_decision(db, company, pr, user)
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
    from app.core.notify import notify_kill_switch
    notify_kill_switch(db, company, user, enabled, reason)
    db.commit()
    db.refresh(company)
    return company

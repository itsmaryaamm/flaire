from sqlalchemy.orm import Session

from app.models import Agent, Card, Department, PurchaseRequest, Transaction, User
from app.schemas import Accountable, AgentOut, AgentOwner, ApprovedBy, DepartmentOut, PurchaseRequestOut, TransactionOut


def department_out(d: Department) -> DepartmentOut:
    return DepartmentOut(id=d.id, name=d.name, monthly_budget=d.monthly_budget, spent_this_period=d.spent_this_period,
                         remaining=d.remaining, period_start=d.period_start, spending_paused=d.spending_paused, agent_count=len(d.agents),
                         cost_center_id=d.cost_center_id, gl_code=d.gl_code, rollover_balance=d.rollover_balance or 0)


def agent_out(a: Agent) -> AgentOut:
    card = None
    if a.card_id:
        from app.core.db import SessionLocal
        from sqlalchemy.orm import object_session
        sess = object_session(a)
        c = sess.get(Card, a.card_id) if sess else None
        if c:
            card = {"id": c.id, "provider": c.provider, "last4": c.last4, "status": c.status, "available_balance": c.available_balance, "credit_limit": c.credit_limit}
    owner = None
    if a.owner_user_id:
        from sqlalchemy.orm import object_session
        sess = object_session(a)
        u = sess.get(User, a.owner_user_id) if sess else None
        if u:
            owner = AgentOwner(id=u.id, full_name=u.full_name)
    return AgentOut(card=card, owner=owner, owner_user_id=a.owner_user_id, id=a.id, name=a.name, role=a.role, department_id=a.department_id, department_name=a.department.name if a.department else "",
                    status=a.status, per_transaction_limit=a.per_transaction_limit, monthly_limit=a.monthly_limit, spent_this_period=a.spent_this_period,
                    approval_threshold=a.approval_threshold, allowed_categories=list(a.allowed_categories or []), blocked_merchants=list(a.blocked_merchants or []),
                    max_requests_per_hour=a.max_requests_per_hour, max_requests_per_day=a.max_requests_per_day or 50, key_prefix=a.key_prefix, last_active_at=a.last_active_at, key_expires_at=a.key_expires_at, created_at=a.created_at,
                    cost_center_id=a.cost_center_id, gl_code=a.gl_code)


def _approved_by(a: dict) -> ApprovedBy:
    """Chain entries use user_id/name; the older two-person entries used id/full_name. Accept both."""
    return ApprovedBy(id=a.get("user_id", a.get("id")), full_name=a.get("name", a.get("full_name", "")), role=a.get("role"), step=a.get("step"),
                      at=a.get("at"), on_behalf_of=a.get("on_behalf_of"))


def purchase_out(pr: PurchaseRequest) -> PurchaseRequestOut:
    return PurchaseRequestOut(id=pr.id, agent_id=pr.agent_id, agent_name=pr.agent.name if pr.agent else "", department_id=pr.department_id,
                              department_name=pr.department.name if pr.department else "", amount=pr.amount, currency=pr.currency, merchant=pr.merchant,
                              category=pr.category, description=pr.description or "", status=pr.status, decision=pr.decision or {}, transaction_id=pr.transaction_id,
                              flags=list((pr.decision or {}).get("flags") or []),
                              approved_by=ApprovedBy(id=pr.approved_by.id, full_name=pr.approved_by.full_name) if pr.approved_by else None,
                              approvals=[_approved_by(a) for a in (pr.decision or {}).get("approvals", [])],
                              needs_second_approver=bool((pr.decision or {}).get("needs_second_approver")),
                              approval_note=pr.approval_note, created_at=pr.created_at, decided_at=pr.decided_at)


def transaction_out(t: Transaction, db: Session | None = None) -> TransactionOut:
    card = t.card
    label = f"{card.label} •••• {card.last4}" if card else "?"
    from sqlalchemy.orm import object_session
    sess = object_session(t)
    pr = sess.get(PurchaseRequest, t.purchase_request_id) if sess else None
    acc = sess.get(User, t.accountable_user_id) if sess and t.accountable_user_id else None
    approvals = [_approved_by(a) for a in (pr.decision or {}).get("approvals", [])] if pr else []
    if pr and pr.approved_by and not any(x.id == pr.approved_by.id for x in approvals):
        approvals.append(ApprovedBy(id=pr.approved_by.id, full_name=pr.approved_by.full_name, role=pr.approved_by.role))
    return TransactionOut(issuer_amount=t.issuer_amount if t.issuer_amount is not None else t.amount, issuer_currency=t.issuer_currency or t.currency,
                          fx_rate=t.fx_rate if t.fx_rate is not None else 1.0,
                          accountable=Accountable(id=acc.id, full_name=acc.full_name, role=acc.role) if acc else None, accountable_reason=t.accountable_reason,
                          approved_by=approvals, id=t.id, purchase_request_id=t.purchase_request_id, card_id=t.card_id, card_label=label, provider=t.provider, provider_ref=t.provider_ref,
                          amount=t.amount, currency=t.currency, merchant=t.merchant, status=t.status, decline_reason=t.decline_reason,
                          fee=t.fee or 0, fee_rate_bps=t.fee_rate_bps or 0, vat_amount=t.vat_amount or 0, vat_rate_bps=t.vat_rate_bps or 0,
                          cost_center_id=t.cost_center_id, gl_code=t.gl_code, period=t.period, locked=bool(t.locked),
                          agent_name=pr.agent.name if pr and pr.agent else None, created_at=t.created_at)

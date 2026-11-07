from sqlalchemy.orm import Session

from app.models import Agent, Card, Department, PurchaseRequest, Transaction
from app.schemas import AgentOut, ApprovedBy, DepartmentOut, PurchaseRequestOut, TransactionOut


def department_out(d: Department) -> DepartmentOut:
    return DepartmentOut(id=d.id, name=d.name, monthly_budget=d.monthly_budget, spent_this_period=d.spent_this_period,
                         remaining=d.remaining, period_start=d.period_start, spending_paused=d.spending_paused, agent_count=len(d.agents))


def agent_out(a: Agent) -> AgentOut:
    card = None
    if a.card_id:
        from app.core.db import SessionLocal
        from sqlalchemy.orm import object_session
        sess = object_session(a)
        c = sess.get(Card, a.card_id) if sess else None
        if c:
            card = {"id": c.id, "provider": c.provider, "last4": c.last4, "status": c.status, "available_balance": c.available_balance, "credit_limit": c.credit_limit}
    return AgentOut(card=card,id=a.id, name=a.name, role=a.role, department_id=a.department_id, department_name=a.department.name if a.department else "",
                    status=a.status, per_transaction_limit=a.per_transaction_limit, monthly_limit=a.monthly_limit, spent_this_period=a.spent_this_period,
                    approval_threshold=a.approval_threshold, allowed_categories=list(a.allowed_categories or []), blocked_merchants=list(a.blocked_merchants or []),
                    max_requests_per_hour=a.max_requests_per_hour, key_prefix=a.key_prefix, last_active_at=a.last_active_at, key_expires_at=a.key_expires_at, created_at=a.created_at)


def purchase_out(pr: PurchaseRequest) -> PurchaseRequestOut:
    return PurchaseRequestOut(id=pr.id, agent_id=pr.agent_id, agent_name=pr.agent.name if pr.agent else "", department_id=pr.department_id,
                              department_name=pr.department.name if pr.department else "", amount=pr.amount, currency=pr.currency, merchant=pr.merchant,
                              category=pr.category, description=pr.description or "", status=pr.status, decision=pr.decision or {}, transaction_id=pr.transaction_id,
                              approved_by=ApprovedBy(id=pr.approved_by.id, full_name=pr.approved_by.full_name) if pr.approved_by else None,
                              approvals=[ApprovedBy(**a) for a in (pr.decision or {}).get("approvals", [])],
                              needs_second_approver=bool((pr.decision or {}).get("needs_second_approver")),
                              approval_note=pr.approval_note, created_at=pr.created_at, decided_at=pr.decided_at)


def transaction_out(t: Transaction, db: Session | None = None) -> TransactionOut:
    card = t.card
    label = f"{card.label} •••• {card.last4}" if card else "?"
    from sqlalchemy.orm import object_session
    sess = object_session(t)
    pr = sess.get(PurchaseRequest, t.purchase_request_id) if sess else None
    return TransactionOut(id=t.id, purchase_request_id=t.purchase_request_id, card_id=t.card_id, card_label=label, provider=t.provider, provider_ref=t.provider_ref,
                          amount=t.amount, currency=t.currency, merchant=t.merchant, status=t.status, decline_reason=t.decline_reason,
                          fee=t.fee or 0, fee_rate_bps=t.fee_rate_bps or 0, agent_name=pr.agent.name if pr and pr.agent else None, created_at=t.created_at)

from sqlalchemy.orm import Session

from app.models import Agent, Card, Department, PurchaseRequest, Transaction
from app.schemas import AgentOut, ApprovedBy, DepartmentOut, PurchaseRequestOut, TransactionOut


def department_out(d: Department) -> DepartmentOut:
    return DepartmentOut(id=d.id, name=d.name, monthly_budget=d.monthly_budget, spent_this_period=d.spent_this_period,
                         remaining=d.remaining, period_start=d.period_start, agent_count=len(d.agents))


def agent_out(a: Agent) -> AgentOut:
    return AgentOut(id=a.id, name=a.name, role=a.role, department_id=a.department_id, department_name=a.department.name if a.department else "",
                    status=a.status, per_transaction_limit=a.per_transaction_limit, monthly_limit=a.monthly_limit, spent_this_period=a.spent_this_period,
                    approval_threshold=a.approval_threshold, allowed_categories=list(a.allowed_categories or []), blocked_merchants=list(a.blocked_merchants or []),
                    max_requests_per_hour=a.max_requests_per_hour, key_prefix=a.key_prefix, last_active_at=a.last_active_at, created_at=a.created_at)


def purchase_out(pr: PurchaseRequest) -> PurchaseRequestOut:
    return PurchaseRequestOut(id=pr.id, agent_id=pr.agent_id, agent_name=pr.agent.name if pr.agent else "", department_id=pr.department_id,
                              department_name=pr.department.name if pr.department else "", amount=pr.amount, currency=pr.currency, merchant=pr.merchant,
                              category=pr.category, description=pr.description or "", status=pr.status, decision=pr.decision or {}, transaction_id=pr.transaction_id,
                              approved_by=ApprovedBy(id=pr.approved_by.id, full_name=pr.approved_by.full_name) if pr.approved_by else None,
                              approval_note=pr.approval_note, created_at=pr.created_at, decided_at=pr.decided_at)


def transaction_out(t: Transaction, db: Session | None = None) -> TransactionOut:
    card = t.card
    label = f"{card.label} •••• {card.last4}" if card else "?"
    return TransactionOut(id=t.id, purchase_request_id=t.purchase_request_id, card_id=t.card_id, card_label=label, provider=t.provider, provider_ref=t.provider_ref,
                          amount=t.amount, currency=t.currency, merchant=t.merchant, status=t.status, decline_reason=t.decline_reason, created_at=t.created_at)

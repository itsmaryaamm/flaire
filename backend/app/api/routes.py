from __future__ import annotations

from datetime import datetime, timedelta, timezone

from datetime import timedelta as _td

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.agents.runner import run_agent_task
from app.api.serializers import agent_out, department_out, purchase_out, transaction_out
from app.core import audit, guard
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import (create_access_token, deny_read_only, generate_agent_key, get_current_agent, get_current_user, hash_password, require_approver,
                               verify_password, visible_department_ids)
from app.integrations.payments import MOCK_PROVIDERS, get_adapter
from app.models import Agent, AgentRun, AuditEntry, Card, Company, Department, PurchaseRequest, Transaction, User
from app.schemas import (AgentCreatedOut, AgentIn, AgentKeyOut, AgentOut, AgentPatch, ApprovalIn, AuditOut, AuthOut, CardIn, CardOut, CardPatch, CompanyOut,
                         CompanyPatch, DepartmentIn, DepartmentOut, DepartmentPatch, KillSwitchIn, LoginIn, PurchaseIn, PurchaseRequestOut, RegisterIn, RunIn,
                         RunOut, TopUpIn, TransactionOut, UserOut)
from app.policy import GOVERNED_FIELDS, bump_policy, propose_or_apply
from app.services import ensure_period, resolve_approval, set_kill_switch, submit_purchase_request

settings = get_settings()
router = APIRouter()


def company_of(user: User, db: Session) -> Company:
    return db.get(Company, user.company_id)


def company_out(c: Company) -> CompanyOut:
    # Rows created before a column existed can carry NULL where the model expects a list.
    if c.trusted_merchants is None:
        c.trusted_merchants = []
    if c.kill_switch_frozen_cards is None:
        c.kill_switch_frozen_cards = []
    out = CompanyOut.model_validate(c)
    out.lithic_configured = bool(c.lithic_api_key_enc) or bool(settings.lithic_api_key)
    return out


# ====================================================== auth
@router.post("/auth/register", response_model=AuthOut, status_code=201, tags=["auth"])
def register(body: RegisterIn, db: Session = Depends(get_db)):
    from app.core import supabase as sb
    if sb.enabled():
        raise HTTPException(409, "Sign up is handled by the sign-in provider on the dashboard.")
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(409, "Email already registered")
    company = Company(name=body.company_name, engine=settings.auth_engine)
    db.add(company)
    db.flush()
    user = User(company_id=company.id, email=body.email.lower(), full_name=body.full_name, password_hash=hash_password(body.password), role="owner")
    db.add(user)
    db.flush()
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="company.created", details={"name": company.name})
    db.commit()
    return AuthOut(access_token=create_access_token(user.id, company.id), user=UserOut.model_validate(user), company=company_out(company))


@router.post("/auth/login", response_model=AuthOut, tags=["auth"])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    guard.check_rate(f"login:{guard.client_ip(request)}", limit=guard.LOGIN_LIMIT_PER_15_MIN, window=900)
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if user.totp_enabled:
        from app.api.auth_extra import totp_ok
        if not body.code:
            raise HTTPException(401, "2fa_required")
        if not totp_ok(user, body.code):
            raise HTTPException(401, "Invalid authentication code")
    company = company_of(user, db)
    return AuthOut(access_token=create_access_token(user.id, company.id), user=UserOut.model_validate(user), company=company_out(company))


@router.get("/auth/me", tags=["auth"])
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = company_of(user, db) if user.company_id else None
    return {"user": UserOut.model_validate(user), "company": company_out(c) if c else None, "needs_onboarding": c is None}


@router.get("/auth/config", tags=["auth"])
def auth_config():
    from app.core import supabase as sb
    return {"provider": "supabase" if sb.enabled() else "builtin", "supabase_url": settings.supabase_url if sb.enabled() else None,
            "supabase_anon_key": settings.supabase_anon_key if sb.enabled() else None}


# ====================================================== company
@router.get("/company", response_model=CompanyOut, tags=["company"])
def get_company(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return company_out(company_of(user, db))


@router.patch("/company", response_model=CompanyOut, tags=["company"])
def patch_company(body: CompanyPatch, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    c = company_of(user, db)
    if body.name:
        c.name = body.name
    if body.engine:
        c.engine = body.engine
        audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="engine.changed", details={"engine": body.engine})
    sec = {k: v for k, v in body.model_dump(exclude_none=True).items() if k in ("require_password_on_approve", "two_person_threshold", "trusted_merchants", "new_merchant_review_from", "notify_threshold", "require_2fa_for_approvers", "require_change_approval")}
    if sec.get("require_2fa_for_approvers") and not user.totp_enabled:
        raise HTTPException(409, "Enable 2FA on your own account first, otherwise you would lock yourself out of approvals.")
    if body.lithic_api_key is not None:
        from app.core.crypto import encrypt
        c.lithic_api_key_enc = encrypt(body.lithic_api_key.strip()) if body.lithic_api_key.strip() else None
        audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="payments.lithic_key_set" if body.lithic_api_key.strip() else "payments.lithic_key_removed", details={})
    if "trusted_merchants" in sec:
        sec["trusted_merchants"] = [m.strip() for m in sec["trusted_merchants"] if m.strip()][:200]
    # Security settings go through change control: tightening applies now, loosening may need a second admin (app.policy).
    diff = {k: {"from": getattr(c, k), "to": v} for k, v in sec.items() if getattr(c, k) != v}
    applied, pending = propose_or_apply(db, c, user, "company", c, diff, body.change_reason or "")
    if applied and diff:
        audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="security.updated", details={k: d["to"] for k, d in diff.items()})
    db.commit()
    if pending is not None:
        return JSONResponse(status_code=202, content={"pending_change_id": pending.id, "message": "Needs a second admin"})
    db.refresh(c)
    return company_out(c)


@router.post("/company/kill-switch", response_model=CompanyOut, tags=["company"])
def kill_switch(body: KillSwitchIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    c = set_kill_switch(db, company_of(user, db), user, body.enabled, body.reason)
    bump_policy(db, c, user, f"Kill switch {'on' if body.enabled else 'off'} by {user.full_name}")
    db.commit()
    db.refresh(c)
    return company_out(c)


# ====================================================== departments
@router.get("/departments", response_model=list[DepartmentOut], tags=["departments"])
def list_departments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = company_of(user, db)
    ensure_period(db, c)
    db.commit()
    return [department_out(d) for d in db.query(Department).filter(Department.company_id == c.id).order_by(Department.id).all()]


@router.post("/departments", response_model=DepartmentOut, status_code=201, tags=["departments"])
def create_department(body: DepartmentIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    c = company_of(user, db)
    d = Department(company_id=c.id, name=body.name, monthly_budget=body.monthly_budget)
    db.add(d)
    db.flush()
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="department.created", details={"id": d.id, "name": d.name, "monthly_budget": d.monthly_budget})
    db.commit()
    db.refresh(d)
    return department_out(d)


def _dept(db: Session, user: User, dept_id: int) -> Department:
    d = db.get(Department, dept_id)
    if not d or d.company_id != user.company_id:
        raise HTTPException(404, "Department not found")
    return d


@router.patch("/departments/{dept_id}", response_model=DepartmentOut, tags=["departments"])
def patch_department(dept_id: int, body: DepartmentPatch, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    d = _dept(db, user, dept_id)
    changes = body.model_dump(exclude_none=True)
    if "cost_center_id" in changes:
        from app.api.finance import check_cost_center
        check_cost_center(db, user.company_id, changes["cost_center_id"])
    reason = changes.pop("change_reason", "") or ""
    governed = {k: changes.pop(k) for k in list(changes) if k in GOVERNED_FIELDS["department"]}
    for k, v in changes.items():
        setattr(d, k, v)
    diff = {k: {"from": getattr(d, k), "to": v} for k, v in governed.items() if getattr(d, k) != v}
    applied, pending = propose_or_apply(db, company_of(user, db), user, "department", d, diff, reason)
    audit.record(db, d.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="department.updated",
                 details={"id": d.id, **changes, **({k: v["to"] for k, v in diff.items()} if applied else {"pending_change_id": pending.id})})
    db.commit()
    if pending is not None:
        return JSONResponse(status_code=202, content={"pending_change_id": pending.id, "message": "Needs a second admin"})
    db.refresh(d)
    return department_out(d)


@router.delete("/departments/{dept_id}", status_code=204, tags=["departments"])
def delete_department(dept_id: int, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    d = _dept(db, user, dept_id)
    if d.agents:
        raise HTTPException(409, "Move or delete the department's agents first")
    db.delete(d)
    db.commit()


# ====================================================== agents
def _agent(db: Session, user: User, agent_id: int) -> Agent:
    a = db.get(Agent, agent_id)
    if not a or a.company_id != user.company_id:
        raise HTTPException(404, "Agent not found")
    return a


@router.get("/agents", response_model=list[AgentOut], tags=["agents"])
def list_agents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [agent_out(a) for a in db.query(Agent).filter(Agent.company_id == user.company_id).order_by(Agent.id).all()]


@router.post("/agents", response_model=AgentCreatedOut, status_code=201, tags=["agents"])
def create_agent(body: AgentIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    _dept(db, user, body.department_id)
    plain, h, prefix = generate_agent_key()
    fields = body.model_dump()
    days = fields.pop("key_expires_in_days", None)
    if fields.get("cost_center_id"):
        from app.api.finance import check_cost_center
        check_cost_center(db, user.company_id, fields["cost_center_id"])
    a = Agent(company_id=user.company_id, api_key_hash=h, key_prefix=prefix, key_expires_at=(datetime.now(timezone.utc) + _td(days=days)) if days else None, **fields)
    db.add(a)
    db.flush()
    audit.record(db, a.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="agent.created", details={"id": a.id, "name": a.name, "role": a.role})
    from app.cards import issue_card_for_agent
    issue_card_for_agent(db, company_of(user, db), a, actor=user.full_name)
    db.commit()
    db.refresh(a)
    return AgentCreatedOut(agent=agent_out(a), api_key=plain)


@router.get("/agents/{agent_id}", response_model=AgentOut, tags=["agents"])
def get_agent(agent_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return agent_out(_agent(db, user, agent_id))


@router.patch("/agents/{agent_id}", response_model=AgentOut, tags=["agents"])
def patch_agent(agent_id: int, body: AgentPatch, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    a = _agent(db, user, agent_id)
    changes = body.model_dump(exclude_none=True)
    if "key_expires_in_days" in changes:
        days = changes.pop("key_expires_in_days")
        a.key_expires_at = (datetime.now(timezone.utc) + _td(days=days)) if days else None
        changes["key_expires_at"] = a.key_expires_at.isoformat() if a.key_expires_at else None
    if "department_id" in changes:
        _dept(db, user, changes["department_id"])
    if "cost_center_id" in changes:
        from app.api.finance import check_cost_center
        check_cost_center(db, user.company_id, changes["cost_center_id"])
    if "status" in changes and changes["status"] not in ("active", "paused"):
        raise HTTPException(422, "status must be active or paused")
    reason = changes.pop("change_reason", "") or ""
    governed = {k: changes.pop(k) for k in list(changes) if k in GOVERNED_FIELDS["agent"]}
    for k, v in changes.items():
        setattr(a, k, v)
    diff = {k: {"from": getattr(a, k), "to": v} for k, v in governed.items() if getattr(a, k) != v}
    applied, pending = propose_or_apply(db, company_of(user, db), user, "agent", a, diff, reason)
    audit.record(db, a.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="agent.updated",
                 details={"id": a.id, **changes, **({k: v["to"] for k, v in diff.items()} if applied else {"pending_change_id": pending.id})})
    from app.cards import sync_card_with_agent
    sync_card_with_agent(db, company_of(user, db), a)
    db.commit()
    if pending is not None:
        return JSONResponse(status_code=202, content={"pending_change_id": pending.id, "message": "Needs a second admin"})
    db.refresh(a)
    return agent_out(a)


@router.post("/agents/{agent_id}/rotate-key", response_model=AgentKeyOut, tags=["agents"])
def rotate_key(agent_id: int, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    a = _agent(db, user, agent_id)
    plain, h, prefix = generate_agent_key()
    a.api_key_hash, a.key_prefix = h, prefix
    audit.record(db, a.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="agent.key_rotated", details={"id": a.id})
    db.commit()
    return AgentKeyOut(api_key=plain)


@router.delete("/agents/{agent_id}", status_code=204, tags=["agents"])
def delete_agent(agent_id: int, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    a = _agent(db, user, agent_id)
    if db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == a.id).count():
        a.status = "paused"
        a.api_key_hash = "revoked"
        audit.record(db, a.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="agent.revoked", details={"id": a.id})
    else:
        db.delete(a)
    db.commit()


def _run_out(db: Session, run: AgentRun) -> RunOut:
    prs = db.query(PurchaseRequest).filter(PurchaseRequest.id.in_(run.purchase_request_ids or [-1])).all()
    return RunOut(run_id=run.id, agent_id=run.agent_id, task=run.task, mode=run.mode, transcript=run.transcript, purchase_requests=[purchase_out(p) for p in prs], created_at=run.created_at)


@router.post("/agents/{agent_id}/run", response_model=RunOut, tags=["agents"])
def run_agent(agent_id: int, body: RunIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deny_read_only(user)
    a = _agent(db, user, agent_id)
    c = company_of(user, db)
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="agent.task_assigned", details={"agent_id": a.id, "task": body.task[:200]})
    db.commit()
    run = run_agent_task(db, c, a, body.task)
    return _run_out(db, run)


@router.get("/agents/{agent_id}/runs", response_model=list[RunOut], tags=["agents"])
def list_runs(agent_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _agent(db, user, agent_id)
    runs = db.query(AgentRun).filter(AgentRun.agent_id == a.id).order_by(AgentRun.id.desc()).limit(20).all()
    return [_run_out(db, r) for r in runs]


# ====================================================== agent-facing (X-Agent-Key)
@router.get("/agent/me", tags=["agent api"])
def agent_me(agent: Agent = Depends(get_current_agent), db: Session = Depends(get_db)):
    c = db.get(Company, agent.company_id)
    return {**agent_out(agent).model_dump(), "department": department_out(agent.department).model_dump(), "kill_switch": c.kill_switch}


@router.post("/agent/purchase-requests", response_model=PurchaseRequestOut, status_code=201, tags=["agent api"])
def agent_purchase(body: PurchaseIn, agent: Agent = Depends(get_current_agent), db: Session = Depends(get_db)):
    c = db.get(Company, agent.company_id)
    if body.card_id and not db.query(Card).filter(Card.id == body.card_id, Card.company_id == c.id).first():
        raise HTTPException(404, "Card not found")
    pr = submit_purchase_request(db, c, agent, amount=body.amount, merchant=body.merchant, category=body.category, description=body.description, card_id=body.card_id)
    return purchase_out(pr)


@router.get("/agent/purchase-requests", response_model=list[PurchaseRequestOut], tags=["agent api"])
def agent_requests(agent: Agent = Depends(get_current_agent), db: Session = Depends(get_db)):
    return [purchase_out(p) for p in db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id).order_by(PurchaseRequest.id.desc()).limit(50).all()]


@router.get("/agent/purchase-requests/{pr_id}", response_model=PurchaseRequestOut, tags=["agent api"])
def agent_request(pr_id: int, agent: Agent = Depends(get_current_agent), db: Session = Depends(get_db)):
    pr = db.get(PurchaseRequest, pr_id)
    if not pr or pr.agent_id != agent.id:
        raise HTTPException(404, "Request not found")
    return purchase_out(pr)


# ====================================================== purchases / approvals / transactions
@router.get("/purchase-requests", response_model=list[PurchaseRequestOut], tags=["purchases"])
def list_purchases(status: str | None = None, agent_id: int | None = None, limit: int = Query(50, le=500), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == user.company_id)
    scope = visible_department_ids(db, user)
    if scope is not None:
        q = q.filter(PurchaseRequest.department_id.in_(scope))
    if status:
        q = q.filter(PurchaseRequest.status == status)
    if agent_id:
        q = q.filter(PurchaseRequest.agent_id == agent_id)
    return [purchase_out(p) for p in q.order_by(PurchaseRequest.id.desc()).limit(limit).all()]


def _pr(db: Session, user: User, pr_id: int) -> PurchaseRequest:
    pr = db.get(PurchaseRequest, pr_id)
    if not pr or pr.company_id != user.company_id:
        raise HTTPException(404, "Request not found")
    return pr


@router.get("/purchase-requests/{pr_id}", response_model=PurchaseRequestOut, tags=["purchases"])
def get_purchase(pr_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return purchase_out(_pr(db, user, pr_id))


@router.get("/approvals", response_model=list[PurchaseRequestOut], tags=["approvals"])
def list_approvals(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == user.company_id, PurchaseRequest.status == "pending_approval")
    scope = visible_department_ids(db, user)
    if scope is not None:
        q = q.filter(PurchaseRequest.department_id.in_(scope))
    return [purchase_out(p) for p in q.order_by(PurchaseRequest.id.asc()).all()]


def _require_2fa_policy(user: User, company: Company) -> None:
    if company.require_2fa_for_approvers and not user.totp_enabled:
        raise HTTPException(403, "Your company requires two-factor authentication for approvers. Enable it in Settings → Security.")


@router.post("/approvals/{pr_id}/approve", response_model=PurchaseRequestOut, tags=["approvals"])
def approve(pr_id: int, body: ApprovalIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    _require_2fa_policy(user, company_of(user, db))
    return purchase_out(resolve_approval(db, company_of(user, db), user, _pr(db, user, pr_id), True, body.note, body.password))


@router.post("/approvals/{pr_id}/reject", response_model=PurchaseRequestOut, tags=["approvals"])
def reject(pr_id: int, body: ApprovalIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    _require_2fa_policy(user, company_of(user, db))
    return purchase_out(resolve_approval(db, company_of(user, db), user, _pr(db, user, pr_id), False, body.note, body.password))


@router.get("/transactions", response_model=list[TransactionOut], tags=["transactions"])
def list_transactions(card_id: int | None = None, limit: int = Query(50, le=500), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Transaction).filter(Transaction.company_id == user.company_id)
    if card_id:
        q = q.filter(Transaction.card_id == card_id)
    return [transaction_out(t) for t in q.order_by(Transaction.id.desc()).limit(limit).all()]


@router.get("/transactions/{tx_id}", response_model=TransactionOut, tags=["transactions"])
def get_transaction(tx_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(Transaction, tx_id)
    if not t or t.company_id != user.company_id:
        raise HTTPException(404, "Transaction not found")
    return transaction_out(t)


@router.post("/transactions/{tx_id}/settle", response_model=TransactionOut, tags=["transactions"])
def settle_transaction(tx_id: int, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    """Retry clearing for an authorization that did not settle (Lithic sandbox)."""
    t = db.get(Transaction, tx_id)
    if not t or t.company_id != user.company_id:
        raise HTTPException(404, "Transaction not found")
    if t.status != "authorized":
        raise HTTPException(409, f"Transaction is {t.status}; only authorized transactions can be settled")
    card = db.get(Card, t.card_id)
    result = get_adapter(card.provider, company_of(user, db)).settle(card, t.provider_ref, t.amount)
    if result.ok:
        t.status = "settled"
    audit.record(db, t.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="payment.settle_retry",
                 details={"transaction_id": t.id, "ok": result.ok, "error": result.decline_reason})
    db.commit()
    db.refresh(t)
    if not result.ok:
        raise HTTPException(502, f"Lithic clearing failed: {result.decline_reason}")
    return transaction_out(t)


# ====================================================== cards
@router.get("/cards", response_model=list[CardOut], tags=["cards"])
def list_cards(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Card).filter(Card.company_id == user.company_id).order_by(Card.id).all()


@router.post("/cards", response_model=CardOut, status_code=201, tags=["cards"])
def create_card(body: CardIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    if body.provider not in MOCK_PROVIDERS and body.provider != "lithic":
        raise HTTPException(422, f"provider must be one of {', '.join(MOCK_PROVIDERS)}, lithic")
    if body.provider in MOCK_PROVIDERS and settings.env == "prod":
        raise HTTPException(422, "Simulated bank cards are not available. Cards are issued per AI employee through Lithic.")
    if body.department_id:
        _dept(db, user, body.department_id)
    try:
        info = get_adapter(body.provider, company_of(user, db)).create_card(body.label, body.credit_limit, "SAR")
    except Exception as exc:
        raise HTTPException(400, str(exc))
    if body.is_default:
        db.query(Card).filter(Card.company_id == user.company_id).update({"is_default": False})
    card = Card(company_id=user.company_id, department_id=body.department_id, label=body.label, provider=body.provider, last4=body.last4 or info["last4"],
                credit_limit=body.credit_limit, available_balance=info["available_balance"], provider_token=info["provider_token"], is_default=body.is_default)
    db.add(card)
    db.flush()
    audit.record(db, card.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="card.added", details={"id": card.id, "label": card.label, "provider": card.provider, "last4": card.last4})
    db.commit()
    db.refresh(card)
    return card


def _card(db: Session, user: User, card_id: int) -> Card:
    c = db.get(Card, card_id)
    if not c or c.company_id != user.company_id:
        raise HTTPException(404, "Card not found")
    return c


@router.patch("/cards/{card_id}", response_model=CardOut, tags=["cards"])
def patch_card(card_id: int, body: CardPatch, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    card = _card(db, user, card_id)
    changes = body.model_dump(exclude_none=True)
    if changes.get("status") not in (None, "active", "frozen"):
        raise HTTPException(422, "status must be active or frozen")
    if changes.get("is_default"):
        db.query(Card).filter(Card.company_id == user.company_id).update({"is_default": False})
    for k, v in changes.items():
        setattr(card, k, v)
    audit.record(db, card.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="card.updated", details={"id": card.id, **changes})
    db.commit()
    db.refresh(card)
    return card


@router.post("/cards/{card_id}/top-up", response_model=CardOut, tags=["cards"])
def top_up(card_id: int, body: TopUpIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    card = _card(db, user, card_id)
    if card.provider not in MOCK_PROVIDERS:
        raise HTTPException(409, "Top-up is only available on simulated bank cards")
    card.available_balance += body.amount
    audit.record(db, card.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="card.topped_up", details={"id": card.id, "amount": body.amount})
    db.commit()
    db.refresh(card)
    return card


# ====================================================== dashboard
@router.get("/dashboard/summary", tags=["dashboard"])
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = company_of(user, db)
    ensure_period(db, c)
    db.commit()
    depts = db.query(Department).filter(Department.company_id == c.id).order_by(Department.id).all()
    agents = db.query(Agent).filter(Agent.company_id == c.id).order_by(Agent.id).all()
    base = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == c.id)
    since = datetime.now(timezone.utc) - timedelta(days=13)
    rows = (db.query(func.date(Transaction.created_at), func.sum(Transaction.amount)).filter(Transaction.company_id == c.id, Transaction.status == "settled", Transaction.created_at >= since)
            .group_by(func.date(Transaction.created_at)).all())
    by_day = {str(d): int(s or 0) for d, s in rows}
    days = [(datetime.now(timezone.utc) - timedelta(days=i)).date() for i in range(13, -1, -1)]
    return {
        "company": company_out(c),
        "kill_switch": c.kill_switch,
        "totals": {
            "spent_this_period": sum(d.spent_this_period for d in depts),
            "budget_total": sum(d.monthly_budget for d in depts),
            "pending_count": base.filter(PurchaseRequest.status == "pending_approval").count(),
            "blocked_count": base.filter(PurchaseRequest.status.in_(["denied", "rejected", "failed"])).count(),
            "completed_count": base.filter(PurchaseRequest.status == "completed").count(),
            "agent_count": len(agents),
            "card_count": db.query(Card).filter(Card.company_id == c.id).count(),
        },
        "departments": [department_out(d) for d in depts],
        "agents": [agent_out(a) for a in agents],
        "recent_requests": [purchase_out(p) for p in base.order_by(PurchaseRequest.id.desc()).limit(10).all()],
        "recent_transactions": [transaction_out(t) for t in db.query(Transaction).filter(Transaction.company_id == c.id).order_by(Transaction.id.desc()).limit(10).all()],
        "spend_by_day": [{"date": str(d), "amount": by_day.get(str(d), 0)} for d in days],
    }


# ====================================================== audit
@router.get("/audit", response_model=list[AuditOut], tags=["audit"])
def list_audit(limit: int = Query(100, le=1000), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(AuditEntry).filter(AuditEntry.company_id == user.company_id).order_by(AuditEntry.id.desc()).limit(limit).all()


@router.get("/audit/verify", tags=["audit"])
def verify_audit(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return audit.verify(db, user.company_id)


# ====================================================== reconciliation + exports
@router.get("/reconciliation", tags=["audit"])
def reconciliation(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Match purchase requests against payment events and flag anything that does not line up."""
    cid = user.company_id
    prs = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == cid).all()
    txs = {t.purchase_request_id: t for t in db.query(Transaction).filter(Transaction.company_id == cid).all()}
    issues = []
    for pr in prs:
        tx = txs.get(pr.id)
        if pr.status == "completed" and (not tx or tx.status not in ("settled", "authorized")):
            issues.append({"request_id": pr.id, "type": "completed_without_settlement", "detail": f"Request marked completed but transaction is {tx.status if tx else 'missing'}"})
        if pr.status in ("denied", "rejected", "pending_approval") and tx and tx.status in ("settled", "authorized"):
            issues.append({"request_id": pr.id, "type": "payment_without_approval", "detail": "Money moved for a request that was not approved"})
        if pr.status == "approved":
            issues.append({"request_id": pr.id, "type": "stuck_approved", "detail": "Approved but no payment outcome recorded"})
        if tx and tx.amount != pr.amount:
            issues.append({"request_id": pr.id, "type": "amount_mismatch", "detail": f"Request {pr.amount} vs transaction {tx.amount}"})
    dup = {}
    for t in txs.values():
        key = (t.provider, t.provider_ref)
        dup.setdefault(key, []).append(t.id)
    for key, ids in dup.items():
        if len(ids) > 1:
            issues.append({"request_id": None, "type": "duplicate_provider_ref", "detail": f"{key[0]} ref {key[1]} appears on transactions {ids}"})
    return {"ok": len(issues) == 0, "requests": len(prs), "transactions": len(txs), "issues": issues}


@router.get("/export/{kind}.csv", tags=["audit"])
def export_csv(kind: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    import csv, io
    from fastapi.responses import StreamingResponse
    buf = io.StringIO()
    w = csv.writer(buf)
    cid = user.company_id
    if kind == "transactions":
        w.writerow(["id", "created_at", "request_id", "agent", "department", "merchant", "category", "amount_sar", "status", "provider", "provider_ref", "card"])
        for t in db.query(Transaction).filter(Transaction.company_id == cid).order_by(Transaction.id).all():
            pr = db.get(PurchaseRequest, t.purchase_request_id)
            w.writerow([t.id, t.created_at.isoformat(), t.purchase_request_id, pr.agent.name if pr else "", pr.department.name if pr else "", t.merchant, pr.category if pr else "",
                        f"{t.amount / 100:.2f}", t.status, t.provider, t.provider_ref, f"{t.card.label} {t.card.last4}" if t.card else ""])
    elif kind == "requests":
        w.writerow(["id", "created_at", "agent", "department", "merchant", "category", "amount_sar", "status", "verdict", "rule_id", "approved_by", "description", "reasons"])
        for pr in db.query(PurchaseRequest).filter(PurchaseRequest.company_id == cid).order_by(PurchaseRequest.id).all():
            d = pr.decision or {}
            w.writerow([pr.id, pr.created_at.isoformat(), pr.agent.name, pr.department.name, pr.merchant, pr.category, f"{pr.amount / 100:.2f}", pr.status, d.get("verdict"), d.get("rule_id"),
                        pr.approved_by.full_name if pr.approved_by else "", pr.description, " | ".join(d.get("reasons", []))])
    elif kind == "audit":
        w.writerow(["id", "ts", "actor_type", "actor_name", "event", "details", "prev_hash", "hash"])
        for e in db.query(AuditEntry).filter(AuditEntry.company_id == cid).order_by(AuditEntry.id).all():
            import json as _json
            w.writerow([e.id, e.ts.isoformat(), e.actor_type, e.actor_name, e.event, _json.dumps(e.details, ensure_ascii=False), e.prev_hash, e.hash])
    else:
        raise HTTPException(404, "kind must be transactions, requests or audit")
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=flaire-{kind}.csv"})


# ====================================================== push notifications (installed phone app)
@router.get("/push/vapid-public-key", tags=["push"])
def vapid_public_key(db: Session = Depends(get_db)):
    from app.core.push import get_keys
    return {"public_key": get_keys(db)[1]}


@router.post("/push/subscribe", status_code=201, tags=["push"])
def push_subscribe(body: dict, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models import PushSubscription
    endpoint = body.get("endpoint"); keys = body.get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(422, "Invalid push subscription")
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == endpoint).first()
    if not sub:
        sub = PushSubscription(user_id=user.id, endpoint=endpoint, p256dh=keys["p256dh"], auth=keys["auth"], user_agent=request.headers.get("user-agent", "")[:300])
        db.add(sub)
    else:
        sub.user_id, sub.p256dh, sub.auth = user.id, keys["p256dh"], keys["auth"]
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="push.subscribed", details={"device": request.headers.get("user-agent", "")[:80]})
    db.commit()
    return {"ok": True}


@router.delete("/push/subscribe", status_code=204, tags=["push"])
def push_unsubscribe(body: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models import PushSubscription
    db.query(PushSubscription).filter(PushSubscription.endpoint == body.get("endpoint", ""), PushSubscription.user_id == user.id).delete()
    db.commit()


@router.post("/push/test", tags=["push"])
def push_test(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.core.push import send_to_company_approvers
    result = send_to_company_approvers(db, user.company_id, "Flaire test", "Push notifications are working on this device.", f"{settings.dashboard_url}/approvals")
    db.commit()
    return result


# ====================================================== connected Claudes (OAuth connections)
@router.get("/connections", tags=["connector"])
def list_connections(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models import OAuthToken
    rows = db.query(OAuthToken).filter(OAuthToken.company_id == user.company_id, OAuthToken.revoked.is_(False)).order_by(OAuthToken.id.desc()).all()
    out = []
    for t in rows:
        ag = db.get(Agent, t.agent_id)
        u = db.get(User, t.user_id)
        out.append({"id": t.id, "agent_id": t.agent_id, "agent_name": ag.name if ag else "?", "connected_by": u.full_name if u else "?",
                    "client": t.client_id if not t.client_id.startswith("fcl_") else "Claude", "created_at": t.created_at, "last_used_at": t.last_used_at, "expires_at": t.expires_at})
    return out


@router.delete("/connections/{conn_id}", status_code=204, tags=["connector"])
def revoke_connection(conn_id: int, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    from app.models import OAuthToken
    t = db.query(OAuthToken).filter(OAuthToken.id == conn_id, OAuthToken.company_id == user.company_id).first()
    if not t:
        raise HTTPException(404, "Connection not found")
    t.revoked = True
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="connector.revoked", details={"connection_id": t.id, "agent_id": t.agent_id})
    db.commit()


@router.get("/connector-info", tags=["connector"])
def connector_info(request: Request, user: User = Depends(get_current_user)):
    from app.api.oauth import base_url
    return {"url": f"{base_url(request)}/api/v1/mcp", "auth": "Sign in now", "steps": ["Claude → Settings → Connectors → Add custom connector", "Name: Flaire. URL: the one above. Authentication: Sign in now.", "Click Add, sign in with your Flaire email and password, choose which AI employee this Claude is."]}


# ====================================================== Flaire fees
@router.get("/fees/statement", tags=["audit"])
def fee_statement(month: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Flaire's fee (company.fee_rate_bps of every settled transaction), by month. month=YYYY-MM, default current."""
    from datetime import date as _date
    c = company_of(user, db)
    today = _date.today()
    y, m = (int(month[:4]), int(month[5:7])) if month else (today.year, today.month)
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m // 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    rows = db.query(Transaction).filter(Transaction.company_id == c.id, Transaction.status.in_(["settled", "authorized"]), Transaction.created_at >= start, Transaction.created_at < end).all()
    volume = sum(t.amount for t in rows)
    fees = sum(t.fee or 0 for t in rows)
    vat = sum(t.vat_amount or 0 for t in rows)
    fee_vat = round(fees * 15 / 100)
    return {"month": f"{y:04d}-{m:02d}", "fee_rate_bps": c.fee_rate_bps, "transactions": len(rows), "volume": volume, "volume_excl_vat": volume - vat, "vat": vat,
            "vat_rate_bps": c.vat_rate_bps, "fees": fees, "fee_vat": fee_vat, "fees_incl_vat": fees + fee_vat,
            "lines": [{"id": t.id, "created_at": t.created_at, "merchant": t.merchant, "amount": t.amount, "vat_amount": t.vat_amount or 0,
                       "amount_excl_vat": t.amount - (t.vat_amount or 0), "fee": t.fee or 0} for t in rows]}


# ====================================================== conversations
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    run_id: int | None = None          # continue an employee thread
    history: list[dict] | None = None  # assistant: prior turns from the client


@router.post("/agents/{agent_id}/chat", response_model=RunOut, tags=["agents"])
def agent_chat(agent_id: int, body: ChatIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.agents.chat import employee_chat
    deny_read_only(user)
    a = _agent(db, user, agent_id)
    c = company_of(user, db)
    run = db.get(AgentRun, body.run_id) if body.run_id else None
    if run and (run.agent_id != a.id or run.company_id != c.id):
        raise HTTPException(404, "Thread not found")
    run = employee_chat(db, c, a, user, run, body.message)
    return _run_out(db, run)


@router.post("/assistant/chat", tags=["assistant"])
def assistant(body: ChatIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.agents.chat import assistant_chat
    return assistant_chat(db, company_of(user, db), user, body.history or [], body.message)

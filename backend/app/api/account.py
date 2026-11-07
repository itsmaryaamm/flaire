"""Onboarding for new users and account deletion.

Onboarding (a user exists but has no company yet, typically after Supabase sign-up):
  POST /onboarding/company  {company_name, full_name?}            → creates the company, user becomes owner
  POST /onboarding/quickstart {department_name, monthly_budget}   → first department + a simulated SNB card + Marketing AI
  GET  /onboarding/status                                          → checklist the dashboard shows new users

Deletion:
  DELETE /account {confirm: "DELETE", password}
    sole owner of the company → deletes the company and every row that belongs to it (agents, requests, cards, ledger,
    other users, connections), then the user. Otherwise only the user and their connections.
    The Supabase user is removed too when Supabase is in use.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import audit
from app.core.db import get_db
from app.core.security import generate_agent_key, get_current_user, verify_user_password
from app.integrations.payments import get_adapter
from app.models import (Agent, AgentRun, AuditEntry, Card, Company, Department, OAuthCode, OAuthToken, PasswordReset, PurchaseRequest, PushSubscription,
                        Transaction, User)

router = APIRouter()


class CompanyIn(BaseModel):
    company_name: str = Field(min_length=2, max_length=200)
    full_name: str | None = Field(default=None, max_length=200)


class QuickstartIn(BaseModel):
    department_name: str = Field(default="Marketing", min_length=1, max_length=120)
    monthly_budget: int = Field(default=500_000, ge=0)        # halalas
    card_limit: int = Field(default=1_000_000, ge=0)          # halalas, simulated SNB card
    create_agent: bool = True


@router.post("/onboarding/company", tags=["onboarding"])
def create_company(body: CompanyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.company_id is not None:
        raise HTTPException(409, "You already belong to a company.")
    company = Company(name=body.company_name.strip(), trusted_merchants=["Google Ads", "Meta Ads", "Canva", "Notion", "Slack", "AWS", "Aramex"], onboarding_done=False)
    db.add(company)
    db.flush()
    user.company_id = company.id
    user.role = "owner"
    if body.full_name:
        user.full_name = body.full_name.strip()
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="company.created", details={"name": company.name})
    db.commit()
    from app.api.routes import company_out
    return {"company": company_out(company), "next": "quickstart"}


@router.post("/onboarding/quickstart", tags=["onboarding"])
def quickstart(body: QuickstartIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    company = db.get(Company, user.company_id)
    if user.role not in ("owner", "admin", "finance"):
        raise HTTPException(403, "Only owners can set up the company.")
    made = {}
    dept = db.query(Department).filter(Department.company_id == company.id).first()
    if not dept:
        dept = Department(company_id=company.id, name=body.department_name.strip(), monthly_budget=body.monthly_budget)
        db.add(dept)
        db.flush()
        made["department"] = dept.name
    if not db.query(Card).filter(Card.company_id == company.id).count():
        info = get_adapter("mock_snb").create_card("SNB Business", body.card_limit, "SAR")
        db.add(Card(company_id=company.id, label="SNB Business", provider="mock_snb", last4=info["last4"], credit_limit=body.card_limit,
                    available_balance=info["available_balance"], provider_token=info["provider_token"], is_default=True))
        made["card"] = "SNB Business (simulated)"
    if body.create_agent and not db.query(Agent).filter(Agent.company_id == company.id).count():
        _, h, prefix = generate_agent_key()
        db.add(Agent(company_id=company.id, department_id=dept.id, name="Marketing AI", role="marketing", api_key_hash=h, key_prefix=prefix,
                     per_transaction_limit=100_000, monthly_limit=400_000, approval_threshold=100_000, allowed_categories=[], blocked_merchants=[]))
        made["agent"] = "Marketing AI"
    company.onboarding_done = True
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="onboarding.quickstart", details=made)
    db.commit()
    return {"ok": True, "created": made}


@router.get("/onboarding/status", tags=["onboarding"])
def status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.company_id is None:
        return {"has_company": False, "steps": {}}
    cid = user.company_id
    company = db.get(Company, cid)
    steps = {
        "company": True,
        "department": db.query(Department).filter(Department.company_id == cid).count() > 0,
        "card": db.query(Card).filter(Card.company_id == cid).count() > 0,
        "agent": db.query(Agent).filter(Agent.company_id == cid).count() > 0,
        "claude_connected": db.query(OAuthToken).filter(OAuthToken.company_id == cid, OAuthToken.revoked.is_(False)).count() > 0,
        "first_request": db.query(PurchaseRequest).filter(PurchaseRequest.company_id == cid).count() > 0,
        "two_factor": bool(user.totp_enabled),
    }
    return {"has_company": True, "onboarding_done": bool(company.onboarding_done), "steps": steps, "complete": all(steps.values())}


@router.post("/onboarding/dismiss", tags=["onboarding"])
def dismiss(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    company = db.get(Company, user.company_id)
    company.onboarding_done = True
    db.commit()
    return {"ok": True}


class DeleteIn(BaseModel):
    confirm: str
    password: str | None = None


def _delete_company(db: Session, cid: int) -> None:
    db.query(OAuthCode).filter(OAuthCode.company_id == cid).delete()
    db.query(OAuthToken).filter(OAuthToken.company_id == cid).delete()
    db.query(AgentRun).filter(AgentRun.company_id == cid).delete()
    db.query(Transaction).filter(Transaction.company_id == cid).delete()
    db.query(PurchaseRequest).filter(PurchaseRequest.company_id == cid).delete()
    db.query(Card).filter(Card.company_id == cid).delete()
    db.query(Agent).filter(Agent.company_id == cid).delete()
    db.query(Department).filter(Department.company_id == cid).delete()
    db.query(AuditEntry).filter(AuditEntry.company_id == cid).delete()
    for u in db.query(User).filter(User.company_id == cid).all():
        db.query(PushSubscription).filter(PushSubscription.user_id == u.id).delete()
        db.query(PasswordReset).filter(PasswordReset.user_id == u.id).delete()
    db.query(User).filter(User.company_id == cid).delete()
    db.query(Company).filter(Company.id == cid).delete()


@router.delete("/account", tags=["account"])
def delete_account(body: DeleteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.confirm != "DELETE":
        raise HTTPException(400, 'Type DELETE to confirm.')
    if not verify_user_password(user, body.password):
        raise HTTPException(403, "Password is wrong.")
    uid = user.supabase_uid
    removed = "user"
    if user.company_id is not None:
        cid = user.company_id
        other_owners = db.query(User).filter(User.company_id == cid, User.role == "owner", User.id != user.id).count()
        if user.role == "owner" and other_owners == 0:
            _delete_company(db, cid)
            removed = "company"
        else:
            db.query(OAuthToken).filter(OAuthToken.user_id == user.id).update({"revoked": True})
            db.query(PushSubscription).filter(PushSubscription.user_id == user.id).delete()
            db.query(PasswordReset).filter(PasswordReset.user_id == user.id).delete()
            audit.record(db, cid, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="account.deleted", details={})
            db.query(User).filter(User.id == user.id).delete()
    else:
        db.query(User).filter(User.id == user.id).delete()
    db.commit()
    if uid:
        from app.core.supabase import admin_delete_user
        admin_delete_user(uid)
    return {"ok": True, "removed": removed}

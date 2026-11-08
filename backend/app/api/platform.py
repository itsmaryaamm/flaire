"""Platform owner console: cross-company, read-only metrics for the people who run Flaire itself.

Access: the signed-in user's email must be listed in PLATFORM_ADMIN_EMAILS (comma separated). Everyone else gets 403.
Nothing here returns secrets (no keys, hashes or card tokens) and nothing here changes data.

  GET /platform/overview          totals, 30 day volume and fees, weekly signups and volume, top companies
  GET /platform/companies         one row per company
  GET /platform/companies/{id}    members and agents of one company
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user, is_platform_admin
from app.models import Agent, AuditEntry, Company, Department, PurchaseRequest, Transaction, User

router = APIRouter(prefix="/platform", tags=["platform"])
MONEY_STATUSES = ("settled", "authorized")


def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    if not is_platform_admin(user):
        raise HTTPException(403, "Platform console is restricted to platform owners")
    return user


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _week(dt: datetime) -> str:
    d = _aware(dt).date()
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def _since_30d() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=30)


@router.get("/overview")
def overview(user: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    since = _since_30d()
    companies = db.query(Company).order_by(Company.id).all()
    txs_all = db.query(Transaction).filter(Transaction.status.in_(MONEY_STATUSES)).all()
    txs_30 = [t for t in txs_all if _aware(t.created_at) >= since]
    weeks_cutoff = datetime.now(timezone.utc) - timedelta(weeks=12)
    signups: dict[str, int] = {}
    for c in companies:
        if _aware(c.created_at) >= weeks_cutoff:
            signups[_week(c.created_at)] = signups.get(_week(c.created_at), 0) + 1
    volume_w: dict[str, dict] = {}
    for t in txs_all:
        if _aware(t.created_at) >= weeks_cutoff:
            w = volume_w.setdefault(_week(t.created_at), {"volume": 0, "fees": 0})
            w["volume"] += t.amount
            w["fees"] += t.fee or 0
    per_company: dict[int, dict] = {}
    for t in txs_30:
        row = per_company.setdefault(t.company_id, {"volume_30d": 0, "fees_30d": 0})
        row["volume_30d"] += t.amount
        row["fees_30d"] += t.fee or 0
    names = {c.id: c.name for c in companies}
    top = sorted(({"id": cid, "name": names.get(cid, "?"), **v} for cid, v in per_company.items()), key=lambda r: r["volume_30d"], reverse=True)[:10]
    return {
        "companies": len(companies),
        "users": db.query(User).count(),
        "agents": db.query(Agent).count(),
        "active_agents": db.query(Agent).filter(Agent.status == "active").count(),
        "transactions_30d": len(txs_30),
        "volume_30d": sum(t.amount for t in txs_30),
        "fees_total": sum(t.fee or 0 for t in txs_all),
        "fees_30d": sum(t.fee or 0 for t in txs_30),
        "signups_by_week": [{"week": w, "companies": n} for w, n in sorted(signups.items())],
        "volume_by_week": [{"week": w, "volume": v["volume"], "fees": v["fees"]} for w, v in sorted(volume_w.items())],
        "top_companies": top,
    }


def _company_row(db: Session, c: Company, since: datetime) -> dict:
    txs = db.query(Transaction).filter(Transaction.company_id == c.id, Transaction.status.in_(MONEY_STATUSES), Transaction.created_at >= since).all()
    last_audit = db.query(func.max(AuditEntry.ts)).filter(AuditEntry.company_id == c.id).scalar()
    last_pr = db.query(func.max(PurchaseRequest.created_at)).filter(PurchaseRequest.company_id == c.id).scalar()
    last = max((d for d in (_aware(last_audit), _aware(last_pr)) if d), default=None)
    return {"id": c.id, "name": c.name, "created_at": c.created_at,
            "users": db.query(User).filter(User.company_id == c.id).count(),
            "agents": db.query(Agent).filter(Agent.company_id == c.id).count(),
            "transactions_30d": len(txs), "volume_30d": sum(t.amount for t in txs), "fees_30d": sum(t.fee or 0 for t in txs),
            "last_activity": last, "lithic_configured": bool(c.lithic_api_key_enc), "kill_switch": bool(c.kill_switch)}


@router.get("/companies")
def companies(user: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    since = _since_30d()
    return [_company_row(db, c, since) for c in db.query(Company).order_by(Company.id).all()]


@router.get("/companies/{company_id}")
def company_detail(company_id: int, user: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if not c:
        raise HTTPException(404, "Company not found")
    since = _since_30d()
    members = [{"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "status": u.status or "active", "totp_enabled": bool(u.totp_enabled), "created_at": u.created_at}
               for u in db.query(User).filter(User.company_id == c.id).order_by(User.id).all()]
    depts = {d.id: d.name for d in db.query(Department).filter(Department.company_id == c.id).all()}
    agents = [{"id": a.id, "name": a.name, "role": a.role, "status": a.status, "department": depts.get(a.department_id), "monthly_limit": a.monthly_limit,
               "spent_this_period": a.spent_this_period, "has_card": bool(a.card_id), "owner_user_id": a.owner_user_id, "last_active_at": a.last_active_at, "created_at": a.created_at}
              for a in db.query(Agent).filter(Agent.company_id == c.id).order_by(Agent.id).all()]
    return {**_company_row(db, c, since), "currency": c.currency, "engine": c.engine, "fee_rate_bps": c.fee_rate_bps, "require_2fa_for_all": bool(c.require_2fa_for_all),
            "asa_enrolled": bool(c.lithic_asa_enrolled), "lithic_environment": c.lithic_environment, "onboarding_done": bool(c.onboarding_done),
            "members": members, "agents": agents,
            "requests_total": db.query(PurchaseRequest).filter(PurchaseRequest.company_id == c.id).count(),
            "pending_approvals": db.query(PurchaseRequest).filter(PurchaseRequest.company_id == c.id, PurchaseRequest.status == "pending_approval").count()}

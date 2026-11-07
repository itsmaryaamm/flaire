"""Policy versions and change approval endpoints (four-eyes on the rules themselves).

GET  /policy/versions                 list versions (newest first)
GET  /policy/versions/{id}            one version with its snapshot
GET  /policy/diff?from=&to=           field-level diff between two versions
GET  /policy/changes?status=          proposed changes (pending by default)
POST /policy/changes/{id}/approve     second admin applies it (password when the company requires it)
POST /policy/changes/{id}/reject      {note}
POST /policy/changes/{id}/cancel      proposer withdraws it
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user
from app.models import Company, PolicyChange, PolicyVersion, User
from app.policy import approve_change, cancel_change, change_out, diff_snapshots, reject_change, version_out

router = APIRouter(prefix="/policy", tags=["policy"])


class ChangeDecisionIn(BaseModel):
    password: str | None = None
    note: str | None = None


def require_policy_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("owner", "admin"):
        raise HTTPException(403, "Only owners and admins can decide policy changes")
    return user


def _company(user: User, db: Session) -> Company:
    return db.get(Company, user.company_id)


def _version(db: Session, user: User, version_id: int) -> PolicyVersion:
    pv = db.get(PolicyVersion, version_id)
    if not pv or pv.company_id != user.company_id:
        raise HTTPException(404, "Policy version not found")
    return pv


def _change(db: Session, user: User, change_id: int) -> PolicyChange:
    ch = db.get(PolicyChange, change_id)
    if not ch or ch.company_id != user.company_id:
        raise HTTPException(404, "Policy change not found")
    return ch


@router.get("/versions")
def list_versions(limit: int = Query(50, le=500), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(PolicyVersion).filter(PolicyVersion.company_id == user.company_id).order_by(PolicyVersion.version.desc()).limit(limit).all()
    return [version_out(db, pv) for pv in rows]


@router.get("/versions/{version_id}")
def get_version(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return version_out(db, _version(db, user, version_id), with_snapshot=True)


@router.get("/diff")
def diff_versions(from_id: int = Query(alias="from"), to_id: int = Query(alias="to"), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a, b = _version(db, user, from_id), _version(db, user, to_id)
    return {"from": version_out(db, a), "to": version_out(db, b), "changes": diff_snapshots(a.snapshot or {}, b.snapshot or {})}


@router.get("/changes")
def list_changes(status: str | None = Query("pending"), limit: int = Query(100, le=500), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(PolicyChange).filter(PolicyChange.company_id == user.company_id)
    if status and status != "all":
        q = q.filter(PolicyChange.status == status)
    return [change_out(db, ch) for ch in q.order_by(PolicyChange.id.desc()).limit(limit).all()]


@router.get("/changes/{change_id}")
def get_change(change_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return change_out(db, _change(db, user, change_id))


@router.post("/changes/{change_id}/approve")
def approve(change_id: int, body: ChangeDecisionIn | None = None, user: User = Depends(require_policy_admin), db: Session = Depends(get_db)):
    body = body or ChangeDecisionIn()
    ch = approve_change(db, _company(user, db), user, _change(db, user, change_id), body.password, body.note)
    db.commit()
    db.refresh(ch)
    return change_out(db, ch)


@router.post("/changes/{change_id}/reject")
def reject(change_id: int, body: ChangeDecisionIn | None = None, user: User = Depends(require_policy_admin), db: Session = Depends(get_db)):
    body = body or ChangeDecisionIn()
    ch = reject_change(db, _company(user, db), user, _change(db, user, change_id), body.note)
    db.commit()
    db.refresh(ch)
    return change_out(db, ch)


@router.post("/changes/{change_id}/cancel")
def cancel(change_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = cancel_change(db, _company(user, db), user, _change(db, user, change_id))
    db.commit()
    db.refresh(ch)
    return change_out(db, ch)

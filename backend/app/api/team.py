"""Teams layer: invites, members, approval chains, delegation and the per-person / company views.

Roles: owner, admin, finance, dept_head, viewer, auditor.
  owner/admin   manage the team (invites, members, approval rules, delegations for anyone) and approve
  finance       approves
  dept_head     approves requests in its own departments only
  auditor       reads everything, including the ledger; changes nothing
  viewer        reads what its departments see (Membership rows), or the whole company if it has none
All changes go to the hash-chained audit ledger.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.serializers import purchase_out
from app.core import audit
from app.core.approval_chain import STEP_ROLES, chain_state, eligible_users_for_request, pick_rule, role_satisfies
from app.core.config import get_settings
from app.core.db import get_db
from app.core.notify import notify_invite
from app.core.security import (TEAM_ADMIN_ROLES, _aware, active_delegations_for, approval_identities, bearer, create_access_token, get_current_user,
                               hash_password, require_role, user_department_ids)
from app.models import (ROLES, ApprovalRule, AuditEntry, Company, Delegation, Department, Invite, Membership, OAuthToken, PasswordReset, PurchaseRequest,
                        PushSubscription, User, utcnow)

settings = get_settings()
router = APIRouter()

INVITE_DAYS = 7


def _company(user: User, db: Session) -> Company:
    return db.get(Company, user.company_id)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _dept(db: Session, company_id: int, dept_id: int | None) -> Department | None:
    if dept_id is None:
        return None
    d = db.get(Department, dept_id)
    if not d or d.company_id != company_id:
        raise HTTPException(404, "Department not found")
    return d


def _user_out(db: Session, u: User, last_seen: dict | None = None) -> dict:
    dept = db.get(Department, u.department_id) if u.department_id else None
    members = db.query(Membership).filter(Membership.user_id == u.id).all()
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "status": u.status or "active",
            "department_id": u.department_id, "department_name": dept.name if dept else None,
            "departments": [m.department_id for m in members], "totp_enabled": bool(u.totp_enabled),
            "last_seen_at": (last_seen or {}).get(u.id), "created_at": u.created_at}


# ====================================================== invites
class InviteIn(BaseModel):
    email: EmailStr
    role: str = Field(default="viewer")
    department_id: int | None = None


class InviteAcceptIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    full_name: str | None = Field(default=None, max_length=200)
    password: str | None = Field(default=None, min_length=8, max_length=128)


def _invite_out(db: Session, inv: Invite) -> dict:
    dept = db.get(Department, inv.department_id) if inv.department_id else None
    by = db.get(User, inv.invited_by_id)
    now = datetime.now(timezone.utc)
    status = "accepted" if inv.accepted_at else ("expired" if _aware(inv.expires_at) < now else "pending")
    return {"id": inv.id, "email": inv.email, "role": inv.role, "department_id": inv.department_id, "department_name": dept.name if dept else None,
            "invited_by": by.full_name if by else None, "status": status, "accepted_at": inv.accepted_at, "expires_at": inv.expires_at, "created_at": inv.created_at}


@router.post("/team/invites", status_code=201, tags=["team"])
def create_invite(body: InviteIn, user: User = Depends(require_role(*TEAM_ADMIN_ROLES)), db: Session = Depends(get_db)):
    c = _company(user, db)
    email = body.email.lower().strip()
    if body.role not in ROLES:
        raise HTTPException(422, f"role must be one of {', '.join(ROLES)}")
    if body.role == "owner" and user.role != "owner":
        raise HTTPException(403, "Only an owner can invite another owner")
    existing = db.query(User).filter(User.email == email).first()
    if existing and existing.company_id == c.id:
        raise HTTPException(409, "This person is already a member")
    if existing and existing.company_id is not None:
        raise HTTPException(409, "This email already belongs to another company")
    _dept(db, c.id, body.department_id)
    # One live invite per email per company: replace any pending one.
    for old in db.query(Invite).filter(Invite.company_id == c.id, Invite.email == email, Invite.accepted_at.is_(None)).all():
        db.delete(old)
    token = secrets.token_urlsafe(32)
    inv = Invite(company_id=c.id, email=email, role=body.role, department_id=body.department_id, token_hash=_hash_token(token), invited_by_id=user.id,
                 expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_DAYS))
    db.add(inv)
    db.flush()
    link = f"{settings.dashboard_url.rstrip('/')}/invite/{token}"
    delivered, error = notify_invite(email, c.name, body.role, link, user.full_name)
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="team.invite_created",
                 details={"invite_id": inv.id, "email": email, "role": body.role, "department_id": body.department_id, "email_delivered": delivered, "error": error})
    db.commit()
    out = {**_invite_out(db, inv), "email_delivered": delivered}
    if not delivered and settings.env != "prod":
        out["accept_link"] = link
        out["token"] = token
    return out


@router.get("/team/invites", tags=["team"])
def list_invites(user: User = Depends(require_role("owner", "admin", "finance", "auditor")), db: Session = Depends(get_db)):
    rows = db.query(Invite).filter(Invite.company_id == user.company_id).order_by(Invite.id.desc()).all()
    return [_invite_out(db, i) for i in rows]


@router.delete("/team/invites/{invite_id}", status_code=204, tags=["team"])
def revoke_invite(invite_id: int, user: User = Depends(require_role(*TEAM_ADMIN_ROLES)), db: Session = Depends(get_db)):
    inv = db.get(Invite, invite_id)
    if not inv or inv.company_id != user.company_id:
        raise HTTPException(404, "Invite not found")
    if inv.accepted_at:
        raise HTTPException(409, "This invite was already accepted")
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="team.invite_revoked", details={"invite_id": inv.id, "email": inv.email})
    db.delete(inv)
    db.commit()


def _live_invite(db: Session, token: str) -> Invite:
    inv = db.query(Invite).filter(Invite.token_hash == _hash_token(token)).first()
    if not inv:
        raise HTTPException(404, "Invite not found")
    if inv.accepted_at:
        raise HTTPException(409, "This invite was already used")
    if _aware(inv.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(410, "This invite has expired. Ask for a new one.")
    return inv


@router.get("/team/invites/preview/{token}", tags=["team"])
def preview_invite(token: str, db: Session = Depends(get_db)):
    inv = _live_invite(db, token)
    c = db.get(Company, inv.company_id)
    dept = db.get(Department, inv.department_id) if inv.department_id else None
    by = db.get(User, inv.invited_by_id)
    from app.core import supabase as sb
    return {"company_name": c.name, "role": inv.role, "email": inv.email, "department_name": dept.name if dept else None,
            "invited_by": by.full_name if by else None, "expires_at": inv.expires_at,
            "existing_account": db.query(User).filter(User.email == inv.email).count() > 0, "auth": "supabase" if sb.enabled() else "builtin"}


def _optional_user(request: Request, creds: HTTPAuthorizationCredentials | None, db: Session) -> User | None:
    if creds is None:
        return None
    return get_current_user(request, creds, db)


@router.post("/team/invites/accept", tags=["team"])
def accept_invite(body: InviteAcceptIn, request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    """Two paths. Signed in (Supabase or Flaire token) with a matching email: the account is linked to the company.
    Not signed in: a Flaire account is created with the given password (builtin auth)."""
    inv = _live_invite(db, body.token)
    c = db.get(Company, inv.company_id)
    current = _optional_user(request, creds, db)
    if current is not None:
        if current.email.lower() != inv.email:
            raise HTTPException(403, f"This invite was sent to {inv.email}. Sign in with that email to accept it.")
        if current.company_id is not None and current.company_id != c.id:
            raise HTTPException(409, "You already belong to another company.")
        user = current
        if body.full_name:
            user.full_name = body.full_name.strip()
    else:
        user = db.query(User).filter(User.email == inv.email).first()
        if user and user.company_id is not None:
            raise HTTPException(409, "This email already has an account. Sign in, then open the invite link again.")
        if user is None:
            if not body.password:
                raise HTTPException(422, "Choose a password to create your account.")
            user = User(company_id=None, email=inv.email, full_name=(body.full_name or inv.email.split("@")[0]).strip(), password_hash=hash_password(body.password), role=inv.role)
            db.add(user)
            db.flush()
        elif body.password and not user.password_hash:
            user.password_hash = hash_password(body.password)
        if body.full_name and user.full_name != body.full_name.strip():
            user.full_name = body.full_name.strip()
    user.company_id = c.id
    user.role = inv.role
    user.status = "active"
    user.department_id = inv.department_id
    if inv.department_id and not db.query(Membership).filter(Membership.user_id == user.id, Membership.department_id == inv.department_id).first():
        db.add(Membership(user_id=user.id, department_id=inv.department_id))
    inv.accepted_at = utcnow()
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="team.invite_accepted",
                 details={"invite_id": inv.id, "email": inv.email, "role": inv.role, "department_id": inv.department_id, "path": "linked" if current else "builtin"})
    from app.core.notify import notify_invite_accepted
    notify_invite_accepted(db, c, inv.invited_by_id, user)
    db.commit()
    db.refresh(user)
    from app.api.routes import company_out
    return {"access_token": create_access_token(user.id, c.id), "user": _user_out(db, user), "company": company_out(c)}


# ====================================================== members
class MemberPatch(BaseModel):
    role: str | None = None
    department_id: int | None = None
    status: str | None = None
    departments: list[int] | None = None
    full_name: str | None = Field(default=None, max_length=200)


def _owners_count(db: Session, company_id: int, exclude_id: int | None = None) -> int:
    q = db.query(User).filter(User.company_id == company_id, User.role == "owner", User.status == "active")
    if exclude_id:
        q = q.filter(User.id != exclude_id)
    return q.count()


def _member(db: Session, user: User, member_id: int) -> User:
    m = db.get(User, member_id)
    if not m or m.company_id != user.company_id:
        raise HTTPException(404, "Member not found")
    return m


@router.get("/team/members", tags=["team"])
def list_members(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(User).filter(User.company_id == user.company_id).order_by(User.id).all()
    seen = dict(db.query(AuditEntry.actor_id, func.max(AuditEntry.ts)).filter(AuditEntry.company_id == user.company_id, AuditEntry.actor_type == "user")
                .group_by(AuditEntry.actor_id).all())
    return [_user_out(db, u, seen) for u in rows]


@router.patch("/team/members/{member_id}", tags=["team"])
def patch_member(member_id: int, body: MemberPatch, user: User = Depends(require_role(*TEAM_ADMIN_ROLES)), db: Session = Depends(get_db)):
    m = _member(db, user, member_id)
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(422, "Nothing to change")
    if "role" in changes:
        if m.id == user.id:
            raise HTTPException(409, "You cannot change your own role. Ask another owner.")
        if changes["role"] not in ROLES:
            raise HTTPException(422, f"role must be one of {', '.join(ROLES)}")
        if (changes["role"] == "owner" or m.role == "owner") and user.role != "owner":
            raise HTTPException(403, "Only an owner can grant or remove the owner role")
        if m.role == "owner" and changes["role"] != "owner" and _owners_count(db, user.company_id, exclude_id=m.id) == 0:
            raise HTTPException(409, "This is the last owner. Promote someone else to owner first.")
    if "status" in changes:
        if changes["status"] not in ("active", "disabled"):
            raise HTTPException(422, "status must be active or disabled")
        if m.id == user.id and changes["status"] == "disabled":
            raise HTTPException(409, "You cannot disable your own account")
        if m.role == "owner" and user.role != "owner":
            raise HTTPException(403, "Only an owner can disable an owner")
        if m.role == "owner" and changes["status"] == "disabled" and _owners_count(db, user.company_id, exclude_id=m.id) == 0:
            raise HTTPException(409, "This is the last owner. Promote someone else to owner first.")
    if "department_id" in changes:
        _dept(db, user.company_id, changes["department_id"])
    if "departments" in changes:
        ids = sorted(set(changes["departments"]))
        for did in ids:
            _dept(db, user.company_id, did)
        db.query(Membership).filter(Membership.user_id == m.id).delete()
        for did in ids:
            db.add(Membership(user_id=m.id, department_id=did))
        changes["departments"] = ids
    for k, v in changes.items():
        if k != "departments":
            setattr(m, k, v)
    if changes.get("status") == "disabled":
        db.query(OAuthToken).filter(OAuthToken.user_id == m.id).update({"revoked": True})
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="team.member_updated",
                 details={"member_id": m.id, "email": m.email, **changes})
    db.commit()
    db.refresh(m)
    return _user_out(db, m)


@router.delete("/team/members/{member_id}", status_code=204, tags=["team"])
def delete_member(member_id: int, user: User = Depends(require_role("owner")), db: Session = Depends(get_db)):
    m = _member(db, user, member_id)
    if m.id == user.id:
        raise HTTPException(409, "You cannot remove yourself. Use account deletion instead.")
    if m.role == "owner" and _owners_count(db, user.company_id, exclude_id=m.id) == 0:
        raise HTTPException(409, "This is the last owner. Promote someone else to owner first.")
    from app.models import Attachment, PeriodClose, PolicyChange, PolicyVersion
    db.query(Membership).filter(Membership.user_id == m.id).delete()
    db.query(Delegation).filter((Delegation.user_id == m.id) | (Delegation.delegate_id == m.id)).delete(synchronize_session=False)
    db.query(PushSubscription).filter(PushSubscription.user_id == m.id).delete()
    db.query(PasswordReset).filter(PasswordReset.user_id == m.id).delete()
    db.query(OAuthToken).filter(OAuthToken.user_id == m.id).delete()
    db.query(Invite).filter(Invite.invited_by_id == m.id).update({"invited_by_id": user.id})
    db.query(PurchaseRequest).filter(PurchaseRequest.approved_by_id == m.id).update({"approved_by_id": None})
    db.query(Attachment).filter(Attachment.uploaded_by_id == m.id).update({"uploaded_by_id": user.id})
    db.query(PeriodClose).filter(PeriodClose.closed_by_id == m.id).update({"closed_by_id": user.id})
    db.query(PolicyVersion).filter(PolicyVersion.created_by_id == m.id).update({"created_by_id": None})
    db.query(PolicyChange).filter(PolicyChange.proposed_by_id == m.id).update({"proposed_by_id": user.id})
    db.query(PolicyChange).filter(PolicyChange.decided_by_id == m.id).update({"decided_by_id": None})
    from app.models import Agent, Notification, Transaction
    db.query(Notification).filter(Notification.user_id == m.id).delete()
    # Accountability never goes blank: the removing owner takes over the member's employees; past transactions keep their record via the company's first owner.
    db.query(Agent).filter(Agent.owner_user_id == m.id).update({"owner_user_id": user.id})
    db.query(Transaction).filter(Transaction.accountable_user_id == m.id).update({"accountable_user_id": user.id})
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="team.member_removed",
                 details={"member_id": m.id, "email": m.email, "role": m.role})
    uid = m.supabase_uid
    db.delete(m)
    db.commit()
    if uid:
        try:
            from app.core.supabase import admin_delete_user
            admin_delete_user(uid)
        except Exception:
            pass


# ====================================================== approval rules
class StepIn(BaseModel):
    role: str
    count: int = Field(default=1, ge=1, le=10)


class RuleIn(BaseModel):
    department_id: int | None = None
    min_amount: int = Field(default=0, ge=0)   # halalas, inclusive
    steps: list[StepIn] = Field(min_length=1, max_length=6)
    active: bool = True


class RulePatch(BaseModel):
    department_id: int | None = None
    min_amount: int | None = Field(default=None, ge=0)
    steps: list[StepIn] | None = Field(default=None, min_length=1, max_length=6)
    active: bool | None = None


def _rule_out(db: Session, r: ApprovalRule) -> dict:
    dept = db.get(Department, r.department_id) if r.department_id else None
    return {"id": r.id, "department_id": r.department_id, "department_name": dept.name if dept else None, "min_amount": r.min_amount,
            "steps": list(r.steps or []), "active": bool(r.active), "created_at": r.created_at}


def _check_steps(steps: list[StepIn]) -> list[dict]:
    for s in steps:
        if s.role not in STEP_ROLES:
            raise HTTPException(422, f"step role must be one of {', '.join(STEP_ROLES)}")
    return [{"role": s.role, "count": s.count} for s in steps]


def _rule(db: Session, user: User, rule_id: int) -> ApprovalRule:
    r = db.get(ApprovalRule, rule_id)
    if not r or r.company_id != user.company_id:
        raise HTTPException(404, "Approval rule not found")
    return r


@router.get("/team/approval-rules", tags=["team"])
def list_rules(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(ApprovalRule).filter(ApprovalRule.company_id == user.company_id).order_by(ApprovalRule.department_id.is_(None), ApprovalRule.min_amount.desc()).all()
    return [_rule_out(db, r) for r in rows]


@router.post("/team/approval-rules", status_code=201, tags=["team"])
def create_rule(body: RuleIn, user: User = Depends(require_role(*TEAM_ADMIN_ROLES)), db: Session = Depends(get_db)):
    _dept(db, user.company_id, body.department_id)
    steps = _check_steps(body.steps)
    r = ApprovalRule(company_id=user.company_id, department_id=body.department_id, min_amount=body.min_amount, steps=steps, active=body.active)
    db.add(r)
    db.flush()
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="approval_rule.created",
                 details={"rule_id": r.id, "department_id": r.department_id, "min_amount": r.min_amount, "steps": steps})
    db.commit()
    db.refresh(r)
    return _rule_out(db, r)


@router.patch("/team/approval-rules/{rule_id}", tags=["team"])
def patch_rule(rule_id: int, body: RulePatch, user: User = Depends(require_role(*TEAM_ADMIN_ROLES)), db: Session = Depends(get_db)):
    r = _rule(db, user, rule_id)
    changes = body.model_dump(exclude_unset=True)
    if "department_id" in changes:
        _dept(db, user.company_id, changes["department_id"])
    if "steps" in changes:
        changes["steps"] = _check_steps(body.steps)
    for k, v in changes.items():
        setattr(r, k, v)
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="approval_rule.updated", details={"rule_id": r.id, **changes})
    db.commit()
    db.refresh(r)
    return _rule_out(db, r)


@router.delete("/team/approval-rules/{rule_id}", status_code=204, tags=["team"])
def delete_rule(rule_id: int, user: User = Depends(require_role(*TEAM_ADMIN_ROLES)), db: Session = Depends(get_db)):
    r = _rule(db, user, rule_id)
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="approval_rule.deleted", details={"rule_id": r.id})
    db.delete(r)
    db.commit()


# ====================================================== delegations
class DelegationIn(BaseModel):
    user_id: int | None = None       # defaults to the caller
    delegate_id: int
    starts_at: datetime | None = None
    ends_at: datetime
    note: str | None = Field(default=None, max_length=300)


def _delegation_out(db: Session, d: Delegation) -> dict:
    u, g = db.get(User, d.user_id), db.get(User, d.delegate_id)
    now = datetime.now(timezone.utc)
    return {"id": d.id, "user_id": d.user_id, "user_name": u.full_name if u else None, "user_role": u.role if u else None,
            "delegate_id": d.delegate_id, "delegate_name": g.full_name if g else None, "starts_at": d.starts_at, "ends_at": d.ends_at, "note": d.note,
            "active": _aware(d.starts_at) <= now <= _aware(d.ends_at), "created_at": d.created_at}


@router.get("/team/delegations", tags=["team"])
def list_delegations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Delegation).filter(Delegation.company_id == user.company_id)
    if user.role not in ("owner", "admin", "finance", "auditor"):
        q = q.filter((Delegation.user_id == user.id) | (Delegation.delegate_id == user.id))
    return [_delegation_out(db, d) for d in q.order_by(Delegation.id.desc()).all()]


@router.post("/team/delegations", status_code=201, tags=["team"])
def create_delegation(body: DelegationIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from_id = body.user_id or user.id
    if from_id != user.id and user.role not in TEAM_ADMIN_ROLES:
        raise HTTPException(403, "Only owners and admins can set a delegation for someone else")
    src = _member(db, user, from_id)
    dst = _member(db, user, body.delegate_id)
    if src.id == dst.id:
        raise HTTPException(422, "You cannot delegate to yourself")
    if (dst.status or "active") != "active":
        raise HTTPException(409, "The delegate's account is disabled")
    if src.role in ("viewer", "auditor"):
        raise HTTPException(409, "This role has nothing to delegate: it cannot approve")
    starts = _aware(body.starts_at) or datetime.now(timezone.utc)
    ends = _aware(body.ends_at)
    if ends <= starts:
        raise HTTPException(422, "ends_at must be after starts_at")
    d = Delegation(company_id=user.company_id, user_id=src.id, delegate_id=dst.id, starts_at=starts, ends_at=ends, note=body.note)
    db.add(d)
    db.flush()
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="delegation.created",
                 details={"delegation_id": d.id, "from": {"id": src.id, "name": src.full_name, "role": src.role}, "to": {"id": dst.id, "name": dst.full_name},
                          "starts_at": starts.isoformat(), "ends_at": ends.isoformat(), "note": body.note})
    db.commit()
    db.refresh(d)
    return _delegation_out(db, d)


@router.delete("/team/delegations/{delegation_id}", status_code=204, tags=["team"])
def delete_delegation(delegation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = db.get(Delegation, delegation_id)
    if not d or d.company_id != user.company_id:
        raise HTTPException(404, "Delegation not found")
    if d.user_id != user.id and user.role not in TEAM_ADMIN_ROLES:
        raise HTTPException(403, "Only the delegator, an owner or an admin can end this delegation")
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="delegation.deleted",
                 details={"delegation_id": d.id, "from": d.user_id, "to": d.delegate_id})
    db.delete(d)
    db.commit()


# ====================================================== views
def _chain_for(db: Session, company: Company, pr: PurchaseRequest) -> dict | None:
    chain = (pr.decision or {}).get("chain")
    if chain:
        return chain
    rule = db.get(ApprovalRule, pr.approval_rule_id) if pr.approval_rule_id else pick_rule(db, company, pr)
    if rule and rule.active and rule.steps:
        return chain_state(rule, list((pr.decision or {}).get("approvals", [])))
    return None


def _can_act_now(db: Session, user: User, pr: PurchaseRequest, chain: dict | None) -> bool:
    approvals = (pr.decision or {}).get("approvals", [])
    if any(a.get("user_id", a.get("id")) == user.id for a in approvals):
        return False
    identities = approval_identities(db, user, pr)
    if not identities:
        return False
    nxt = (chain or {}).get("next")
    if nxt is None:
        return True
    return any(role_satisfies(i["role"], nxt["role"]) for i in identities)


@router.get("/me/view", tags=["team"])
def my_view(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _company(user, db)
    pending = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == c.id, PurchaseRequest.status == "pending_approval").order_by(PurchaseRequest.id.asc()).all()
    needs_me = []
    for pr in pending:
        chain = _chain_for(db, c, pr)
        if _can_act_now(db, user, pr, chain):
            needs_me.append({**purchase_out(pr).model_dump(), "chain": chain})
    dept_ids = user_department_ids(db, user)
    depts = db.query(Department).filter(Department.id.in_(dept_ids or [-1])).all()
    recent = (db.query(AuditEntry).filter(AuditEntry.company_id == c.id, AuditEntry.actor_type == "user", AuditEntry.actor_id == user.id, AuditEntry.event.like("approval.%"))
              .order_by(AuditEntry.id.desc()).limit(10).all())
    delegations = [_delegation_out(db, d) for d in active_delegations_for(db, user)]
    return {"my_role": user.role, "my_departments": [{"id": d.id, "name": d.name} for d in depts],
            "needs_me": needs_me,
            "my_recent_approvals": [{"id": e.id, "ts": e.ts, "event": e.event, "details": e.details} for e in recent],
            "delegations_active_for_me": delegations}


@router.get("/admin/view", tags=["team"])
def admin_view(user: User = Depends(require_role("owner", "admin", "finance", "auditor")), db: Session = Depends(get_db)):
    c = _company(user, db)
    pending = db.query(PurchaseRequest).filter(PurchaseRequest.company_id == c.id, PurchaseRequest.status == "pending_approval").order_by(PurchaseRequest.id.asc()).all()
    depts = {d.id: d for d in db.query(Department).filter(Department.company_id == c.id).all()}
    by_dept: dict[int, dict] = {}
    for pr in pending:
        row = by_dept.setdefault(pr.department_id, {"department_id": pr.department_id, "department_name": depts[pr.department_id].name if pr.department_id in depts else "?", "count": 0, "amount": 0})
        row["count"] += 1
        row["amount"] += pr.amount
    members = db.query(User).filter(User.company_id == c.id).all()
    open_counts: dict[int, int] = {}
    for pr in pending:
        for u in eligible_users_for_request(db, c, pr):
            open_counts[u.id] = open_counts.get(u.id, 0) + 1
    approvers = [{"id": u.id, "full_name": u.full_name, "role": u.role, "status": u.status or "active", "open_count": open_counts.get(u.id, 0)}
                 for u in members if u.role in ("owner", "admin", "finance", "dept_head") or u.id in open_counts]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    stuck = [{**purchase_out(pr).model_dump(), "chain": _chain_for(db, c, pr), "age_hours": round((datetime.now(timezone.utc) - _aware(pr.created_at)).total_seconds() / 3600, 1)}
             for pr in pending if _aware(pr.created_at) < cutoff]
    return {"pending_total": len(pending), "pending_amount": sum(p.amount for p in pending),
            "pending_by_department": sorted(by_dept.values(), key=lambda r: -r["amount"]),
            "approvers": sorted(approvers, key=lambda a: -a["open_count"]),
            "members": {"count": len(members), "active": sum(1 for m in members if (m.status or "active") == "active"),
                        "by_role": {r: sum(1 for m in members if m.role == r) for r in ROLES if any(m.role == r for m in members)}},
            "pending_invites": sum(1 for i in db.query(Invite).filter(Invite.company_id == c.id, Invite.accepted_at.is_(None)).all() if _aware(i.expires_at) > datetime.now(timezone.utc)),
            "stuck_holds": stuck,
            "approval_rules": db.query(ApprovalRule).filter(ApprovalRule.company_id == c.id, ApprovalRule.active.is_(True)).count(),
            "active_delegations": sum(1 for d in db.query(Delegation).filter(Delegation.company_id == c.id).all() if _aware(d.starts_at) <= datetime.now(timezone.utc) <= _aware(d.ends_at))}

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core import guard
from app.core.db import get_db
from app.models import Agent, Delegation, Membership, PurchaseRequest, User

settings = get_settings()
bearer = HTTPBearer(auto_error=False)

# Roles that can act on a hold. dept_head is limited to its own departments (checked at the point of approval).
APPROVER_ROLES = ("owner", "admin", "finance", "dept_head")
# Roles that manage the team (invites, members, approval rules, delegations for others).
TEAM_ADMIN_ROLES = ("owner", "admin")
# Roles that may read anything in the company but never change money or policy.
READ_ONLY_ROLES = ("viewer", "auditor")


# ---------- passwords ----------
def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:
        return False


# ---------- JWT for humans ----------
def create_access_token(user_id: int, company_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": str(user_id), "cid": company_id, "exp": exp}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


ONBOARDING_OK_PATHS = ("/api/v1/auth/me", "/api/v1/onboarding", "/api/v1/account", "/api/v1/auth/2fa", "/api/v1/auth/change-password",
                       "/api/v1/team/invites/accept", "/api/v1/team/invites/preview")
# Paths a member may still use while the company requires 2FA and they have not enrolled yet (enough to set it up and sign out).
TOTP_OK_PATHS = ("/api/v1/auth/2fa", "/api/v1/auth/me", "/api/v1/auth/config", "/api/v1/auth/logout", "/api/v1/onboarding", "/api/v1/account", "/api/v1/notifications")


def is_platform_admin(user: User) -> bool:
    """Platform owner console access: the email is listed in PLATFORM_ADMIN_EMAILS."""
    return (user.email or "").lower() in get_settings().platform_admin_list


def company_requires_totp(db: Session, user: User) -> bool:
    if user.company_id is None or user.totp_enabled:
        return False
    from app.models import Company
    company = db.get(Company, user.company_id)
    return bool(company and company.require_2fa_for_all)


def _user_from_supabase(db: Session, token: str) -> User | None:
    from app.core.supabase import verify_supabase_token
    claims = verify_supabase_token(token)
    if not claims or not claims.get("sub"):
        return None
    uid = claims["sub"]
    email = (claims.get("email") or "").lower()
    user = db.query(User).filter(User.supabase_uid == uid).first()
    if not user and email:
        user = db.query(User).filter(User.email == email).first()  # link a pre-existing Flaire account by email
        if user:
            user.supabase_uid = uid
    if not user:
        meta = claims.get("user_metadata") or {}
        user = User(company_id=None, email=email or f"{uid}@supabase.local", full_name=meta.get("full_name") or meta.get("name") or email.split("@")[0],
                    password_hash="", supabase_uid=uid, role="owner")
        db.add(user)
    db.commit()
    return user


def get_current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user = None
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user = db.get(User, int(payload["sub"]))
    except jwt.PyJWTError:
        user = _user_from_supabase(db, creds.credentials)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if (user.status or "active") != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account_disabled")
    if user.company_id is None and not request.url.path.startswith(ONBOARDING_OK_PATHS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "onboarding_required")
    # Mandatory 2FA: Supabase and builtin users alike. Only the paths needed to enrol stay open.
    if not request.url.path.startswith(TOTP_OK_PATHS) and company_requires_totp(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "totp_required")
    return user


def verify_user_password(user: User, password: str | None) -> bool:
    """Password check that works for both identity stores: Supabase (password grant) or Flaire's own bcrypt hash."""
    if not password:
        return False
    if user.supabase_uid:
        from app.core.supabase import password_grant
        return password_grant(user.email, password) is not None
    return verify_password(password, user.password_hash)


def require_approver(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """Owners, admins and finance always pass. Department heads pass here and get their department checked at the point of
    approval. Anyone else passes only while an approver has delegated to them."""
    if user.role in APPROVER_ROLES:
        return user
    if any(d.role in APPROVER_ROLES for d in active_delegators(db, user)):
        return user
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners, admins, finance users and department heads can approve spending")


def require_role(*roles: str):
    """Dependency factory: `Depends(require_role("owner", "admin"))`."""
    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action needs one of these roles: {', '.join(roles)}")
        return user
    return _dep


def deny_read_only(user: User) -> None:
    if user.role in READ_ONLY_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role is read only")


# ---------- scope, delegation, approval eligibility ----------
def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def user_department_ids(db: Session, user: User) -> set[int]:
    """Home department plus Membership rows. Empty set means no department scope (whole company, if the role allows)."""
    ids = {m.department_id for m in db.query(Membership).filter(Membership.user_id == user.id).all()}
    if user.department_id:
        ids.add(user.department_id)
    return ids


def visible_department_ids(db: Session, user: User) -> set[int] | None:
    """None means the user sees the whole company. Viewers and department heads with Membership rows see only those."""
    if user.role in ("viewer", "dept_head"):
        ids = user_department_ids(db, user)
        return ids or None
    return None


def active_delegations_for(db: Session, user: User) -> list[Delegation]:
    """Delegations where `user` is the delegate and the window is open right now."""
    now = datetime.now(timezone.utc)
    rows = db.query(Delegation).filter(Delegation.delegate_id == user.id, Delegation.company_id == user.company_id).all()
    return [d for d in rows if _aware(d.starts_at) <= now <= _aware(d.ends_at)]


def active_delegators(db: Session, user: User) -> list[User]:
    out: list[User] = []
    for d in active_delegations_for(db, user):
        u = db.get(User, d.user_id)
        if u and (u.status or "active") == "active" and u.company_id == user.company_id:
            out.append(u)
    return out


def role_can_approve(db: Session, actor: User, pr: PurchaseRequest | None) -> bool:
    """Does this user's own role let them act on this request (ignoring delegation)?"""
    if (actor.status or "active") != "active":
        return False
    if actor.role in ("owner", "admin", "finance"):
        return True
    if actor.role == "dept_head":
        if pr is None:
            return True
        return pr.department_id in user_department_ids(db, actor)
    return False


def approval_identities(db: Session, user: User, pr: PurchaseRequest | None) -> list[dict]:
    """Every identity this user may approve as: themselves first, then anyone who delegated to them.
    Each item: {"user": User whose role applies, "role": str, "on_behalf_of": User | None}."""
    out: list[dict] = []
    if role_can_approve(db, user, pr):
        out.append({"user": user, "role": user.role, "on_behalf_of": None})
    for d in active_delegators(db, user):
        if role_can_approve(db, d, pr):
            out.append({"user": d, "role": d.role, "on_behalf_of": d})
    return out


def can_approve(user: User, pr: PurchaseRequest | None = None, db: Session | None = None) -> bool:
    """owner/admin/finance always; dept_head only for requests in their departments; anyone else through an active delegation."""
    if db is None:
        from sqlalchemy.orm import object_session
        db = object_session(user)
    if db is None:
        return user.role in ("owner", "admin", "finance") or (user.role == "dept_head" and (pr is None or pr.department_id == user.department_id))
    return bool(approval_identities(db, user, pr))


# ---------- API keys for AI employees ----------
def generate_agent_key() -> tuple[str, str, str]:
    """Returns (plain_key, sha256_hash, prefix). The plain key is shown exactly once."""
    plain = "flk_" + secrets.token_urlsafe(24)
    return plain, hash_api_key(plain), plain[:8]


def hash_api_key(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()


def resolve_agent_key(db: Session, key: str, request: Request | None = None) -> Agent:
    """Shared by the X-Agent-Key routes and the MCP connector. Enforces lockout, expiry, status and rate limit."""
    ip = guard.client_ip(request) if request else "unknown"
    guard.check_ip_locked(ip)
    agent = db.query(Agent).filter(Agent.api_key_hash == hash_api_key(key)).first() if key else None
    if not agent:
        guard.record_bad_key(ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown agent key")
    if agent.key_expires_at and agent.key_expires_at.replace(tzinfo=agent.key_expires_at.tzinfo or timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This agent key has expired. Ask the company to issue a new connect link.")
    guard.check_rate(f"agent:{agent.id}")
    return agent


def get_current_agent(request: Request, x_agent_key: str | None = Header(default=None), db: Session = Depends(get_db)) -> Agent:
    if not x_agent_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing X-Agent-Key header")
    return resolve_agent_key(db, x_agent_key, request)

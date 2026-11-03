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
from app.models import Agent, User

settings = get_settings()
bearer = HTTPBearer(auto_error=False)


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


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user


def require_approver(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("owner", "finance"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners and finance users can approve spending")
    return user


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

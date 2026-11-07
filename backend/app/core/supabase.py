"""Supabase Auth integration.

When SUPABASE_URL is set, identity lives in Supabase (sign-up with email confirmation, login, password reset and
magic links, Google sign-in later). Flaire keeps its own User row per person, linked by supabase_uid, for roles,
company membership, 2FA for approvals and the audit trail.

  * Dashboard sends Supabase access tokens as `Authorization: Bearer`. verify_supabase_token() checks them with the
    project's JWT secret (HS256) or JWKS (ES256/RS256) and returns the claims.
  * The Claude connector sign-in page and the approval password step verify a password server-side with the
    password grant on Supabase's auth API (no credentials are stored by Flaire).
  * Account deletion removes the Supabase user with the service role key.

Without SUPABASE_URL everything falls back to Flaire's built-in email + password (used by the test suite).
"""
from __future__ import annotations

from functools import lru_cache

import httpx
import jwt

from app.core.config import get_settings


def enabled() -> bool:
    s = get_settings()
    return bool(s.supabase_url and s.supabase_anon_key)


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True)


def verify_supabase_token(token: str) -> dict | None:
    """Returns claims (sub, email, ...) or None. Tries the shared JWT secret first, then JWKS for asymmetric keys."""
    s = get_settings()
    if not enabled():
        return None
    if s.supabase_jwt_secret:
        try:
            return jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated", options={"verify_exp": True})
        except jwt.PyJWTError:
            pass
    try:
        key = _jwks_client(s.supabase_url).get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated")
    except Exception:
        return None


def password_grant(email: str, password: str) -> dict | None:
    """Verifies email + password against Supabase. Returns the Supabase user dict or None."""
    s = get_settings()
    if not enabled():
        return None
    try:
        r = httpx.post(f"{s.supabase_url.rstrip('/')}/auth/v1/token", params={"grant_type": "password"},
                       headers={"apikey": s.supabase_anon_key, "Content-Type": "application/json"},
                       json={"email": email, "password": password}, timeout=10)
        if r.status_code != 200:
            return None
        return r.json().get("user")
    except Exception:
        return None


def admin_delete_user(uid: str) -> bool:
    s = get_settings()
    if not enabled() or not s.supabase_service_role_key:
        return False
    try:
        r = httpx.delete(f"{s.supabase_url.rstrip('/')}/auth/v1/admin/users/{uid}",
                         headers={"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {s.supabase_service_role_key}"}, timeout=10)
        return r.status_code in (200, 204, 404)
    except Exception:
        return False

"""Request-level security controls: rate limiting, bad-key lockout, security headers.

In-memory and per process, which is right for a single Render instance. Swap the dict for Redis if Flaire ever
runs on several instances.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

RATE_LIMIT_PER_MINUTE = 60       # per agent key, on /agent/* and /mcp/*
LOGIN_LIMIT_PER_15_MIN = 10      # per IP, on /auth/login
BAD_KEY_LOCKOUT_AFTER = 8        # wrong agent keys from one IP ...
BAD_KEY_LOCKOUT_SECONDS = 900    # ... locks that IP out for 15 minutes

_hits: dict[str, deque] = defaultdict(deque)
_bad_keys: dict[str, deque] = defaultdict(deque)
_locked: dict[str, float] = {}


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown"))


def _bump(bucket: dict[str, deque], key: str, window: int) -> int:
    now = time.time()
    q = bucket[key]
    q.append(now)
    while q and q[0] < now - window:
        q.popleft()
    return len(q)


def check_rate(key: str, limit: int = RATE_LIMIT_PER_MINUTE, window: int = 60) -> None:
    if _bump(_hits, key, window) > limit:
        raise HTTPException(429, f"Rate limit exceeded ({limit} requests per {window}s). Slow down.")


def check_ip_locked(ip: str) -> None:
    until = _locked.get(ip)
    if until and until > time.time():
        raise HTTPException(429, "Too many invalid keys from this address. Locked out for 15 minutes.")
    if until:
        _locked.pop(ip, None)


def record_bad_key(ip: str) -> None:
    if _bump(_bad_keys, ip, BAD_KEY_LOCKOUT_SECONDS) >= BAD_KEY_LOCKOUT_AFTER:
        _locked[ip] = time.time() + BAD_KEY_LOCKOUT_SECONDS


def reset() -> None:  # for tests
    _hits.clear(); _bad_keys.clear(); _locked.clear()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("Cache-Control", "no-store")
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return resp

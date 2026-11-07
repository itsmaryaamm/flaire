"""OAuth 2.1 authorization server for the Flaire MCP connector ("Sign in" flow in Claude).

Flow (what Claude does when a user adds https://<api>/api/v1/mcp as a custom connector):
  1. GET  /.well-known/oauth-protected-resource[/api/v1/mcp]   → points at this authorization server
  2. GET  /.well-known/oauth-authorization-server              → endpoints, PKCE S256, DCR supported
  3. POST /api/v1/oauth/register   (dynamic client registration) or a client_id that is an https URL (CIMD)
  4. GET  /api/v1/oauth/authorize  → Flaire-hosted sign-in + "which AI employee is this Claude?" page
  5. POST /api/v1/oauth/authorize  → verifies password, creates/picks the agent, redirects back with ?code=
  6. POST /api/v1/oauth/token      → exchanges code (+ PKCE verifier) for a bearer token bound to that agent
  7. Claude calls /api/v1/mcp with Authorization: Bearer <token>

Tokens are random, stored hashed, bound to one agent and one company, revocable from the dashboard, 90 days.
Codes are single-use and live 10 minutes. PKCE is required. Redirect URIs must match the registered client, or,
for URL client_ids, the metadata fetched from that URL; Claude's own domains are allowed as a fallback.
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import generate_agent_key, hash_api_key, verify_password
from app.models import Agent, Company, Department, OAuthClient, OAuthCode, OAuthToken, User, utcnow

router = APIRouter()
well_known = APIRouter()
settings = get_settings()

TOKEN_TTL_DAYS = 90
CODE_TTL_SECONDS = 600
CLAUDE_REDIRECT_HOSTS = ("claude.ai", "claude.com", "anthropic.com", "localhost", "127.0.0.1")


def base_url(request: Request) -> str:
    cfg = get_settings().api_base_url.rstrip("/")
    if cfg and "localhost" not in cfg:
        return cfg
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", "localhost:8000"))
    return f"{proto}://{host}"


# ---------------------------------------------------------------- metadata
def _as_metadata(request: Request) -> dict:
    b = base_url(request)
    return {
        "issuer": b,
        "authorization_endpoint": f"{b}/api/v1/oauth/authorize",
        "token_endpoint": f"{b}/api/v1/oauth/token",
        "registration_endpoint": f"{b}/api/v1/oauth/register",
        "revocation_endpoint": f"{b}/api/v1/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "scopes_supported": ["purchases"],
        "client_id_metadata_document_supported": True,
    }


@well_known.get("/.well-known/oauth-authorization-server", include_in_schema=False)
@well_known.get("/.well-known/oauth-authorization-server/api/v1/mcp", include_in_schema=False)
def as_metadata(request: Request):
    return _as_metadata(request)


@well_known.get("/.well-known/oauth-protected-resource", include_in_schema=False)
@well_known.get("/.well-known/oauth-protected-resource/api/v1/mcp", include_in_schema=False)
def prm(request: Request):
    b = base_url(request)
    return {"resource": f"{b}/api/v1/mcp", "authorization_servers": [b], "scopes_supported": ["purchases"], "bearer_methods_supported": ["header"]}


# ---------------------------------------------------------------- client registration
@router.post("/oauth/register", status_code=201, tags=["oauth"], include_in_schema=False)
def register_client(body: dict, db: Session = Depends(get_db)):
    redirect_uris = body.get("redirect_uris") or []
    if not redirect_uris or not all(isinstance(u, str) and u.startswith(("https://", "http://localhost", "http://127.0.0.1")) for u in redirect_uris):
        raise HTTPException(400, "redirect_uris must be https URLs")
    client = OAuthClient(client_id="fcl_" + secrets.token_urlsafe(16), client_name=str(body.get("client_name") or "MCP client")[:120],
                         redirect_uris=redirect_uris, token_endpoint_auth_method=body.get("token_endpoint_auth_method") or "none")
    db.add(client)
    db.commit()
    return {"client_id": client.client_id, "client_name": client.client_name, "redirect_uris": client.redirect_uris,
            "token_endpoint_auth_method": client.token_endpoint_auth_method, "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]}


def _allowed_redirect(db: Session, client_id: str, redirect_uri: str) -> bool:
    client = db.query(OAuthClient).filter(OAuthClient.client_id == client_id).first()
    if client:
        return redirect_uri in (client.redirect_uris or [])
    if client_id.startswith("https://"):
        # Client ID Metadata Document: fetch the document and trust its redirect_uris
        try:
            r = httpx.get(client_id, timeout=5, headers={"Accept": "application/json"})
            if r.status_code == 200:
                uris = r.json().get("redirect_uris") or []
                if redirect_uri in uris:
                    return True
        except Exception:
            pass
        host = urlparse(redirect_uri).hostname or ""
        return redirect_uri.startswith("https://") and any(host == h or host.endswith("." + h) for h in CLAUDE_REDIRECT_HOSTS)
    return False


# ---------------------------------------------------------------- authorize (sign-in page)
PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Flaire</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{{--v:#7B2FF2;--ink:#1A0B33;--mut:#8A80A0;--line:#E8E3F0;--bg:#FBFAFD;--lav:#F1E8FD}}
*{{box-sizing:border-box}}body{{margin:0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--bg);color:var(--ink);display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}}
.card{{background:#fff;border:1px solid var(--line);border-radius:20px;padding:28px;width:100%;max-width:440px}}
h1{{font-size:24px;letter-spacing:-.03em;margin:0 0 4px}}p{{color:var(--mut);margin:0 0 20px;font-size:14px}}
label{{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}}input,select{{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:10px;font:inherit;font-size:15px;background:#fff}}
button{{margin-top:22px;width:100%;padding:13px;border:0;border-radius:999px;background:var(--v);color:#fff;font:inherit;font-weight:700;font-size:15px;box-shadow:0 12px 28px -14px rgba(123,47,242,.8);cursor:pointer}}
.err{{background:#FDE6E6;color:#B3141C;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:14px}}
.who{{background:var(--lav);border-radius:12px;padding:12px 14px;font-size:13px;margin-bottom:6px}}
.logo{{font-weight:800;font-size:20px;letter-spacing:-.03em;color:var(--v);margin-bottom:18px}}
.small{{font-size:12px;color:var(--mut);margin-top:10px}}
</style></head><body><form class="card" method="post">
<div class="logo">Flaire</div>
<h1>Connect your Claude</h1>
<p>Sign in to your Flaire company. Your Claude becomes one of its AI employees: it can request purchases, and only you can approve them.</p>
<div class="who"><strong>{client}</strong> is asking to connect.</div>
{error}
<label>Email</label><input name="email" type="email" required autocomplete="email" value="{email}">
<label>Password</label><input name="password" type="password" required autocomplete="current-password">
<label>This Claude will act as</label>
<select name="agent"><option value="__new__">A new AI employee named "My Claude"</option>{agents}</select>
<p class="small">Pick an existing AI employee to reuse its limits, or create a new one (default limits: SAR 1,000 per purchase, SAR 5,000 per month, human approval above SAR 500). You can change everything in the dashboard.</p>
<input type="hidden" name="client_id" value="{client_id}"><input type="hidden" name="redirect_uri" value="{redirect_uri}"><input type="hidden" name="state" value="{state}">
<input type="hidden" name="code_challenge" value="{code_challenge}"><input type="hidden" name="code_challenge_method" value="{ccm}"><input type="hidden" name="scope" value="{scope}"><input type="hidden" name="resource" value="{resource}">
<button type="submit">Sign in and connect</button>
</form></body></html>"""


def _render(client_name: str, params: dict, error: str = "", email: str = "", agents: list[Agent] | None = None) -> HTMLResponse:
    opts = "".join(f'<option value="{a.id}">{html.escape(a.name)} ({html.escape(a.department.name if a.department else "")})</option>' for a in (agents or []))
    return HTMLResponse(PAGE.format(client=html.escape(client_name), error=f'<div class="err">{html.escape(error)}</div>' if error else "", email=html.escape(email),
                                    agents=opts, client_id=html.escape(params.get("client_id", "")), redirect_uri=html.escape(params.get("redirect_uri", "")),
                                    state=html.escape(params.get("state", "")), code_challenge=html.escape(params.get("code_challenge", "")),
                                    ccm=html.escape(params.get("code_challenge_method", "S256")), scope=html.escape(params.get("scope", "purchases")),
                                    resource=html.escape(params.get("resource", ""))))


def _client_name(db: Session, client_id: str) -> str:
    c = db.query(OAuthClient).filter(OAuthClient.client_id == client_id).first()
    if c:
        return c.client_name
    if client_id.startswith("https://"):
        return urlparse(client_id).hostname or "An MCP client"
    return "An MCP client"


@router.get("/oauth/authorize", response_class=HTMLResponse, tags=["oauth"], include_in_schema=False)
def authorize_page(request: Request, db: Session = Depends(get_db)):
    q = dict(request.query_params)
    if q.get("response_type") != "code" or not q.get("client_id") or not q.get("redirect_uri") or not q.get("code_challenge"):
        raise HTTPException(400, "response_type=code, client_id, redirect_uri and code_challenge (PKCE) are required")
    if q.get("code_challenge_method", "S256") != "S256":
        raise HTTPException(400, "Only S256 PKCE is supported")
    if not _allowed_redirect(db, q["client_id"], q["redirect_uri"]):
        raise HTTPException(400, "redirect_uri is not registered for this client")
    return _render(_client_name(db, q["client_id"]), q)


@router.post("/oauth/authorize", tags=["oauth"], include_in_schema=False)
def authorize_submit(request: Request, db: Session = Depends(get_db), email: str = Form(...), password: str = Form(...), agent: str = Form("__new__"),
                     client_id: str = Form(...), redirect_uri: str = Form(...), state: str = Form(""), code_challenge: str = Form(...),
                     code_challenge_method: str = Form("S256"), scope: str = Form("purchases"), resource: str = Form("")):
    params = {"client_id": client_id, "redirect_uri": redirect_uri, "state": state, "code_challenge": code_challenge, "code_challenge_method": code_challenge_method, "scope": scope, "resource": resource}
    if not _allowed_redirect(db, client_id, redirect_uri):
        raise HTTPException(400, "redirect_uri is not registered for this client")
    from app.core import guard
    guard.check_rate(f"oauth:{guard.client_ip(request)}", limit=15, window=900)
    user = db.query(User).filter(User.email == email.lower().strip()).first()
    if not user or not verify_password(password, user.password_hash):
        return _render(_client_name(db, client_id), params, "Wrong email or password.", email)
    if user.role not in ("owner", "finance"):
        return _render(_client_name(db, client_id), params, "Only owners and finance users can connect an AI employee.", email)
    company = db.get(Company, user.company_id)
    agents = db.query(Agent).filter(Agent.company_id == company.id, Agent.status == "active", Agent.api_key_hash != "revoked").order_by(Agent.id).all()

    if agent == "__new__":
        dept = db.query(Department).filter(Department.company_id == company.id).order_by(Department.id).first()
        if not dept:
            dept = Department(company_id=company.id, name="General", monthly_budget=500_000)
            db.add(dept)
            db.flush()
        n = db.query(Agent).filter(Agent.company_id == company.id, Agent.name.like("My Claude%")).count()
        _, h, prefix = generate_agent_key()
        ag = Agent(company_id=company.id, department_id=dept.id, name="My Claude" if n == 0 else f"My Claude {n + 1}", role="general", api_key_hash=h, key_prefix=prefix,
                   per_transaction_limit=100_000, monthly_limit=500_000, approval_threshold=50_000, allowed_categories=[], blocked_merchants=[])
        db.add(ag)
        db.flush()
        audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="agent.created", details={"id": ag.id, "name": ag.name, "via": "oauth-connect"})
    else:
        ag = next((a for a in agents if str(a.id) == agent), None)
        if not ag:
            return _render(_client_name(db, client_id), params, "That AI employee is not available.", email, agents)

    code = OAuthCode(code=secrets.token_urlsafe(32), client_id=client_id, redirect_uri=redirect_uri, code_challenge=code_challenge, scope=scope,
                     user_id=user.id, agent_id=ag.id, company_id=company.id, expires_at=utcnow() + timedelta(seconds=CODE_TTL_SECONDS))
    db.add(code)
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="connector.authorized", details={"agent_id": ag.id, "client": _client_name(db, client_id)})
    db.commit()
    sep = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(f"{redirect_uri}{sep}{urlencode({'code': code.code, 'state': state})}", status_code=302)


# ---------------------------------------------------------------- token
def _token_error(err: str, desc: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": err, "error_description": desc}, status_code=status)


def _issue(db: Session, *, client_id: str, user_id: int, agent_id: int, company_id: int, scope: str) -> dict:
    access = "fat_" + secrets.token_urlsafe(32)
    refresh = "frt_" + secrets.token_urlsafe(32)
    tok = OAuthToken(access_hash=hash_api_key(access), refresh_hash=hash_api_key(refresh), client_id=client_id, user_id=user_id, agent_id=agent_id,
                     company_id=company_id, scope=scope, expires_at=utcnow() + timedelta(days=TOKEN_TTL_DAYS))
    db.add(tok)
    db.commit()
    return {"access_token": access, "token_type": "Bearer", "expires_in": TOKEN_TTL_DAYS * 86400, "refresh_token": refresh, "scope": scope}


@router.post("/oauth/token", tags=["oauth"], include_in_schema=False)
async def token(request: Request, db: Session = Depends(get_db)):
    form = dict(await request.form()) if "application/x-www-form-urlencoded" in request.headers.get("content-type", "") else (await request.json())
    grant = form.get("grant_type")
    if grant == "authorization_code":
        code = db.query(OAuthCode).filter(OAuthCode.code == str(form.get("code", ""))).first()
        if not code or code.used or code.expires_at.replace(tzinfo=code.expires_at.tzinfo or timezone.utc) < datetime.now(timezone.utc):
            return _token_error("invalid_grant", "Authorization code is invalid or expired")
        if form.get("client_id") and form.get("client_id") != code.client_id:
            return _token_error("invalid_client", "client_id mismatch", 401)
        if form.get("redirect_uri") and form.get("redirect_uri") != code.redirect_uri:
            return _token_error("invalid_grant", "redirect_uri mismatch")
        verifier = str(form.get("code_verifier", ""))
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        if not verifier or not secrets.compare_digest(expected, code.code_challenge):
            return _token_error("invalid_grant", "PKCE verification failed")
        code.used = True
        db.flush()
        return _issue(db, client_id=code.client_id, user_id=code.user_id, agent_id=code.agent_id, company_id=code.company_id, scope=code.scope)
    if grant == "refresh_token":
        old = db.query(OAuthToken).filter(OAuthToken.refresh_hash == hash_api_key(str(form.get("refresh_token", "")))).first()
        if not old or old.revoked:
            return _token_error("invalid_grant", "Refresh token is invalid")
        old.revoked = True
        db.flush()
        return _issue(db, client_id=old.client_id, user_id=old.user_id, agent_id=old.agent_id, company_id=old.company_id, scope=old.scope)
    return _token_error("unsupported_grant_type", "Use authorization_code or refresh_token")


@router.post("/oauth/revoke", tags=["oauth"], include_in_schema=False)
async def revoke(request: Request, db: Session = Depends(get_db)):
    form = dict(await request.form())
    h = hash_api_key(str(form.get("token", "")))
    tok = db.query(OAuthToken).filter((OAuthToken.access_hash == h) | (OAuthToken.refresh_hash == h)).first()
    if tok:
        tok.revoked = True
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- bearer resolution (used by the MCP endpoint)
def agent_from_bearer(db: Session, token: str) -> Agent | None:
    if not token.startswith("fat_"):
        return None
    tok = db.query(OAuthToken).filter(OAuthToken.access_hash == hash_api_key(token)).first()
    if not tok or tok.revoked or tok.expires_at.replace(tzinfo=tok.expires_at.tzinfo or timezone.utc) < datetime.now(timezone.utc):
        return None
    tok.last_used_at = utcnow()
    agent = db.get(Agent, tok.agent_id)
    if not agent or agent.api_key_hash == "revoked":
        return None
    return agent

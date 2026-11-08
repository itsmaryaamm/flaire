"""Lithic Auth Stream Access (ASA): the issuer asks Flaire, in real time, whether a card transaction may go through.

This is the piece that makes the model real. An AI employee's card cannot be used for anything Flaire did not
approve: when the card is presented anywhere, Lithic calls this endpoint and Flaire answers within the 3 second
budget. The decision is simple and strict:

  1. Find the card and its AI employee. Unknown card or paused employee → decline.
  2. Find an approved purchase for that employee, on that card, for that amount, authorized by Flaire in the last
     10 minutes and not yet consumed → APPROVED (and mark it consumed).
  3. Otherwise → decline (UNAUTHORIZED_MERCHANT for an unknown purchase, CARD_PAUSED for frozen cards,
     INSUFFICIENT_FUNDS when the employee's remaining budget cannot cover it).

Enrollment: POST /settings/lithic/asa/enroll registers <API_BASE_URL>/api/v1/webhooks/lithic/asa with Lithic and
stores the ASA HMAC secret (encrypted) so requests can be verified with the Standard Webhooks scheme.
Everything that happens here is written to the ledger.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.webhooks import verify_standard_webhook
from app.core import audit
from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.core.db import get_db
from app.core.security import get_current_user, require_approver
from app.models import Agent, Card, Company, PurchaseRequest, User, WebhookEvent

router = APIRouter()
MATCH_WINDOW_MINUTES = 10


def _amount(body: dict) -> int:
    amounts = body.get("amounts") or {}
    for key in ("merchant", "cardholder", "hold"):
        a = (amounts.get(key) or {}).get("amount")
        if isinstance(a, int):
            return abs(a)
    a = body.get("amount")
    return abs(int(a)) if isinstance(a, (int, float)) else 0


def _card_token(body: dict) -> str | None:
    return (body.get("card") or {}).get("token") or body.get("card_token")


def _decline(result: str, reason: str, db: Session, company_id: int | None, details: dict) -> JSONResponse:
    if company_id:
        audit.record(db, company_id, actor_type="system", actor_id=None, actor_name="lithic-asa", event="asa.declined", details={**details, "result": result, "reason": reason})
        db.commit()
    return JSONResponse({"result": result})


@router.post("/webhooks/lithic/asa", include_in_schema=False)
async def asa(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        return JSONResponse({"result": "SUSPECTED_FRAUD"})
    token = _card_token(body)
    card = db.query(Card).filter(Card.provider == "lithic", Card.provider_token == token).first() if token else None
    if not card:
        return JSONResponse({"result": "UNAUTHORIZED_MERCHANT"})
    company = db.get(Company, card.company_id)

    # Signature: verified when the company has stored its ASA secret (Lithic starts signing once the secret is fetched).
    secret = decrypt(company.lithic_asa_secret_enc) if company.lithic_asa_secret_enc else None
    if secret and request.headers.get("webhook-signature"):
        try:
            verify_standard_webhook(raw, {k.lower(): v for k, v in request.headers.items()}, secret)
        except HTTPException:
            return _decline("SUSPECTED_FRAUD", "bad signature", db, company.id, {"card_id": card.id})

    event_id = request.headers.get("webhook-id") or body.get("token") or ""
    if event_id and db.query(WebhookEvent).filter(WebhookEvent.provider == "lithic-asa", WebhookEvent.event_id == event_id).first():
        prior = db.query(WebhookEvent).filter(WebhookEvent.provider == "lithic-asa", WebhookEvent.event_id == event_id).first()
        return JSONResponse({"result": (prior.payload or {}).get("_result", "UNAUTHORIZED_MERCHANT")})  # idempotent replay

    amount = _amount(body)
    merchant = ((body.get("merchant") or {}).get("descriptor") or "")[:120]
    details = {"card_id": card.id, "amount": amount, "merchant": merchant, "status": body.get("status")}

    agent = db.query(Agent).filter(Agent.card_id == card.id).first()
    if not agent or agent.status != "active" or company.kill_switch or card.status != "active":
        resp = _decline("CARD_PAUSED", "employee or card paused, or kill switch on", db, company.id, details)
        _remember(db, event_id, body, "CARD_PAUSED")
        return resp

    if body.get("status") == "BALANCE_INQUIRY":
        return JSONResponse({"result": "APPROVED", "balance": {"amount": card.available_balance, "available": card.available_balance}})

    since = datetime.now(timezone.utc) - timedelta(minutes=MATCH_WINDOW_MINUTES)
    match = (db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id, PurchaseRequest.amount == amount,
                                             PurchaseRequest.status.in_(["approved", "completed"]), PurchaseRequest.decided_at >= since).order_by(PurchaseRequest.id.desc()).all())
    match = next((m for m in match if not (m.decision or {}).get("asa_consumed")), None)
    if not match:
        if amount > (agent.monthly_limit - agent.spent_this_period):
            resp = _decline("INSUFFICIENT_FUNDS", "no approved purchase and over remaining budget", db, company.id, details)
            _remember(db, event_id, body, "INSUFFICIENT_FUNDS")
            return resp
        resp = _decline("UNAUTHORIZED_MERCHANT", "no Flaire-approved purchase matches this card transaction", db, company.id, details)
        _remember(db, event_id, body, "UNAUTHORIZED_MERCHANT")
        return resp

    match.decision = {**(match.decision or {}), "asa_consumed": True, "asa_transaction": body.get("token"), "asa_merchant": merchant}
    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="lithic-asa", event="asa.approved",
                 details={**details, "request_id": match.id, "agent_id": agent.id})
    _remember(db, event_id, body, "APPROVED")
    db.commit()
    return JSONResponse({"result": "APPROVED"})


def _remember(db: Session, event_id: str, body: dict, result: str) -> None:
    if not event_id:
        return
    db.add(WebhookEvent(provider="lithic-asa", event_id=event_id, event_type=str(body.get("status") or "AUTHORIZATION"), payload={"_result": result, "token": body.get("token")}))
    db.commit()


# ---------------------------------------------------------------- enrollment (owner action in Settings → Payments)
def _lithic_client(company: Company) -> httpx.Client:
    s = get_settings()
    key = decrypt(company.lithic_api_key_enc) if company.lithic_api_key_enc else s.lithic_api_key
    if not key:
        raise HTTPException(409, "Add your Lithic API key first.")
    return httpx.Client(base_url=s.lithic_base_url.rstrip("/"), headers={"Authorization": key, "Content-Type": "application/json"}, timeout=15)


def enroll_asa(db: Session, company: Company, api_base: str, actor: User | None = None) -> dict:
    """Register Flaire's ASA endpoint with Lithic and store the signing secret. Shared by the manual endpoint and the automatic
    attempt when a key is saved. Never raises: the outcome (enrolled, error) is stored on the company and returned."""
    url = f"{api_base.rstrip('/')}/api/v1/webhooks/lithic/asa"
    secret = None
    try:
        with _lithic_client(company) as c:
            r = c.post("/auth_stream/enroll", json={"webhook_url": url})
            if r.status_code >= 400 and "already" not in r.text.lower():
                raise RuntimeError(f"Lithic refused enrollment: {r.status_code} {r.text[:200]}")
            sec = c.get("/auth_stream/secret")
            secret = sec.json().get("secret") if sec.status_code < 400 else None
    except HTTPException as exc:
        error = str(exc.detail)
    except Exception as exc:
        error = str(exc)[:280]
    else:
        error = None
    if error:
        company.lithic_asa_enrolled = False
        company.lithic_asa_error = error[:300]
        audit.record(db, company.id, actor_type="user" if actor else "system", actor_id=actor.id if actor else None, actor_name=actor.full_name if actor else "payments",
                     event="asa.enroll_failed", details={"url": url, "error": error[:300]})
        return {"ok": False, "url": url, "signed": False, "error": error}
    company.lithic_asa_enrolled = True
    company.lithic_asa_error = None
    if secret:
        company.lithic_asa_secret_enc = encrypt(secret)
    audit.record(db, company.id, actor_type="user" if actor else "system", actor_id=actor.id if actor else None, actor_name=actor.full_name if actor else "payments",
                 event="asa.enrolled", details={"url": url, "signed": bool(secret), "automatic": actor is None})
    return {"ok": True, "url": url, "signed": bool(secret), "error": None}


def detect_lithic_environment(key: str | None) -> str:
    """sandbox or production. The key prefix decides when it can; otherwise a cheap GET against the sandbox host with that key decides."""
    s = get_settings()
    k = (key or "").strip().lower()
    if not k:
        return "sandbox" if "sandbox" in s.lithic_base_url else "production"
    if "sandbox" in k or k.startswith("sk_test") or k.startswith("test_"):
        return "sandbox"
    if k.startswith("sk_live") or k.startswith("live_") or k.startswith("prod"):
        return "production"
    try:
        r = httpx.get("https://sandbox.lithic.com/v1/cards", params={"page_size": 1}, headers={"Authorization": key.strip()}, timeout=5)
        if r.status_code < 400:
            return "sandbox"
        if r.status_code in (401, 403):
            return "production"
    except Exception:
        pass
    return "sandbox" if "sandbox" in s.lithic_base_url else "production"


def on_lithic_key_saved(db: Session, company: Company, api_base: str, actor: User) -> dict:
    """Runs right after a Lithic key is stored: detect the environment, issue cards for employees without one, try ASA enrollment."""
    from app.cards import issue_missing_cards
    key = decrypt(company.lithic_api_key_enc) if company.lithic_api_key_enc else None
    company.lithic_environment = detect_lithic_environment(key)
    issued = issue_missing_cards(db, company, actor=actor.full_name)
    asa = enroll_asa(db, company, api_base, actor=None)
    return {"environment": company.lithic_environment, "cards_issued": [c.id for c in issued], "asa": asa}


@router.post("/settings/lithic/asa/enroll", tags=["payments"])
def asa_enroll(request: Request, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    from app.api.oauth import base_url
    company = db.get(Company, user.company_id)
    if not (company.lithic_api_key_enc or get_settings().lithic_api_key):
        raise HTTPException(409, "Add your Lithic API key first.")
    out = enroll_asa(db, company, base_url(request), actor=user)
    db.commit()
    if not out["ok"]:
        raise HTTPException(502, out["error"])
    return {"ok": True, "url": out["url"], "signed": out["signed"]}


@router.delete("/settings/lithic/asa/enroll", tags=["payments"])
def asa_disenroll(user: User = Depends(require_approver), db: Session = Depends(get_db)):
    company = db.get(Company, user.company_id)
    with _lithic_client(company) as c:
        c.delete("/auth_stream/enroll")
    company.lithic_asa_enrolled = False
    company.lithic_asa_secret_enc = None
    company.lithic_asa_error = None
    audit.record(db, company.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="asa.disenrolled", details={})
    db.commit()
    return {"ok": True}


@router.get("/settings/lithic/status", tags=["payments"])
def lithic_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    company = db.get(Company, user.company_id)
    s = get_settings()
    configured = bool(company.lithic_api_key_enc or s.lithic_api_key)
    env = company.lithic_environment if (company.lithic_api_key_enc and company.lithic_environment) else ("sandbox" if "sandbox" in s.lithic_base_url else "production")
    return {"configured": configured, "asa_enrolled": bool(company.lithic_asa_enrolled), "asa_error": company.lithic_asa_error if configured else None,
            "asa_signed": bool(company.lithic_asa_secret_enc), "fee_rate_bps": company.fee_rate_bps, "environment": env}

"""Lithic Events API webhook receiver.

Lithic signs events with the Standard Webhooks scheme:
  headers  webhook-id, webhook-timestamp, webhook-signature ("v1,<base64>" possibly several, space separated)
  signed   "<id>.<timestamp>.<raw body>"  with HMAC-SHA256, secret = base64 decode of the part after "whsec_"
Verification uses the raw request body (never re-serialised JSON), constant-time comparison and a 5 minute
timestamp window. Each webhook-id is processed once (duplicate deliveries are acknowledged and ignored).

Set LITHIC_WEBHOOK_SECRET in the environment and point Lithic at  POST https://<api>/api/v1/webhooks/lithic
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.core.db import get_db
from app.models import Transaction, WebhookEvent

router = APIRouter()
TOLERANCE_SECONDS = 300


def verify_standard_webhook(raw: bytes, headers: dict[str, str], secret: str, now: float | None = None) -> str:
    """Returns the webhook id if valid, raises HTTPException otherwise."""
    msg_id = headers.get("webhook-id", "")
    ts = headers.get("webhook-timestamp", "")
    sig_header = headers.get("webhook-signature", "")
    if not (msg_id and ts and sig_header and secret):
        raise HTTPException(400, "Missing webhook signature headers")
    try:
        ts_int = int(ts)
    except ValueError:
        raise HTTPException(400, "Bad webhook timestamp")
    if abs((now or time.time()) - ts_int) > TOLERANCE_SECONDS:
        raise HTTPException(400, "Webhook timestamp outside tolerance")
    key = base64.b64decode(secret.split("_", 1)[1] if secret.startswith("whsec_") else secret)
    expected = hmac.new(key, f"{msg_id}.{ts}.".encode() + raw, hashlib.sha256).digest()
    for part in sig_header.split():
        version, _, b64 = part.partition(",")
        if version != "v1":
            continue
        try:
            if hmac.compare_digest(base64.b64decode(b64), expected):
                return msg_id
        except Exception:
            continue
    raise HTTPException(401, "Invalid webhook signature")


@router.post("/webhooks/lithic", tags=["webhooks"], include_in_schema=False)
async def lithic_webhook(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    raw = await request.body()
    msg_id = verify_standard_webhook(raw, {k.lower(): v for k, v in request.headers.items()}, settings.lithic_webhook_secret or "")

    if db.query(WebhookEvent).filter(WebhookEvent.provider == "lithic", WebhookEvent.event_id == msg_id).first():
        return {"ok": True, "duplicate": True}
    import json
    payload = json.loads(raw or b"{}")
    event_type = str(payload.get("event_type") or payload.get("type") or "unknown")
    db.add(WebhookEvent(provider="lithic", event_id=msg_id, event_type=event_type, payload=payload))

    # Reconcile: find our transaction by the authorization token Lithic gave us and mirror the state.
    body = payload.get("payload") or payload
    token = body.get("token") or body.get("transaction_token")
    status_map = {"transaction.updated": None, "authorization.approved": "authorized", "clearing": "settled", "void": "reversed", "return": "reversed"}
    tx = db.query(Transaction).filter(Transaction.provider == "lithic", Transaction.provider_ref == token).first() if token else None
    if tx:
        new_status = None
        result = str(body.get("status") or body.get("result") or "").upper()
        if "SETTLED" in result or event_type.endswith("clearing"):
            new_status = "settled"
        elif "VOID" in result or "REVERS" in result or "RETURN" in result or "DECLINED" in result:
            new_status = "reversed" if "DECLINED" not in result else "declined"
        elif "PENDING" in result or "AUTHORIZ" in event_type:
            new_status = "authorized"
        if new_status and new_status != tx.status:
            old = tx.status
            tx.status = new_status
            audit.record(db, tx.company_id, actor_type="system", actor_id=None, actor_name="lithic-webhook", event="payment.reconciled",
                         details={"transaction_id": tx.id, "from": old, "to": new_status, "event_id": msg_id, "event_type": event_type})
    db.commit()
    return {"ok": True, "matched_transaction": tx.id if tx else None}

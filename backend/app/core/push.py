"""Web Push notifications to the installed Flaire app on phones (iPhone 16.4+ home-screen apps and Android).

VAPID keys: set VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY in the environment, or Flaire generates a pair on first boot
and stores it in the vapid_keys table so every instance uses the same one. The public key is served at
GET /push/vapid-public-key for the browser; subscriptions are stored per user.
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import PushSubscription, User, VapidKey


def get_keys(db: Session) -> tuple[str, str]:
    """Returns (private_pem, public_key_base64url)."""
    settings = get_settings()
    if settings.vapid_private_key and settings.vapid_public_key:
        return settings.vapid_private_key.replace("\\n", "\n"), settings.vapid_public_key
    row = db.query(VapidKey).first()
    if row:
        return row.private_pem, row.public_key
    from py_vapid import Vapid
    v = Vapid()
    v.generate_keys()
    private_pem = v.private_pem().decode()
    import base64
    from cryptography.hazmat.primitives import serialization
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    public_b64 = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    db.add(VapidKey(private_pem=private_pem, public_key=public_b64))
    db.commit()
    return private_pem, public_b64


def send_to_company_approvers(db: Session, company_id: int, title: str, body: str, url: str) -> dict:
    settings = get_settings()
    private_pem, _ = get_keys(db)
    subs = (db.query(PushSubscription).join(User, User.id == PushSubscription.user_id)
            .filter(User.company_id == company_id, User.role.in_(["owner", "finance"])).all())
    sent, failed = 0, 0
    errors: list[str] = []
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return {"sent": 0, "failed": 0, "subscriptions": 0, "errors": ["pywebpush not installed"]}
    for sub in subs:
        try:
            webpush(subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=json.dumps({"title": title, "body": body, "url": url}), vapid_private_key=private_pem,
                    vapid_claims={"sub": f"mailto:{settings.smtp_from or 'flaire@example.com'}"}, ttl=3600)
            sent += 1
        except WebPushException as exc:
            failed += 1
            status = getattr(getattr(exc, "response", None), "status_code", None)
            errors.append(f"{status or 'push'}: {str(exc)[:120]}")
            if status in (404, 410):  # subscription gone
                db.delete(sub)
        except Exception as exc:
            failed += 1
            errors.append(str(exc)[:160])
    db.flush()
    return {"sent": sent, "failed": failed, "subscriptions": len(subs), "errors": errors[:3],
            "devices": [{"ua": (s.user_agent or "")[:60], "since": s.created_at.isoformat()} for s in subs]}

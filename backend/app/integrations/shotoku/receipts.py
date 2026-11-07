"""Signed decision receipts, wire-compatible with Shotoku's format:

    rcpt.<base64url(canonical payload JSON)>.<hex HMAC-SHA256>

Payload: {v:1, decisionId, actor, action, resource, amount?, recipient?, exp}
Amounts are expressed in major units (SAR) as Shotoku does; Flaire converts from halalas.
A receipt proves that this exact actor was approved for this exact amount at this exact resource, and it
expires, so an approval cannot be replayed later. On top of that, receipts are single use: consume_receipt() marks
a token as spent the moment the payment service accepts it, so the same receipt presented a second time is refused
even inside its validity window. The spent set is in-process (per instance) and is pruned at each receipt's expiry.
"""
import base64
import hashlib
import hmac
import json
import threading
import time

_spent: dict[str, float] = {}      # sha256(token) -> exp timestamp
_spent_lock = threading.Lock()


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sign(secret: str, body: str) -> str:
    # Shotoku signs canonicalJson(payloadJsonString), i.e. the JSON string encoded once more as a JSON string.
    wrapped = json.dumps(body, ensure_ascii=False)
    return hmac.new(secret.encode(), wrapped.encode(), hashlib.sha256).hexdigest()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def create_receipt(*, secret: str, decision_id: str, actor: str, resource: str, amount_major: float, ttl_seconds: int = 300, action: str = "purchase") -> str:
    if not secret.strip():
        raise ValueError("Receipts require a signing secret (RECEIPT_SECRET).")
    payload = {"v": 1, "decisionId": decision_id, "actor": actor, "action": action, "resource": resource,
               "amount": amount_major, "exp": int(time.time()) + ttl_seconds}
    body = _canonical(payload)
    sig = _sign(secret, body)
    return f"rcpt.{_b64url(body.encode())}.{sig}"


def verify_receipt(token: str, *, secret: str, actor: str, resource: str, amount_major: float) -> tuple[bool, list[str]]:
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "rcpt":
        return False, ["Receipt is malformed."]
    try:
        body = _b64url_decode(parts[1]).decode()
        payload = json.loads(body)
    except Exception:
        return False, ["Receipt is malformed."]
    expected = _sign(secret, _canonical(payload))
    if not hmac.compare_digest(expected, parts[2]):
        return False, ["Receipt signature is invalid."]
    reasons = []
    if payload.get("exp", 0) < time.time():
        reasons.append("Receipt has expired.")
    if payload.get("actor") != actor:
        reasons.append("Receipt was issued to a different agent.")
    if payload.get("resource") != resource:
        reasons.append("Receipt was issued for a different merchant.")
    if abs(float(payload.get("amount", -1)) - amount_major) > 0.005:
        reasons.append("Receipt amount does not match the payment.")
    return (len(reasons) == 0), reasons


def _token_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _prune(now: float) -> None:
    for k in [k for k, exp in _spent.items() if exp < now]:
        _spent.pop(k, None)


def is_spent(token: str) -> bool:
    with _spent_lock:
        _prune(time.time())
        return _token_id(token) in _spent


def consume_receipt(token: str) -> bool:
    """Marks the receipt as used. Returns False if it was already used (a replay)."""
    parts = token.split(".")
    exp = time.time() + 3600
    try:
        exp = float(json.loads(_b64url_decode(parts[1]).decode()).get("exp", exp))
    except Exception:
        pass
    with _spent_lock:
        now = time.time()
        _prune(now)
        key = _token_id(token)
        if key in _spent:
            return False
        _spent[key] = max(exp, now + 60)
        return True


def verify_and_consume(token: str, *, secret: str, actor: str, resource: str, amount_major: float) -> tuple[bool, list[str]]:
    """verify_receipt plus single use. A valid receipt that was already consumed fails with a replay reason."""
    ok, reasons = verify_receipt(token, secret=secret, actor=actor, resource=resource, amount_major=amount_major)
    if not ok:
        return ok, reasons
    if not consume_receipt(token):
        return False, ["Receipt has already been used. Each authorization pays exactly once."]
    return True, []


def reset_spent() -> None:  # for tests
    with _spent_lock:
        _spent.clear()

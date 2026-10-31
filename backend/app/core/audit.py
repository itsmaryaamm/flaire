"""Hash-chained audit ledger, modelled on Shotoku's tamper-evident decisions ledger.

Each entry stores sha256(prev_hash + canonical_json(body)). Changing or deleting any row breaks the chain,
and GET /audit/verify will report the first broken position.
"""
import hashlib
import json
from datetime import timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEntry, utcnow

GENESIS = "sha256:" + "0" * 64


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hash_record(prev_hash: str, body: dict) -> str:
    return "sha256:" + hashlib.sha256((prev_hash + canonical_json(body)).encode()).hexdigest()


def _body(entry: AuditEntry) -> dict:
    return {
        # SQLite drops tzinfo on readback; hash the naive UTC form so the chain verifies on every database.
        "ts": (entry.ts.astimezone(timezone.utc) if entry.ts.tzinfo else entry.ts).replace(tzinfo=None).isoformat(),
        "actor_type": entry.actor_type,
        "actor_id": entry.actor_id,
        "actor_name": entry.actor_name,
        "event": entry.event,
        "details": entry.details,
    }


def record(db: Session, company_id: int, *, actor_type: str, actor_id: int | None, actor_name: str, event: str, details: dict | None = None) -> AuditEntry:
    last = db.query(AuditEntry).filter(AuditEntry.company_id == company_id).order_by(AuditEntry.id.desc()).first()
    prev = last.hash if last else GENESIS
    entry = AuditEntry(
        company_id=company_id, ts=utcnow(), actor_type=actor_type, actor_id=actor_id,
        actor_name=actor_name, event=event, details=details or {}, prev_hash=prev,
    )
    entry.hash = hash_record(prev, _body(entry))
    db.add(entry)
    db.flush()
    return entry


def verify(db: Session, company_id: int) -> dict:
    prev = GENESIS
    entries = db.query(AuditEntry).filter(AuditEntry.company_id == company_id).order_by(AuditEntry.id.asc()).all()
    for i, e in enumerate(entries, start=1):
        if e.prev_hash != prev or e.hash != hash_record(prev, _body(e)):
            return {"ok": False, "broken_at": i, "entries": len(entries)}
        prev = e.hash
    return {"ok": True, "entries": len(entries)}

"""Velocity counters and anomaly flags for the rules engine.

Two jobs:
  1. velocity_snapshot(): the per-agent counters the engine needs to catch hammering (hourly and daily caps) and
     purchase splitting (several requests to the same merchant that together exceed the per-purchase limit).
  2. anomaly_flags(): soft signals shown to the human next to a request. They never change the verdict; they are
     stored in decision["flags"] and exposed as `flags` on purchase requests so an approver sees "this one is odd".

All money is integer halalas. Times are UTC; working hours are judged in Riyadh time (UTC+3).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Agent, Company, PurchaseRequest

# Statuses that represent money that moved or may still move. Denied and rejected requests never count towards splitting.
LIVE_STATUSES = ("completed", "approved", "pending_approval")

LARGE_FIRST_PURCHASE = 500_000        # halalas: SAR 5,000
AVERAGE_MULTIPLE = 3                  # flag when a request is this many times the agent's average completed purchase
MIN_HISTORY_FOR_AVERAGE = 3           # need a few purchases before an average means anything
RIYADH_OFFSET_HOURS = 3
WORKING_HOURS_START = 6               # 06:00 Riyadh
WORKING_HOURS_END = 22                # 22:00 Riyadh


def _sar(halalas: int) -> str:
    return f"SAR {halalas / 100:,.0f}" if halalas % 100 == 0 else f"SAR {halalas / 100:,.2f}"


def velocity_snapshot(db: Session, agent: Agent, pr: PurchaseRequest) -> dict:
    """Counters for the engine: requests in the last hour and day (every request, including denied ones, because
    a denied flood is still a flood) and the halalas already committed to this merchant in the last hour."""
    now = datetime.now(timezone.utc)
    base = db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id, PurchaseRequest.id != pr.id)
    last_hour = base.filter(PurchaseRequest.created_at >= now - timedelta(hours=1)).count()
    today = base.filter(PurchaseRequest.created_at >= now - timedelta(hours=24)).count()
    same_merchant = (base.filter(PurchaseRequest.created_at >= now - timedelta(minutes=60), func.lower(PurchaseRequest.merchant) == pr.merchant.lower(),
                                 PurchaseRequest.status.in_(LIVE_STATUSES)).with_entities(func.coalesce(func.sum(PurchaseRequest.amount), 0)).scalar())
    return {"requests_last_hour": last_hour, "requests_today": today, "same_merchant_last_hour": int(same_merchant or 0)}


def _riyadh_hour(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    return (now + timedelta(hours=RIYADH_OFFSET_HOURS)).hour


def anomaly_flags(db: Session, company: Company, agent: Agent, merchant: str, amount: int, *, exclude_request_id: int | None = None, now: datetime | None = None) -> list[str]:
    """Soft anomaly signals for one request. Returns human-readable strings; an empty list means nothing stood out."""
    flags: list[str] = []
    history = db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id, PurchaseRequest.company_id == company.id, PurchaseRequest.status == "completed")
    if exclude_request_id is not None:
        history = history.filter(PurchaseRequest.id != exclude_request_id)
    count, total, biggest = history.with_entities(func.count(PurchaseRequest.id), func.coalesce(func.sum(PurchaseRequest.amount), 0), func.coalesce(func.max(PurchaseRequest.amount), 0)).one()
    count, total, biggest = int(count or 0), int(total or 0), int(biggest or 0)

    if amount > LARGE_FIRST_PURCHASE and biggest <= LARGE_FIRST_PURCHASE:
        flags.append(f"First purchase from this employee above {_sar(LARGE_FIRST_PURCHASE)}")
    if count >= MIN_HISTORY_FOR_AVERAGE and total > 0:
        average = total / count
        if amount >= AVERAGE_MULTIPLE * average:
            flags.append(f"{int(amount // average)}x the employee's average purchase")
    hour = _riyadh_hour(now)
    if hour >= WORKING_HOURS_END or hour < WORKING_HOURS_START:
        flags.append(f"Outside working hours (Riyadh {WORKING_HOURS_END}:00 to {WORKING_HOURS_START:02d}:00)")
    return flags

"""Finance layer helpers: period rollover, transaction stamping (cost center, GL, VAT, period), statements and fiscal years.

All money is integer halalas. Transaction.amount is VAT inclusive; vat_amount is the VAT portion inside it.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core import audit
from app.models import Agent, Company, CostCenter, Department, PeriodClose, PurchaseRequest, Transaction


# ---------------- periods and fiscal years ----------------
def period_of(dt: datetime | date | None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return f"{dt.year:04d}-{dt.month:02d}"


def current_period() -> str:
    return period_of(datetime.now(timezone.utc))


def parse_period(period: str) -> tuple[int, int]:
    try:
        y, m = int(period[:4]), int(period[5:7])
    except (ValueError, TypeError):
        raise ValueError("period must be YYYY-MM")
    if len(period) != 7 or period[4] != "-" or not 1 <= m <= 12:
        raise ValueError("period must be YYYY-MM")
    return y, m


def period_bounds(period: str) -> tuple[datetime, datetime]:
    y, m = parse_period(period)
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m // 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return start, end


def fiscal_year_label(period: str, start_month: int) -> str:
    """Fiscal years are named after the calendar year in which they end. With start_month 1, FY2026 is Jan to Dec 2026."""
    y, m = parse_period(period)
    start_month = start_month or 1
    if start_month == 1:
        return f"FY{y}"
    return f"FY{y + 1}" if m >= start_month else f"FY{y}"


def tx_period(t: Transaction) -> str:
    """Period stored on the row, or derived from created_at for rows written before the finance layer existed."""
    return t.period or period_of(t.created_at)


# ---------------- VAT ----------------
def vat_split(amount: int, vat_rate_bps: int) -> int:
    """VAT portion of a VAT inclusive amount: amount - amount * 10000 / (10000 + rate), rounded."""
    rate = vat_rate_bps or 0
    if rate <= 0 or amount <= 0:
        return 0
    net = round(amount * 10_000 / (10_000 + rate))
    return amount - net


# ---------------- stamping at payment time ----------------
def stamp_transaction(db: Session, company: Company, tx: Transaction, agent: Agent | None, dept: Department | None) -> Transaction:
    """Set cost center, GL code, period and VAT on a new transaction. Precedence: agent, then department, then cost center default GL."""
    cc_id = (agent.cost_center_id if agent else None) or (dept.cost_center_id if dept else None)
    cc = db.get(CostCenter, cc_id) if cc_id else None
    gl = (agent.gl_code if agent else None) or (dept.gl_code if dept else None) or (cc.gl_code if cc else None)
    tx.cost_center_id = cc.id if cc else None
    tx.gl_code = gl
    tx.period = period_of(tx.created_at)
    tx.vat_rate_bps = company.vat_rate_bps or 0
    tx.vat_amount = vat_split(tx.amount, tx.vat_rate_bps) if tx.status in ("settled", "authorized") else 0
    return tx


# ---------------- budget rollover ----------------
def roll_period(db: Session, company: Company) -> list[dict]:
    """When a department's period_start month is behind the current month, start a new period.
    Spend counters reset; with company.budget_rollover the unspent part of the budget (budget + rollover - spent) carries into rollover_balance,
    otherwise rollover_balance is cleared. Returns one entry per department rolled, for auditing."""
    first = date.today().replace(day=1)
    rolled: list[dict] = []
    for dept in db.query(Department).filter(Department.company_id == company.id).all():
        if dept.period_start >= first:
            continue
        unspent = max(dept.monthly_budget + (dept.rollover_balance or 0) - dept.spent_this_period, 0)
        carried = unspent if company.budget_rollover else 0
        rolled.append({"department_id": dept.id, "name": dept.name, "from": dept.period_start.isoformat(), "to": first.isoformat(),
                       "spent": dept.spent_this_period, "carried": carried})
        dept.period_start = first
        dept.spent_this_period = 0
        dept.rollover_balance = carried
        for ag in dept.agents:
            ag.spent_this_period = 0
    if rolled:
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="finance", event="period.rolled",
                     details={"period": period_of(first), "rollover": bool(company.budget_rollover), "departments": rolled})
    db.flush()
    return rolled


# ---------------- statements ----------------
def period_transactions(db: Session, company_id: int, period: str, statuses: tuple[str, ...] = ("settled", "authorized")) -> list[Transaction]:
    start, end = period_bounds(period)
    rows = db.query(Transaction).filter(Transaction.company_id == company_id, Transaction.status.in_(statuses)).order_by(Transaction.id).all()
    out = []
    for t in rows:
        if t.period:
            if t.period == period:
                out.append(t)
            continue
        c = t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=timezone.utc)
        if start <= c < end:
            out.append(t)
    return out


def statement_hash(rows: list[Transaction]) -> str:
    body = sorted((t.id, t.amount) for t in rows)
    return "sha256:" + hashlib.sha256(json.dumps(body, separators=(",", ":")).encode()).hexdigest()


def build_statement(db: Session, company: Company, period: str) -> dict:
    """Live statement snapshot for a month: totals by department, cost center, agent and category, fees, VAT, count and a hash of ids and amounts."""
    rows = period_transactions(db, company.id, period)
    prs = {p.id: p for p in db.query(PurchaseRequest).filter(PurchaseRequest.id.in_([t.purchase_request_id for t in rows] or [-1])).all()}
    depts = {d.id: d for d in db.query(Department).filter(Department.company_id == company.id).all()}
    agents = {a.id: a for a in db.query(Agent).filter(Agent.company_id == company.id).all()}
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.company_id == company.id).all()}

    def bucket(store: dict, key, label: str, extra: dict, t: Transaction) -> None:
        b = store.setdefault(key, {"key": key, "label": label, **extra, "amount": 0, "vat": 0, "net": 0, "fee": 0, "count": 0})
        b["amount"] += t.amount
        b["vat"] += t.vat_amount or 0
        b["net"] += t.amount - (t.vat_amount or 0)
        b["fee"] += t.fee or 0
        b["count"] += 1

    by_dept: dict = {}
    by_cc: dict = {}
    by_agent: dict = {}
    by_cat: dict = {}
    for t in rows:
        pr = prs.get(t.purchase_request_id)
        d = depts.get(pr.department_id) if pr else None
        a = agents.get(pr.agent_id) if pr else None
        cc = ccs.get(t.cost_center_id) if t.cost_center_id else None
        bucket(by_dept, d.id if d else None, d.name if d else "Unassigned", {"id": d.id if d else None}, t)
        bucket(by_cc, cc.id if cc else None, cc.code if cc else "Unassigned", {"id": cc.id if cc else None, "name": cc.name if cc else None, "gl_code": cc.gl_code if cc else None}, t)
        bucket(by_agent, a.id if a else None, a.name if a else "Unknown", {"id": a.id if a else None}, t)
        bucket(by_cat, pr.category if pr else "other", pr.category if pr else "other", {}, t)

    volume = sum(t.amount for t in rows)
    vat = sum(t.vat_amount or 0 for t in rows)
    fees = sum(t.fee or 0 for t in rows)
    fee_vat = round(fees * 15 / 100)
    return {
        "period": period,
        "fiscal_year": fiscal_year_label(period, company.fiscal_year_start_month),
        "currency": company.currency,
        "transaction_count": len(rows),
        "pending_settlement": sum(1 for t in rows if t.status == "authorized"),
        "volume": volume,
        "vat": vat,
        "net": volume - vat,
        "vat_rate_bps": company.vat_rate_bps,
        "fees": fees,
        "fee_rate_bps": company.fee_rate_bps,
        "fee_vat": fee_vat,
        "fees_incl_vat": fees + fee_vat,
        "by_department": sorted(by_dept.values(), key=lambda b: -b["amount"]),
        "by_cost_center": sorted(by_cc.values(), key=lambda b: -b["amount"]),
        "by_agent": sorted(by_agent.values(), key=lambda b: -b["amount"]),
        "by_category": sorted(by_cat.values(), key=lambda b: -b["amount"]),
        "hash": statement_hash(rows),
        "transaction_ids": [t.id for t in rows],
    }


def get_close(db: Session, company_id: int, period: str) -> PeriodClose | None:
    return db.query(PeriodClose).filter(PeriodClose.company_id == company_id, PeriodClose.period == period).first()

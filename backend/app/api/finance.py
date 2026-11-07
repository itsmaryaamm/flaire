"""Finance layer routes: cost centers, receipts, month-end close, statements, ERP exports and Flaire's fee VAT invoices.

Mounted under /api/v1. Money is integer halalas in JSON; CSV exports write SAR with two decimals for the ERPs.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import audit
from app.core.db import get_db
from app.core.security import get_current_user, require_approver
from app.finance import (build_statement, current_period, fiscal_year_label, get_close, parse_period, period_transactions, tx_period, vat_split)
from app.models import Agent, Attachment, Company, CostCenter, Department, FeeInvoice, PeriodClose, PurchaseRequest, Transaction, User

router = APIRouter(tags=["finance"])

MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}
ALLOWED_EXT = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
FEE_VAT_RATE_BPS = 1500
FLAIRE_SELLER_NAME = "Flaire"
# Default GL accounts used by the ERP exports when a transaction carries none.
GL_DEFAULT_EXPENSE = "6000"
GL_INPUT_VAT = "1410"
GL_CARD_CLEARING = "2100"


def _company(user: User, db: Session) -> Company:
    return db.get(Company, user.company_id)


def _period_or_422(period: str) -> str:
    try:
        parse_period(period)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return period


def _sar(halalas: int) -> str:
    return f"{(halalas or 0) / 100:.2f}"


def check_cost_center(db: Session, company_id: int, cc_id: int | None) -> CostCenter | None:
    """Used by routes.py when a department or agent is pointed at a cost center."""
    if cc_id is None:
        return None
    cc = db.get(CostCenter, cc_id)
    if not cc or cc.company_id != company_id:
        raise HTTPException(404, "Cost center not found")
    if not cc.active:
        raise HTTPException(409, "Cost center is inactive")
    return cc


# ====================================================== cost centers
class CostCenterIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    gl_code: str | None = Field(default=None, max_length=40)
    active: bool = True


class CostCenterPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    gl_code: str | None = Field(default=None, max_length=40)
    active: bool | None = None


class CostCenterOut(BaseModel):
    id: int
    code: str
    name: str
    gl_code: str | None
    active: bool
    model_config = {"from_attributes": True}


def _cc(db: Session, user: User, cc_id: int) -> CostCenter:
    cc = db.get(CostCenter, cc_id)
    if not cc or cc.company_id != user.company_id:
        raise HTTPException(404, "Cost center not found")
    return cc


@router.get("/finance/cost-centers", response_model=list[CostCenterOut])
def list_cost_centers(include_inactive: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(CostCenter).filter(CostCenter.company_id == user.company_id)
    if not include_inactive:
        q = q.filter(CostCenter.active.is_(True))
    return q.order_by(CostCenter.code).all()


@router.post("/finance/cost-centers", response_model=CostCenterOut, status_code=201)
def create_cost_center(body: CostCenterIn, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    code = body.code.strip().upper()
    if db.query(CostCenter).filter(CostCenter.company_id == user.company_id, CostCenter.code == code).first():
        raise HTTPException(409, f"Cost center {code} already exists")
    cc = CostCenter(company_id=user.company_id, code=code, name=body.name.strip(), gl_code=(body.gl_code or "").strip() or None, active=body.active)
    db.add(cc)
    db.flush()
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="cost_center.created",
                 details={"id": cc.id, "code": cc.code, "name": cc.name, "gl_code": cc.gl_code})
    db.commit()
    db.refresh(cc)
    return cc


@router.get("/finance/cost-centers/{cc_id}", response_model=CostCenterOut)
def get_cost_center(cc_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _cc(db, user, cc_id)


@router.patch("/finance/cost-centers/{cc_id}", response_model=CostCenterOut)
def patch_cost_center(cc_id: int, body: CostCenterPatch, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    cc = _cc(db, user, cc_id)
    changes = body.model_dump(exclude_none=True)
    if "code" in changes:
        changes["code"] = changes["code"].strip().upper()
        dup = db.query(CostCenter).filter(CostCenter.company_id == user.company_id, CostCenter.code == changes["code"], CostCenter.id != cc.id).first()
        if dup:
            raise HTTPException(409, f"Cost center {changes['code']} already exists")
    for k, v in changes.items():
        setattr(cc, k, v)
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="cost_center.updated", details={"id": cc.id, **changes})
    db.commit()
    db.refresh(cc)
    return cc


@router.delete("/finance/cost-centers/{cc_id}", status_code=204)
def delete_cost_center(cc_id: int, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    """Deletes an unused cost center. One referenced by departments, agents or transactions is deactivated instead, so history keeps its code."""
    cc = _cc(db, user, cc_id)
    referenced = (db.query(Department).filter(Department.cost_center_id == cc.id).count() + db.query(Agent).filter(Agent.cost_center_id == cc.id).count()
                  + db.query(Transaction).filter(Transaction.cost_center_id == cc.id).count())
    if referenced:
        cc.active = False
        event = "cost_center.deactivated"
    else:
        db.delete(cc)
        event = "cost_center.deleted"
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event=event, details={"id": cc_id, "code": cc.code, "referenced": referenced})
    db.commit()
    return Response(status_code=204)


# ====================================================== attachments (receipts)
class AttachmentOut(BaseModel):
    id: int
    transaction_id: int
    filename: str
    content_type: str
    size: int
    sha256: str
    uploaded_by_id: int
    created_at: datetime
    model_config = {"from_attributes": True}


def _tx(db: Session, user: User, tx_id: int) -> Transaction:
    t = db.get(Transaction, tx_id)
    if not t or t.company_id != user.company_id:
        raise HTTPException(404, "Transaction not found")
    return t


def _sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


@router.post("/transactions/{tx_id}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(tx_id: int, file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _tx(db, user, tx_id)
    if t.locked:
        raise HTTPException(423, f"Transaction belongs to closed period {tx_period(t)}. Reopen the period to change its receipts.")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, "Only PDF, PNG and JPG receipts are accepted")
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(413, "Receipt is larger than 5 MB")
    if not data:
        raise HTTPException(422, "Empty file")
    kind = _sniff(data)
    if kind is None or kind != ALLOWED_EXT[ext]:
        raise HTTPException(415, "File content does not match a PDF, PNG or JPG")
    att = Attachment(company_id=user.company_id, transaction_id=t.id, filename=os.path.basename(file.filename or f"receipt{ext}")[:200], content_type=kind,
                     size=len(data), sha256=hashlib.sha256(data).hexdigest(), data=data, uploaded_by_id=user.id)
    db.add(att)
    db.flush()
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="attachment.added",
                 details={"id": att.id, "transaction_id": t.id, "filename": att.filename, "size": att.size, "sha256": att.sha256})
    db.commit()
    db.refresh(att)
    return att


@router.get("/transactions/{tx_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(tx_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _tx(db, user, tx_id)
    return db.query(Attachment).filter(Attachment.transaction_id == t.id).order_by(Attachment.id).all()


def _att(db: Session, user: User, att_id: int) -> Attachment:
    a = db.get(Attachment, att_id)
    if not a or a.company_id != user.company_id:
        raise HTTPException(404, "Attachment not found")
    return a


@router.get("/attachments/{att_id}/download")
def download_attachment(att_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _att(db, user, att_id)
    safe_name = a.filename.replace('"', "")
    return Response(content=a.data, media_type=a.content_type, headers={"Content-Disposition": f'attachment; filename="{safe_name}"', "X-Content-SHA256": a.sha256})


@router.delete("/attachments/{att_id}", status_code=204)
def delete_attachment(att_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _att(db, user, att_id)
    t = db.get(Transaction, a.transaction_id)
    if t and t.locked:
        raise HTTPException(423, f"Transaction belongs to closed period {tx_period(t)}. Reopen the period to change its receipts.")
    if a.uploaded_by_id != user.id and user.role not in ("owner", "finance"):
        raise HTTPException(403, "Only the uploader, an owner or finance can remove a receipt")
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="attachment.deleted",
                 details={"id": a.id, "transaction_id": a.transaction_id, "filename": a.filename, "sha256": a.sha256})
    db.delete(a)
    db.commit()
    return Response(status_code=204)


# ====================================================== month-end close
def _period_rows(db: Session, company: Company) -> list[dict]:
    closes = {c.period: c for c in db.query(PeriodClose).filter(PeriodClose.company_id == company.id).all()}
    txs = db.query(Transaction).filter(Transaction.company_id == company.id, Transaction.status.in_(["settled", "authorized"])).all()
    months: dict[str, dict] = {}
    for t in txs:
        p = tx_period(t)
        m = months.setdefault(p, {"period": p, "transaction_count": 0, "volume": 0, "vat": 0, "fees": 0, "pending_settlement": 0})
        m["transaction_count"] += 1
        m["volume"] += t.amount
        m["vat"] += t.vat_amount or 0
        m["fees"] += t.fee or 0
        if t.status == "authorized":
            m["pending_settlement"] += 1
    for p in list(closes) + [current_period()]:
        months.setdefault(p, {"period": p, "transaction_count": 0, "volume": 0, "vat": 0, "fees": 0, "pending_settlement": 0})
    out = []
    for p in sorted(months, reverse=True):
        m = months[p]
        c = closes.get(p)
        out.append({**m, "net": m["volume"] - m["vat"], "fiscal_year": fiscal_year_label(p, company.fiscal_year_start_month), "closed": c is not None,
                    "closed_at": c.closed_at if c else None, "closed_by_id": c.closed_by_id if c else None, "is_current": p == current_period()})
    return out


@router.get("/finance/periods")
def list_periods(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Months with totals and closed flag, grouped into fiscal years by company.fiscal_year_start_month."""
    c = _company(user, db)
    rows = _period_rows(db, c)
    fys: dict[str, dict] = {}
    for r in rows:
        fy = fys.setdefault(r["fiscal_year"], {"label": r["fiscal_year"], "volume": 0, "vat": 0, "fees": 0, "transaction_count": 0, "periods": []})
        fy["volume"] += r["volume"]
        fy["vat"] += r["vat"]
        fy["fees"] += r["fees"]
        fy["transaction_count"] += r["transaction_count"]
        fy["periods"].append(r)
    return {"fiscal_year_start_month": c.fiscal_year_start_month or 1, "current_period": current_period(), "periods": rows,
            "fiscal_years": sorted(fys.values(), key=lambda f: f["label"], reverse=True)}


@router.post("/finance/periods/{period}/close")
def close_period(period: str, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    """Locks every transaction of the month and stores the statement snapshot. Refused while any transaction is still awaiting settlement."""
    _period_or_422(period)
    c = _company(user, db)
    if period > current_period():
        raise HTTPException(422, "Cannot close a future period")
    if get_close(db, c.id, period):
        raise HTTPException(409, f"Period {period} is already closed")
    rows = period_transactions(db, c.id, period)
    pending = [t.id for t in rows if t.status == "authorized"]
    if pending:
        raise HTTPException(409, f"{len(pending)} transaction(s) still awaiting settlement: {pending[:10]}. Settle or reverse them before closing {period}.")
    statement = build_statement(db, c, period)
    all_rows = period_transactions(db, c.id, period, statuses=("settled", "authorized", "declined", "reversed"))
    for t in all_rows:
        t.locked = True
        if not t.period:
            t.period = period
    close = PeriodClose(company_id=c.id, period=period, closed_by_id=user.id, statement=statement)
    db.add(close)
    db.flush()
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="period.closed",
                 details={"period": period, "transaction_count": statement["transaction_count"], "volume": statement["volume"], "vat": statement["vat"],
                          "fees": statement["fees"], "hash": statement["hash"], "locked": len(all_rows)})
    db.commit()
    return {"period": period, "closed": True, "closed_at": close.closed_at, "closed_by_id": user.id, "locked_transactions": len(all_rows), "statement": statement}


@router.post("/finance/periods/{period}/reopen")
def reopen_period(period: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Owner only. Unlocks the month's transactions and removes the stored snapshot; the audit ledger keeps both the close and the reopen."""
    _period_or_422(period)
    if user.role != "owner":
        raise HTTPException(403, "Only the owner can reopen a closed period")
    c = _company(user, db)
    close = get_close(db, c.id, period)
    if not close:
        raise HTTPException(404, f"Period {period} is not closed")
    rows = period_transactions(db, c.id, period, statuses=("settled", "authorized", "declined", "reversed"))
    for t in rows:
        t.locked = False
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="period.reopened",
                 details={"period": period, "previous_hash": (close.statement or {}).get("hash"), "closed_at": close.closed_at.isoformat() if close.closed_at else None,
                          "closed_by_id": close.closed_by_id, "unlocked": len(rows)})
    db.delete(close)
    db.commit()
    return {"period": period, "closed": False, "unlocked_transactions": len(rows)}


# ====================================================== statement
@router.get("/finance/statement")
def finance_statement(period: str | None = Query(default=None), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Same structure as the period close snapshot: live while the month is open, the stored snapshot once closed."""
    c = _company(user, db)
    period = _period_or_422(period or current_period())
    close = get_close(db, c.id, period)
    if close:
        return {**close.statement, "closed": True, "closed_at": close.closed_at, "closed_by_id": close.closed_by_id}
    return {**build_statement(db, c, period), "closed": False, "closed_at": None, "closed_by_id": None}


# ====================================================== exports
def _csv_response(rows: list[list], filename: str) -> StreamingResponse:
    def gen():
        buf = io.StringIO()
        w = csv.writer(buf)
        for r in rows:
            w.writerow(r)
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)
    return StreamingResponse(gen(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})


def _export_rows(db: Session, c: Company, period: str | None) -> list[tuple[Transaction, PurchaseRequest | None, Department | None, Agent | None, CostCenter | None]]:
    if period:
        txs = period_transactions(db, c.id, period, statuses=("settled", "authorized", "declined", "reversed"))
    else:
        txs = db.query(Transaction).filter(Transaction.company_id == c.id).order_by(Transaction.id).all()
    prs = {p.id: p for p in db.query(PurchaseRequest).filter(PurchaseRequest.company_id == c.id).all()}
    depts = {d.id: d for d in db.query(Department).filter(Department.company_id == c.id).all()}
    agents = {a.id: a for a in db.query(Agent).filter(Agent.company_id == c.id).all()}
    ccs = {x.id: x for x in db.query(CostCenter).filter(CostCenter.company_id == c.id).all()}
    out = []
    for t in txs:
        pr = prs.get(t.purchase_request_id)
        out.append((t, pr, depts.get(pr.department_id) if pr else None, agents.get(pr.agent_id) if pr else None, ccs.get(t.cost_center_id) if t.cost_center_id else None))
    return out


def _date(t: Transaction) -> str:
    return t.created_at.date().isoformat()


@router.get("/finance/exports/transactions.csv")
def export_transactions(period: str | None = Query(default=None), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _company(user, db)
    if period:
        _period_or_422(period)
    receipts: dict[int, int] = {}
    for att in db.query(Attachment).filter(Attachment.company_id == c.id).all():
        receipts[att.transaction_id] = receipts.get(att.transaction_id, 0) + 1
    rows: list[list] = [["date", "transaction_id", "request_id", "employee", "department", "cost_center_code", "gl_code", "merchant", "category", "description",
                         "amount_incl_vat", "vat_amount", "amount_excl_vat", "currency", "status", "provider_ref", "fee", "receipt_count"]]
    for t, pr, d, a, cc in _export_rows(db, c, period):
        vat = t.vat_amount or 0
        rows.append([_date(t), t.id, t.purchase_request_id, a.name if a else "", d.name if d else "", cc.code if cc else "", t.gl_code or "", t.merchant,
                     pr.category if pr else "", (pr.description or "") if pr else "", _sar(t.amount), _sar(vat), _sar(t.amount - vat), t.currency, t.status,
                     t.provider_ref, _sar(t.fee or 0), receipts.get(t.id, 0)])
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="export.transactions", details={"period": period, "rows": len(rows) - 1})
    db.commit()
    return _csv_response(rows, f"flaire-transactions-{period or 'all'}.csv")


@router.get("/finance/exports/sap.csv")
def export_sap(period: str | None = Query(default=None), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """SAP FI journal (document type SA). Per settled transaction: debit expense GL (net), debit input VAT, credit card clearing (gross)."""
    c = _company(user, db)
    if period:
        _period_or_422(period)
    company_code = f"{c.id:04d}"
    rows: list[list] = [["posting_date", "document_type", "company_code", "gl_account", "cost_center", "debit_amount", "credit_amount", "text", "reference"]]
    n = 0
    for t, pr, d, a, cc in _export_rows(db, c, period):
        if t.status != "settled":
            continue
        n += 1
        vat = t.vat_amount or 0
        text = f"{t.merchant} / {a.name if a else 'AI employee'}"[:50]
        ref = f"FLR-TX-{t.id}"
        cc_code = cc.code if cc else ""
        rows.append([_date(t), "SA", company_code, t.gl_code or GL_DEFAULT_EXPENSE, cc_code, _sar(t.amount - vat), "", text, ref])
        if vat:
            rows.append([_date(t), "SA", company_code, GL_INPUT_VAT, cc_code, _sar(vat), "", f"Input VAT {text}"[:50], ref])
        rows.append([_date(t), "SA", company_code, GL_CARD_CLEARING, "", "", _sar(t.amount), f"Card {t.provider_ref}"[:50], ref])
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="export.sap", details={"period": period, "transactions": n})
    db.commit()
    return _csv_response(rows, f"flaire-sap-{period or 'all'}.csv")


@router.get("/finance/exports/oracle.csv")
def export_oracle(period: str | None = Query(default=None), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Oracle GL interface style. segment1 company code, segment2 cost center, segment3 natural account."""
    c = _company(user, db)
    if period:
        _period_or_422(period)
    ledger = f"{c.name} Primary Ledger"
    company_code = f"{c.id:04d}"
    rows: list[list] = [["ledger", "accounting_date", "segment1", "segment2", "segment3", "entered_dr", "entered_cr", "description"]]
    n = 0
    for t, pr, d, a, cc in _export_rows(db, c, period):
        if t.status != "settled":
            continue
        n += 1
        vat = t.vat_amount or 0
        cc_code = cc.code if cc else "000"
        desc = f"Flaire TX {t.id} {t.merchant} ({a.name if a else 'AI employee'})"[:240]
        rows.append([ledger, _date(t), company_code, cc_code, t.gl_code or GL_DEFAULT_EXPENSE, _sar(t.amount - vat), "", desc])
        if vat:
            rows.append([ledger, _date(t), company_code, cc_code, GL_INPUT_VAT, _sar(vat), "", f"Input VAT {desc}"[:240]])
        rows.append([ledger, _date(t), company_code, "000", GL_CARD_CLEARING, "", _sar(t.amount), f"Card clearing {t.provider_ref} {desc}"[:240]])
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="export.oracle", details={"period": period, "transactions": n})
    db.commit()
    return _csv_response(rows, f"flaire-oracle-{period or 'all'}.csv")


# ====================================================== Flaire fee VAT invoices (ZATCA simplified)
class FeeInvoiceOut(BaseModel):
    id: int
    period: str
    number: str
    subtotal: int
    vat: int
    total: int
    transaction_count: int
    qr_payload: str
    issued_at: datetime
    model_config = {"from_attributes": True}


def seller_vat_number() -> str:
    return os.environ.get("FLAIRE_VAT_NUMBER", "300000000000003")


def zatca_tlv(seller: str, vat_no: str, ts: str, total: str, vat: str) -> str:
    """ZATCA phase 1 simplified e-invoice QR: TLV with tags 1..5, base64 encoded."""
    out = bytearray()
    for tag, value in ((1, seller), (2, vat_no), (3, ts), (4, total), (5, vat)):
        b = value.encode("utf-8")
        out += bytes([tag, len(b)]) + b
    return base64.b64encode(bytes(out)).decode("ascii")


def _invoice(db: Session, user: User, inv_id: int) -> FeeInvoice:
    inv = db.get(FeeInvoice, inv_id)
    if not inv or inv.company_id != user.company_id:
        raise HTTPException(404, "Invoice not found")
    return inv


@router.post("/finance/fee-invoices/{period}", response_model=FeeInvoiceOut)
def issue_fee_invoice(period: str, user: User = Depends(require_approver), db: Session = Depends(get_db)):
    """Idempotent: returns the existing invoice for the month if one was already issued."""
    _period_or_422(period)
    c = _company(user, db)
    existing = db.query(FeeInvoice).filter(FeeInvoice.company_id == c.id, FeeInvoice.period == period).first()
    if existing:
        return existing
    rows = period_transactions(db, c.id, period, statuses=("settled",))
    subtotal = sum(t.fee or 0 for t in rows)
    vat = round(subtotal * FEE_VAT_RATE_BPS / 10_000)
    total = subtotal + vat
    issued_at = datetime.now(timezone.utc)
    number = f"FLR-{period.replace('-', '')}-{c.id:04d}"
    qr = zatca_tlv(FLAIRE_SELLER_NAME, seller_vat_number(), issued_at.replace(microsecond=0).isoformat(), _sar(total), _sar(vat))
    inv = FeeInvoice(company_id=c.id, period=period, number=number, subtotal=subtotal, vat=vat, total=total, transaction_count=len(rows), qr_payload=qr, issued_at=issued_at)
    db.add(inv)
    db.flush()
    audit.record(db, c.id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="fee_invoice.issued",
                 details={"id": inv.id, "number": number, "period": period, "subtotal": subtotal, "vat": vat, "total": total, "transactions": len(rows)})
    db.commit()
    db.refresh(inv)
    return inv


@router.get("/finance/fee-invoices", response_model=list[FeeInvoiceOut])
def list_fee_invoices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(FeeInvoice).filter(FeeInvoice.company_id == user.company_id).order_by(FeeInvoice.period.desc()).all()


def render_fee_invoice_pdf(inv: FeeInvoice, company: Company) -> bytes:
    import qrcode
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    pdf.setTitle(f"Flaire tax invoice {inv.number}")
    w, h = A4
    left = 20 * mm
    y = h - 25 * mm

    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(left, y, "Flaire")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(left, y - 6 * mm, "Simplified tax invoice (ZATCA phase 1)")
    pdf.drawString(left, y - 11 * mm, f"Seller VAT number: {seller_vat_number()}")

    qr_img = qrcode.make(inv.qr_payload)
    qr_buf = io.BytesIO()
    qr_img.save(qr_buf, format="PNG")
    qr_buf.seek(0)
    pdf.drawImage(ImageReader(qr_buf), w - 20 * mm - 35 * mm, y - 30 * mm, 35 * mm, 35 * mm)

    y -= 30 * mm
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(left, y, f"Invoice {inv.number}")
    pdf.setFont("Helvetica", 10)
    issued = inv.issued_at if inv.issued_at.tzinfo else inv.issued_at.replace(tzinfo=timezone.utc)
    pdf.drawString(left, y - 6 * mm, f"Issue date: {issued.date().isoformat()}")
    pdf.drawString(left, y - 11 * mm, f"Billing period: {inv.period}")
    pdf.drawString(left, y - 16 * mm, f"Due: on receipt")

    y -= 28 * mm
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(left, y, "Bill to")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(left, y - 5 * mm, company.name)
    pdf.drawString(left, y - 10 * mm, f"Buyer VAT number: {company.vat_number or 'not provided'}")

    y -= 24 * mm
    col_amount = w - 20 * mm
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(left, y, "Description")
    pdf.drawRightString(col_amount, y, f"Amount ({company.currency})")
    pdf.line(left, y - 2 * mm, col_amount, y - 2 * mm)
    y -= 8 * mm
    pdf.setFont("Helvetica", 10)
    pdf.drawString(left, y, f"Flaire platform fee, {company.fee_rate_bps / 100:.2f}% of {inv.transaction_count} transactions")
    pdf.drawRightString(col_amount, y, _sar(inv.subtotal))

    y -= 14 * mm
    pdf.line(left, y + 4 * mm, col_amount, y + 4 * mm)
    for label, value, bold in (("Subtotal (excl. VAT)", inv.subtotal, False), ("VAT 15%", inv.vat, False), ("Total (incl. VAT)", inv.total, True)):
        pdf.setFont("Helvetica-Bold" if bold else "Helvetica", 10)
        pdf.drawString(w - 90 * mm, y, label)
        pdf.drawRightString(col_amount, y, _sar(value))
        y -= 6 * mm

    y -= 10 * mm
    pdf.setFont("Helvetica", 8)
    pdf.drawString(left, y, "Fees are charged on settled card transactions executed through Flaire during the billing period. Amounts in Saudi riyals.")
    pdf.drawString(left, y - 4 * mm, f"QR payload (base64 TLV): {inv.qr_payload[:90]}{'...' if len(inv.qr_payload) > 90 else ''}")
    pdf.showPage()
    pdf.save()
    return buf.getvalue()


@router.get("/finance/fee-invoices/{inv_id}.pdf")
def fee_invoice_pdf(inv_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inv = _invoice(db, user, inv_id)
    data = render_fee_invoice_pdf(inv, _company(user, db))
    return Response(content=data, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{inv.number}.pdf"'})


@router.get("/finance/fee-invoices/{inv_id}", response_model=FeeInvoiceOut)
def get_fee_invoice(inv_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _invoice(db, user, inv_id)

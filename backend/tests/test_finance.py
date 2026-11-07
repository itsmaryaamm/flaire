"""Finance layer tests: VAT split, cost center stamping, receipts, month-end close, exports, fee invoices and budget rollover."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_flaire.db"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_ENGINE"] = "native"

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import guard
from app.core.db import Base, SessionLocal, engine
from app.main import app

client = TestClient(app)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PERIOD = f"{date.today().year:04d}-{date.today().month:02d}"


@pytest.fixture(autouse=True, scope="module")
def _fresh_db():
    guard.reset()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    guard.reset()
    if os.path.exists("test_flaire.db"):
        os.remove("test_flaire.db")


@pytest.fixture(scope="module")
def ctx():
    r = client.post("/api/v1/auth/register", json={"company_name": "FinCo", "email": "owner@finco.sa", "password": "password123", "full_name": "Owner"})
    assert r.status_code == 201, r.text
    H = {"Authorization": f"Bearer {r.json()['access_token']}"}
    client.patch("/api/v1/company", json={"trusted_merchants": ["Google Ads", "Canva", "Notion"]}, headers=H)
    cc = client.post("/api/v1/finance/cost-centers", json={"code": "mkt-100", "name": "Marketing", "gl_code": "6100"}, headers=H)
    assert cc.status_code == 201, cc.text
    cc = cc.json()
    assert cc["code"] == "MKT-100"
    dept = client.post("/api/v1/departments", json={"name": "Marketing", "monthly_budget": 500_000}, headers=H).json()
    d = client.patch(f"/api/v1/departments/{dept['id']}", json={"cost_center_id": cc["id"]}, headers=H)
    assert d.status_code == 200, d.text
    assert d.json()["cost_center_id"] == cc["id"] and d.json()["gl_code"] is None
    ag = client.post("/api/v1/agents", json={"name": "Marketing AI", "role": "marketing", "department_id": dept["id"], "per_transaction_limit": 100_000,
                                            "monthly_limit": 400_000, "approval_threshold": 100_000, "allowed_categories": ["advertising", "software"],
                                            "max_requests_per_hour": 100}, headers=H).json()
    return {"H": H, "A": {"X-Agent-Key": ag["api_key"]}, "dept": dept, "agent": ag["agent"], "cc": cc}


def buy(ctx, amount, merchant="Google Ads", category="advertising", desc=""):
    r = client.post("/api/v1/agent/purchase-requests", json={"amount": amount, "merchant": merchant, "category": category, "description": desc}, headers=ctx["A"])
    assert r.status_code == 201, r.text
    return r.json()


def test_cost_center_crud_and_validation(ctx):
    H = ctx["H"]
    assert client.post("/api/v1/finance/cost-centers", json={"code": "MKT-100", "name": "dup"}, headers=H).status_code == 409
    ops = client.post("/api/v1/finance/cost-centers", json={"code": "OPS-200", "name": "Operations", "gl_code": "6200"}, headers=H).json()
    assert client.patch(f"/api/v1/finance/cost-centers/{ops['id']}", json={"name": "Ops"}, headers=H).json()["name"] == "Ops"
    assert [c["code"] for c in client.get("/api/v1/finance/cost-centers", headers=H).json()] == ["MKT-100", "OPS-200"]
    # unknown cost center on a department is rejected
    assert client.patch(f"/api/v1/departments/{ctx['dept']['id']}", json={"cost_center_id": 9999}, headers=H).status_code == 404
    # unused cost center is deleted outright
    assert client.delete(f"/api/v1/finance/cost-centers/{ops['id']}", headers=H).status_code == 204
    assert client.get(f"/api/v1/finance/cost-centers/{ops['id']}", headers=H).status_code == 404
    # agent keys cannot touch finance routes
    assert client.get("/api/v1/finance/cost-centers", headers=ctx["A"]).status_code == 401


def test_vat_split_and_cost_center_stamping(ctx):
    pr = buy(ctx, 50_000, desc="launch")
    assert pr["status"] == "completed"
    tx = client.get(f"/api/v1/transactions/{pr['transaction_id']}", headers=ctx["H"]).json()
    # amount is VAT inclusive: 50000 - round(50000 * 10000 / 11500) = 50000 - 43478 = 6522
    assert tx["vat_rate_bps"] == 1500 and tx["vat_amount"] == 6522
    assert tx["cost_center_id"] == ctx["cc"]["id"] and tx["gl_code"] == "6100"   # department cost center, cost center default GL
    assert tx["period"] == PERIOD and tx["locked"] is False
    assert tx["fee"] == round(50_000 * 15 / 10_000)
    # the agent's own GL code wins over the cost center default
    a = client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"gl_code": "6150"}, headers=ctx["H"])
    assert a.status_code == 200 and a.json()["gl_code"] == "6150"
    pr2 = buy(ctx, 11_500, merchant="Canva", category="software")
    tx2 = client.get(f"/api/v1/transactions/{pr2['transaction_id']}", headers=ctx["H"]).json()
    assert tx2["gl_code"] == "6150" and tx2["vat_amount"] == 1_500 and tx2["cost_center_id"] == ctx["cc"]["id"]
    ctx["tx"] = tx
    ctx["tx2"] = tx2


def test_fee_statement_has_vat_split(ctx):
    st = client.get("/api/v1/fees/statement", headers=ctx["H"]).json()
    assert st["transactions"] == 2 and st["volume"] == 61_500 and st["vat"] == 8_022 and st["volume_excl_vat"] == 53_478
    assert st["fees"] == sum(l["fee"] for l in st["lines"]) and st["fee_vat"] == round(st["fees"] * 15 / 100)
    live = client.get(f"/api/v1/finance/statement?period={PERIOD}", headers=ctx["H"]).json()
    assert live["closed"] is False and live["transaction_count"] == 2 and live["vat"] == 8_022
    assert live["by_cost_center"][0]["label"] == "MKT-100" and live["by_cost_center"][0]["amount"] == 61_500
    assert live["by_department"][0]["label"] == "Marketing" and live["by_agent"][0]["label"] == "Marketing AI"
    assert {b["key"] for b in live["by_category"]} == {"advertising", "software"}
    assert live["hash"].startswith("sha256:")


def test_attachment_upload_list_download_delete(ctx):
    H = ctx["H"]
    tx_id = ctx["tx"]["id"]
    r = client.post(f"/api/v1/transactions/{tx_id}/attachments", files={"file": ("receipt.png", PNG, "image/png")}, headers=H)
    assert r.status_code == 201, r.text
    att = r.json()
    import hashlib
    assert att["sha256"] == hashlib.sha256(PNG).hexdigest() and att["size"] == len(PNG) and att["content_type"] == "image/png"
    # wrong type and mismatched content are refused
    assert client.post(f"/api/v1/transactions/{tx_id}/attachments", files={"file": ("x.txt", b"hello", "text/plain")}, headers=H).status_code == 415
    assert client.post(f"/api/v1/transactions/{tx_id}/attachments", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}, headers=H).status_code == 415
    big = b"%PDF-1.4" + b"\x00" * (5 * 1024 * 1024)
    assert client.post(f"/api/v1/transactions/{tx_id}/attachments", files={"file": ("big.pdf", big, "application/pdf")}, headers=H).status_code == 413
    lst = client.get(f"/api/v1/transactions/{tx_id}/attachments", headers=H).json()
    assert [a["id"] for a in lst] == [att["id"]]
    dl = client.get(f"/api/v1/attachments/{att['id']}/download", headers=H)
    assert dl.status_code == 200 and dl.content == PNG and dl.headers["content-type"].startswith("image/png")
    # a second receipt, removed again
    att2 = client.post(f"/api/v1/transactions/{tx_id}/attachments", files={"file": ("inv.pdf", b"%PDF-1.7 fake", "application/pdf")}, headers=H).json()
    assert client.delete(f"/api/v1/attachments/{att2['id']}", headers=H).status_code == 204
    assert len(client.get(f"/api/v1/transactions/{tx_id}/attachments", headers=H).json()) == 1
    ctx["att"] = att


def test_period_close_refuses_pending_settlement_then_closes_and_locks(ctx):
    H = ctx["H"]
    periods = client.get("/api/v1/finance/periods", headers=H).json()
    cur = next(p for p in periods["periods"] if p["period"] == PERIOD)
    assert cur["closed"] is False and cur["transaction_count"] == 2 and cur["fiscal_year"] == f"FY{PERIOD[:4]}"
    assert periods["fiscal_years"][0]["label"] == cur["fiscal_year"]
    # one transaction still waiting for clearing blocks the close
    from app.models import Transaction
    db = SessionLocal()
    db.get(Transaction, ctx["tx2"]["id"]).status = "authorized"
    db.commit(); db.close()
    r = client.post(f"/api/v1/finance/periods/{PERIOD}/close", headers=H)
    assert r.status_code == 409 and "settlement" in r.json()["detail"]
    db = SessionLocal()
    db.get(Transaction, ctx["tx2"]["id"]).status = "settled"
    db.commit(); db.close()
    assert client.post("/api/v1/finance/periods/2099-01/close", headers=H).status_code == 422
    assert client.post("/api/v1/finance/periods/bad/close", headers=H).status_code == 422
    r = client.post(f"/api/v1/finance/periods/{PERIOD}/close", headers=H)
    assert r.status_code == 200, r.text
    snap = r.json()["statement"]
    assert snap["transaction_count"] == 2 and snap["volume"] == 61_500 and snap["vat"] == 8_022 and snap["fees"] == 75 + 17
    assert r.json()["locked_transactions"] == 2
    assert client.post(f"/api/v1/finance/periods/{PERIOD}/close", headers=H).status_code == 409
    # locked: no receipts in or out
    tx = client.get(f"/api/v1/transactions/{ctx['tx']['id']}", headers=H).json()
    assert tx["locked"] is True
    assert client.post(f"/api/v1/transactions/{tx['id']}/attachments", files={"file": ("r.png", PNG, "image/png")}, headers=H).status_code == 423
    assert client.delete(f"/api/v1/attachments/{ctx['att']['id']}", headers=H).status_code == 423
    # stored snapshot is served while closed and matches the live one
    stored = client.get(f"/api/v1/finance/statement?period={PERIOD}", headers=H).json()
    assert stored["closed"] is True and stored["hash"] == snap["hash"]
    assert next(p for p in client.get("/api/v1/finance/periods", headers=H).json()["periods"] if p["period"] == PERIOD)["closed"] is True
    # the closed month is still rolled into a closed-only listing when there are no transactions in it
    events = [e["event"] for e in client.get("/api/v1/audit?limit=50", headers=H).json()]
    assert "period.closed" in events


def test_exports_headers_and_rows(ctx):
    H = ctx["H"]
    e = client.get(f"/api/v1/finance/exports/transactions.csv?period={PERIOD}", headers=H)
    assert e.status_code == 200 and e.headers["content-type"].startswith("text/csv")
    lines = e.text.strip().splitlines()
    assert lines[0] == "date,transaction_id,request_id,employee,department,cost_center_code,gl_code,merchant,category,description,amount_incl_vat,vat_amount,amount_excl_vat,currency,status,provider_ref,fee,receipt_count"
    assert len(lines) == 3
    row = lines[1].split(",")
    assert row[1] == str(ctx["tx"]["id"]) and row[3] == "Marketing AI" and row[4] == "Marketing" and row[5] == "MKT-100" and row[6] == "6100"
    assert row[7] == "Google Ads" and row[8] == "advertising" and row[10] == "500.00" and row[11] == "65.22" and row[12] == "434.78" and row[13] == "SAR"
    assert row[14] == "settled" and row[16] == "0.75" and row[17] == "1"
    assert client.get("/api/v1/finance/exports/transactions.csv?period=nope", headers=H).status_code == 422

    sap = client.get(f"/api/v1/finance/exports/sap.csv?period={PERIOD}", headers=H)
    lines = sap.text.strip().splitlines()
    assert lines[0] == "posting_date,document_type,company_code,gl_account,cost_center,debit_amount,credit_amount,text,reference"
    assert len(lines) == 1 + 2 * 3   # three journal lines per transaction (expense, input VAT, card clearing)
    first = lines[1].split(",")
    assert first[1] == "SA" and first[3] == "6100" and first[4] == "MKT-100" and first[5] == "434.78" and first[6] == "" and first[8] == f"FLR-TX-{ctx['tx']['id']}"
    assert lines[3].split(",")[6] == "500.00"   # credit line balances the document
    debits = sum(float(l.split(",")[5] or 0) for l in lines[1:])
    credits = sum(float(l.split(",")[6] or 0) for l in lines[1:])
    assert round(debits, 2) == round(credits, 2) == 615.00

    ora = client.get(f"/api/v1/finance/exports/oracle.csv?period={PERIOD}", headers=H)
    lines = ora.text.strip().splitlines()
    assert lines[0] == "ledger,accounting_date,segment1,segment2,segment3,entered_dr,entered_cr,description"
    first = lines[1].split(",")
    assert first[0] == "FinCo Primary Ledger" and first[3] == "MKT-100" and first[4] == "6100" and first[5] == "434.78"


def test_fee_invoice_idempotent_and_pdf(ctx):
    H = ctx["H"]
    client.patch("/api/v1/company", json={"name": "FinCo"}, headers=H)
    r = client.post(f"/api/v1/finance/fee-invoices/{PERIOD}", headers=H)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["number"] == f"FLR-{PERIOD.replace('-', '')}-0001" and inv["subtotal"] == 92 and inv["vat"] == 14 and inv["total"] == 106 and inv["transaction_count"] == 2
    again = client.post(f"/api/v1/finance/fee-invoices/{PERIOD}", headers=H).json()
    assert again["id"] == inv["id"] and again["number"] == inv["number"]
    assert [i["id"] for i in client.get("/api/v1/finance/fee-invoices", headers=H).json()] == [inv["id"]]
    # ZATCA TLV: tag 1 seller name, tag 2 VAT number, tag 4 total, tag 5 VAT
    import base64
    raw = base64.b64decode(inv["qr_payload"])
    tags = {}
    i = 0
    while i < len(raw):
        tag, ln = raw[i], raw[i + 1]
        tags[tag] = raw[i + 2:i + 2 + ln].decode()
        i += 2 + ln
    assert tags[1] == "Flaire" and tags[2] == "300000000000003" and tags[4] == "1.06" and tags[5] == "0.14" and "T" in tags[3]
    pdf = client.get(f"/api/v1/finance/fee-invoices/{inv['id']}.pdf", headers=H)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
    assert client.get(f"/api/v1/finance/fee-invoices/{inv['id']}", headers=H).json()["number"] == inv["number"]
    assert client.get("/api/v1/finance/fee-invoices/9999.pdf", headers=H).status_code == 404


def test_reopen_is_owner_only_and_unlocks(ctx):
    H = ctx["H"]
    from app.core.security import hash_password
    from app.models import User
    db = SessionLocal()
    owner = db.query(User).filter(User.email == "owner@finco.sa").one()
    db.add(User(company_id=owner.company_id, email="fin@finco.sa", full_name="Fin", password_hash=hash_password("password123"), role="finance"))
    db.commit(); db.close()
    guard.reset()
    tok = client.post("/api/v1/auth/login", json={"email": "fin@finco.sa", "password": "password123"}).json()["access_token"]
    F = {"Authorization": f"Bearer {tok}"}
    assert client.post(f"/api/v1/finance/periods/{PERIOD}/reopen", headers=F).status_code == 403
    r = client.post(f"/api/v1/finance/periods/{PERIOD}/reopen", headers=H)
    assert r.status_code == 200 and r.json()["unlocked_transactions"] == 2
    assert client.post(f"/api/v1/finance/periods/{PERIOD}/reopen", headers=H).status_code == 404
    assert client.get(f"/api/v1/transactions/{ctx['tx']['id']}", headers=H).json()["locked"] is False
    assert client.get(f"/api/v1/finance/statement?period={PERIOD}", headers=H).json()["closed"] is False
    events = [e["event"] for e in client.get("/api/v1/audit?limit=20", headers=H).json()]
    assert "period.reopened" in events
    # finance can close again
    assert client.post(f"/api/v1/finance/periods/{PERIOD}/close", headers=F).status_code == 200
    assert client.post(f"/api/v1/finance/periods/{PERIOD}/reopen", headers=H).status_code == 200


def test_rollover_math(ctx):
    from app.finance import fiscal_year_label, roll_period, vat_split
    from app.models import Company, Department
    assert vat_split(50_000, 1500) == 6_522 and vat_split(11_500, 1500) == 1_500 and vat_split(100, 0) == 0
    assert fiscal_year_label("2026-03", 1) == "FY2026" and fiscal_year_label("2026-09", 7) == "FY2027" and fiscal_year_label("2026-03", 7) == "FY2026"
    db = SessionLocal()
    company = db.get(Company, ctx["dept"]["id"] and client.get("/api/v1/company", headers=ctx["H"]).json()["id"])
    dept = db.get(Department, ctx["dept"]["id"])
    last_month = (date.today().replace(day=1) - __import__("datetime").timedelta(days=1)).replace(day=1)
    # without rollover: counters reset, nothing carried
    dept.period_start = last_month
    dept.spent_this_period = 61_500
    company.budget_rollover = False
    db.commit()
    rolled = roll_period(db, company)
    db.commit()
    assert len(rolled) == 1 and rolled[0]["carried"] == 0
    assert dept.spent_this_period == 0 and dept.rollover_balance == 0 and dept.period_start == date.today().replace(day=1)
    assert dept.remaining == 500_000
    # with rollover: unspent carries and remaining grows
    dept.period_start = last_month
    dept.spent_this_period = 120_000
    company.budget_rollover = True
    db.commit()
    rolled = roll_period(db, company)
    db.commit()
    assert rolled[0]["carried"] == 380_000 and dept.rollover_balance == 380_000 and dept.spent_this_period == 0
    assert dept.remaining == 880_000
    # second month: previous carry is part of what rolls forward
    dept.period_start = last_month
    dept.spent_this_period = 800_000
    db.commit()
    roll_period(db, company)
    db.commit()
    assert dept.rollover_balance == 80_000 and dept.remaining == 580_000
    # already rolled this month: nothing happens
    assert roll_period(db, company) == []
    db.close()
    d = client.get("/api/v1/departments", headers=ctx["H"]).json()[0]
    assert d["rollover_balance"] == 80_000 and d["remaining"] == 580_000

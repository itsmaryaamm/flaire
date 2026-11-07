"""Abuse test suite (docs/THREAT_MODEL.md, "Abuse test suite").

Every test here is an attack an AI employee, a compromised key or a careless human could try against Flaire, and the
expected outcome is that the engine or the API refuses it. Each case is its own test so a regression names the hole.

Runs against the same SQLite database as test_flaire.py with its own company, so counters and limits start clean.
"""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_flaire.db"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_ENGINE"] = "native"

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import guard
from app.core.db import Base, SessionLocal, engine
from app.core.security import create_access_token, hash_api_key, hash_password
from app.main import app
from app.models import Agent, OAuthToken, PurchaseRequest, Transaction, User

client = TestClient(app)
PASSWORD = "password123"


@pytest.fixture(autouse=True, scope="module")
def _fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    guard.reset()
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    if os.path.exists("test_flaire.db"):
        os.remove("test_flaire.db")


@pytest.fixture(autouse=True)
def _no_rate_limits():
    guard.reset()
    yield
    guard.reset()


@pytest.fixture(scope="module")
def ctx():
    r = client.post("/api/v1/auth/register", json={"company_name": "AbuseCo", "email": "owner@abuse.sa", "password": PASSWORD, "full_name": "Owner"})
    assert r.status_code == 201, r.text
    H = {"Authorization": f"Bearer {r.json()['access_token']}"}
    company_id = r.json()["company"]["id"]
    # No trusted suppliers and no new-supplier review, so the rules under test are the only thing deciding.
    client.patch("/api/v1/company", json={"trusted_merchants": [], "new_merchant_review_from": 0}, headers=H)
    marketing = client.post("/api/v1/departments", json={"name": "Marketing", "monthly_budget": 100_000_000}, headers=H).json()
    ops = client.post("/api/v1/departments", json={"name": "Operations", "monthly_budget": 100_000_000}, headers=H).json()
    client.post("/api/v1/cards", json={"label": "SNB Business", "provider": "mock_snb", "last4": "1111", "credit_limit": 1_000_000_000, "is_default": True}, headers=H)
    return {"H": H, "company_id": company_id, "marketing": marketing, "ops": ops}


def make_agent(ctx, name, **overrides):
    body = {"name": name, "role": "general", "department_id": ctx["marketing"]["id"], "per_transaction_limit": 1_000_000, "monthly_limit": 50_000_000,
            "approval_threshold": 1_000_000, "allowed_categories": [], "blocked_merchants": [], "max_requests_per_hour": 50, "max_requests_per_day": 1000}
    body.update(overrides)
    r = client.post("/api/v1/agents", json=body, headers=ctx["H"])
    assert r.status_code == 201, r.text
    data = r.json()
    return data["agent"], {"X-Agent-Key": data["api_key"]}


def buy(A, amount, merchant, category="software", desc=""):
    r = client.post("/api/v1/agent/purchase-requests", json={"amount": amount, "merchant": merchant, "category": category, "description": desc}, headers=A)
    assert r.status_code == 201, r.text
    return r.json()


def make_user(ctx, email, role, department_id=None, status="active"):
    db = SessionLocal()
    u = User(company_id=ctx["company_id"], email=email, full_name=email.split("@")[0].title(), password_hash=hash_password(PASSWORD), role=role,
             department_id=department_id, status=status)
    db.add(u)
    db.commit()
    uid, cid = u.id, u.company_id
    db.close()
    return uid, {"Authorization": f"Bearer {create_access_token(uid, cid)}"}


def login(email):
    guard.reset()
    return client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})


# 1 ---------------------------------------------------------------- split purchase
def test_split_purchase_is_held(ctx):
    """Per-purchase limit SAR 1,000. Three requests of SAR 900 to one merchant inside an hour: the second already sums past the limit."""
    _, A = make_agent(ctx, "Splitter", per_transaction_limit=100_000, approval_threshold=100_000)
    first = buy(A, 90_000, "Hosting Co")
    assert first["status"] == "completed", first["decision"]
    second = buy(A, 90_000, "Hosting Co")
    third = buy(A, 90_000, "Hosting Co")
    held = [p for p in (second, third) if p["status"] == "pending_approval" and p["decision"]["rule_id"] == "split-purchase"]
    assert held, (second["decision"], third["decision"])
    reason = " ".join(held[0]["decision"]["reasons"])
    assert "Possible split purchase" in reason and "Hosting Co" in reason and "per-purchase limit" in reason
    assert not any(p["status"] == "completed" for p in (second, third))


def test_split_check_does_not_fire_under_the_limit(ctx):
    """Two small purchases at one merchant that stay under the limit together are a plain duplicate hold, not a split."""
    _, A = make_agent(ctx, "Modest", per_transaction_limit=1_000_000, approval_threshold=1_000_000)
    assert buy(A, 7_700, "Canva")["status"] == "completed"
    again = buy(A, 7_700, "Canva")
    assert again["status"] == "pending_approval" and again["decision"]["rule_id"] == "duplicate-purchase"


# 2 ---------------------------------------------------------------- category relabel
def test_known_advertising_merchant_relabelled_as_services(ctx):
    _, A = make_agent(ctx, "Relabeler", allowed_categories=["software", "services"])
    pr = buy(A, 10_000, "Google Ads", category="services")
    assert pr["category"] == "advertising"
    assert pr["status"] == "denied" and pr["decision"]["rule_id"] == "category-not-allowed", pr["decision"]
    assert any("Category corrected" in r and "services" in r for r in pr["decision"]["reasons"])


# 3 ---------------------------------------------------------------- receipt replay
def test_receipt_cannot_be_replayed(ctx):
    """There is no public endpoint that accepts a receipt: the payment service consumes the engine's receipt internally.
    So the replay is tested at that boundary: the receipt captured from a paid request is presented to execute_payment
    again (a) for the same request and (b) for a forged second request with identical agent, merchant and amount.
    Both must be refused. The receipts module itself is also checked for single use."""
    from app.integrations.shotoku.interface import Decision
    from app.integrations.shotoku.receipts import create_receipt, verify_and_consume
    from app.models import Company
    from app.services import execute_payment

    agent, A = make_agent(ctx, "Replayer")
    paid = buy(A, 5_000, "Canva")
    assert paid["status"] == "completed" and paid["decision"]["receipt"].startswith("rcpt.")
    receipt = paid["decision"]["receipt"]
    db = SessionLocal()
    company = db.get(Company, ctx["company_id"])
    pr = db.get(PurchaseRequest, paid["id"])
    fake = Decision(verdict="approved", reasons=["replay"], engine="native", receipt=receipt)
    # (a) same request again
    assert execute_payment(db, company, pr, fake) is None
    assert db.query(Transaction).filter(Transaction.purchase_request_id == pr.id).count() == 1
    # (b) a forged second request carrying the old receipt
    forged = PurchaseRequest(company_id=company.id, agent_id=agent["id"], department_id=agent["department_id"], amount=5_000, currency="SAR",
                             merchant="Canva", category="software", description="replay", status="approved", decision={})
    db.add(forged)
    db.flush()
    assert execute_payment(db, company, forged, fake) is None
    assert forged.status == "failed" and "already been used" in forged.decision["payment_error"]
    assert db.query(Transaction).filter(Transaction.purchase_request_id == forged.id).count() == 0
    db.rollback()
    db.close()
    # the module: a fresh receipt verifies once
    tok = create_receipt(secret="s", decision_id="dec_x", actor="agent-1", resource="Canva", amount_major=50)
    assert verify_and_consume(tok, secret="s", actor="agent-1", resource="Canva", amount_major=50)[0]
    ok, reasons = verify_and_consume(tok, secret="s", actor="agent-1", resource="Canva", amount_major=50)
    assert not ok and "already been used" in reasons[0]


# 4 ---------------------------------------------------------------- hourly and daily caps
def test_hourly_cap(ctx):
    _, A = make_agent(ctx, "Hourly", max_requests_per_hour=3, max_requests_per_day=1000)
    for i in range(3):
        assert buy(A, 1_000, f"Shop {i}")["status"] == "completed"
    fourth = buy(A, 1_000, "Shop 99")
    assert fourth["status"] == "denied" and fourth["decision"]["rule_id"] == "velocity"


def test_daily_cap(ctx):
    _, A = make_agent(ctx, "Daily", max_requests_per_hour=50, max_requests_per_day=5)
    for i in range(5):
        assert buy(A, 1_000, f"Store {i}")["status"] == "completed"
    sixth = buy(A, 1_000, "Store 99")
    assert sixth["status"] == "denied" and sixth["decision"]["rule_id"] == "velocity-daily"
    assert any("requests/day" in r for r in sixth["decision"]["reasons"])


# 5 ---------------------------------------------------------------- agent key on human endpoints
def test_agent_key_rejected_on_human_endpoints(ctx):
    agent, A = make_agent(ctx, "Trespasser")
    for path in ("/api/v1/approvals", "/api/v1/company", "/api/v1/agents", "/api/v1/team/members", "/api/v1/policy/changes", "/api/v1/purchase-requests"):
        assert client.get(path, headers=A).status_code in (401, 403), path
    assert client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=A).status_code in (401, 403)
    assert client.post("/api/v1/approvals/1/approve", json={"password": PASSWORD}, headers=A).status_code in (401, 403)
    assert client.patch(f"/api/v1/agents/{agent['id']}", json={"per_transaction_limit": 10**9}, headers=A).status_code in (401, 403)
    assert client.patch("/api/v1/team/members/1", json={"role": "owner"}, headers=A).status_code in (401, 403)


# 6 ---------------------------------------------------------------- read-only roles and disabled accounts
def test_viewer_auditor_and_disabled_cannot_approve(ctx):
    _, A = make_agent(ctx, "Needs Human", approval_threshold=1)
    pr = buy(A, 2_000, "Figma")
    assert pr["status"] == "pending_approval"
    _, viewer = make_user(ctx, "viewer@abuse.sa", "viewer")
    _, auditor = make_user(ctx, "auditor@abuse.sa", "auditor")
    disabled_id, disabled = make_user(ctx, "gone@abuse.sa", "finance", status="disabled")
    for who, H in (("viewer", viewer), ("auditor", auditor)):
        r = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PASSWORD}, headers=H)
        assert r.status_code == 403, (who, r.text)
        assert client.post(f"/api/v1/approvals/{pr['id']}/reject", json={"password": PASSWORD}, headers=H).status_code == 403
    # a disabled account is dead on every route (login itself still answers, by design: see test_team.py), whether the
    # token was issued before the account was disabled or minted fresh now
    fresh = login("gone@abuse.sa")
    tokens = [disabled] + ([{"Authorization": f"Bearer {fresh.json()['access_token']}"}] if fresh.status_code == 200 else [])
    for T in tokens:
        for path in ("/api/v1/company", "/api/v1/approvals", "/api/v1/dashboard/summary", "/api/v1/team/members", "/api/v1/policy/changes"):
            r = client.get(path, headers=T)
            assert r.status_code == 403 and r.json()["detail"] == "account_disabled", path
        r = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PASSWORD}, headers=T)
        assert r.status_code == 403 and r.json()["detail"] == "account_disabled"
        assert client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=T).status_code == 403
    assert client.get(f"/api/v1/purchase-requests/{pr['id']}", headers=ctx["H"]).json()["status"] == "pending_approval"


# 7 ---------------------------------------------------------------- department head, other department
def test_department_head_cannot_approve_other_department(ctx):
    _, A = make_agent(ctx, "Marketing Buyer", approval_threshold=1)
    pr = buy(A, 2_000, "Notion")
    assert pr["status"] == "pending_approval" and pr["department_id"] == ctx["marketing"]["id"]
    _, ops_head = make_user(ctx, "opshead@abuse.sa", "dept_head", department_id=ctx["ops"]["id"])
    r = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PASSWORD}, headers=ops_head)
    assert r.status_code == 403 and "own departments" in r.json()["detail"], r.text
    assert client.get(f"/api/v1/purchase-requests/{pr['id']}", headers=ctx["H"]).json()["status"] == "pending_approval"
    # the head of the right department can
    _, mkt_head = make_user(ctx, "mkthead@abuse.sa", "dept_head", department_id=ctx["marketing"]["id"])
    done = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PASSWORD}, headers=mkt_head)
    assert done.status_code == 200 and done.json()["status"] == "completed", done.text


# 9 ---------------------------------------------------------------- kill switch
def test_kill_switch_denies_requests_and_freezes_approvals(ctx):
    H = ctx["H"]
    _, A = make_agent(ctx, "Kill Test", approval_threshold=1)
    pending = buy(A, 2_000, "Slack")
    assert pending["status"] == "pending_approval"
    assert client.post("/api/v1/company/kill-switch", json={"enabled": True, "reason": "incident"}, headers=H).status_code == 200
    try:
        denied = buy(A, 500, "GitHub")
        assert denied["status"] == "denied" and denied["decision"]["rule_id"] == "kill-switch"
        assert any("kill switch" in r.lower() for r in denied["decision"]["reasons"])
        r = client.post(f"/api/v1/approvals/{pending['id']}/approve", json={"password": PASSWORD}, headers=H)
        assert r.status_code == 409 and "Kill switch" in r.json()["detail"]
        assert client.get(f"/api/v1/purchase-requests/{pending['id']}", headers=H).json()["status"] == "pending_approval"
    finally:
        client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=H)
    assert buy(A, 500, "GitHub")["status"] == "pending_approval"


# 10 --------------------------------------------------------------- amount and field tampering
def test_amount_and_field_tampering_rejected(ctx):
    from app.core.categorize import CATEGORIES
    _, A = make_agent(ctx, "Tamperer")
    post = lambda **kw: client.post("/api/v1/agent/purchase-requests", json={"amount": 1_000, "merchant": "Canva", "category": "software", "description": "", **kw}, headers=A)
    assert post(amount=0).status_code == 422
    assert post(amount=-500).status_code == 422
    assert post(amount=1_000_000_001).status_code == 422          # above SAR 10,000,000
    assert post(amount=1_000_000_000).status_code == 201          # exactly the cap is a valid request (the engine then applies limits)
    assert post(amount=12.5).status_code == 422                   # halalas are integers
    assert post(amount="1000; drop table").status_code == 422
    assert post(merchant="M" * 201).status_code == 422
    assert post(merchant="   ").status_code == 422
    assert post(category="").status_code == 422
    assert post(category="c" * 61).status_code == 422
    weird = post(merchant="Mystery Vendor", category="zzz-not-a-category")
    assert weird.status_code == 201 and weird.json()["category"] in CATEGORIES
    assert post(merchant="Mystery Vendor 2", category="ad").json()["category"] == "advertising"
    # the MCP tool path has no pydantic model, so it needs its own cap
    key = A["X-Agent-Key"]
    r = client.post(f"/api/v1/mcp/{key}", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                 "params": {"name": "request_purchase", "arguments": {"amount_sar": 99_000_000, "merchant": "Canva", "category": "software", "description": "x"}}})
    assert r.status_code == 200 and r.json()["result"]["isError"] is True and "at most" in r.json()["result"]["content"][0]["text"]
    r = client.post(f"/api/v1/mcp/{key}", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                                                 "params": {"name": "request_purchase", "arguments": {"amount_sar": "lots", "merchant": "Canva", "category": "software", "description": "x"}}})
    assert r.status_code == 200 and r.json()["result"]["isError"] is True


# 11 --------------------------------------------------------------- MCP connector with revoked and paused identities
def _issue_token(ctx, agent_id, token, revoked=False):
    db = SessionLocal()
    owner = db.query(User).filter(User.email == "owner@abuse.sa").first()
    db.add(OAuthToken(access_hash=hash_api_key(token), refresh_hash=hash_api_key("r" + token), client_id="fcl_test", user_id=owner.id, agent_id=agent_id,
                      company_id=ctx["company_id"], revoked=revoked, expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db.commit()
    db.close()


def test_mcp_revoked_connection_and_paused_agent(ctx):
    import json as _json
    agent, _ = make_agent(ctx, "Connector")
    call = {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "request_purchase", "arguments": {"amount_sar": 10, "merchant": "Canva", "category": "software", "description": "mcp"}}}
    # revoked connection: JSON-RPC error, not a tool result
    _issue_token(ctx, agent["id"], "fat_revoked_token_abuse", revoked=True)
    r = client.post("/api/v1/mcp", json=call, headers={"Authorization": "Bearer fat_revoked_token_abuse"})
    assert r.status_code == 401 and "error" in r.json() and r.json()["error"]["code"] == -32001 and "result" not in r.json()
    # paused agent: a live token still gets a denied verdict, never a 500
    _issue_token(ctx, agent["id"], "fat_live_token_abuse")
    assert client.patch(f"/api/v1/agents/{agent['id']}", json={"status": "paused"}, headers=ctx["H"]).status_code == 200
    r = client.post("/api/v1/mcp", json=call, headers={"Authorization": "Bearer fat_live_token_abuse"})
    assert r.status_code == 200, r.text
    body = _json.loads(r.json()["result"]["content"][0]["text"])
    assert body["status"] == "denied" and body["verdict"] == "denied" and r.json()["result"]["isError"] is True
    assert any("paused" in s for s in body["reasons"])
    client.patch(f"/api/v1/agents/{agent['id']}", json={"status": "active"}, headers=ctx["H"])


# 12 --------------------------------------------------------------- anomaly flags
def test_anomaly_flag_three_times_average(ctx):
    from app.core.velocity import anomaly_flags
    from app.models import Company
    agent, A = make_agent(ctx, "Flagged")
    for i, merchant in enumerate(("Canva", "Notion", "Figma")):
        assert buy(A, 10_000, merchant)["status"] == "completed"
    big = buy(A, 50_000, "Slack")
    assert big["status"] == "completed"                      # flags never change the verdict
    assert any("average purchase" in f for f in big["flags"]), big["flags"]
    assert big["decision"]["flags"] == big["flags"]
    listed = {p["id"]: p for p in client.get(f"/api/v1/purchase-requests?agent_id={agent['id']}", headers=ctx["H"]).json()}
    assert any("average purchase" in f for f in listed[big["id"]]["flags"])
    assert client.get(f"/api/v1/purchase-requests/{big['id']}", headers=ctx["H"]).json()["flags"] == big["flags"]
    # direct call: large first purchase and working hours are judged in Riyadh time
    db = SessionLocal()
    company, a = db.get(Company, ctx["company_id"]), db.get(Agent, agent["id"])
    night = datetime(2026, 1, 1, 20, 30, tzinfo=timezone.utc)   # 23:30 Riyadh
    flags = anomaly_flags(db, company, a, "Jarir", 600_000, now=night)
    assert "First purchase from this employee above SAR 5,000" in flags
    assert "Outside working hours (Riyadh 22:00 to 06:00)" in flags
    noon = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)      # 12:00 Riyadh
    assert not any("working hours" in f for f in anomaly_flags(db, company, a, "Canva", 10_000, now=noon))
    db.close()


# 8 ---------------------------------------------------------------- proposer approving their own policy change (last: it toggles change approval)
def test_proposer_cannot_approve_own_policy_change(ctx):
    H = ctx["H"]
    agent, _ = make_agent(ctx, "Policy Target", per_transaction_limit=100_000)
    assert client.patch("/api/v1/company", json={"require_change_approval": True}, headers=H).status_code == 200   # tightening applies at once
    r = client.patch(f"/api/v1/agents/{agent['id']}", json={"per_transaction_limit": 5_000_000, "change_reason": "bigger campaigns"}, headers=H)
    assert r.status_code == 202, r.text
    change_id = r.json()["pending_change_id"]
    r = client.post(f"/api/v1/policy/changes/{change_id}/approve", json={"password": PASSWORD}, headers=H)
    assert r.status_code == 403 and "different admin" in r.json()["detail"]
    assert client.get(f"/api/v1/agents/{agent['id']}", headers=H).json()["per_transaction_limit"] == 100_000   # nothing applied
    # a second admin can, and the proposer's password alone never does it
    _, admin = make_user(ctx, "admin2@abuse.sa", "admin")
    ok = client.post(f"/api/v1/policy/changes/{change_id}/approve", json={"password": PASSWORD}, headers=admin)
    assert ok.status_code == 200 and ok.json()["status"] == "applied"
    assert client.get(f"/api/v1/agents/{agent['id']}", headers=H).json()["per_transaction_limit"] == 5_000_000
    # turning change approval off is itself a loosening and needs the second admin
    r = client.patch("/api/v1/company", json={"require_change_approval": False}, headers=H)
    assert r.status_code == 202
    client.post(f"/api/v1/policy/changes/{r.json()['pending_change_id']}/approve", json={"password": PASSWORD}, headers=admin)
    assert client.get("/api/v1/company", headers=H).json()["require_change_approval"] is False

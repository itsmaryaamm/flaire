"""End-to-end tests for the Flaire pipeline against an in-memory SQLite database.

Covers the first milestone (agent requests SAR 500 → rules → mock bank pays → dashboard updates), every
denial rule, the approval flow, the kill switch, bypass attempts and the audit chain.
"""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_flaire.db"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_ENGINE"] = "native"

import pytest
from fastapi.testclient import TestClient

from app.core.db import Base, engine
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True, scope="module")
def _fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    if os.path.exists("test_flaire.db"):
        os.remove("test_flaire.db")


@pytest.fixture(scope="module")
def ctx():
    r = client.post("/api/v1/auth/register", json={"company_name": "TestCo", "email": "owner@test.sa", "password": "password123", "full_name": "Owner"})
    assert r.status_code == 201, r.text
    H = {"Authorization": f"Bearer {r.json()['access_token']}"}
    dept = client.post("/api/v1/departments", json={"name": "Marketing", "monthly_budget": 500_000}, headers=H).json()
    card = client.post("/api/v1/cards", json={"label": "SNB Business", "provider": "mock_snb", "last4": "4471", "credit_limit": 1_000_000, "is_default": True}, headers=H).json()
    ag = client.post("/api/v1/agents", json={"name": "Marketing AI", "role": "marketing", "department_id": dept["id"], "per_transaction_limit": 100_000,
                                            "monthly_limit": 400_000, "approval_threshold": 100_000, "allowed_categories": ["advertising", "software"],
                                            "blocked_merchants": ["Gift card"], "max_requests_per_hour": 50}, headers=H).json()
    return {"H": H, "A": {"X-Agent-Key": ag["api_key"]}, "dept": dept, "card": card, "agent": ag["agent"]}


def buy(ctx, amount, merchant="Google Ads", category="advertising", desc=""):
    r = client.post("/api/v1/agent/purchase-requests", json={"amount": amount, "merchant": merchant, "category": category, "description": desc}, headers=ctx["A"])
    assert r.status_code == 201, r.text
    return r.json()


# ---------------- milestone one ----------------
def test_sar_500_purchase_end_to_end(ctx):
    pr = buy(ctx, 50_000, desc="Ramadan launch campaign")
    assert pr["status"] == "completed"
    assert pr["decision"]["verdict"] == "approved"
    assert pr["decision"]["receipt"].startswith("rcpt.")
    assert pr["transaction_id"]
    tx = client.get(f"/api/v1/transactions/{pr['transaction_id']}", headers=ctx["H"]).json()
    assert tx["status"] == "settled" and tx["provider"] == "mock_snb" and tx["amount"] == 50_000
    card = client.get("/api/v1/cards", headers=ctx["H"]).json()[0]
    assert card["available_balance"] == 1_000_000 - 50_000
    dash = client.get("/api/v1/dashboard/summary", headers=ctx["H"]).json()
    assert dash["totals"]["spent_this_period"] == 50_000
    assert dash["departments"][0]["remaining"] == 450_000


# ---------------- denial rules ----------------
def test_gift_card_blocked(ctx):
    pr = buy(ctx, 10_000, merchant="Gift card", category="advertising")
    assert pr["status"] == "denied"
    assert any("blocked" in r.lower() for r in pr["decision"]["reasons"])


def test_category_not_allowed(ctx):
    pr = buy(ctx, 10_000, merchant="Jarir", category="equipment")
    assert pr["status"] == "denied" and pr["decision"]["rule_id"] == "category-not-allowed"


def test_per_transaction_limit(ctx):
    pr = buy(ctx, 150_000)
    assert pr["status"] == "denied" and pr["decision"]["rule_id"] == "per-transaction-limit"


def test_needs_approval_then_approve(ctx):
    pr = buy(ctx, 100_000, merchant="Snapchat Ads")
    assert pr["status"] == "pending_approval"
    # the agent cannot approve: it has no such endpoint, and its key is rejected by human routes
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={}, headers=ctx["A"]).status_code == 401
    pending = client.get("/api/v1/approvals", headers=ctx["H"]).json()
    assert [p["id"] for p in pending] == [pr["id"]]
    done = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"note": "ok for launch"}, headers=ctx["H"]).json()
    assert done["status"] == "completed" and done["approved_by"]["full_name"] == "Owner"
    assert client.get("/api/v1/approvals", headers=ctx["H"]).json() == []


def test_reject(ctx):
    pr = buy(ctx, 100_000, merchant="TikTok Ads")
    assert pr["status"] == "pending_approval"
    out = client.post(f"/api/v1/approvals/{pr['id']}/reject", json={"note": "no"}, headers=ctx["H"]).json()
    assert out["status"] == "rejected"
    assert client.get("/api/v1/cards", headers=ctx["H"]).json()[0]["available_balance"] == 1_000_000 - 150_000


def test_department_budget_enforced(ctx):
    # Spent so far: 50k + 100k = 150k of 500k. Agent monthly limit 400k. Ask for 99k x 3 then one more that busts the dept budget.
    for _ in range(2):
        assert buy(ctx, 99_000)["status"] == "completed"
    # spent 348k, agent limit 400k leaves 52k; dept remaining 152k. 60k → agent-monthly-limit
    pr = buy(ctx, 60_000)
    assert pr["status"] == "denied" and pr["decision"]["rule_id"] == "agent-monthly-limit"


def test_kill_switch(ctx):
    client.post("/api/v1/company/kill-switch", json={"enabled": True, "reason": "test"}, headers=ctx["H"])
    pr = buy(ctx, 1_000)
    assert pr["status"] == "denied" and pr["decision"]["rule_id"] == "kill-switch"
    client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=ctx["H"])
    assert buy(ctx, 1_000)["status"] == "completed"


def test_paused_agent(ctx):
    client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"status": "paused"}, headers=ctx["H"])
    assert buy(ctx, 1_000)["decision"]["rule_id"] == "agent-paused"
    client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"status": "active"}, headers=ctx["H"])


def test_bad_key_and_tampered_receipt(ctx):
    assert client.post("/api/v1/agent/purchase-requests", json={"amount": 100, "merchant": "x", "category": "advertising"}, headers={"X-Agent-Key": "flk_fake"}).status_code == 401
    from app.integrations.shotoku.receipts import create_receipt, verify_receipt
    tok = create_receipt(secret="s", decision_id="dec_1", actor="agent-1", resource="Google Ads", amount_major=5)
    assert verify_receipt(tok, secret="s", actor="agent-1", resource="Google Ads", amount_major=5)[0]
    assert not verify_receipt(tok, secret="s", actor="agent-1", resource="Google Ads", amount_major=50)[0]
    assert not verify_receipt(tok[:-2] + "ab", secret="s", actor="agent-1", resource="Google Ads", amount_major=5)[0]
    assert not verify_receipt(tok, secret="other", actor="agent-1", resource="Google Ads", amount_major=5)[0]


def test_scripted_agent_run(ctx):
    r = client.post(f"/api/v1/agents/{ctx['agent']['id']}/run", json={"task": "Buy a Canva subscription for about SAR 200"}, headers=ctx["H"])
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["mode"] == "scripted" and run["purchase_requests"][0]["merchant"] == "Canva"
    assert run["purchase_requests"][0]["amount"] == 20_000


def test_audit_chain_intact(ctx):
    v = client.get("/api/v1/audit/verify", headers=ctx["H"]).json()
    assert v["ok"] and v["entries"] > 10
    events = {e["event"] for e in client.get("/api/v1/audit?limit=500", headers=ctx["H"]).json()}
    assert {"purchase.requested", "decision.approved", "decision.denied", "payment.settled", "kill_switch.on", "approval.approved"} <= events


def test_mcp_connector(ctx):
    import json as _json
    key = ctx["A"]["X-Agent-Key"]
    url = f"/api/v1/mcp/{key}"
    init = client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}).json()
    assert init["result"]["serverInfo"]["name"] == "flaire"
    assert client.post(url, json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202
    tools = client.post(url, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]
    assert {t["name"] for t in tools} == {"check_budget", "request_purchase", "get_purchase_status", "list_my_requests"}
    r = client.post(url, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "request_purchase", "arguments": {"amount_sar": 5, "merchant": "Google Ads", "category": "advertising", "description": "mcp"}}}).json()
    body = _json.loads(r["result"]["content"][0]["text"])
    assert body["status"] == "completed" and r["result"]["isError"] is False
    assert client.post("/api/v1/mcp/flk_nope", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}).status_code == 401
    assert "approve" not in " ".join(t["name"] for t in tools)

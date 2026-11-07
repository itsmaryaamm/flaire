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
    client.patch("/api/v1/company", json={"trusted_merchants": ["Google Ads", "Snapchat Ads", "TikTok Ads", "Meta Ads", "LinkedIn Ads", "Canva", "Aramex"]}, headers=H)
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
    # password re-entry is enforced server-side
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"note": "x"}, headers=ctx["H"]).status_code == 403
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"note": "x", "password": "wrong"}, headers=ctx["H"]).status_code == 403
    done = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"note": "ok for launch", "password": "password123"}, headers=ctx["H"]).json()
    assert done["status"] == "completed" and done["approved_by"]["full_name"] == "Owner"
    assert client.get("/api/v1/approvals", headers=ctx["H"]).json() == []


def test_reject(ctx):
    pr = buy(ctx, 100_000, merchant="TikTok Ads")
    assert pr["status"] == "pending_approval"
    out = client.post(f"/api/v1/approvals/{pr['id']}/reject", json={"note": "no", "password": "password123"}, headers=ctx["H"]).json()
    assert out["status"] == "rejected"
    assert client.get("/api/v1/cards", headers=ctx["H"]).json()[0]["available_balance"] == 1_000_000 - 150_000


def test_department_budget_enforced(ctx):
    # Spent so far: 50k + 100k = 150k of 500k. Agent monthly limit 400k. Ask for 99k x 3 then one more that busts the dept budget.
    for merchant in ("Meta Ads", "LinkedIn Ads"):
        assert buy(ctx, 99_000, merchant=merchant)["status"] == "completed"
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


def test_two_person_rule(ctx):
    from app.core import guard
    guard.reset()
    H = ctx["H"]
    # Raise limits so a SAR 3,000 request is possible, keep approval threshold so it goes pending.
    client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"per_transaction_limit": 500_000, "monthly_limit": 2_000_000}, headers=H)
    client.patch("/api/v1/departments/%d" % ctx["dept"]["id"], json={"monthly_budget": 5_000_000}, headers=H)
    pr = buy(ctx, 300_000, merchant="Snapchat Ads")
    assert pr["status"] == "pending_approval"
    first = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": "password123"}, headers=H).json()
    assert first["status"] == "pending_approval" and first["needs_second_approver"] is True and len(first["approvals"]) == 1
    # same person cannot give the second approval
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": "password123"}, headers=H).status_code == 409
    # a second human can. Register one in the same company by inviting: for the test, create directly.
    from app.core.db import SessionLocal
    from app.core.security import hash_password
    from app.models import User
    db = SessionLocal()
    u2 = User(company_id=db.query(User).filter(User.email == "owner@test.sa").first().company_id, email="finance@test.sa", full_name="Finance", password_hash=hash_password("password123"), role="finance")
    db.add(u2); db.commit(); db.close()
    tok2 = client.post("/api/v1/auth/login", json={"email": "finance@test.sa", "password": "password123"}).json()["access_token"]
    second = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": "password123"}, headers={"Authorization": f"Bearer {tok2}"}).json()
    assert second["status"] == "completed" and len(second["approvals"]) == 2


def test_agent_key_cannot_reach_human_routes(ctx):
    A = ctx["A"]
    for path in ["/api/v1/approvals", "/api/v1/agents", "/api/v1/cards", "/api/v1/company", "/api/v1/dashboard/summary", "/api/v1/audit"]:
        assert client.get(path, headers=A).status_code == 401, path
    assert client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=A).status_code == 401
    assert client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"per_transaction_limit": 10**9}, headers=A).status_code == 401


def test_bad_key_lockout_and_rate_limit(ctx):
    from app.core import guard
    guard.reset()
    for _ in range(8):
        client.get("/api/v1/agent/me", headers={"X-Agent-Key": "flk_bad"})
    r = client.get("/api/v1/agent/me", headers={"X-Agent-Key": "flk_bad"})
    assert r.status_code == 429 and "Locked out" in r.json()["detail"]
    guard.reset()
    for _ in range(60):
        assert client.get("/api/v1/agent/me", headers=ctx["A"]).status_code == 200
    assert client.get("/api/v1/agent/me", headers=ctx["A"]).status_code == 429
    guard.reset()


def test_key_expiry(ctx):
    from app.core import guard
    guard.reset()
    H = ctx["H"]
    dept = ctx["dept"]["id"]
    made = client.post("/api/v1/agents", json={"name": "Temp AI", "role": "general", "department_id": dept, "key_expires_in_days": 1}, headers=H).json()
    assert made["agent"]["key_expires_at"] is not None
    assert client.get("/api/v1/agent/me", headers={"X-Agent-Key": made["api_key"]}).status_code == 200
    from app.core.db import SessionLocal
    from app.models import Agent
    from datetime import datetime, timedelta, timezone
    db = SessionLocal(); a = db.get(Agent, made["agent"]["id"]); a.key_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1); db.commit(); db.close()
    r = client.get("/api/v1/agent/me", headers={"X-Agent-Key": made["api_key"]})
    assert r.status_code == 401 and "expired" in r.json()["detail"]
    r = client.post(f"/api/v1/mcp/{made['api_key']}", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401


def test_security_headers():
    r = client.get("/api/v1/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"


def test_kill_switch_freezes_cards_and_restores(ctx):
    from app.core import guard
    guard.reset()
    H = ctx["H"]
    client.post("/api/v1/company/kill-switch", json={"enabled": True, "reason": "drill"}, headers=H)
    assert all(c["status"] == "frozen" for c in client.get("/api/v1/cards", headers=H).json())
    client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=H)
    assert all(c["status"] == "active" for c in client.get("/api/v1/cards", headers=H).json())


def test_duplicate_purchase_goes_to_human(ctx):
    from app.core import guard
    guard.reset()
    first = buy(ctx, 7_700, merchant="Canva", category="software")
    assert first["status"] == "completed"
    again = buy(ctx, 7_700, merchant="Canva", category="software")
    assert again["status"] == "pending_approval" and again["decision"]["rule_id"] == "duplicate-purchase"


def test_lithic_webhook_signature_and_dedupe():
    import base64, hmac, hashlib, time, os
    from app.api.webhooks import verify_standard_webhook
    from fastapi import HTTPException
    secret_raw = os.urandom(24)
    secret = "whsec_" + base64.b64encode(secret_raw).decode()
    body = b'{"event_type":"transaction.updated","payload":{"token":"nope","status":"SETTLED"}}'
    ts = str(int(time.time()))
    sig = base64.b64encode(hmac.new(secret_raw, f"m1.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    headers = {"webhook-id": "m1", "webhook-timestamp": ts, "webhook-signature": f"v1,{sig}"}
    assert verify_standard_webhook(body, headers, secret) == "m1"
    try:
        verify_standard_webhook(body + b" ", headers, secret); assert False
    except HTTPException as e:
        assert e.status_code == 401
    try:
        verify_standard_webhook(body, {**headers, "webhook-timestamp": str(int(time.time()) - 1000)}, secret); assert False
    except HTTPException as e:
        assert e.status_code == 400
    # endpoint: configured secret, first delivery processed, second acknowledged as duplicate
    from app.core.config import get_settings
    get_settings().lithic_webhook_secret = secret
    r1 = client.post("/api/v1/webhooks/lithic", content=body, headers={**headers, "content-type": "application/json"})
    r2 = client.post("/api/v1/webhooks/lithic", content=body, headers={**headers, "content-type": "application/json"})
    assert r1.status_code == 200 and r1.json()["ok"] and not r1.json().get("duplicate")
    assert r2.json().get("duplicate") is True


def test_trusted_and_new_merchant_policy(ctx):
    from app.core import guard
    guard.reset()
    H = ctx["H"]
    client.patch("/api/v1/company", json={"new_merchant_review_from": 20_000}, headers=H)
    # trusted supplier: category outside the agent's allowlist still pays
    pr = buy(ctx, 9_900, merchant="Canva", category="office")
    assert pr["status"] == "completed" and any("trusted supplier" in r for r in pr["decision"]["reasons"])
    # brand-new supplier above SAR 200 is held for a human even though everything else passes
    pr = buy(ctx, 25_000, merchant="Zid Platform", category="software")
    assert pr["status"] == "pending_approval" and pr["decision"]["rule_id"] == "new-merchant-review"
    # small amount at a new supplier goes through
    pr = buy(ctx, 5_000, merchant="Picsart", category="software")
    assert pr["status"] == "completed"


def test_categorization_and_department_pause_and_exports(ctx):
    from app.core import guard
    from app.core.categorize import categorize
    guard.reset()
    H = ctx["H"]
    assert categorize("Snapchat Ads", "marketing stuff", "")[0] == "advertising"
    assert categorize("Jarir Bookstore", None, "two laptops for the team")[0] == "equipment"
    assert categorize("Some Shop", "advertising", "iTunes gift cards")[0] == "gift_card"   # mislabel caught
    assert categorize("Unknown Co", "", "")[0] == "other"
    # a mislabelled gift card from the API is normalised and then blocked
    pr = buy(ctx, 5_000, merchant="Some Shop", category="advertising", desc="iTunes gift cards")
    assert pr["category"] == "gift_card" and pr["status"] == "denied"
    # department kill switch
    client.patch("/api/v1/departments/%d" % ctx["dept"]["id"], json={"spending_paused": True}, headers=H)
    pr = buy(ctx, 1_000, merchant="Google Ads")
    assert pr["status"] == "denied" and pr["decision"]["rule_id"] == "department-paused"
    client.patch("/api/v1/departments/%d" % ctx["dept"]["id"], json={"spending_paused": False}, headers=H)
    # reconciliation and exports
    r = client.get("/api/v1/reconciliation", headers=H).json()
    assert r["ok"] is True and r["issues"] == []
    for kind in ("transactions", "requests", "audit"):
        e = client.get(f"/api/v1/export/{kind}.csv", headers=H)
        assert e.status_code == 200 and e.text.splitlines()[0].startswith("id,")
    # approval notification was recorded in the ledger (in-app channel without SMTP)
    events = [e for e in client.get("/api/v1/audit?limit=1000", headers=H).json() if e["event"] == "approval.notified"]
    assert events and events[0]["details"]["channel"] == "in-app"


def test_push_endpoints(ctx):
    H = ctx["H"]
    k = client.get("/api/v1/push/vapid-public-key").json()["public_key"]
    assert len(k) > 60
    r = client.post("/api/v1/push/subscribe", json={"endpoint": "https://push.example/abc", "keys": {"p256dh": "BPx", "auth": "abc"}}, headers=H)
    assert r.status_code == 201
    t = client.post("/api/v1/push/test", headers=H).json()
    assert t["subscriptions"] == 1  # delivery to a fake endpoint fails, which is fine
    assert client.request("DELETE", "/api/v1/push/subscribe", json={"endpoint": "https://push.example/abc"}, headers=H).status_code == 204


def test_oauth_connector_sign_in_flow(ctx):
    import base64, hashlib, re
    from urllib.parse import parse_qs, urlparse
    from app.core import guard
    guard.reset()
    H = ctx["H"]
    # 1. discovery
    prm = client.get("/.well-known/oauth-protected-resource/api/v1/mcp").json()
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert prm["resource"].endswith("/api/v1/mcp") and "S256" in meta["code_challenge_methods_supported"]
    # unauthenticated MCP call advertises where to sign in
    r = client.post("/api/v1/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert r.status_code == 401 and "resource_metadata" in r.headers["www-authenticate"]
    # 2. dynamic client registration
    reg = client.post("/api/v1/oauth/register", json={"client_name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]}).json()
    cid = reg["client_id"]
    # 3. authorize page + sign in, creating a new "My Claude" employee
    verifier = "v" * 50
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    q = {"response_type": "code", "client_id": cid, "redirect_uri": reg["redirect_uris"][0], "state": "xyz", "code_challenge": challenge, "code_challenge_method": "S256", "scope": "purchases"}
    page = client.get("/api/v1/oauth/authorize", params=q)
    assert page.status_code == 200 and "Connect your Claude" in page.text
    bad = client.post("/api/v1/oauth/authorize", data={**q, "email": "owner@test.sa", "password": "nope", "agent": "__new__"})
    assert bad.status_code == 200 and "Wrong email" in bad.text
    ok = client.post("/api/v1/oauth/authorize", data={**q, "email": "owner@test.sa", "password": "password123", "agent": "__new__"}, follow_redirects=False)
    assert ok.status_code == 302
    loc = urlparse(ok.headers["location"]); qs = parse_qs(loc.query)
    assert loc.netloc == "claude.ai" and qs["state"] == ["xyz"]
    code = qs["code"][0]
    # 4. token exchange (wrong verifier fails, right one works, code single-use)
    assert client.post("/api/v1/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": cid, "redirect_uri": q["redirect_uri"], "code_verifier": "wrong"}).status_code == 400
    tok = client.post("/api/v1/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": cid, "redirect_uri": q["redirect_uri"], "code_verifier": verifier}).json()
    assert tok["token_type"] == "Bearer" and tok["access_token"].startswith("fat_")
    assert client.post("/api/v1/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": cid, "redirect_uri": q["redirect_uri"], "code_verifier": verifier}).status_code == 400
    # 5. MCP with bearer: initialize as the new employee, make a purchase
    B = {"Authorization": f"Bearer {tok['access_token']}"}
    init = client.post("/api/v1/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}, headers=B).json()
    assert "My Claude" in init["result"]["instructions"]
    import json as _json
    res = client.post("/api/v1/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "request_purchase", "arguments": {"amount_sar": 50, "merchant": "Google Ads", "category": "advertising", "description": "oauth test"}}}, headers=B).json()
    assert _json.loads(res["result"]["content"][0]["text"])["status"] == "completed"
    # 6. visible in the dashboard, revocable, then dead
    conns = client.get("/api/v1/connections", headers=H).json()
    assert len(conns) == 1 and conns[0]["agent_name"] == "My Claude"
    assert client.delete(f"/api/v1/connections/{conns[0]['id']}", headers=H).status_code == 204
    assert client.post("/api/v1/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "ping"}, headers=B).status_code == 401
    # 7. refresh token of a revoked connection is dead too
    assert client.post("/api/v1/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]}).status_code == 400


def test_company_lithic_key_and_notify_threshold(ctx):
    from app.core import guard
    guard.reset()
    H = ctx["H"]
    c = client.patch("/api/v1/company", json={"lithic_api_key": "sk_sandbox_test", "notify_threshold": 100_000}, headers=H).json()
    assert c["lithic_configured"] is True and c["notify_threshold"] == 100_000
    from app.core.db import SessionLocal
    from app.core.crypto import decrypt
    from app.models import Company
    db = SessionLocal(); row = db.get(Company, c["id"]); assert row.lithic_api_key_enc != "sk_sandbox_test" and decrypt(row.lithic_api_key_enc) == "sk_sandbox_test"; db.close()
    # a small hold does not notify, a large one does
    before = len([e for e in client.get("/api/v1/audit?limit=1000", headers=H).json() if e["event"] == "approval.notified"])
    pr = buy(ctx, 25_000, merchant="Brand New Vendor", category="advertising")   # new supplier → held, below notify threshold
    assert pr["status"] == "pending_approval"
    after = len([e for e in client.get("/api/v1/audit?limit=1000", headers=H).json() if e["event"] == "approval.notified"])
    assert after == before
    c = client.patch("/api/v1/company", json={"lithic_api_key": "", "notify_threshold": 0}, headers=H).json()
    assert c["lithic_configured"] is False


def test_password_reset_change_and_2fa(ctx):
    import pyotp
    from app.core import guard
    guard.reset()
    H = ctx["H"]
    # forgot: unknown email still 200; known email returns link in non-prod
    assert client.post("/api/v1/auth/forgot", json={"email": "nobody@test.sa"}).json()["ok"]
    r = client.post("/api/v1/auth/forgot", json={"email": "owner@test.sa"}).json()
    token = r["reset_link"].split("token=")[1]
    assert client.post("/api/v1/auth/reset", json={"token": "bad", "password": "newpassword1"}).status_code == 400
    assert client.post("/api/v1/auth/reset", json={"token": token, "password": "newpassword1"}).json()["ok"]
    assert client.post("/api/v1/auth/reset", json={"token": token, "password": "again12345"}).status_code == 400  # single use
    assert client.post("/api/v1/auth/login", json={"email": "owner@test.sa", "password": "password123"}).status_code == 401
    tok = client.post("/api/v1/auth/login", json={"email": "owner@test.sa", "password": "newpassword1"}).json()["access_token"]
    H2 = {"Authorization": f"Bearer {tok}"}
    # change back
    assert client.post("/api/v1/auth/change-password", json={"current_password": "wrong", "new_password": "password123"}, headers=H2).status_code == 403
    assert client.post("/api/v1/auth/change-password", json={"current_password": "newpassword1", "new_password": "password123"}, headers=H2).json()["ok"]
    # 2FA
    setup = client.post("/api/v1/auth/2fa/setup", headers=H).json()
    assert setup["qr_svg"].startswith("data:image/svg+xml")
    assert client.post("/api/v1/auth/2fa/enable", json={"code": "000000"}, headers=H).status_code == 400
    code = pyotp.TOTP(setup["secret"]).now()
    assert client.post("/api/v1/auth/2fa/enable", json={"code": code}, headers=H).json()["enabled"]
    assert client.post("/api/v1/auth/login", json={"email": "owner@test.sa", "password": "password123"}).json()["detail"] == "2fa_required"
    assert client.post("/api/v1/auth/login", json={"email": "owner@test.sa", "password": "password123", "code": pyotp.TOTP(setup["secret"]).now()}).status_code == 200
    # company policy: require 2FA for approvers blocks a user without it
    assert client.patch("/api/v1/company", json={"require_2fa_for_approvers": True}, headers=H).json()["require_2fa_for_approvers"] is True
    tok2 = client.post("/api/v1/auth/login", json={"email": "finance@test.sa", "password": "password123"}).json()["access_token"]
    pr = buy(ctx, 150_000, merchant="Snapchat Ads")
    assert pr["status"] == "pending_approval"
    r = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": "password123"}, headers={"Authorization": f"Bearer {tok2}"})
    assert r.status_code == 403 and "two-factor" in r.json()["detail"]
    client.patch("/api/v1/company", json={"require_2fa_for_approvers": False}, headers=H)
    assert client.post("/api/v1/auth/2fa/disable", json={"password": "password123", "code": pyotp.TOTP(setup["secret"]).now()}, headers=H).json()["enabled"] is False


def test_company_with_null_json_columns_still_loads(ctx):
    # Simulate a row from before the column existed (production DBs had NULL there).
    from app.api.routes import company_out
    from app.models import Company
    from app.core.db import SessionLocal
    db = SessionLocal()
    c = db.query(Company).first()
    c.trusted_merchants = None
    c.kill_switch_frozen_cards = None
    out = company_out(c)
    assert out.trusted_merchants == []
    db.rollback(); db.close()


def test_supabase_token_onboarding_and_delete(ctx, monkeypatch):
    """Simulate a Supabase sign-in with an HS256 token, walk onboarding, then delete the company."""
    import jwt as _jwt, time
    from app.core.config import get_settings
    from app.core import guard
    guard.reset()
    st = get_settings()
    st.supabase_url, st.supabase_anon_key, st.supabase_jwt_secret = "https://example.supabase.co", "anon", "super-secret-jwt"
    try:
        assert client.get("/api/v1/health").json()["auth"] == "supabase"
        assert client.get("/api/v1/auth/config").json()["provider"] == "supabase"
        tok = _jwt.encode({"sub": "11111111-2222-3333-4444-555555555555", "email": "new@company.sa", "aud": "authenticated", "exp": int(time.time()) + 600,
                           "user_metadata": {"full_name": "Noor"}}, "super-secret-jwt", algorithm="HS256")
        B = {"Authorization": f"Bearer {tok}"}
        me = client.get("/api/v1/auth/me", headers=B).json()
        assert me["needs_onboarding"] is True and me["user"]["full_name"] == "Noor"
        assert client.get("/api/v1/dashboard/summary", headers=B).json()["detail"] == "onboarding_required"
        c = client.post("/api/v1/onboarding/company", json={"company_name": "Noor Labs"}, headers=B).json()
        assert c["company"]["name"] == "Noor Labs"
        q = client.post("/api/v1/onboarding/quickstart", json={}, headers=B).json()
        assert set(q["created"]) == {"department", "card", "agent"}
        stt = client.get("/api/v1/onboarding/status", headers=B).json()
        assert stt["steps"]["card"] and stt["steps"]["agent"] and not stt["steps"]["claude_connected"]
        assert client.get("/api/v1/dashboard/summary", headers=B).status_code == 200
        # delete: password verified against Supabase (mocked)
        import app.core.supabase as sb
        monkeypatch.setattr(sb, "password_grant", lambda e, p: {"id": "x"} if p == "pw" else None)
        monkeypatch.setattr(sb, "admin_delete_user", lambda uid: True)
        assert client.request("DELETE", "/api/v1/account", json={"confirm": "DELETE", "password": "nope"}, headers=B).status_code == 403
        r = client.request("DELETE", "/api/v1/account", json={"confirm": "DELETE", "password": "pw"}, headers=B).json()
        assert r["removed"] == "company"
        me2 = client.get("/api/v1/auth/me", headers=B).json()
        assert me2["needs_onboarding"] is True  # a fresh user row again, no company
    finally:
        st.supabase_url = st.supabase_anon_key = st.supabase_jwt_secret = None

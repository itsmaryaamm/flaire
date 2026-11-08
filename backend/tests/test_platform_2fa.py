"""Currency, cards, accountability, scripted chat intents, MCP search/fetch, notifications, platform console, mandatory 2FA, onboarding status."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_flaire.db"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_ENGINE"] = "native"

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.db import Base, SessionLocal, engine
from app.main import app

client = TestClient(app)
PW = "password123"


@pytest.fixture(autouse=True, scope="module")
def _fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    if os.path.exists("test_flaire.db"):
        os.remove("test_flaire.db")


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(email: str, password: str = PW, code: str | None = None) -> dict:
    from app.core import guard
    guard.reset()
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password, "code": code})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"])


def _invite(H: dict, email: str, role: str) -> dict:
    inv = client.post("/api/v1/team/invites", json={"email": email, "role": role}, headers=H).json()
    r = client.post("/api/v1/team/invites/accept", json={"token": inv["token"], "password": PW, "full_name": email.split("@")[0].title()})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"])


@pytest.fixture(scope="module")
def ctx():
    from app.core import guard
    guard.reset()
    r = client.post("/api/v1/auth/register", json={"company_name": "PlatCo", "email": "platform@flaire.sa", "password": PW, "full_name": "Sara Owner"})
    assert r.status_code == 201, r.text
    H = _h(r.json()["access_token"])
    company_id = r.json()["company"]["id"]
    client.patch("/api/v1/company", json={"trusted_merchants": ["Google Ads", "Snapchat Ads", "Canva", "Notion"], "two_person_threshold": 100_000_000}, headers=H)
    dept = client.post("/api/v1/departments", json={"name": "Marketing", "monthly_budget": 5_000_000}, headers=H).json()
    ag = client.post("/api/v1/agents", json={"name": "Marketing AI", "role": "marketing", "department_id": dept["id"], "per_transaction_limit": 300_000,
                                            "monthly_limit": 2_000_000, "approval_threshold": 100_000, "allowed_categories": ["advertising", "software"], "max_requests_per_hour": 200,
                                            "max_requests_per_day": 500}, headers=H).json()
    FIN = _invite(H, "fin@plat.sa", "finance")
    return {"H": H, "FIN": FIN, "A": {"X-Agent-Key": ag["api_key"]}, "dept": dept, "agent": ag["agent"], "company_id": company_id}


def buy(ctx, amount, merchant="Google Ads", category="advertising", desc=""):
    r = client.post("/api/v1/agent/purchase-requests", json={"amount": amount, "merchant": merchant, "category": category, "description": desc}, headers=ctx["A"])
    assert r.status_code == 201, r.text
    return r.json()


# ====================================================== A. currency
def test_mock_transaction_records_sar_at_fx_one(ctx):
    pr = buy(ctx, 12_500, desc="launch creatives")
    assert pr["status"] == "completed"
    tx = client.get(f"/api/v1/transactions/{pr['transaction_id']}", headers=ctx["H"]).json()
    assert tx["issuer_amount"] == 12_500 and tx["issuer_currency"] == "SAR" and tx["fx_rate"] == 1.0
    assert tx["accountable"]["full_name"] == "Sara Owner" and tx["accountable_reason"] == "auto_under_limits"


def test_lithic_adapter_converts_halalas_to_usd_cents(monkeypatch):
    from app.integrations.payments.lithic import LithicAdapter
    from app.models import Card
    calls: list[tuple[str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json
        body = json.loads(request.content or b"{}") if request.content else {}
        calls.append((f"{request.method} {request.url.path}", body))
        if request.url.path.endswith("/cards") and request.method == "POST":
            return httpx.Response(200, json={"token": "card_abc", "last_four": "4242"})
        if request.method == "GET" and "/cards/" in request.url.path:
            return httpx.Response(200, json={"pan": "4111111111111111"})
        if request.url.path.endswith("/simulate/authorize"):
            return httpx.Response(200, json={"token": "auth_1"})
        if request.url.path.endswith("/simulate/clearing"):
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    adapter = LithicAdapter(api_key="sk_sandbox_x")
    monkeypatch.setattr(adapter, "_client", lambda: httpx.Client(base_url="https://sandbox.lithic.com/v1", transport=httpx.MockTransport(handler)))
    assert adapter.fx_rate == 3.75
    assert adapter.to_issuer_amount(37_500) == 10_000  # SAR 375.00 -> USD 100.00
    assert adapter.to_issuer_amount(1) == 1              # never below one cent
    info = adapter.create_card("Marketing AI", 375_000, "SAR")
    assert info["provider_token"] == "card_abc" and calls[-1][1]["spend_limit"] == 100_000  # SAR 3,750 limit -> USD 1,000
    card = Card(company_id=1, label="x", provider="lithic", last4="4242", status="active", available_balance=375_000, credit_limit=375_000, provider_token="card_abc")
    res = adapter.authorize(card, 37_500, "Google Ads", "FLAIRE*Google Ads")
    assert res.ok and res.status == "settled"
    assert res.issuer_amount == 10_000 and res.issuer_currency == "USD" and res.fx_rate == 3.75
    auth_call = next(b for p, b in calls if p.endswith("/simulate/authorize"))
    clear_call = next(b for p, b in calls if p.endswith("/simulate/clearing"))
    assert auth_call["amount"] == 10_000 and clear_call["amount"] == 10_000
    assert card.available_balance == 375_000 - 37_500  # Flaire's own balance stays in SAR
    adapter.set_spend_limit(card, 75_000)
    assert calls[-1][1]["spend_limit"] == 20_000


# ====================================================== B. cards
def test_card_issued_at_creation_and_on_demand(ctx):
    H = ctx["H"]
    assert ctx["agent"]["card"] is not None  # issued at creation
    a2 = client.post("/api/v1/agents", json={"name": "Ops AI", "role": "operations", "department_id": ctx["dept"]["id"]}, headers=H).json()["agent"]
    assert a2["card"] and a2["owner"]["full_name"] == "Sara Owner"
    # idempotent: issuing again returns the same card
    again = client.post(f"/api/v1/agents/{a2['id']}/card", headers=H).json()
    assert again["card"]["id"] == a2["card"]["id"]
    # an agent that lost its card gets a new one on demand
    from app.models import Agent
    db = SessionLocal(); row = db.get(Agent, a2["id"]); row.card_id = None; db.commit(); db.close()
    fixed = client.post(f"/api/v1/agents/{a2['id']}/card", headers=H).json()
    assert fixed["card"] and fixed["card"]["id"] != a2["card"]["id"]


def test_lithic_key_save_issues_cards_detects_env_and_tries_asa(ctx, monkeypatch):
    from app.api import asa as asa_mod
    from app.models import Agent
    H = ctx["H"]
    # one employee without a card before the key arrives
    a3 = client.post("/api/v1/agents", json={"name": "Procurement AI", "role": "procurement", "department_id": ctx["dept"]["id"]}, headers=H).json()["agent"]
    db = SessionLocal(); row = db.get(Agent, a3["id"]); row.card_id = None; db.commit(); db.close()
    issued: list = []
    monkeypatch.setattr(asa_mod, "enroll_asa", lambda db, company, base, actor=None: (setattr(company, "lithic_asa_enrolled", True) or setattr(company, "lithic_asa_error", None) or {"ok": True, "url": base, "signed": True, "error": None}))

    import app.cards as cards_mod
    real_issue = cards_mod.issue_card_for_agent

    def fake_issue(db, company, agent, actor="system"):
        issued.append(agent.id)
        # pretend Lithic answered: store a lithic card without a network call
        from app.models import Card
        card = Card(company_id=company.id, department_id=agent.department_id, agent_id=agent.id, label=agent.name, provider="lithic", last4="9999",
                    credit_limit=agent.monthly_limit, available_balance=agent.monthly_limit, provider_token="card_tok_x", is_default=False)
        db.add(card); db.flush(); agent.card_id = card.id
        return card
    monkeypatch.setattr(cards_mod, "issue_card_for_agent", fake_issue)
    c = client.patch("/api/v1/company", json={"lithic_api_key": "sk_sandbox_abc"}, headers=H).json()
    assert c["lithic_configured"] is True
    assert issued == [a3["id"]]  # only the employee without a card
    st = client.get("/api/v1/settings/lithic/status", headers=H).json()
    assert st == {**st, "configured": True, "asa_enrolled": True, "asa_error": None, "environment": "sandbox"}
    # a failing enrollment is stored, not raised
    monkeypatch.setattr(asa_mod, "enroll_asa", lambda db, company, base, actor=None: (setattr(company, "lithic_asa_enrolled", False) or setattr(company, "lithic_asa_error", "Lithic refused enrollment: 401") or {"ok": False, "url": base, "signed": False, "error": "Lithic refused enrollment: 401"}))
    monkeypatch.setattr(asa_mod, "detect_lithic_environment", lambda key: "production")
    client.patch("/api/v1/company", json={"lithic_api_key": "live_key_123"}, headers=H)
    st = client.get("/api/v1/settings/lithic/status", headers=H).json()
    assert st["asa_enrolled"] is False and "401" in st["asa_error"] and st["environment"] == "production"
    monkeypatch.setattr(cards_mod, "issue_card_for_agent", real_issue)
    c = client.patch("/api/v1/company", json={"lithic_api_key": ""}, headers=H).json()
    assert c["lithic_configured"] is False
    assert client.get("/api/v1/settings/lithic/status", headers=H).json()["asa_error"] is None
    # put the Procurement card back on the mock rail so later tests can pay
    from app.models import Card
    db = SessionLocal(); card = db.get(Card, db.get(Agent, a3["id"]).card_id); card.provider = "mock_snb"; db.commit(); db.close()


def test_detect_environment_from_prefix():
    from app.api.asa import detect_lithic_environment
    assert detect_lithic_environment("sk_sandbox_123") == "sandbox"
    assert detect_lithic_environment("sk_live_123") == "production"


# ====================================================== C. accountability
def test_owner_patch_and_approved_accountability(ctx):
    H, FIN = ctx["H"], ctx["FIN"]
    aid = ctx["agent"]["id"]
    agents = client.get("/api/v1/agents", headers=H).json()
    me = next(a for a in agents if a["id"] == aid)
    assert me["owner"] == {"id": me["owner_user_id"], "full_name": "Sara Owner"}
    fin_id = client.get("/api/v1/team/members", headers=H).json()
    fin_id = next(m["id"] for m in fin_id if m["email"] == "fin@plat.sa")
    # a viewer cannot own an employee
    V = _invite(H, "view@plat.sa", "viewer")
    viewer_id = next(m["id"] for m in client.get("/api/v1/team/members", headers=H).json() if m["email"] == "view@plat.sa")
    assert client.patch(f"/api/v1/agents/{aid}", json={"owner_user_id": viewer_id}, headers=H).status_code == 422
    out = client.patch(f"/api/v1/agents/{aid}", json={"owner_user_id": fin_id}, headers=H).json()
    assert out["owner"]["full_name"] == "Fin"
    # auto approved purchase is now on the new owner
    pr = buy(ctx, 5_000, merchant="Canva", category="software")
    tx = client.get(f"/api/v1/transactions/{pr['transaction_id']}", headers=H).json()
    assert tx["accountable"]["id"] == fin_id and tx["accountable"]["role"] == "finance" and tx["accountable_reason"] == "auto_under_limits"
    # a human approved purchase is on the approver
    held = buy(ctx, 150_000, merchant="Snapchat Ads")
    assert held["status"] == "pending_approval"
    done = client.post(f"/api/v1/approvals/{held['id']}/approve", json={"password": PW}, headers=H).json()
    assert done["status"] == "completed", done
    tx = client.get(f"/api/v1/transactions/{done['transaction_id']}", headers=H).json()
    assert tx["accountable"]["full_name"] == "Sara Owner" and tx["accountable_reason"] == "approved"
    assert [a["full_name"] for a in tx["approved_by"]] == ["Sara Owner"]
    # owner disabled (left the company): falls back to the company's first owner
    from app.models import User
    db = SessionLocal(); db.get(User, fin_id).status = "disabled"; db.commit(); db.close()
    pr = buy(ctx, 4_000, merchant="Notion", category="software")
    tx = client.get(f"/api/v1/transactions/{pr['transaction_id']}", headers=H).json()
    assert tx["accountable"]["full_name"] == "Sara Owner" and tx["accountable_reason"] == "auto_under_limits"
    db = SessionLocal(); db.get(User, fin_id).status = "active"; db.commit(); db.close()
    client.patch(f"/api/v1/agents/{aid}", json={"owner_user_id": me["owner_user_id"]}, headers=H)


# ====================================================== D. scripted chat intents
def _chat(ctx, message, run_id=None):
    r = client.post(f"/api/v1/agents/{ctx['agent']['id']}/chat", json={"message": message, "run_id": run_id}, headers=ctx["H"])
    assert r.status_code == 200, r.text
    return r.json()


def _last(run) -> str:
    return run["transcript"][-1]["content"]


def test_chat_answers_instead_of_buying(ctx):
    # greeting
    r = _chat(ctx, "Hi there")
    assert r["purchase_requests"] == [] and "Marketing AI" in _last(r)
    # help
    r = _chat(ctx, "help")
    assert "cannot approve" in _last(r) and r["purchase_requests"] == []
    # spending this month: lists completed transactions with totals
    r = _chat(ctx, "What did you buy this month?")
    body = _last(r)
    assert "totalling" in body and "Canva" in body and "Notion" in body and r["purchase_requests"] == []
    # budget / how much is left
    r = _chat(ctx, "How much budget is left?")
    assert "left of my SAR 20,000" in _last(r) and r["transcript"][-2]["name"] == "check_budget"
    # status of my last request
    r = _chat(ctx, "What is the status of my last request?")
    assert "My last request" in _last(r) and "Notion" in _last(r)
    # list pending (none yet)
    r = _chat(ctx, "anything pending?")
    assert "Nothing of mine is waiting" in _last(r)
    # why held: create a hold then ask
    held = buy(ctx, 200_000, merchant="Snapchat Ads", desc="Q4 push")
    assert held["status"] == "pending_approval"
    r = _chat(ctx, "why was it held?")
    assert f"#{held['id']}" in _last(r) and "waiting for a human" in _last(r)
    r = _chat(ctx, "list pending")
    assert "1 waiting" in _last(r) and "Snapchat" in _last(r)
    # why denied: blocked category
    den = buy(ctx, 1_000, merchant="Jarir", category="equipment")
    assert den["status"] == "denied"
    r = _chat(ctx, f"why was #{den['id']} denied?")
    assert "denied" in _last(r) and "equipment" in _last(r).lower()
    client.post(f"/api/v1/approvals/{held['id']}/reject", json={"password": PW}, headers=ctx["H"])


def test_chat_purchase_asks_one_question_then_completes(ctx):
    # amount known, vendor missing: one question about the vendor only
    r = _chat(ctx, "Please launch a campaign for SAR 150")
    assert r["purchase_requests"] == [] and "Which vendor" in _last(r) and "how much" not in _last(r).lower()
    r2 = _chat(ctx, "TikTok", run_id=r["run_id"])
    assert len(r2["purchase_requests"]) == 1 and r2["purchase_requests"][0]["merchant"] == "TikTok Ads" and r2["purchase_requests"][0]["amount"] == 15_000
    assert r2["purchase_requests"][0]["status"] == "completed" and "paid" in _last(r2)
    # vendor known, amount missing: one question about the amount only
    r = _chat(ctx, "buy a Canva subscription again")
    assert r["purchase_requests"] == [] and "How much" in _last(r) and "Canva" in _last(r)
    r2 = _chat(ctx, "60", run_id=r["run_id"])
    assert r2["purchase_requests"][0]["amount"] == 6_000 and r2["purchase_requests"][0]["merchant"] == "Canva"
    # a question in between does not trigger a purchase
    r = _chat(ctx, "order ads on Snapchat")
    assert "How much" in _last(r)
    r2 = _chat(ctx, "how much is left?", run_id=r["run_id"])
    assert r2["purchase_requests"] == [] and "left of my" in _last(r2)


def test_assistant_answers(ctx):
    H = ctx["H"]
    a = client.post("/api/v1/assistant/chat", json={"message": "hello"}, headers=H).json()
    assert a["reply"].startswith("Hi Sara") and a["actions"] == []
    a = client.post("/api/v1/assistant/chat", json={"message": "what was bought this month?"}, headers=H).json()
    assert "totalling" in a["reply"] and "Marketing AI paid" in a["reply"]
    a = client.post("/api/v1/assistant/chat", json={"message": "how much is left?"}, headers=H).json()
    assert "left" in a["reply"] and "Departments" in a["reply"]
    a = client.post("/api/v1/assistant/chat", json={"message": "status of the latest request"}, headers=H).json()
    assert a["reply"].startswith("Latest:")


# ====================================================== E. MCP search / fetch and connector info
def test_mcp_search_fetch_and_connector_info(ctx):
    key = ctx["A"]["X-Agent-Key"]
    url = f"/api/v1/mcp/{key}"
    init = client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}).json()
    assert "do not ask the user whether to use Flaire" in init["result"]["instructions"]
    tools = {t["name"]: t for t in client.post(url, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]}
    assert {"search", "fetch"} <= set(tools) and tools["search"]["inputSchema"]["required"] == ["query"] and tools["fetch"]["inputSchema"]["required"] == ["id"]
    import json
    res = json.loads(client.post(url, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "search", "arguments": {"query": "canva"}}}).json()["result"]["content"][0]["text"])
    assert res["results"] and all({"id", "title", "url"} <= set(r) for r in res["results"]) and all("Canva" in r["title"] for r in res["results"])
    rid = res["results"][0]["id"]
    doc = json.loads(client.post(url, json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "fetch", "arguments": {"id": rid}}}).json()["result"]["content"][0]["text"])
    assert doc["id"] == rid and "Canva" in doc["text"] and doc["metadata"]["merchant"] == "Canva" and doc["url"].endswith(f"request={rid}")
    # another agent's request is not visible
    other = client.post(url, json={"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "fetch", "arguments": {"id": "999999"}}}).json()["result"]
    assert other["isError"] is True
    empty = json.loads(client.post(url, json={"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "search", "arguments": {"query": "zzz-nothing"}}}).json()["result"]["content"][0]["text"])
    assert empty == {"results": []}
    info = client.get("/api/v1/connector-info", headers=ctx["H"]).json()
    assert info["mcp_url"].endswith("/api/v1/mcp") and "request_purchase immediately" in info["agent_instructions"]
    assert isinstance(info["claude_steps"], list) and isinstance(info["chatgpt_steps"], list) and info["claude_steps"] and info["chatgpt_steps"]
    # connected step recognises the MCP call
    assert client.get("/api/v1/onboarding/status", headers=ctx["H"]).json()["steps"]["connected"] is True


# ====================================================== F. notifications
def test_notification_feed(ctx):
    H, FIN = ctx["H"], ctx["FIN"]
    held = buy(ctx, 180_000, merchant="Snapchat Ads", desc="Eid campaign")
    assert held["status"] == "pending_approval"
    feed = client.get("/api/v1/notifications", headers=FIN).json()
    hold = next(n for n in feed if n["type"] == "hold" and n["request_id"] == held["id"])
    assert hold["url"] == f"/?decide={held['id']}" and hold["read"] is False
    assert "Marketing AI" in hold["body"] and "Snapchat Ads" in hold["body"] and "SAR 1,800.00" in hold["title"] and "Eid campaign" in hold["body"] and "Held:" in hold["body"]
    # the push payload carries the same fields and the relative decide url
    from app.core.notify import hold_context
    from app.models import PurchaseRequest
    db = SessionLocal(); c = hold_context(db.get(PurchaseRequest, held["id"])); db.close()
    assert c["url"] == f"/?decide={held['id']}" and c["employee"] == "Marketing AI" and c["amount"] == 180_000 and c["reason"] == "Eid campaign" and c["held_because"]
    # mark one read, then all
    r = client.post("/api/v1/notifications/read", json={"ids": [hold["id"]]}, headers=FIN).json()
    assert r["marked"] == 1
    assert next(n for n in client.get("/api/v1/notifications", headers=FIN).json() if n["id"] == hold["id"])["read"] is True
    # decision on a hold: the approver gets a decision entry
    client.post(f"/api/v1/approvals/{held['id']}/approve", json={"password": PW}, headers=FIN)
    feed = client.get("/api/v1/notifications", headers=FIN).json()
    dec = next(n for n in feed if n["type"] == "decision" and n["request_id"] == held["id"])
    assert dec["title"].startswith("Paid") and "Fin" in dec["body"]
    # kill switch events reach owners, admins and finance
    client.post("/api/v1/company/kill-switch", json={"enabled": True, "reason": "drill"}, headers=H)
    client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=H)
    types = [n["type"] for n in client.get("/api/v1/notifications", headers=FIN).json()]
    assert types.count("kill_switch") >= 2
    # invite accepted: inviter is told
    _invite(H, "aud@plat.sa", "auditor")
    assert any(n["type"] == "invite_accepted" and "aud@plat.sa" in n["body"] for n in client.get("/api/v1/notifications", headers=H).json())
    # policy change pending: other admins are told
    ADMIN = _invite(H, "adm@plat.sa", "admin")
    client.patch("/api/v1/company", json={"require_change_approval": True}, headers=H)
    r = client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"monthly_limit": 3_000_000}, headers=ADMIN)
    assert r.status_code == 202
    owner_feed = client.get("/api/v1/notifications", headers=H).json()
    assert any(n["type"] == "policy_change" and n["url"] == f"/?change={r.json()['pending_change_id']}" for n in owner_feed)
    assert not any(n["type"] == "policy_change" for n in client.get("/api/v1/notifications", headers=ADMIN).json())  # proposer is not told
    client.patch("/api/v1/company", json={"require_change_approval": False}, headers=H)
    all_read = client.post("/api/v1/notifications/read", json={"all": True}, headers=H).json()
    assert all_read["unread"] == 0
    assert client.post("/api/v1/notifications/read", json={}, headers=H).status_code == 422


# ====================================================== G. platform console
def test_platform_console(ctx):
    H, FIN = ctx["H"], ctx["FIN"]
    me = client.get("/api/v1/auth/me", headers=H).json()
    assert me["user"]["is_platform_admin"] is True
    assert client.get("/api/v1/auth/me", headers=FIN).json()["user"]["is_platform_admin"] is False
    assert client.get("/api/v1/platform/overview", headers=FIN).status_code == 403
    ov = client.get("/api/v1/platform/overview", headers=H).json()
    assert ov["companies"] >= 1 and ov["agents"] >= 3 and ov["transactions_30d"] >= 4 and ov["volume_30d"] > 0 and ov["fees_30d"] > 0
    assert ov["fees_total"] >= ov["fees_30d"]
    assert ov["signups_by_week"] and ov["volume_by_week"] and ov["top_companies"][0]["name"] == "PlatCo"
    assert set(ov["volume_by_week"][0]) == {"week", "volume", "fees"} and set(ov["signups_by_week"][0]) == {"week", "companies"}
    rows = client.get("/api/v1/platform/companies", headers=H).json()
    row = next(r for r in rows if r["id"] == ctx["company_id"])
    assert set(row) >= {"id", "name", "created_at", "users", "agents", "transactions_30d", "volume_30d", "fees_30d", "last_activity", "lithic_configured", "kill_switch"}
    assert row["users"] >= 5 and row["lithic_configured"] is False and row["kill_switch"] is False
    det = client.get(f"/api/v1/platform/companies/{ctx['company_id']}", headers=H).json()
    assert {m["email"] for m in det["members"]} >= {"platform@flaire.sa", "fin@plat.sa"} and len(det["agents"]) == 3
    assert "lithic_api_key_enc" not in str(det) and "api_key_hash" not in str(det) and "password" not in str(det)
    assert client.get("/api/v1/platform/companies/999999", headers=H).status_code == 404


# ====================================================== H. mandatory 2FA
def test_mandatory_2fa_gate(ctx):
    import pyotp
    from app.core import guard
    from app.models import Company
    guard.reset()
    r = client.post("/api/v1/auth/register", json={"company_name": "StrictCo", "email": "strict@flaire.sa", "password": PW, "full_name": "Strict Owner"})
    assert r.status_code == 201
    H = _h(r.json()["access_token"])
    cid = r.json()["company"]["id"]
    # the test environment creates companies without the requirement; turn it on as production would
    db = SessionLocal(); db.get(Company, cid).require_2fa_for_all = True; db.commit(); db.close()
    # everything is blocked with totp_required
    for path in ("/api/v1/dashboard/summary", "/api/v1/agents", "/api/v1/departments", "/api/v1/transactions", "/api/v1/platform/overview"):
        resp = client.get(path, headers=H)
        assert resp.status_code == 403 and resp.json()["detail"] == "totp_required", path
    assert client.post("/api/v1/departments", json={"name": "X", "monthly_budget": 1}, headers=H).status_code == 403
    # except what is needed to enrol and sign out
    assert client.get("/api/v1/auth/me", headers=H).status_code == 200
    assert client.get("/api/v1/onboarding/status", headers=H).status_code == 200
    assert client.get("/api/v1/notifications", headers=H).status_code == 200
    assert client.get("/api/v1/auth/2fa", headers=H).status_code == 200
    setup = client.post("/api/v1/auth/2fa/setup", json={}, headers=H).json()
    secret = setup.get("secret") or setup.get("otpauth_url", "").split("secret=")[1].split("&")[0]
    code = pyotp.TOTP(secret).now()
    en = client.post("/api/v1/auth/2fa/enable", json={"code": code, "password": PW}, headers=H)
    assert en.status_code == 200, en.text
    # now the same token works everywhere
    assert client.get("/api/v1/dashboard/summary", headers=H).status_code == 200
    # a Supabase identity is gated the same way
    import time, jwt as _jwt
    from app.core.config import get_settings
    from app.models import User
    st = get_settings()
    st.supabase_url, st.supabase_anon_key, st.supabase_jwt_secret = "https://example.supabase.co", "anon", "super-secret-jwt"
    try:
        db = SessionLocal()
        u = User(company_id=cid, email="sb@strict.sa", full_name="SB Member", password_hash="", supabase_uid="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", role="finance")
        db.add(u); db.commit(); db.close()
        tok = _jwt.encode({"sub": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "email": "sb@strict.sa", "aud": "authenticated", "exp": int(time.time()) + 600}, "super-secret-jwt", algorithm="HS256")
        B = _h(tok)
        assert client.get("/api/v1/auth/me", headers=B).status_code == 200
        resp = client.get("/api/v1/approvals", headers=B)
        assert resp.status_code == 403 and resp.json()["detail"] == "totp_required"
    finally:
        st.supabase_url = st.supabase_anon_key = st.supabase_jwt_secret = None
    # turning the requirement off is a company setting; an owner without TOTP cannot turn it on
    assert client.patch("/api/v1/company", json={"require_2fa_for_all": False}, headers=H).json()["require_2fa_for_all"] is False
    assert client.patch("/api/v1/company", json={"require_2fa_for_all": True}, headers=ctx["H"]).status_code == 409


def test_new_company_default_follows_setting():
    from app.core.config import get_settings
    from app.models import Company
    st = get_settings()
    assert st.require_2fa_for_new_companies is False  # tests/conftest.py switches it off for the suites
    st.require_2fa_for_new_companies = True
    try:
        from app.core import guard
        guard.reset()
        r = client.post("/api/v1/auth/register", json={"company_name": "DefaultCo", "email": "default@flaire.sa", "password": PW, "full_name": "D"})
        cid = r.json()["company"]["id"]
        db = SessionLocal(); flag = db.get(Company, cid).require_2fa_for_all; db.close()
        assert flag is True and r.json()["company"]["require_2fa_for_all"] is True
        assert client.get("/api/v1/agents", headers=_h(r.json()["access_token"])).json()["detail"] == "totp_required"
    finally:
        st.require_2fa_for_new_companies = False


# ====================================================== I. onboarding status
def test_onboarding_status_steps(ctx):
    st = client.get("/api/v1/onboarding/status", headers=ctx["H"]).json()
    steps = st["steps"]
    assert steps["company"] and steps["employee"] and steps["connected"] and steps["first_purchase"]
    assert steps["card"] is False and steps["twofa"] is False
    assert st["next_step"] == "twofa"
    # existing keys are still there
    assert {"department", "agent", "claude_connected", "first_request", "two_factor"} <= set(steps)

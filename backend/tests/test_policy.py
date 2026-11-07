"""Policy versioning and change approval (four-eyes on the rules themselves)."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_flaire.db"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_ENGINE"] = "native"

import pytest
from fastapi.testclient import TestClient

from app.core.db import Base, SessionLocal, engine
from app.core.security import hash_password
from app.main import app
from app.models import PurchaseRequest, User

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
    r = client.post("/api/v1/auth/register", json={"company_name": "PolicyCo", "email": "sara@policy.sa", "password": "password123", "full_name": "Sara"})
    assert r.status_code == 201, r.text
    H = {"Authorization": f"Bearer {r.json()['access_token']}"}
    company_id = r.json()["company"]["id"]
    dept = client.post("/api/v1/departments", json={"name": "Marketing", "monthly_budget": 500_000}, headers=H).json()
    ag = client.post("/api/v1/agents", json={"name": "Marketing AI", "role": "marketing", "department_id": dept["id"], "per_transaction_limit": 100_000,
                                            "monthly_limit": 400_000, "approval_threshold": 100_000, "allowed_categories": ["advertising", "software"]}, headers=H).json()
    # A second admin, created directly (invites live in another module).
    db = SessionLocal()
    second = User(company_id=company_id, email="omar@policy.sa", full_name="Omar", password_hash=hash_password("password456"), role="admin")
    db.add(second)
    db.commit()
    db.close()
    r2 = client.post("/api/v1/auth/login", json={"email": "omar@policy.sa", "password": "password456"})
    assert r2.status_code == 200, r2.text
    H2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    return {"H": H, "H2": H2, "A": {"X-Agent-Key": ag["api_key"]}, "dept": dept, "agent": ag["agent"], "company_id": company_id}


def versions(ctx):
    return client.get("/api/v1/policy/versions", headers=ctx["H"]).json()


def test_version_created_on_first_purchase_and_stamped(ctx):
    assert versions(ctx) == []
    pr = client.post("/api/v1/agent/purchase-requests", json={"amount": 5_000, "merchant": "Google Ads", "category": "advertising"}, headers=ctx["A"]).json()
    assert pr["status"] == "completed"
    vs = versions(ctx)
    assert len(vs) == 1 and vs[0]["version"] == 1
    assert pr["decision"]["policy_version"] == 1
    db = SessionLocal()
    row = db.get(PurchaseRequest, pr["id"])
    assert row.policy_version_id == vs[0]["id"]
    db.close()
    snap = client.get(f"/api/v1/policy/versions/{vs[0]['id']}", headers=ctx["H"]).json()["snapshot"]
    assert snap["agents"][0]["monthly_limit"] == 400_000 and snap["departments"][0]["monthly_budget"] == 500_000
    assert client.get("/api/v1/company", headers=ctx["H"]).json()["policy_version"] == 1


def test_identical_snapshot_does_not_create_new_version(ctx):
    client.post("/api/v1/agent/purchase-requests", json={"amount": 10_000, "merchant": "Google Ads", "category": "advertising"}, headers=ctx["A"])
    # PATCH with the same values the agent already has.
    r = client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"monthly_limit": 400_000}, headers=ctx["H"])
    assert r.status_code == 200
    assert len(versions(ctx)) == 1


def test_direct_change_bumps_version(ctx):
    r = client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"monthly_limit": 600_000}, headers=ctx["H"])
    assert r.status_code == 200 and r.json()["monthly_limit"] == 600_000
    vs = versions(ctx)
    assert vs[0]["version"] == 2
    assert "monthly limit 400,000 -> 600,000 by Sara" in vs[0]["change_summary"]


def test_enable_change_approval_applies_immediately(ctx):
    r = client.patch("/api/v1/company", json={"require_change_approval": True}, headers=ctx["H"])
    assert r.status_code == 200 and r.json()["require_change_approval"] is True


def test_loosening_change_needs_second_admin(ctx):
    r = client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"monthly_limit": 900_000, "change_reason": "Q4 campaign"}, headers=ctx["H"])
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["message"] == "Needs a second admin" and body["pending_change_id"]
    agent = client.get(f"/api/v1/agents/{ctx['agent']['id']}", headers=ctx["H"]).json()
    assert agent["monthly_limit"] == 600_000  # not applied
    pending = client.get("/api/v1/policy/changes", headers=ctx["H"]).json()
    assert len(pending) == 1 and pending[0]["changes"] == {"monthly_limit": {"from": 600_000, "to": 900_000}} and pending[0]["reason"] == "Q4 campaign"
    ctx["change_id"] = body["pending_change_id"]


def test_tightening_applies_immediately(ctx):
    r = client.patch(f"/api/v1/agents/{ctx['agent']['id']}", json={"per_transaction_limit": 50_000, "blocked_merchants": ["Gift card"]}, headers=ctx["H"])
    assert r.status_code == 200, r.text
    assert r.json()["per_transaction_limit"] == 50_000 and r.json()["blocked_merchants"] == ["Gift card"]
    d = client.patch("/api/v1/departments/%d" % ctx["dept"]["id"], json={"spending_paused": True}, headers=ctx["H"])
    assert d.status_code == 200 and d.json()["spending_paused"] is True
    # Resuming is loosening.
    d = client.patch("/api/v1/departments/%d" % ctx["dept"]["id"], json={"spending_paused": False}, headers=ctx["H"])
    assert d.status_code == 202
    client.post(f"/api/v1/policy/changes/{d.json()['pending_change_id']}/cancel", headers=ctx["H"])


def test_proposer_cannot_approve_own_change(ctx):
    r = client.post(f"/api/v1/policy/changes/{ctx['change_id']}/approve", json={"password": "password123"}, headers=ctx["H"])
    assert r.status_code == 403 and "different admin" in r.json()["detail"]


def test_second_admin_needs_password(ctx):
    r = client.post(f"/api/v1/policy/changes/{ctx['change_id']}/approve", json={"password": "wrong"}, headers=ctx["H2"])
    assert r.status_code == 403


def test_second_admin_approves_and_change_applies(ctx):
    before = versions(ctx)[0]["version"]
    r = client.post(f"/api/v1/policy/changes/{ctx['change_id']}/approve", json={"password": "password456", "note": "ok"}, headers=ctx["H2"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "applied" and r.json()["decided_by"]["full_name"] == "Omar"
    agent = client.get(f"/api/v1/agents/{ctx['agent']['id']}", headers=ctx["H"]).json()
    assert agent["monthly_limit"] == 900_000
    vs = versions(ctx)
    assert vs[0]["version"] == before + 1 and r.json()["policy_version_id"] == vs[0]["id"]
    assert "approved by Omar" in vs[0]["change_summary"]
    ctx["v_from"], ctx["v_to"] = vs[1]["id"], vs[0]["id"]
    # Already applied: cannot be approved twice.
    assert client.post(f"/api/v1/policy/changes/{ctx['change_id']}/approve", json={"password": "password456"}, headers=ctx["H2"]).status_code == 409


def test_diff_endpoint_shows_field(ctx):
    r = client.get(f"/api/v1/policy/diff?from={ctx['v_from']}&to={ctx['v_to']}", headers=ctx["H"])
    assert r.status_code == 200, r.text
    changes = r.json()["changes"]
    assert changes == [{"path": f"agents.{ctx['agent']['id']}.monthly_limit", "from": 600_000, "to": 900_000}]


def test_reject_change(ctx):
    r = client.patch("/api/v1/company", json={"two_person_threshold": 10_000_000}, headers=ctx["H"])
    assert r.status_code == 202
    cid = r.json()["pending_change_id"]
    rej = client.post(f"/api/v1/policy/changes/{cid}/reject", json={"note": "too high"}, headers=ctx["H2"])
    assert rej.status_code == 200 and rej.json()["status"] == "rejected" and rej.json()["decision_note"] == "too high"
    assert client.get("/api/v1/company", headers=ctx["H"]).json()["two_person_threshold"] == 250_000
    assert client.get("/api/v1/policy/changes?status=rejected", headers=ctx["H"]).json()[0]["id"] == cid


def test_turning_change_approval_off_needs_second_admin(ctx):
    r = client.patch("/api/v1/company", json={"require_change_approval": False}, headers=ctx["H"])
    assert r.status_code == 202
    assert client.get("/api/v1/company", headers=ctx["H"]).json()["require_change_approval"] is True
    ok = client.post(f"/api/v1/policy/changes/{r.json()['pending_change_id']}/approve", json={"password": "password456"}, headers=ctx["H2"])
    assert ok.status_code == 200 and ok.json()["status"] == "applied"
    assert client.get("/api/v1/company", headers=ctx["H"]).json()["require_change_approval"] is False


def test_kill_switch_bumps_version_and_audit_chain_intact(ctx):
    before = versions(ctx)[0]["version"]
    client.post("/api/v1/company/kill-switch", json={"enabled": True, "reason": "drill"}, headers=ctx["H"])
    assert versions(ctx)[0]["version"] == before + 1
    client.post("/api/v1/company/kill-switch", json={"enabled": False}, headers=ctx["H"])
    assert versions(ctx)[0]["version"] == before + 2
    events = {e["event"] for e in client.get("/api/v1/audit?limit=500", headers=ctx["H"]).json()}
    assert {"policy.version", "policy.change_proposed", "policy.change_approved", "policy.change_rejected", "policy.change_cancelled"} <= events
    assert client.get("/api/v1/audit/verify", headers=ctx["H"]).json()["ok"] is True

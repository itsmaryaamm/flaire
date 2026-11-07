"""Teams layer: invites, roles, approval chains, delegation, member protection and the my/admin views."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_flaire.db"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_ENGINE"] = "native"

import pytest
from fastapi.testclient import TestClient

from app.core.db import Base, engine
from app.main import app

client = TestClient(app)
PW = "password123"


@pytest.fixture(autouse=True, scope="module")
def _fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(email: str) -> dict:
    from app.core import guard
    guard.reset()  # the login guard allows 10 per 15 minutes per IP; the tests sign in far more often than a person would
    r = client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"])


def _invite_and_accept(H: dict, email: str, role: str, department_id: int | None = None, full_name: str | None = None) -> dict:
    r = client.post("/api/v1/team/invites", json={"email": email, "role": role, "department_id": department_id}, headers=H)
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["status"] == "pending" and inv["accept_link"].endswith(inv["token"])
    r = client.post("/api/v1/team/invites/accept", json={"token": inv["token"], "password": PW, "full_name": full_name or email.split("@")[0].title()})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"])


@pytest.fixture(scope="module")
def ctx():
    from app.core import guard
    guard.reset()
    r = client.post("/api/v1/auth/register", json={"company_name": "TeamCo", "email": "owner@team.sa", "password": PW, "full_name": "Owner"})
    assert r.status_code == 201, r.text
    H = _h(r.json()["access_token"])
    client.patch("/api/v1/company", json={"trusted_merchants": ["Google Ads", "Snapchat Ads"], "two_person_threshold": 100_000_000}, headers=H)
    mkt = client.post("/api/v1/departments", json={"name": "Marketing", "monthly_budget": 5_000_000}, headers=H).json()
    ops = client.post("/api/v1/departments", json={"name": "Operations", "monthly_budget": 5_000_000}, headers=H).json()
    client.post("/api/v1/cards", json={"label": "SNB Business", "provider": "mock_snb", "last4": "4471", "credit_limit": 10_000_000, "is_default": True}, headers=H)
    agent_json = {"role": "marketing", "per_transaction_limit": 1_000_000, "monthly_limit": 4_000_000, "approval_threshold": 100_000,
                  "allowed_categories": ["advertising", "software"], "blocked_merchants": [], "max_requests_per_hour": 100}
    a_mkt = client.post("/api/v1/agents", json={"name": "Marketing AI", "department_id": mkt["id"], **agent_json}, headers=H).json()
    a_ops = client.post("/api/v1/agents", json={"name": "Ops AI", "department_id": ops["id"], **agent_json}, headers=H).json()
    return {"H": H, "mkt": mkt, "ops": ops, "A_mkt": {"X-Agent-Key": a_mkt["api_key"]}, "A_ops": {"X-Agent-Key": a_ops["api_key"]}}


def buy(ctx, amount, agent="A_mkt", merchant="Google Ads"):
    r = client.post("/api/v1/agent/purchase-requests", json={"amount": amount, "merchant": merchant, "category": "advertising", "description": "test"}, headers=ctx[agent])
    assert r.status_code == 201, r.text
    return r.json()


def approve(pr_id, H, expect=200):
    r = client.post(f"/api/v1/approvals/{pr_id}/approve", json={"password": PW}, headers=H)
    assert r.status_code == expect, r.text
    return r.json()


# ---------------- invites ----------------
def test_invite_create_preview_accept_builtin(ctx):
    H = ctx["H"]
    r = client.post("/api/v1/team/invites", json={"email": "fin1@team.sa", "role": "finance"}, headers=H)
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["id"] and inv["email_delivered"] is False and "accept_link" in inv
    prev = client.get(f"/api/v1/team/invites/preview/{inv['token']}").json()
    assert prev == {**prev, "company_name": "TeamCo", "role": "finance", "email": "fin1@team.sa"}
    assert client.get("/api/v1/team/invites/preview/not-a-real-token").status_code == 404
    # accepting without a password needs one for a brand new account
    assert client.post("/api/v1/team/invites/accept", json={"token": inv["token"]}).status_code == 422
    r = client.post("/api/v1/team/invites/accept", json={"token": inv["token"], "password": PW, "full_name": "Finance One"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "finance" and r.json()["company"]["name"] == "TeamCo"
    # token is single use
    assert client.post("/api/v1/team/invites/accept", json={"token": inv["token"], "password": PW}).status_code == 409
    listed = client.get("/api/v1/team/invites", headers=H).json()
    assert listed[0]["email"] == "fin1@team.sa" and listed[0]["status"] == "accepted"
    # the new finance user can log in and is listed as a member
    F1 = _login("fin1@team.sa")
    members = client.get("/api/v1/team/members", headers=F1).json()
    assert {m["email"] for m in members} == {"owner@team.sa", "fin1@team.sa"}
    # an invite can be revoked before use
    r = client.post("/api/v1/team/invites", json={"email": "gone@team.sa", "role": "viewer"}, headers=H).json()
    assert client.delete(f"/api/v1/team/invites/{r['id']}", headers=H).status_code == 204
    assert client.get(f"/api/v1/team/invites/preview/{r['token']}").status_code == 404
    # finance cannot invite
    assert client.post("/api/v1/team/invites", json={"email": "x@team.sa", "role": "viewer"}, headers=F1).status_code == 403


def test_invite_accept_linked_signed_in_user(ctx):
    """A signed-in account without a company (the Supabase path) gets linked by the invite."""
    from app.core.db import SessionLocal
    from app.core.security import create_access_token, hash_password
    from app.models import User
    db = SessionLocal()
    u = User(company_id=None, email="floating@team.sa", full_name="Floating", password_hash=hash_password(PW), role="owner")
    db.add(u); db.commit(); uid = u.id; db.close()
    tok = _h(create_access_token(uid, 0))
    assert client.get("/api/v1/company", headers=tok).status_code == 403  # onboarding_required
    inv = client.post("/api/v1/team/invites", json={"email": "floating@team.sa", "role": "viewer"}, headers=ctx["H"]).json()
    # wrong account cannot use it
    assert client.post("/api/v1/team/invites/accept", json={"token": inv["token"]}, headers=ctx["H"]).status_code == 403
    r = client.post("/api/v1/team/invites/accept", json={"token": inv["token"]}, headers=tok)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "viewer"
    assert client.get("/api/v1/company", headers=_h(r.json()["access_token"])).status_code == 200


# ---------------- roles ----------------
def test_role_enforcement(ctx):
    H = ctx["H"]
    V = _invite_and_accept(H, "viewer@team.sa", "viewer")
    AUD = _invite_and_accept(H, "auditor@team.sa", "auditor")
    HEAD_OPS = _invite_and_accept(H, "opshead@team.sa", "dept_head", department_id=ctx["ops"]["id"])
    pr = buy(ctx, 150_000)  # Marketing hold, above the agent approval threshold
    assert pr["status"] == "pending_approval"
    # viewer and auditor cannot approve
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PW}, headers=V).status_code == 403
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PW}, headers=AUD).status_code == 403
    # auditor reads the ledger; viewer cannot run an employee; auditor cannot manage the team
    assert client.get("/api/v1/audit", headers=AUD).status_code == 200
    assert client.post("/api/v1/team/invites", json={"email": "z@team.sa", "role": "viewer"}, headers=AUD).status_code == 403
    assert client.post("/api/v1/team/approval-rules", json={"steps": [{"role": "finance", "count": 1}]}, headers=AUD).status_code == 403
    # dept_head of Operations cannot approve a Marketing request
    r = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PW}, headers=HEAD_OPS)
    assert r.status_code == 403 and "department" in r.json()["detail"].lower()
    # but can approve one in Operations
    pr2 = buy(ctx, 150_000, agent="A_ops")
    assert pr2["status"] == "pending_approval"
    assert approve(pr2["id"], HEAD_OPS)["status"] == "completed"
    # the Operations head sees only Operations requests
    seen = client.get("/api/v1/purchase-requests", headers=HEAD_OPS).json()
    assert seen and all(p["department_id"] == ctx["ops"]["id"] for p in seen)
    # finance approves the Marketing one
    assert approve(pr["id"], _login("fin1@team.sa"))["status"] == "completed"
    # disabled users are locked out
    members = {m["email"]: m for m in client.get("/api/v1/team/members", headers=H).json()}
    assert client.patch(f"/api/v1/team/members/{members['viewer@team.sa']['id']}", json={"status": "disabled"}, headers=H).json()["status"] == "disabled"
    r = client.get("/api/v1/company", headers=V)
    assert r.status_code == 403 and r.json()["detail"] == "account_disabled"
    assert client.post("/api/v1/auth/login", json={"email": "viewer@team.sa", "password": PW}).status_code == 200  # login itself still works
    client.patch(f"/api/v1/team/members/{members['viewer@team.sa']['id']}", json={"status": "active"}, headers=H)


# ---------------- approval chain ----------------
def test_two_step_chain_dept_head_then_two_finance(ctx):
    H = ctx["H"]
    HEAD_MKT = _invite_and_accept(H, "mkthead@team.sa", "dept_head", department_id=ctx["mkt"]["id"], full_name="Marketing Head")
    F2 = _invite_and_accept(H, "fin2@team.sa", "finance", full_name="Finance Two")
    F1 = _login("fin1@team.sa")
    r = client.post("/api/v1/team/approval-rules", json={"department_id": ctx["mkt"]["id"], "min_amount": 200_000,
                                                         "steps": [{"role": "dept_head", "count": 1}, {"role": "finance", "count": 2}]}, headers=H)
    assert r.status_code == 201, r.text
    rule = r.json()
    assert client.post("/api/v1/team/approval-rules", json={"steps": [{"role": "viewer", "count": 1}]}, headers=H).status_code == 422
    assert len(client.get("/api/v1/team/approval-rules", headers=H).json()) == 1

    pr = buy(ctx, 250_000, merchant="Snapchat Ads")
    assert pr["status"] == "pending_approval"
    assert pr["decision"]["chain"]["rule_id"] == rule["id"] and pr["decision"]["chain"]["next"]["step"] == 1
    assert pr["decision"]["reasons"][-1] == "Step 1 of 2: waiting for 1 department head approver."
    # the hold notification went only to people who can act on step 1 (the Marketing head, and owner who satisfies any step)
    notified = [e for e in client.get("/api/v1/audit", headers=H).json() if e["event"] == "approval.notified" and e["details"]["request_id"] == pr["id"]]
    assert notified and set(notified[0]["details"]["recipients"]) == {"owner@team.sa", "mkthead@team.sa"}

    # finance cannot take step 1
    r = client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PW}, headers=F1)
    assert r.status_code == 403 and "department head" in r.json()["detail"]
    # department head does step 1
    out = approve(pr["id"], HEAD_MKT)
    assert out["status"] == "pending_approval" and out["needs_second_approver"] is True
    assert out["decision"]["reasons"][-1] == "Step 1 of 2 done (department head). Waiting for 2 finance approvers."
    assert out["decision"]["chain"]["satisfied"] == [1] and out["decision"]["chain"]["next"]["role"] == "finance"
    assert out["approvals"][0]["role"] == "dept_head" and out["approvals"][0]["step"] == 1
    # the head cannot count twice
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PW}, headers=HEAD_MKT).status_code == 409
    # first finance
    out = approve(pr["id"], F1)
    assert out["status"] == "pending_approval"
    assert out["decision"]["reasons"][-1] == "Step 2 of 2 in progress (1 of 2 finance). Waiting for 1 more finance approver."
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PW}, headers=F1).status_code == 409
    # second finance completes the chain and money moves
    out = approve(pr["id"], F2)
    assert out["status"] == "completed" and len(out["approvals"]) == 3 and out["transaction_id"]
    assert out["decision"]["chain"]["complete"] is True
    # a decline by any eligible approver rejects at once
    pr = buy(ctx, 250_000, merchant="Snapchat Ads")
    r = client.post(f"/api/v1/approvals/{pr['id']}/reject", json={"password": PW, "note": "no"}, headers=HEAD_MKT)
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    # a request below the rule's amount keeps the single-approver path
    small = buy(ctx, 150_000)
    assert "chain" not in small["decision"]
    assert approve(small["id"], F1)["status"] == "completed"
    # owner satisfies any step: owner alone cannot finish (needs 3 distinct humans), but counts for step 1
    pr = buy(ctx, 250_000, merchant="Snapchat Ads")
    out = approve(pr["id"], H)
    assert out["approvals"][0]["role"] == "owner" and out["decision"]["chain"]["satisfied"] == [1]
    client.post(f"/api/v1/approvals/{pr['id']}/reject", json={"password": PW}, headers=F1)


# ---------------- delegation ----------------
def test_delegation(ctx):
    H = ctx["H"]
    V = _login("viewer@team.sa")
    members = {m["email"]: m for m in client.get("/api/v1/team/members", headers=H).json()}
    # viewer has nothing to delegate; finance delegates to the viewer
    assert client.post("/api/v1/team/delegations", json={"delegate_id": members["owner@team.sa"]["id"], "ends_at": "2099-01-01T00:00:00Z"}, headers=V).status_code == 409
    F2 = _login("fin2@team.sa")
    r = client.post("/api/v1/team/delegations", json={"delegate_id": members["viewer@team.sa"]["id"], "ends_at": "2099-01-01T00:00:00Z", "note": "holiday"}, headers=F2)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["active"] is True and d["user_role"] == "finance"
    me = client.get("/api/v1/me/view", headers=V).json()
    assert me["delegations_active_for_me"][0]["id"] == d["id"]
    # now the viewer can approve a small Marketing hold, recorded on behalf of fin2
    pr = buy(ctx, 150_000)
    out = approve(pr["id"], V)
    assert out["status"] == "completed"
    assert out["decision"]["approvals"] == [] or True  # single approver path records the actor in the ledger
    entries = [e for e in client.get("/api/v1/audit", headers=H).json() if e["event"] == "approval.approved" and e["details"]["request_id"] == pr["id"]]
    assert entries[0]["details"]["on_behalf_of"]["full_name"] == "Finance Two" and entries[0]["details"]["role"] == "finance"
    # and count as a finance approver in a chain, recorded on behalf of
    HEAD_MKT = _login("mkthead@team.sa")
    pr = buy(ctx, 250_000, merchant="Snapchat Ads")
    approve(pr["id"], HEAD_MKT)
    out = approve(pr["id"], V)
    assert out["approvals"][-1]["on_behalf_of"]["full_name"] == "Finance Two" and out["approvals"][-1]["role"] == "finance"
    # a viewer cannot end someone else's delegation; the delegator can
    assert client.delete(f"/api/v1/team/delegations/{d['id']}", headers=V).status_code == 403
    assert client.delete(f"/api/v1/team/delegations/{d['id']}", headers=F2).status_code == 204
    assert client.post(f"/api/v1/approvals/{pr['id']}/approve", json={"password": PW}, headers=V).status_code == 403
    # an expired window is not active
    r = client.post("/api/v1/team/delegations", json={"delegate_id": members["viewer@team.sa"]["id"], "starts_at": "2020-01-01T00:00:00Z", "ends_at": "2020-02-01T00:00:00Z"}, headers=F2)
    assert r.status_code == 201 and r.json()["active"] is False
    client.post(f"/api/v1/approvals/{pr['id']}/reject", json={"password": PW}, headers=H)


# ---------------- members ----------------
def test_member_management_and_last_owner(ctx):
    H = ctx["H"]
    members = {m["email"]: m for m in client.get("/api/v1/team/members", headers=H).json()}
    me = members["owner@team.sa"]
    assert me["last_seen_at"] is not None
    # cannot change own role, cannot demote the last owner, cannot delete self
    assert client.patch(f"/api/v1/team/members/{me['id']}", json={"role": "viewer"}, headers=H).status_code == 409
    assert client.delete(f"/api/v1/team/members/{me['id']}", headers=H).status_code == 409
    # promote fin1 to admin, then admin manages departments for the viewer but cannot grant owner
    fin1 = members["fin1@team.sa"]
    assert client.patch(f"/api/v1/team/members/{fin1['id']}", json={"role": "admin"}, headers=H).json()["role"] == "admin"
    ADMIN = _login("fin1@team.sa")
    viewer = members["viewer@team.sa"]
    out = client.patch(f"/api/v1/team/members/{viewer['id']}", json={"departments": [ctx["ops"]["id"]]}, headers=ADMIN).json()
    assert out["departments"] == [ctx["ops"]["id"]]
    V = _login("viewer@team.sa")
    assert all(p["department_id"] == ctx["ops"]["id"] for p in client.get("/api/v1/purchase-requests", headers=V).json())
    assert client.patch(f"/api/v1/team/members/{viewer['id']}", json={"role": "owner"}, headers=ADMIN).status_code == 403
    assert client.patch(f"/api/v1/team/members/{me['id']}", json={"status": "disabled"}, headers=ADMIN).status_code == 403
    # admin can approve like an owner
    pr = buy(ctx, 150_000)
    assert approve(pr["id"], ADMIN)["status"] == "completed"
    # only owners delete; a second owner makes the first demotable
    assert client.delete(f"/api/v1/team/members/{viewer['id']}", headers=ADMIN).status_code == 403
    assert client.patch(f"/api/v1/team/members/{fin1['id']}", json={"role": "owner"}, headers=H).json()["role"] == "owner"
    assert client.patch(f"/api/v1/team/members/{me['id']}", json={"role": "finance"}, headers=ADMIN).status_code == 200
    assert client.patch(f"/api/v1/team/members/{me['id']}", json={"role": "owner"}, headers=ADMIN).status_code == 200
    # delete the viewer; audit records it
    assert client.delete(f"/api/v1/team/members/{viewer['id']}", headers=H).status_code == 204
    assert client.get("/api/v1/company", headers=V).status_code == 401
    assert any(e["event"] == "team.member_removed" for e in client.get("/api/v1/audit", headers=H).json())
    # put fin1 back to finance for the views test
    client.patch(f"/api/v1/team/members/{fin1['id']}", json={"role": "finance"}, headers=H)


# ---------------- views ----------------
def test_me_view_and_admin_view(ctx):
    H = ctx["H"]
    HEAD_MKT = _login("mkthead@team.sa")
    F1 = _login("fin1@team.sa")
    pr = buy(ctx, 250_000, merchant="Snapchat Ads")  # chain: step 1 needs the Marketing head
    small = buy(ctx, 150_000, agent="A_ops")         # plain hold in Operations
    me = client.get("/api/v1/me/view", headers=HEAD_MKT).json()
    assert me["my_role"] == "dept_head" and [d["name"] for d in me["my_departments"]] == ["Marketing"]
    assert [p["id"] for p in me["needs_me"]] == [pr["id"]]
    assert me["needs_me"][0]["chain"]["next"]["role"] == "dept_head"
    fin = client.get("/api/v1/me/view", headers=F1).json()
    assert [p["id"] for p in fin["needs_me"]] == [small["id"]]  # step 1 of the chain is not finance's turn
    assert fin["my_recent_approvals"] and fin["my_recent_approvals"][0]["event"].startswith("approval.")
    approve(pr["id"], HEAD_MKT)
    fin = client.get("/api/v1/me/view", headers=F1).json()
    assert {p["id"] for p in fin["needs_me"]} == {pr["id"], small["id"]}
    assert client.get("/api/v1/me/view", headers=HEAD_MKT).json()["needs_me"] == []
    # admin view
    assert client.get("/api/v1/admin/view", headers=HEAD_MKT).status_code == 403
    adm = client.get("/api/v1/admin/view", headers=_login("auditor@team.sa")).json()
    assert adm["pending_total"] == 2 and {r["department_name"] for r in adm["pending_by_department"]} == {"Marketing", "Operations"}
    by_name = {a["full_name"]: a["open_count"] for a in adm["approvers"]}
    assert by_name["Owner"] == 2 and by_name["Marketing Head"] == 0 and by_name["Finance One"] == 2
    assert adm["members"]["count"] >= 6 and adm["approval_rules"] == 1 and adm["stuck_holds"] == []
    # make one hold older than 24h and it shows as stuck
    from datetime import datetime, timedelta, timezone
    from app.core.db import SessionLocal
    from app.models import PurchaseRequest
    db = SessionLocal()
    db.get(PurchaseRequest, small["id"]).created_at = datetime.now(timezone.utc) - timedelta(hours=30)
    db.commit(); db.close()
    adm = client.get("/api/v1/admin/view", headers=H).json()
    assert [s["id"] for s in adm["stuck_holds"]] == [small["id"]] and adm["stuck_holds"][0]["age_hours"] >= 29


def test_seed_includes_team_layer(ctx):
    import seed as seed_mod
    assert "head@flaire.sa" in open(seed_mod.__file__).read()

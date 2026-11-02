"""Flaire as an MCP connector: let anyone's Claude become an AI employee of a company.

Share a link like   https://<api>/api/v1/mcp/<agent_key>
The recipient adds it in Claude (Settings → Connectors → Add custom connector). Their Claude then has four tools:
check_budget, request_purchase, get_purchase_status, list_my_requests. It gets Flaire's decision on every
purchase and has no tool to approve, raise limits or touch cards. Every request is attributed to that agent key.

Transport: MCP Streamable HTTP, JSON responses (POST JSON-RPC in, JSON-RPC out). Stateless, so it works behind
Render/Vercel without sticky sessions. Protocol reference: https://modelcontextprotocol.io/specification
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.serializers import purchase_out
from app.core.db import get_db
from app.core.security import hash_api_key
from app.models import Agent, Company, Department, PurchaseRequest
from app.services import submit_purchase_request

router = APIRouter()
PROTOCOL_VERSION = "2025-06-18"

TOOLS = [
    {"name": "check_budget",
     "description": "Check this AI employee's spending permissions and the department's remaining budget. Call this before requesting any purchase.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "request_purchase",
     "description": "Request a purchase through Flaire, the company's finance department for AI employees. Amount is in SAR. Flaire returns approved (paid), pending_approval (a human must sign off, do not retry) or denied (read the reasons). Never split a purchase to dodge a limit.",
     "inputSchema": {"type": "object", "required": ["amount_sar", "merchant", "category", "description"],
                     "properties": {"amount_sar": {"type": "number", "description": "Amount in Saudi Riyals, e.g. 500"},
                                    "merchant": {"type": "string", "description": "Who gets paid, e.g. Google Ads"},
                                    "category": {"type": "string", "description": "advertising, software, equipment, services, travel, logistics, utilities, office or other"},
                                    "description": {"type": "string", "description": "What the purchase is for"}}}},
    {"name": "get_purchase_status",
     "description": "Check the current status of a purchase request you made earlier (for example to see if a human approved it).",
     "inputSchema": {"type": "object", "required": ["request_id"], "properties": {"request_id": {"type": "integer"}}}},
    {"name": "list_my_requests",
     "description": "List this AI employee's recent purchase requests with their status.",
     "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 10}}}},
]


def _rpc_result(id_: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _rpc_error(id_: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def _text(payload: Any, is_error: bool = False) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2, default=str)}], "isError": is_error}


def _budget(db: Session, agent: Agent) -> dict:
    dept = db.get(Department, agent.department_id)
    company = db.get(Company, agent.company_id)
    return {"company": company.name, "agent": agent.name, "role": agent.role, "status": agent.status, "currency": "SAR",
            "per_transaction_limit_sar": agent.per_transaction_limit / 100, "monthly_limit_sar": agent.monthly_limit / 100,
            "spent_this_month_sar": agent.spent_this_period / 100, "needs_human_approval_at_or_above_sar": agent.approval_threshold / 100,
            "allowed_categories": agent.allowed_categories or "any", "blocked_merchants": agent.blocked_merchants,
            "department": dept.name, "department_remaining_sar": dept.remaining / 100, "kill_switch_on": company.kill_switch}


def _pr_view(pr: PurchaseRequest) -> dict:
    out = purchase_out(pr).model_dump()
    return {"request_id": out["id"], "status": out["status"], "verdict": out["decision"].get("verdict"), "reasons": out["decision"].get("reasons", []),
            "payment_error": out["decision"].get("payment_error"), "amount_sar": out["amount"] / 100, "merchant": out["merchant"],
            "category": out["category"], "created_at": out["created_at"], "approved_by": (out["approved_by"] or {}).get("full_name")}


def _call_tool(db: Session, agent: Agent, name: str, args: dict) -> dict:
    if name == "check_budget":
        return _text(_budget(db, agent))
    if name == "request_purchase":
        try:
            amount = int(round(float(args["amount_sar"]) * 100))
        except (KeyError, TypeError, ValueError):
            return _text({"error": "amount_sar must be a number"}, True)
        if amount <= 0:
            return _text({"error": "amount_sar must be greater than zero"}, True)
        company = db.get(Company, agent.company_id)
        pr = submit_purchase_request(db, company, agent, amount=amount, merchant=str(args.get("merchant") or "Unknown")[:200],
                                     category=str(args.get("category") or "other")[:60], description=str(args.get("description") or "")[:2000], card_id=None)
        view = _pr_view(pr)
        view["what_to_do"] = {"completed": "Paid. You are done with this item.", "pending_approval": "Waiting for a human. Do not retry; tell the user it is pending.",
                              "denied": "Blocked. Read the reasons and pick a compliant alternative or report back.", "failed": "Approved but payment failed. Report the payment_error."}.get(pr.status, "")
        return _text(view, is_error=pr.status in ("denied", "failed"))
    if name == "get_purchase_status":
        pr = db.get(PurchaseRequest, int(args.get("request_id", 0)))
        if not pr or pr.agent_id != agent.id:
            return _text({"error": "Request not found"}, True)
        return _text(_pr_view(pr))
    if name == "list_my_requests":
        limit = max(1, min(int(args.get("limit", 10)), 50))
        rows = db.query(PurchaseRequest).filter(PurchaseRequest.agent_id == agent.id).order_by(PurchaseRequest.id.desc()).limit(limit).all()
        return _text([_pr_view(p) for p in rows])
    return _text({"error": f"Unknown tool {name}"}, True)


def _handle(db: Session, agent: Agent, msg: dict) -> dict | None:
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if method == "initialize":
        company = db.get(Company, agent.company_id)
        return _rpc_result(id_, {"protocolVersion": params.get("protocolVersion") or PROTOCOL_VERSION, "capabilities": {"tools": {"listChanged": False}},
                                 "serverInfo": {"name": "flaire", "title": f"Flaire · {company.name}", "version": "0.2.0"},
                                 "instructions": f"You are '{agent.name}', an AI employee of {company.name}. Flaire is the company's finance department for AI employees. "
                                                 "Always call check_budget before request_purchase. You cannot approve purchases or change limits; a human does that in the Flaire dashboard."})
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None
    if method == "ping":
        return _rpc_result(id_, {})
    if method == "tools/list":
        return _rpc_result(id_, {"tools": TOOLS})
    if method == "tools/call":
        try:
            return _rpc_result(id_, _call_tool(db, agent, params.get("name", ""), params.get("arguments") or {}))
        except Exception as exc:  # fail closed, but keep the session alive
            return _rpc_result(id_, _text({"error": str(exc)}, True))
    if method in ("resources/list", "prompts/list"):
        return _rpc_result(id_, {"resources": [], "prompts": []})
    if id_ is None:
        return None
    return _rpc_error(id_, -32601, f"Method not found: {method}")


def _agent_from_key(db: Session, key: str) -> Agent | None:
    return db.query(Agent).filter(Agent.api_key_hash == hash_api_key(key)).first()


@router.post("/mcp/{agent_key}", tags=["mcp"], include_in_schema=False)
async def mcp_post(agent_key: str, request: Request, db: Session = Depends(get_db)):
    agent = _agent_from_key(db, agent_key)
    if not agent:
        return JSONResponse(_rpc_error(None, -32001, "Unknown Flaire agent key"), status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_rpc_error(None, -32700, "Parse error"), status_code=400)
    messages = body if isinstance(body, list) else [body]
    responses = [r for r in (_handle(db, agent, m) for m in messages if isinstance(m, dict)) if r is not None]
    if not responses:
        return Response(status_code=202)
    return JSONResponse(responses[0] if not isinstance(body, list) else responses)


@router.get("/mcp/{agent_key}", tags=["mcp"], include_in_schema=False)
async def mcp_get(agent_key: str, db: Session = Depends(get_db)):
    # Server-initiated streams are not used; clients that probe GET get a friendly answer.
    agent = _agent_from_key(db, agent_key)
    if not agent:
        return JSONResponse({"detail": "Unknown Flaire agent key"}, status_code=401)
    company = db.get(Company, agent.company_id)
    return JSONResponse({"ok": True, "name": "flaire", "company": company.name, "agent": agent.name,
                         "message": "This link works. Add it in Claude: Settings, Connectors, Add custom connector."})


@router.delete("/mcp/{agent_key}", include_in_schema=False)
async def mcp_delete(agent_key: str):
    return Response(status_code=204)

"""Authorization engine backed by the real `@shotoku/core` (via the Node sidecar in service/).

Division of labour, matching the Flaire plan:
  * Flaire (Python) owns company-level business rules: kill switch, agent identity/status, category and
    merchant restrictions, department budgets, velocity, and the human-approval threshold.
  * Shotoku owns spending policy evaluation (per-transaction limit, rolling 24h limit), the decision ledger,
    pending-approval resolution and signed receipts.

If the sidecar is unreachable the engine fails closed (denied) and says so in the reasons.
"""
from __future__ import annotations

import httpx

from app.core.config import get_settings
from app.integrations.shotoku.interface import AuthorizationRequest, Decision
from app.integrations.shotoku.native_engine import NativeEngine, sar
from app.integrations.shotoku.receipts import verify_receipt


class ShotokuEngine:
    name = "shotoku"

    def __init__(self) -> None:
        self.settings = get_settings()
        self.base = self.settings.shotoku_service_url.rstrip("/")
        self._pre = NativeEngine()

    # ------------- helpers -------------
    def _company_key(self, req: AuthorizationRequest) -> str:
        return f"company-{req.company_id}"  # one Shotoku policy + ledger per Flaire company

    def _shotoku_request(self, req: AuthorizationRequest) -> dict:
        return {
            "actor": f"agent-{req.agent.agent_id}",
            "action": "purchase",
            "resource": req.merchant,
            "rail": "api",
            "amount": round(req.amount / 100, 2),
            "context": {"category": req.category, "description": req.description, "currency": req.currency, "flaire_request": req.request_id},
        }

    def _policy(self, req: AuthorizationRequest) -> dict:
        a = req.agent
        return {
            "rules": [{
                "actor": f"agent-{a.agent_id}",
                "resource": "*",
                "actions": ["purchase"],
                "verdict": "approved",
                "maxAmount": round(a.per_transaction_limit / 100, 2),
                # Shotoku tracks a rolling 24h window per actor|resource; we feed it the agent's remaining monthly room.
                "maxDailyAmount": round(max(a.monthly_limit - a.spent_this_period, 0) / 100, 2),
            }],
            "defaultVerdict": "pending_approval",
        }

    def _post(self, path: str, body: dict) -> dict:
        r = httpx.post(f"{self.base}{path}", json=body, timeout=10)
        data = r.json()
        if r.status_code != 200:
            raise RuntimeError(data.get("message", "Shotoku sidecar error"))
        return data

    # ------------- engine -------------
    def authorize(self, req: AuthorizationRequest) -> Decision:
        # Flaire business pre-checks run first (kill switch, identity, categories, budgets, velocity, threshold).
        pre = self._pre.authorize(req)
        if pre.verdict == "denied":
            return Decision(**{**pre.__dict__, "engine": self.name})
        try:
            resp = self._post("/authorize", {"company": self._company_key(req), "policy": self._policy(req), "request": self._shotoku_request(req)})
        except Exception as exc:
            return Decision(verdict="denied", engine=self.name, rule_id="sidecar-unreachable",
                            reasons=[f"Shotoku sidecar unavailable, failing closed: {exc}"], summary="Denied: authorization service unreachable.")

        reasons = [f"Flaire pre-checks passed ({req.department.name} budget {sar(req.department.remaining)} remaining)."]
        reasons += [f"Shotoku: {r['text']}" for r in resp.get("reasons", [])]
        verdict = resp["status"]
        if verdict == "approved" and pre.verdict == "pending_approval":
            # Flaire's approval threshold still wins: a human must sign off.
            verdict = "pending_approval"
            reasons.append(f"Flaire: {sar(req.amount)} is at or above the approval threshold ({sar(req.agent.approval_threshold)}).")
        return Decision(verdict=verdict, reasons=reasons, engine=self.name, rule_id="shotoku-policy",
                        receipt=resp.get("receipt") if verdict == "approved" else None,
                        summary=resp.get("explanation", {}).get("summary", ""), decision_id=resp.get("decisionId"))

    def approve(self, req: AuthorizationRequest, decision_id: str | None, approver: str) -> Decision:
        pre = self._pre.approve(req, decision_id, approver)
        if pre.verdict == "denied":
            return Decision(**{**pre.__dict__, "engine": self.name})
        try:
            body = {"company": self._company_key(req), "decisionId": decision_id, "via": f"flaire:{approver}",
                    "receipt": {"actor": f"agent-{req.agent.agent_id}", "action": "purchase", "resource": req.merchant, "amount": round(req.amount / 100, 2)}}
            resp = self._post("/approve", body)
        except Exception as exc:
            # Shotoku had the decision as auto-approved already (threshold was Flaire's), or sidecar is down.
            if "not pending approval" in str(exc):
                return Decision(**{**pre.__dict__, "engine": self.name})
            return Decision(verdict="denied", engine=self.name, reasons=[f"Shotoku approve failed, failing closed: {exc}"], rule_id="sidecar-error")
        return Decision(verdict="approved", reasons=[f"Approved by {approver} (Shotoku approval {resp.get('approvalId')})."], engine=self.name,
                        rule_id="human-approved", receipt=resp.get("receipt") or pre.receipt, decision_id=decision_id, summary="Approved by a human.")

    def deny(self, req: AuthorizationRequest, decision_id: str | None, approver: str) -> Decision:
        try:
            self._post("/deny", {"company": self._company_key(req), "decisionId": decision_id, "via": f"flaire:{approver}"})
        except Exception:
            pass  # Flaire's own ledger still records the rejection
        return Decision(verdict="denied", reasons=[f"Rejected by {approver}."], engine=self.name, rule_id="human-rejected", decision_id=decision_id)

    def verify_receipt(self, receipt: str, req: AuthorizationRequest) -> tuple[bool, list[str]]:
        # Same format and same shared secret, so the Python verifier works for Shotoku-issued receipts too.
        return verify_receipt(receipt, secret=self.settings.receipt_secret, actor=f"agent-{req.agent.agent_id}",
                              resource=req.merchant, amount_major=round(req.amount / 100, 2))

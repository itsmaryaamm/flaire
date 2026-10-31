"""Native authorization engine: a Python port of Shotoku's policy model, extended with Flaire's business rules.

Shotoku concepts kept on purpose:
  * three verdicts: approved / denied / pending_approval
  * default verdict is pending_approval (unknown things go to a human, never auto-approved)
  * fail closed: any internal error becomes "denied"
  * every check that ran is returned as a reason, so the dashboard can show *why*
  * approved decisions carry a short-lived HMAC receipt in Shotoku's own format

Flaire additions: company kill switch, agent identity/status, per-agent monthly limits, department budgets,
category allowlists, merchant blocklists, hourly velocity limits and approval thresholds.

Order matters: hard denials first, then "needs a human", then approval. A request that trips a denial rule
is denied even if it would also have needed approval.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.integrations.shotoku.interface import AuthorizationRequest, Decision
from app.integrations.shotoku.receipts import create_receipt, verify_receipt


def sar(halalas: int) -> str:
    return f"SAR {halalas / 100:,.2f}"


def _norm(s: str) -> str:
    return " ".join(s.lower().replace("_", " ").replace("-", " ").split())


class NativeEngine:
    name = "native"

    def __init__(self) -> None:
        self.settings = get_settings()

    # ---------------- core evaluation ----------------
    def authorize(self, req: AuthorizationRequest) -> Decision:
        try:
            return self._evaluate(req)
        except Exception as exc:  # fail closed
            return Decision(verdict="denied", reasons=[f"Engine error, failing closed: {exc}"], engine=self.name, summary="Denied: internal error.")

    def _evaluate(self, req: AuthorizationRequest) -> Decision:
        reasons: list[str] = []
        a, d = req.agent, req.department

        # 1. Hard stops
        if req.kill_switch:
            return self._deny(req, "kill-switch", ["Company kill switch is ON. All new AI spending is disabled."])
        if a.status != "active":
            return self._deny(req, "agent-paused", [f"Agent '{a.agent_name}' is paused."])
        if req.amount <= 0:
            return self._deny(req, "invalid-amount", ["Amount must be greater than zero."])
        reasons.append(f"Agent identity verified ({a.agent_name}, active).")

        # 2. Merchant / category restrictions
        merchant_n, category_n = _norm(req.merchant), _norm(req.category)
        for blocked in req.company_blocked_categories:
            b = _norm(blocked)
            if b == category_n or b in merchant_n or b in _norm(req.description):
                return self._deny(req, "company-blocked-category", reasons + [f"Category '{blocked}' is blocked company-wide (fraud-prone)."])
        for blocked in a.blocked_merchants:
            if _norm(blocked) in merchant_n:
                return self._deny(req, "agent-blocked-merchant", reasons + [f"Merchant '{req.merchant}' is on this agent's blocklist."])
        if a.allowed_categories and category_n not in {_norm(c) for c in a.allowed_categories}:
            return self._deny(req, "category-not-allowed", reasons + [f"Category '{req.category}' is not in this agent's allowed categories ({', '.join(a.allowed_categories)})."])
        reasons.append(f"Merchant '{req.merchant}' and category '{req.category}' allowed.")

        # 3. Limits and budgets (Shotoku: maxAmount / maxDailyAmount; Flaire: monthly + department)
        if req.amount > a.per_transaction_limit:
            return self._deny(req, "per-transaction-limit", reasons + [f"{sar(req.amount)} exceeds per-transaction limit of {sar(a.per_transaction_limit)}."])
        reasons.append(f"Within per-transaction limit ({sar(a.per_transaction_limit)}).")

        if a.spent_this_period + req.amount > a.monthly_limit:
            return self._deny(req, "agent-monthly-limit", reasons + [f"Would exceed agent monthly limit: {sar(a.spent_this_period)} spent + {sar(req.amount)} > {sar(a.monthly_limit)}."])
        reasons.append(f"Within agent monthly limit ({sar(a.monthly_limit - a.spent_this_period)} left).")

        if req.amount > d.remaining:
            return self._deny(req, "department-budget", reasons + [f"{d.name} budget has {sar(d.remaining)} remaining, request is {sar(req.amount)}."])
        reasons.append(f"{d.name} budget OK ({sar(d.remaining)} remaining).")

        # 4. Velocity
        if a.requests_last_hour >= a.max_requests_per_hour:
            return self._deny(req, "velocity", reasons + [f"Agent hit its velocity limit ({a.max_requests_per_hour} requests/hour)."])

        # 5. Human-in-the-loop threshold
        if req.amount >= a.approval_threshold:
            reasons.append(f"{sar(req.amount)} is at or above the approval threshold ({sar(a.approval_threshold)}). Human approval required.")
            return Decision(verdict="pending_approval", reasons=reasons, engine=self.name, rule_id="approval-threshold",
                            summary=f"Held for approval: {sar(req.amount)} at {req.merchant} needs a human sign-off.",
                            decision_id=f"dec_{req.request_id}")

        reasons.append(f"Below approval threshold ({sar(a.approval_threshold)}). Auto-approved.")
        return self._approve(req, "auto-approve", reasons)

    # ---------------- human resolution ----------------
    def approve(self, req: AuthorizationRequest, decision_id: str | None, approver: str) -> Decision:
        # Re-check hard stops and budgets at approval time; a human cannot lift a kill switch or a budget by approving.
        if req.kill_switch:
            return self._deny(req, "kill-switch", ["Kill switch is ON; approvals are frozen."])
        if req.amount > req.department.remaining:
            return self._deny(req, "department-budget", [f"Budget no longer covers this: {sar(req.department.remaining)} remaining."])
        return self._approve(req, "human-approved", [f"Approved by {approver}."])

    def deny(self, req: AuthorizationRequest, decision_id: str | None, approver: str) -> Decision:
        return self._deny(req, "human-rejected", [f"Rejected by {approver}."])

    # ---------------- receipts ----------------
    def verify_receipt(self, receipt: str, req: AuthorizationRequest) -> tuple[bool, list[str]]:
        return verify_receipt(receipt, secret=self.settings.receipt_secret, actor=f"agent-{req.agent.agent_id}",
                              resource=req.merchant, amount_major=round(req.amount / 100, 2))

    # ---------------- helpers ----------------
    def _approve(self, req: AuthorizationRequest, rule_id: str, reasons: list[str]) -> Decision:
        receipt = create_receipt(secret=self.settings.receipt_secret, decision_id=f"dec_{req.request_id}",
                                 actor=f"agent-{req.agent.agent_id}", resource=req.merchant,
                                 amount_major=round(req.amount / 100, 2), ttl_seconds=self.settings.receipt_ttl_seconds)
        return Decision(verdict="approved", reasons=reasons, engine=self.name, rule_id=rule_id, receipt=receipt,
                        summary=f"Approved: {sar(req.amount)} at {req.merchant}.", decision_id=f"dec_{req.request_id}")

    def _deny(self, req: AuthorizationRequest, rule_id: str, reasons: list[str]) -> Decision:
        return Decision(verdict="denied", reasons=reasons, engine=self.name, rule_id=rule_id,
                        summary=f"Blocked: {reasons[-1]}", decision_id=f"dec_{req.request_id}")

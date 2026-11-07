"""The one interface Flaire uses to ask "is this AI employee allowed to spend this?".

Everything Flaire knows about the request is packed into AuthorizationRequest. The engine answers with a
Decision carrying a verdict, human-readable reasons, and (when approved) a signed receipt that the payment
service verifies before it moves any simulated money. The engine never touches cards or balances.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

Verdict = Literal["approved", "denied", "pending_approval"]


@dataclass
class AgentPolicy:
    """The agent's own permissions as configured in the Flaire dashboard."""
    agent_id: int
    agent_name: str
    status: str                       # active | paused
    per_transaction_limit: int        # halalas
    monthly_limit: int                # halalas
    spent_this_period: int            # halalas
    approval_threshold: int           # halalas; amount >= threshold needs a human
    allowed_categories: list[str] = field(default_factory=list)   # empty = any
    blocked_merchants: list[str] = field(default_factory=list)
    max_requests_per_hour: int = 10
    requests_last_hour: int = 0
    duplicate_recent: bool = False   # same merchant + amount from this agent in the last 10 minutes
    max_requests_per_day: int = 50
    requests_today: int = 0
    same_merchant_last_hour: int = 0  # halalas this agent already sent (or is waiting to send) to this merchant in the last 60 minutes


@dataclass
class DepartmentBudget:
    department_id: int
    name: str
    monthly_budget: int
    spent_this_period: int
    spending_paused: bool = False

    @property
    def remaining(self) -> int:
        return max(self.monthly_budget - self.spent_this_period, 0)


@dataclass
class AuthorizationRequest:
    request_id: str                   # Flaire's purchase request id, used as decision id
    company_id: int
    amount: int                       # halalas
    currency: str
    merchant: str
    category: str
    description: str
    agent: AgentPolicy
    department: DepartmentBudget
    kill_switch: bool
    company_blocked_categories: list[str] = field(default_factory=lambda: ["gift_card", "crypto", "cash_withdrawal"])
    company_trusted_merchants: list[str] = field(default_factory=list)
    merchant_is_new: bool = False            # company has never completed a payment to this merchant
    new_merchant_review_from: int = 20_000   # halalas; 0 disables
    category_given: str | None = None        # what the agent sent, when it differs from the category Flaire settled on
    flags: list[str] = field(default_factory=list)   # anomaly flags (app.core.velocity); informational, never change the verdict


@dataclass
class Decision:
    verdict: Verdict
    reasons: list[str]
    engine: str
    rule_id: str | None = None
    receipt: str | None = None
    summary: str = ""
    decision_id: str | None = None   # engine-side id (Shotoku's dec_...), if any
    flags: list[str] = field(default_factory=list)   # anomaly flags carried through from the request

    @property
    def approved(self) -> bool:
        return self.verdict == "approved"


class AuthorizationEngine(Protocol):
    name: str

    def authorize(self, req: AuthorizationRequest) -> Decision: ...

    def approve(self, req: AuthorizationRequest, decision_id: str | None, approver: str) -> Decision:
        """A human resolved a pending decision. Returns the final decision with a fresh receipt."""
        ...

    def deny(self, req: AuthorizationRequest, decision_id: str | None, approver: str) -> Decision: ...

    def verify_receipt(self, receipt: str, req: AuthorizationRequest) -> tuple[bool, list[str]]: ...

"""Pydantic schemas (API contract in docs/API.md). Money fields are integer halalas."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, field_validator


def _utc(d: UtcDatetime | None) -> datetime | None:
    """SQLite returns naive datetimes; mark them UTC so browsers render local time correctly."""
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


UtcDatetime = Annotated[datetime, AfterValidator(_utc)]


# ---------- auth ----------
class RegisterIn(BaseModel):
    company_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    model_config = {"from_attributes": True}


class CompanyOut(BaseModel):
    id: int
    name: str
    currency: str
    kill_switch: bool
    kill_switch_reason: str | None = None
    engine: str
    created_at: UtcDatetime
    model_config = {"from_attributes": True}


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    company: CompanyOut


class CompanyPatch(BaseModel):
    name: str | None = None
    engine: str | None = None

    @field_validator("engine")
    @classmethod
    def _engine(cls, v):
        if v is not None and v not in ("native", "shotoku"):
            raise ValueError("engine must be 'native' or 'shotoku'")
        return v


class KillSwitchIn(BaseModel):
    enabled: bool
    reason: str | None = None


# ---------- departments ----------
class DepartmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    monthly_budget: int = Field(ge=0)


class DepartmentPatch(BaseModel):
    name: str | None = None
    monthly_budget: int | None = Field(default=None, ge=0)


class DepartmentOut(BaseModel):
    id: int
    name: str
    monthly_budget: int
    spent_this_period: int
    remaining: int
    period_start: date
    agent_count: int = 0


# ---------- agents ----------
class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = "general"
    department_id: int
    per_transaction_limit: int = Field(default=100_000, ge=0)
    monthly_limit: int = Field(default=500_000, ge=0)
    approval_threshold: int = Field(default=100_000, ge=0)
    allowed_categories: list[str] = []
    blocked_merchants: list[str] = []
    max_requests_per_hour: int = Field(default=10, ge=1, le=1000)


class AgentPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    department_id: int | None = None
    status: str | None = None
    per_transaction_limit: int | None = Field(default=None, ge=0)
    monthly_limit: int | None = Field(default=None, ge=0)
    approval_threshold: int | None = Field(default=None, ge=0)
    allowed_categories: list[str] | None = None
    blocked_merchants: list[str] | None = None
    max_requests_per_hour: int | None = Field(default=None, ge=1, le=1000)


class AgentOut(BaseModel):
    id: int
    name: str
    role: str
    department_id: int
    department_name: str
    status: str
    per_transaction_limit: int
    monthly_limit: int
    spent_this_period: int
    approval_threshold: int
    allowed_categories: list[str]
    blocked_merchants: list[str]
    max_requests_per_hour: int
    key_prefix: str
    last_active_at: UtcDatetime | None
    created_at: UtcDatetime


class AgentCreatedOut(BaseModel):
    agent: AgentOut
    api_key: str


class AgentKeyOut(BaseModel):
    api_key: str


class RunIn(BaseModel):
    task: str = Field(min_length=3, max_length=2000)


class RunOut(BaseModel):
    run_id: int
    agent_id: int
    task: str
    mode: str
    transcript: list[dict]
    purchase_requests: list[PurchaseRequestOut]
    created_at: UtcDatetime


# ---------- purchases ----------
class PurchaseIn(BaseModel):
    amount: int = Field(gt=0, description="halalas")
    merchant: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=60)
    description: str = ""
    card_id: int | None = None


class ApprovedBy(BaseModel):
    id: int
    full_name: str


class PurchaseRequestOut(BaseModel):
    id: int
    agent_id: int
    agent_name: str
    department_id: int
    department_name: str
    amount: int
    currency: str
    merchant: str
    category: str
    description: str
    status: str
    decision: dict
    transaction_id: int | None
    approved_by: ApprovedBy | None
    approval_note: str | None
    created_at: UtcDatetime
    decided_at: UtcDatetime | None


class ApprovalIn(BaseModel):
    note: str | None = None


class TransactionOut(BaseModel):
    id: int
    purchase_request_id: int
    card_id: int
    card_label: str
    provider: str
    provider_ref: str
    amount: int
    currency: str
    merchant: str
    status: str
    decline_reason: str | None
    created_at: UtcDatetime


# ---------- cards ----------
class CardIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    provider: str
    last4: str | None = None
    credit_limit: int = Field(ge=0)
    department_id: int | None = None
    is_default: bool = False


class CardPatch(BaseModel):
    label: str | None = None
    status: str | None = None
    is_default: bool | None = None
    department_id: int | None = None


class TopUpIn(BaseModel):
    amount: int = Field(gt=0)


class CardOut(BaseModel):
    id: int
    label: str
    provider: str
    last4: str
    currency: str
    available_balance: int
    credit_limit: int
    status: str
    is_default: bool
    department_id: int | None
    created_at: UtcDatetime
    model_config = {"from_attributes": True}


# ---------- dashboard / audit ----------
class AuditOut(BaseModel):
    id: int
    ts: UtcDatetime
    actor_type: str
    actor_id: int | None
    actor_name: str
    event: str
    details: dict
    prev_hash: str
    hash: str
    model_config = {"from_attributes": True}

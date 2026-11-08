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
    code: str | None = None   # 2FA code when enabled


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    totp_enabled: bool = False
    is_platform_admin: bool = False
    model_config = {"from_attributes": True}


class CompanyOut(BaseModel):
    id: int
    name: str
    currency: str
    kill_switch: bool
    kill_switch_reason: str | None = None
    engine: str
    require_password_on_approve: bool = True
    two_person_threshold: int = 250_000
    trusted_merchants: list[str] = []
    new_merchant_review_from: int = 20_000
    notify_threshold: int = 0
    lithic_configured: bool = False
    require_2fa_for_approvers: bool = False
    require_2fa_for_all: bool = False
    require_change_approval: bool = False
    policy_version: int = 0
    onboarding_done: bool = False
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
    require_password_on_approve: bool | None = None
    two_person_threshold: int | None = Field(default=None, ge=0)
    trusted_merchants: list[str] | None = None
    new_merchant_review_from: int | None = Field(default=None, ge=0)
    notify_threshold: int | None = Field(default=None, ge=0)
    lithic_api_key: str | None = None   # write-only; empty string removes
    require_2fa_for_approvers: bool | None = None
    require_2fa_for_all: bool | None = None      # mandatory 2FA for every member; turning it off is a loosening
    require_change_approval: bool | None = None  # turning it off while on needs a second admin
    change_reason: str | None = Field(default=None, max_length=500)

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
    spending_paused: bool | None = None
    cost_center_id: int | None = None
    gl_code: str | None = Field(default=None, max_length=40)
    change_reason: str | None = Field(default=None, max_length=500)


class DepartmentOut(BaseModel):
    id: int
    name: str
    monthly_budget: int
    spent_this_period: int
    remaining: int
    period_start: date
    spending_paused: bool = False
    agent_count: int = 0
    cost_center_id: int | None = None
    gl_code: str | None = None
    rollover_balance: int = 0


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
    max_requests_per_day: int = Field(default=50, ge=1, le=10_000)
    key_expires_in_days: int | None = Field(default=None, ge=1, le=365)
    cost_center_id: int | None = None
    gl_code: str | None = Field(default=None, max_length=40)


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
    max_requests_per_day: int | None = Field(default=None, ge=1, le=10_000)
    key_expires_in_days: int | None = Field(default=None, ge=0, le=365)  # 0 clears expiry
    change_reason: str | None = Field(default=None, max_length=500)
    cost_center_id: int | None = None
    gl_code: str | None = Field(default=None, max_length=40)
    owner_user_id: int | None = None   # the accountable human: any active owner, admin, finance or dept_head


class AgentOwner(BaseModel):
    id: int
    full_name: str


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
    max_requests_per_day: int = 50
    key_prefix: str
    last_active_at: UtcDatetime | None
    key_expires_at: UtcDatetime | None = None
    card: dict | None = None   # {id, provider, last4, status, available_balance, credit_limit}
    cost_center_id: int | None = None
    gl_code: str | None = None
    owner_user_id: int | None = None
    owner: AgentOwner | None = None
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
MAX_PURCHASE_HALALAS = 1_000_000_000   # SAR 10,000,000: nothing an AI employee asks for is bigger than this


class PurchaseIn(BaseModel):
    amount: int = Field(gt=0, le=MAX_PURCHASE_HALALAS, description="halalas")
    merchant: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=2000)
    card_id: int | None = None

    @field_validator("merchant")
    @classmethod
    def _merchant_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("merchant must not be blank")
        return v.strip()


class ApprovedBy(BaseModel):
    id: int
    full_name: str
    role: str | None = None            # role the approval counted as (chain steps)
    step: int | None = None            # 1-based chain step, None for the plain two-person rule
    at: str | None = None
    on_behalf_of: dict | None = None   # {"id", "full_name"} when a delegate acted for someone


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
    flags: list[str] = []                  # anomaly flags (app.core.velocity); informational, never change the verdict
    transaction_id: int | None
    approved_by: ApprovedBy | None
    approvals: list[ApprovedBy] = []       # for the two-person rule
    needs_second_approver: bool = False
    approval_note: str | None
    created_at: UtcDatetime
    decided_at: UtcDatetime | None


class ApprovalIn(BaseModel):
    note: str | None = None
    password: str | None = None   # required when company.require_password_on_approve


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
    fee: int = 0
    fee_rate_bps: int = 0
    vat_amount: int = 0
    vat_rate_bps: int = 0
    cost_center_id: int | None = None
    gl_code: str | None = None
    period: str | None = None
    locked: bool = False
    agent_name: str | None = None
    # What the issuer moved (Lithic sandbox cards are USD cents; mock cards record SAR at 1.0)
    issuer_amount: int | None = None
    issuer_currency: str = "USD"
    fx_rate: float = 3.75
    # The one human accountable for this money
    accountable: Accountable | None = None
    accountable_reason: str | None = None   # approved | auto_under_limits
    approved_by: list[ApprovedBy] = []     # every human who approved a step of the request
    created_at: UtcDatetime


class Accountable(BaseModel):
    id: int
    full_name: str
    role: str | None = None


# ---------- notifications ----------
class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: str
    request_id: int | None = None
    url: str | None = None
    created_at: UtcDatetime
    read: bool = False


class NotificationsReadIn(BaseModel):
    ids: list[int] | None = None
    all: bool = False


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
    agent_id: int | None = None
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

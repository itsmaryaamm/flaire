"""Database models. All money is stored as integer halalas (1 SAR = 100 halalas)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _default_require_2fa() -> bool:
    from app.core.config import get_settings
    return bool(get_settings().require_2fa_for_new_companies)


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    currency: Mapped[str] = mapped_column(String(3), default="SAR")
    kill_switch: Mapped[bool] = mapped_column(Boolean, default=False)
    kill_switch_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    engine: Mapped[str] = mapped_column(String(20), default="native")  # native | shotoku
    # Security controls (server-enforced, never by the AI)
    require_password_on_approve: Mapped[bool] = mapped_column(Boolean, default=True)
    two_person_threshold: Mapped[int] = mapped_column(Integer, default=250_000)  # halalas; approvals at/above need 2 different humans
    kill_switch_frozen_cards: Mapped[list] = mapped_column(JSON, default=list)
    # Finance policy: trusted suppliers pay without category checks (still within limits); unknown suppliers get a look first.
    trusted_merchants: Mapped[list] = mapped_column(JSON, default=list)
    new_merchant_review_from: Mapped[int] = mapped_column(Integer, default=20_000)  # halalas; 0 disables new-merchant review
    notify_threshold: Mapped[int] = mapped_column(Integer, default=0)  # halalas; push/email approvers only for holds at/above this
    lithic_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # encrypted, entered in Settings → Payments
    lithic_asa_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # ASA HMAC secret, encrypted
    lithic_asa_enrolled: Mapped[bool] = mapped_column(Boolean, default=False)
    lithic_asa_error: Mapped[str | None] = mapped_column(String(300), nullable=True)   # last automatic enrollment failure, if any
    lithic_environment: Mapped[str | None] = mapped_column(String(12), nullable=True)  # sandbox | production, detected when the key is saved
    fee_rate_bps: Mapped[int] = mapped_column(Integer, default=15)  # Flaire fee: 0.15% of every settled transaction
    require_2fa_for_approvers: Mapped[bool] = mapped_column(Boolean, default=False)
    # Mandatory 2FA for every member. New companies default to on (REQUIRE_2FA_FOR_NEW_COMPANIES); see security.get_current_user.
    require_2fa_for_all: Mapped[bool] = mapped_column(Boolean, default=lambda: _default_require_2fa())
    onboarding_done: Mapped[bool] = mapped_column(Boolean, default=False)
    # Enterprise
    vat_rate_bps: Mapped[int] = mapped_column(Integer, default=1500)      # 15% KSA VAT, recorded on each transaction
    vat_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    fiscal_year_start_month: Mapped[int] = mapped_column(Integer, default=1)
    budget_rollover: Mapped[bool] = mapped_column(Boolean, default=False)  # unspent department budget carries to next month
    require_change_approval: Mapped[bool] = mapped_column(Boolean, default=False)  # limit/policy changes need a second admin
    policy_version: Mapped[int] = mapped_column(Integer, default=0)
    locale: Mapped[str] = mapped_column(String(5), default="en")  # en | ar
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list[User]] = relationship(back_populates="company")
    departments: Mapped[list[Department]] = relationship(back_populates="company")
    agents: Mapped[list[Agent]] = relationship(back_populates="company")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"), nullable=True)  # None until onboarding is done
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(200), default="")  # empty when identity lives in Supabase
    supabase_uid: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(30), default="owner")  # owner | admin | finance | dept_head | viewer | auditor
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)  # home department (dept_head)
    locale: Mapped[str] = mapped_column(String(5), default="en")
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | disabled
    totp_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    company: Mapped[Company | None] = relationship(back_populates="users")


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    name: Mapped[str] = mapped_column(String(120))
    monthly_budget: Mapped[int] = mapped_column(Integer, default=0)
    spent_this_period: Mapped[int] = mapped_column(Integer, default=0)
    period_start: Mapped[date] = mapped_column(Date, default=lambda: date.today().replace(day=1))
    spending_paused: Mapped[bool] = mapped_column(Boolean, default=False)  # department-level kill switch
    cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_centers.id"), nullable=True)
    gl_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    rollover_balance: Mapped[int] = mapped_column(Integer, default=0)  # carried from previous period when rollover is on

    company: Mapped[Company] = relationship(back_populates="departments")
    agents: Mapped[list[Agent]] = relationship(back_populates="department")

    @property
    def remaining(self) -> int:
        return max(self.monthly_budget + (self.rollover_balance or 0) - self.spent_this_period, 0)


class Agent(Base):
    """An AI employee. It can request purchases with its API key but can never approve them."""
    __tablename__ = "agents"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(60), default="general")  # marketing | procurement | operations | general
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | paused
    api_key_hash: Mapped[str] = mapped_column(String(200), index=True)
    key_prefix: Mapped[str] = mapped_column(String(16))
    per_transaction_limit: Mapped[int] = mapped_column(Integer, default=100_000)
    monthly_limit: Mapped[int] = mapped_column(Integer, default=500_000)
    spent_this_period: Mapped[int] = mapped_column(Integer, default=0)
    approval_threshold: Mapped[int] = mapped_column(Integer, default=100_000)
    allowed_categories: Mapped[list] = mapped_column(JSON, default=list)
    blocked_merchants: Mapped[list] = mapped_column(JSON, default=list)
    max_requests_per_hour: Mapped[int] = mapped_column(Integer, default=10)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    key_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # connector link expiry
    card_id: Mapped[int | None] = mapped_column(ForeignKey("cards.id"), nullable=True)  # this employee's own card
    cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_centers.id"), nullable=True)
    gl_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    max_requests_per_day: Mapped[int] = mapped_column(Integer, default=50)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)  # the accountable human (defaults to the creator)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    company: Mapped[Company] = relationship(back_populates="agents")
    department: Mapped[Department] = relationship(back_populates="agents")
    owner: Mapped[User | None] = relationship(foreign_keys=[owner_user_id])


class Card(Base):
    """A simulated payment card. provider = mock_snb | mock_rajhi | mock_riyad | lithic."""
    __tablename__ = "cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    agent_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)  # owner employee (one card per AI employee)
    label: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(30))
    last4: Mapped[str] = mapped_column(String(4))
    currency: Mapped[str] = mapped_column(String(3), default="SAR")
    credit_limit: Mapped[int] = mapped_column(Integer, default=0)
    available_balance: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | frozen
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    provider_token: Mapped[str | None] = mapped_column(String(200), nullable=True)  # Lithic card token
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PurchaseRequest(Base):
    __tablename__ = "purchase_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"), index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    card_id: Mapped[int | None] = mapped_column(ForeignKey("cards.id"), nullable=True)
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="SAR")
    merchant: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text, default="")
    # approved | pending_approval | denied | completed | failed | rejected
    status: Mapped[str] = mapped_column(String(30), index=True)
    decision: Mapped[dict] = mapped_column(JSON, default=dict)
    transaction_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    policy_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approval_rule_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approval_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    agent: Mapped[Agent] = relationship()
    department: Mapped[Department] = relationship()
    approved_by: Mapped[User | None] = relationship()


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    purchase_request_id: Mapped[int] = mapped_column(ForeignKey("purchase_requests.id"))
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"))
    provider: Mapped[str] = mapped_column(String(30))
    provider_ref: Mapped[str] = mapped_column(String(200))
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="SAR")
    merchant: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20))  # authorized | settled | declined | reversed
    decline_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    fee: Mapped[int] = mapped_column(Integer, default=0)            # Flaire fee in halalas (company.fee_rate_bps of amount)
    fee_rate_bps: Mapped[int] = mapped_column(Integer, default=15)
    vat_amount: Mapped[int] = mapped_column(Integer, default=0)      # VAT portion of amount (amount is VAT inclusive)
    vat_rate_bps: Mapped[int] = mapped_column(Integer, default=1500)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gl_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    period: Mapped[str | None] = mapped_column(String(7), nullable=True, index=True)  # YYYY-MM
    locked: Mapped[bool] = mapped_column(Boolean, default=False)      # set by period close
    # What the issuer actually moved. Flaire amounts are SAR halalas; Lithic sandbox cards are USD cents (amount / fx_rate).
    issuer_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    issuer_currency: Mapped[str] = mapped_column(String(3), default="USD")
    fx_rate: Mapped[float] = mapped_column(Float, default=3.75)
    # The one human accountable for this money: the approver, or the employee's owner for auto-approved purchases.
    accountable_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    accountable_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)  # approved | auto_under_limits
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    card: Mapped[Card] = relationship()
    accountable: Mapped[User | None] = relationship(foreign_keys=[accountable_user_id])


class AgentRun(Base):
    """One task given to a Claude AI employee, with the full transcript."""
    __tablename__ = "agent_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"), index=True)
    task: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(20))  # claude | scripted
    transcript: Mapped[list] = mapped_column(JSON, default=list)
    purchase_request_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditEntry(Base):
    """Hash-chained, append-only ledger (Shotoku-style). Never update rows here."""
    __tablename__ = "audit_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    actor_type: Mapped[str] = mapped_column(String(10))  # user | agent | system
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_name: Mapped[str] = mapped_column(String(200))
    event: Mapped[str] = mapped_column(String(80), index=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(80))
    hash: Mapped[str] = mapped_column(String(80))


class WebhookEvent(Base):
    """Processed provider webhooks, keyed by the provider's event id so duplicate deliveries are ignored."""
    __tablename__ = "webhook_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(30), index=True)
    event_id: Mapped[str] = mapped_column(String(120), index=True)
    event_type: Mapped[str] = mapped_column(String(120))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PushSubscription(Base):
    """Browser/phone push subscription for a dashboard user (installed Flaire app)."""
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Notification(Base):
    """In-app feed item for one user: a hold to act on, a decision on a hold they approved, a policy change waiting for them,
    an accepted invite or a kill switch event. Created at the same points push and email go out."""
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    type: Mapped[str] = mapped_column(String(30), index=True)  # hold | decision | policy_change | invite_accepted | kill_switch
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    request_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class VapidKey(Base):
    __tablename__ = "vapid_keys"
    id: Mapped[int] = mapped_column(primary_key=True)
    private_pem: Mapped[str] = mapped_column(Text)
    public_key: Mapped[str] = mapped_column(String(200))


class OAuthClient(Base):
    __tablename__ = "oauth_clients"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    client_name: Mapped[str] = mapped_column(String(120))
    redirect_uris: Mapped[list] = mapped_column(JSON, default=list)
    token_endpoint_auth_method: Mapped[str] = mapped_column(String(30), default="none")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OAuthCode(Base):
    __tablename__ = "oauth_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    client_id: Mapped[str] = mapped_column(String(300))
    redirect_uri: Mapped[str] = mapped_column(Text)
    code_challenge: Mapped[str] = mapped_column(String(200))
    scope: Mapped[str] = mapped_column(String(100), default="purchases")
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"))
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OAuthToken(Base):
    """A connected Claude (or other MCP client) acting as one AI employee. Revocable from the dashboard."""
    __tablename__ = "oauth_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    access_hash: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    refresh_hash: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    client_id: Mapped[str] = mapped_column(String(300))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"), index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    scope: Mapped[str] = mapped_column(String(100), default="purchases")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Enterprise layer: teams, approval chains, finance, policy versioning
# ---------------------------------------------------------------------------

ROLES = ("owner", "admin", "finance", "dept_head", "viewer", "auditor")


class Invite(Base):
    """Email invite to join a company with a role. Token is hashed; accepted once."""
    __tablename__ = "invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    email: Mapped[str] = mapped_column(String(200), index=True)
    role: Mapped[str] = mapped_column(String(30), default="viewer")
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)  # for dept_head
    token_hash: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    invited_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Membership(Base):
    """Department scope for a user (dept_head or viewer limited to departments). Users without rows see the whole company if their role allows."""
    __tablename__ = "memberships"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"), index=True)


class ApprovalRule(Base):
    """Approval chain step. Ordered by min_amount; the highest matching rule for the amount applies.
    steps example: [{"role": "dept_head", "count": 1}, {"role": "finance", "count": 2}]  all steps must be satisfied in order."""
    __tablename__ = "approval_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)  # None = company-wide
    min_amount: Mapped[int] = mapped_column(Integer, default=0)  # halalas, inclusive
    steps: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Delegation(Base):
    """While active, `delegate` may approve on behalf of `user` (out of office)."""
    __tablename__ = "delegations"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    delegate_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CostCenter(Base):
    __tablename__ = "cost_centers"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    gl_code: Mapped[str | None] = mapped_column(String(40), nullable=True)  # default GL account
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Attachment(Base):
    """Receipt or invoice attached to a transaction. Stored as bytes (small) in DB for now; S3 later."""
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id"), index=True)
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(80))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PeriodClose(Base):
    """Month-end close. Once closed, transactions in that month are locked (no edits, no new attachments) and a statement snapshot is stored."""
    __tablename__ = "period_closes"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)  # YYYY-MM
    closed_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    statement: Mapped[dict] = mapped_column(JSON, default=dict)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FeeInvoice(Base):
    """Flaire's monthly VAT invoice to the company for its fees (ZATCA simplified format)."""
    __tablename__ = "fee_invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)
    number: Mapped[str] = mapped_column(String(40), unique=True)
    subtotal: Mapped[int] = mapped_column(Integer)      # fees excl. VAT, halalas
    vat: Mapped[int] = mapped_column(Integer)           # 15%
    total: Mapped[int] = mapped_column(Integer)
    transaction_count: Mapped[int] = mapped_column(Integer)
    qr_payload: Mapped[str] = mapped_column(Text)       # ZATCA TLV base64
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PolicyVersion(Base):
    """Immutable snapshot of a company's spending policy (limits, thresholds, trusted suppliers, approval rules, agent limits).
    Every purchase decision records the policy_version_id it was judged against."""
    __tablename__ = "policy_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    hash: Mapped[str] = mapped_column(String(80))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    change_summary: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PolicyChange(Base):
    """A proposed change to limits/policy that needs a second admin before it applies (four-eyes on the rules themselves)."""
    __tablename__ = "policy_changes"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(30))   # company | agent | department | approval_rule
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    changes: Mapped[dict] = mapped_column(JSON, default=dict)  # {field: {"from": x, "to": y}}
    reason: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending | approved | rejected | applied | cancelled
    proposed_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    policy_version_id: Mapped[int | None] = mapped_column(ForeignKey("policy_versions.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

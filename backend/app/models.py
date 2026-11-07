"""Database models. All money is stored as integer halalas (1 SAR = 100 halalas)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list[User]] = relationship(back_populates="company")
    departments: Mapped[list[Department]] = relationship(back_populates="company")
    agents: Mapped[list[Agent]] = relationship(back_populates="company")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(30), default="owner")  # owner | finance | viewer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    company: Mapped[Company] = relationship(back_populates="users")


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    name: Mapped[str] = mapped_column(String(120))
    monthly_budget: Mapped[int] = mapped_column(Integer, default=0)
    spent_this_period: Mapped[int] = mapped_column(Integer, default=0)
    period_start: Mapped[date] = mapped_column(Date, default=lambda: date.today().replace(day=1))
    spending_paused: Mapped[bool] = mapped_column(Boolean, default=False)  # department-level kill switch

    company: Mapped[Company] = relationship(back_populates="departments")
    agents: Mapped[list[Agent]] = relationship(back_populates="department")

    @property
    def remaining(self) -> int:
        return max(self.monthly_budget - self.spent_this_period, 0)


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    company: Mapped[Company] = relationship(back_populates="agents")
    department: Mapped[Department] = relationship(back_populates="agents")


class Card(Base):
    """A simulated payment card. provider = mock_snb | mock_rajhi | mock_riyad | lithic."""
    __tablename__ = "cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    card: Mapped[Card] = relationship()


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

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)

if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401  (register tables)
    Base.metadata.create_all(bind=engine)
    _migrate()


# Columns added after the first release. create_all() does not alter existing tables, so add them here.
_NEW_COLUMNS = {
    "companies": [("require_password_on_approve", "BOOLEAN DEFAULT 1"), ("two_person_threshold", "INTEGER DEFAULT 250000"), ("kill_switch_frozen_cards", "JSON NULL"),
                  ("trusted_merchants", "JSON NULL"), ("new_merchant_review_from", "INTEGER DEFAULT 20000"),
                  ("notify_threshold", "INTEGER DEFAULT 0"), ("lithic_api_key_enc", "TEXT NULL"), ("require_2fa_for_approvers", "BOOLEAN DEFAULT 0"), ("onboarding_done", "BOOLEAN DEFAULT 1"),
                  ("lithic_asa_secret_enc", "TEXT NULL"), ("lithic_asa_enrolled", "BOOLEAN DEFAULT 0"), ("fee_rate_bps", "INTEGER DEFAULT 15"),
                  ("vat_rate_bps", "INTEGER DEFAULT 1500"), ("vat_number", "VARCHAR(30) NULL"), ("fiscal_year_start_month", "INTEGER DEFAULT 1"), ("budget_rollover", "BOOLEAN DEFAULT 0"),
                  ("require_change_approval", "BOOLEAN DEFAULT 0"), ("policy_version", "INTEGER DEFAULT 0"), ("locale", "VARCHAR(5) DEFAULT 'en'"),
                  ("require_2fa_for_all", "BOOLEAN DEFAULT 0"), ("lithic_asa_error", "VARCHAR(300) NULL"), ("lithic_environment", "VARCHAR(12) NULL")],
    "cards": [("agent_id", "INTEGER NULL")],
    "transactions": [("fee", "INTEGER DEFAULT 0"), ("fee_rate_bps", "INTEGER DEFAULT 15"), ("vat_amount", "INTEGER DEFAULT 0"), ("vat_rate_bps", "INTEGER DEFAULT 1500"),
                     ("cost_center_id", "INTEGER NULL"), ("gl_code", "VARCHAR(40) NULL"), ("period", "VARCHAR(7) NULL"), ("locked", "BOOLEAN DEFAULT 0"),
                     ("issuer_amount", "INTEGER NULL"), ("issuer_currency", "VARCHAR(3) DEFAULT 'USD'"), ("fx_rate", "FLOAT DEFAULT 3.75"),
                     ("accountable_user_id", "INTEGER NULL"), ("accountable_reason", "VARCHAR(30) NULL")],
    "users": [("totp_secret_enc", "TEXT NULL"), ("totp_enabled", "BOOLEAN DEFAULT 0"), ("supabase_uid", "VARCHAR(64) NULL"),
              ("department_id", "INTEGER NULL"), ("locale", "VARCHAR(5) DEFAULT 'en'"), ("status", "VARCHAR(20) DEFAULT 'active'")],
    "agents": [("key_expires_at", "TIMESTAMP NULL"), ("card_id", "INTEGER NULL"), ("cost_center_id", "INTEGER NULL"), ("gl_code", "VARCHAR(40) NULL"), ("max_requests_per_day", "INTEGER DEFAULT 50"), ("owner_user_id", "INTEGER NULL")],
    "departments": [("spending_paused", "BOOLEAN DEFAULT 0"), ("cost_center_id", "INTEGER NULL"), ("gl_code", "VARCHAR(40) NULL"), ("rollover_balance", "INTEGER DEFAULT 0")],
    "purchase_requests": [("policy_version_id", "INTEGER NULL"), ("approval_rule_id", "INTEGER NULL")],
}


def _migrate() -> None:
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    is_pg = engine.dialect.name == "postgresql"
    added: set[tuple[str, str]] = set()
    with engine.begin() as conn:
        for table, cols in _NEW_COLUMNS.items():
            if table not in insp.get_table_names():
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name in existing:
                    continue
                ddl_pg = ddl.replace("BOOLEAN DEFAULT 1", "BOOLEAN DEFAULT TRUE").replace("BOOLEAN DEFAULT 0", "BOOLEAN DEFAULT FALSE").replace("TIMESTAMP NULL", "TIMESTAMPTZ NULL")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl_pg if is_pg else ddl}"))
                added.add((table, name))
        # Ops migration: the column lands as FALSE so nobody is locked out mid-deploy, then every existing company is moved to
        # mandatory 2FA. Members without TOTP can still reach /auth/2fa/* to enrol (see security.TOTP_OK_PATHS).
        if ("companies", "require_2fa_for_all") in added:
            conn.execute(text("UPDATE companies SET require_2fa_for_all = " + ("TRUE" if is_pg else "1")))
        # Older agents had no accountable owner: give them the company's first owner.
        if ("agents", "owner_user_id") in added:
            conn.execute(text("UPDATE agents SET owner_user_id = (SELECT MIN(u.id) FROM users u WHERE u.company_id = agents.company_id AND u.role = 'owner') WHERE owner_user_id IS NULL"))
        if is_pg and "users" in insp.get_table_names():
            conn.execute(text("ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL"))
            conn.execute(text("ALTER TABLE users ALTER COLUMN password_hash SET DEFAULT ''"))
        # Backfill NULL JSON lists so older rows load cleanly.
        for table, col in (("companies", "trusted_merchants"), ("companies", "kill_switch_frozen_cards"), ("agents", "allowed_categories"), ("agents", "blocked_merchants")):
            if table in insp.get_table_names() and col in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"UPDATE {table} SET {col} = '[]' WHERE {col} IS NULL"))

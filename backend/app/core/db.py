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
                  ("notify_threshold", "INTEGER DEFAULT 0"), ("lithic_api_key_enc", "TEXT NULL")],
    "agents": [("key_expires_at", "TIMESTAMP NULL")],
    "departments": [("spending_paused", "BOOLEAN DEFAULT 0")],
}


def _migrate() -> None:
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    is_pg = engine.dialect.name == "postgresql"
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

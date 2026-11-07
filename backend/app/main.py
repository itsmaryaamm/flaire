from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.account import router as account_router
from app.api.asa import router as asa_router
from app.api.auth_extra import router as auth_extra_router
from app.api.mcp import router as mcp_router
from app.api.oauth import router as oauth_router, well_known
from app.api.routes import router
from app.api.webhooks import router as webhooks_router
from app.core.config import get_settings
from app.core.db import init_db
from app.core.guard import SecurityHeadersMiddleware

settings = get_settings()

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    _run_ops_tasks()
    yield


def _run_ops_tasks() -> None:
    """Operator maintenance driven by environment variables (free hosting has no shell)."""
    email = (settings.ops_delete_user_email or "").strip().lower()
    if not email:
        return
    from app.api.account import _delete_company
    from app.core.db import SessionLocal
    from app.models import User
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"[ops] delete-user: no account for {email}", flush=True)
            return
        others = db.query(User).filter(User.company_id == user.company_id, User.role == "owner", User.id != user.id).count() if user.company_id else 0
        if user.company_id and user.role == "owner" and others == 0:
            _delete_company(db, user.company_id)
            print(f"[ops] delete-user: removed {email} and its company", flush=True)
        else:
            db.query(User).filter(User.id == user.id).delete()
            print(f"[ops] delete-user: removed {email}", flush=True)
        db.commit()
    finally:
        db.close()


app = FastAPI(
    lifespan=lifespan,
    title="Flaire API",
    version="0.2.0",
    description="The finance department for AI employees. Agents request, Flaire authorizes, simulated banks pay.",
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_origin_regex=r"https://.*\.vercel\.app",
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(router, prefix="/api/v1")
app.include_router(auth_extra_router, prefix="/api/v1")
app.include_router(account_router, prefix="/api/v1")
app.include_router(asa_router, prefix="/api/v1")
app.include_router(mcp_router, prefix="/api/v1")
app.include_router(webhooks_router, prefix="/api/v1")
app.include_router(oauth_router, prefix="/api/v1")
app.include_router(well_known)


@app.get("/api/v1/health", tags=["health"])
def health():
    return {"status": "ok", "engine": settings.auth_engine, "payments": ["mock_snb", "mock_rajhi", "mock_riyad"] + (["lithic"] if settings.lithic_enabled else []),
            "claude": settings.claude_enabled, "env": settings.env, "auth": "supabase" if (settings.supabase_url and settings.supabase_anon_key) else "builtin"}


@app.get("/")
def root():
    return {"name": "Flaire API", "docs": "/docs", "health": "/api/v1/health"}

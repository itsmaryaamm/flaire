from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.mcp import router as mcp_router
from app.api.routes import router
from app.core.config import get_settings
from app.core.db import init_db

settings = get_settings()

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="Flaire API",
    version="0.2.0",
    description="The finance department for AI employees. Agents request, Flaire authorizes, simulated banks pay.",
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_origin_regex=r"https://.*\.vercel\.app",
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router, prefix="/api/v1")
app.include_router(mcp_router, prefix="/api/v1")


@app.get("/api/v1/health", tags=["health"])
def health():
    return {"status": "ok", "engine": settings.auth_engine, "payments": ["mock_snb", "mock_rajhi", "mock_riyad"] + (["lithic"] if settings.lithic_enabled else []),
            "claude": settings.claude_enabled, "env": settings.env}


@app.get("/")
def root():
    return {"name": "Flaire API", "docs": "/docs", "health": "/api/v1/health"}

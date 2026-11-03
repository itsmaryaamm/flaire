"""Flaire backend configuration. Everything comes from environment variables (see .env.example)."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Flaire"
    env: str = "dev"  # dev | test | prod

    # Database. SQLite by default so the demo runs with zero setup. Render/Neon/Supabase give a postgres:// URL.
    database_url: str = "sqlite:///./flaire.db"

    # Auth
    jwt_secret: str = "change-me-in-production-please"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12

    # CORS (comma separated). Add your Vercel URL in production.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Authorization engine: "native" (Python, Shotoku-style) or "shotoku" (real @shotoku/core via sidecar)
    auth_engine: str = "native"
    shotoku_service_url: str = "http://localhost:8788"
    # Shared secret for Shotoku-format signed receipts. The payment service refuses to pay without a valid receipt.
    receipt_secret: str = "flaire-dev-receipt-secret"
    receipt_ttl_seconds: int = 300

    # Claude AI employees
    anthropic_api_key: str | None = None
    claude_model: str = "claude-sonnet-4-5"

    # Lithic sandbox (optional). Get a sandbox key at https://dashboard.lithic.com
    lithic_api_key: str | None = None
    lithic_base_url: str = "https://sandbox.lithic.com/v1"
    lithic_webhook_secret: str | None = None

    # Approval notifications (optional). Without SMTP the notification is recorded in the ledger only.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    dashboard_url: str = "http://localhost:5173"
    # Web push (optional; generated and stored on first boot if absent)
    vapid_private_key: str | None = None
    vapid_public_key: str | None = None  # "whsec_..." from the Lithic dashboard webhook settings

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def claude_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def lithic_enabled(self) -> bool:
        return bool(self.lithic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()

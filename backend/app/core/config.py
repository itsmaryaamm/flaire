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
    app_encryption_key: str | None = None  # for per-company secrets (payment keys); defaults to JWT_SECRET
    api_base_url: str = "http://localhost:8000"  # public URL of this API, used in OAuth metadata and connector links

    # One-time maintenance: delete this account (and its company if sole owner) at startup, then unset the variable.
    ops_delete_user_email: str | None = None

    # Supabase Auth (optional). When set, identity moves to Supabase; Flaire keeps roles, companies and 2FA.
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    supabase_jwt_secret: str | None = None

    # Claude AI employees
    anthropic_api_key: str | None = None
    claude_model: str = "claude-sonnet-4-5"

    # Lithic sandbox (optional). Get a sandbox key at https://dashboard.lithic.com
    lithic_api_key: str | None = None
    lithic_base_url: str = "https://sandbox.lithic.com/v1"
    lithic_webhook_secret: str | None = None
    # Flaire amounts are SAR; Lithic sandbox cards are USD. Halalas are converted to cents at this rate before the issuer is called.
    fx_sar_usd: float = 3.75

    # Platform owner console (GET /platform/*): comma separated emails that may read cross-company metrics.
    platform_admin_emails: str = ""
    # Mandatory 2FA for every member of a company. Applies to companies created from now on; existing ones keep their flag.
    require_2fa_for_new_companies: bool = True

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
    def platform_admin_list(self) -> list[str]:
        return [e.strip().lower() for e in self.platform_admin_emails.split(",") if e.strip()]

    @property
    def claude_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def lithic_enabled(self) -> bool:
        return bool(self.lithic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()

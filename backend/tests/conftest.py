"""Shared test environment. Loaded before any test module imports the app.

Mandatory 2FA defaults to ON for new companies in production (REQUIRE_2FA_FOR_NEW_COMPANIES). The suites create companies
without TOTP, so the default is switched off here; tests/test_platform_2fa.py enables it per company to check the gate.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_flaire.db")
os.environ.setdefault("ANTHROPIC_API_KEY", "")
os.environ.setdefault("AUTH_ENGINE", "native")
os.environ["REQUIRE_2FA_FOR_NEW_COMPANIES"] = "0"
os.environ["PLATFORM_ADMIN_EMAILS"] = "platform@flaire.sa"

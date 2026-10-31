"""Lithic sandbox adapter.

Tests a real card-issuer sandbox: creates virtual cards and simulates authorization + clearing events through
Lithic's /simulate endpoints. This is a separate rail from the mock Saudi banks and is NOT presented as control
over an existing Saudi bank card. Lithic sandbox amounts are USD cents; Flaire passes SAR halalas 1:1 for
demonstration and labels the card accordingly.

Needs LITHIC_API_KEY (sandbox key from https://dashboard.lithic.com). Without it every call declines with a
clear reason, so the rest of Flaire keeps working.

Endpoints used (https://docs.lithic.com):
  POST /v1/cards                 create a VIRTUAL card
  POST /v1/simulate/authorize    simulate a merchant authorization (needs the card PAN; sandbox returns it)
  POST /v1/simulate/clearing     simulate clearing/settlement of that authorization
  GET  /v1/cards/{token}         read card state
"""
from __future__ import annotations

import json

import httpx

from app.core.config import get_settings
from app.integrations.payments.base import PaymentResult
from app.models import Card


class LithicAdapter:
    provider = "lithic"

    def __init__(self) -> None:
        self.settings = get_settings()
        self.enabled = self.settings.lithic_enabled
        self.base = self.settings.lithic_base_url.rstrip("/")

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.base, headers={"Authorization": self.settings.lithic_api_key or "", "Content-Type": "application/json"}, timeout=20)

    def create_card(self, label: str, credit_limit: int, currency: str) -> dict:
        if not self.enabled:
            raise RuntimeError("LITHIC_API_KEY is not configured. Add a sandbox key to .env to create Lithic cards.")
        with self._client() as c:
            r = c.post("/cards", json={"type": "VIRTUAL", "memo": label, "spend_limit": credit_limit, "spend_limit_duration": "MONTHLY", "state": "OPEN"})
            r.raise_for_status()
            data = r.json()
        token = json.dumps({"token": data["token"], "pan": data.get("pan")})
        return {"last4": data.get("last_four", "0000"), "provider_token": token, "available_balance": credit_limit}

    def _ids(self, card: Card) -> dict:
        try:
            return json.loads(card.provider_token or "{}")
        except json.JSONDecodeError:
            return {}

    def authorize(self, card: Card, amount: int, merchant: str, descriptor: str) -> PaymentResult:
        if not self.enabled:
            return PaymentResult(False, "declined", "lithic_disabled", "LITHIC_API_KEY not configured")
        if card.status != "active":
            return PaymentResult(False, "declined", "lithic_frozen", f"Card is {card.status}")
        ids = self._ids(card)
        if not ids.get("pan"):
            return PaymentResult(False, "declined", "lithic_no_pan", "Card has no sandbox PAN stored")
        with self._client() as c:
            r = c.post("/simulate/authorize", json={"descriptor": descriptor[:25] or merchant[:25], "pan": ids["pan"], "amount": amount})
            data = r.json()
            if r.status_code >= 400:
                return PaymentResult(False, "declined", "lithic_error", data.get("message", "Lithic error"), raw=data)
            auth_token = data.get("token", "")
            if not auth_token:
                return PaymentResult(False, "declined", "lithic_no_token", "Lithic did not return an authorization token", raw=data)
            # Clear it straight away so the demo shows a settled transaction.
            cr = c.post("/simulate/clearing", json={"token": auth_token, "amount": amount})
            settled = cr.status_code < 400
        card.available_balance = max(card.available_balance - amount, 0)
        return PaymentResult(True, "settled" if settled else "authorized", auth_token, raw=data)

    def settle(self, card: Card, provider_ref: str, amount: int) -> PaymentResult:
        with self._client() as c:
            r = c.post("/simulate/clearing", json={"token": provider_ref, "amount": amount})
            return PaymentResult(r.status_code < 400, "settled" if r.status_code < 400 else "authorized", provider_ref)

    def balance(self, card: Card) -> int:
        return card.available_balance

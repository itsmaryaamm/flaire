"""Lithic sandbox adapter.

Tests a real card-issuer sandbox: creates virtual cards and simulates authorization + clearing events through
Lithic's /simulate endpoints. This is a separate rail from the mock Saudi banks and is NOT presented as control
over an existing Saudi bank card. Lithic sandbox amounts are USD cents; Flaire passes SAR halalas 1:1 for
demonstration and labels the card accordingly. Not suitable for real money as is.

Security notes
  * Flaire never stores a card number (PAN). Only the Lithic card token is stored; the sandbox PAN needed by
    /simulate/authorize is fetched at the moment of use and discarded.
  * Card creation sends an Idempotency-Key so a retry cannot create two cards.
  * Webhooks (see app/api/webhooks.py) are verified with the Standard Webhooks HMAC scheme Lithic uses, with a
    5 minute timestamp window and duplicate-event protection.

Needs LITHIC_API_KEY (sandbox key from https://dashboard.lithic.com). Without it every call declines with a
clear reason, so the rest of Flaire keeps working.

Endpoints used (https://docs.lithic.com):
  POST  /v1/cards                 create a VIRTUAL card (Idempotency-Key header)
  GET   /v1/cards/{token}         read card state (sandbox returns pan)
  PATCH /v1/cards/{token}         state OPEN | PAUSED
  POST  /v1/simulate/authorize    simulate a merchant authorization
  POST  /v1/simulate/clearing     simulate clearing/settlement
"""
from __future__ import annotations

import uuid

import httpx

from app.core.config import get_settings
from app.integrations.payments.base import PaymentResult
from app.models import Card


class LithicAdapter:
    provider = "lithic"

    def __init__(self, api_key: str | None = None) -> None:
        """api_key: the company's own key from Settings → Payments; falls back to LITHIC_API_KEY in the environment."""
        self.settings = get_settings()
        self.api_key = api_key or self.settings.lithic_api_key
        self.enabled = bool(self.api_key)
        self.base = self.settings.lithic_base_url.rstrip("/")

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.base, headers={"Authorization": self.api_key or "", "Content-Type": "application/json"}, timeout=20)

    # ---------------- cards ----------------
    def create_card(self, label: str, credit_limit: int, currency: str) -> dict:
        if not self.enabled:
            raise RuntimeError("No Lithic key. Add your Lithic sandbox API key in Settings → Payments first.")
        with self._client() as c:
            r = c.post("/cards", headers={"Idempotency-Key": str(uuid.uuid4())},
                       json={"type": "VIRTUAL", "memo": label[:50], "spend_limit": credit_limit, "spend_limit_duration": "MONTHLY", "state": "OPEN"})
            r.raise_for_status()
            data = r.json()
        # Store the token only. Never the PAN.
        return {"last4": data.get("last_four", "0000"), "provider_token": data["token"], "available_balance": credit_limit}

    def _pan(self, c: httpx.Client, card: Card) -> str | None:
        r = c.get(f"/cards/{card.provider_token}")
        if r.status_code >= 400:
            return None
        return r.json().get("pan")

    def set_state(self, card: Card, state: str) -> None:
        """OPEN or PAUSED. Used by the kill switch. A CLOSED card cannot be reopened, so Flaire never closes."""
        if not self.enabled or not card.provider_token:
            return
        with self._client() as c:
            r = c.patch(f"/cards/{card.provider_token}", json={"state": state})
            r.raise_for_status()

    def set_spend_limit(self, card: Card, limit: int) -> None:
        if not self.enabled or not card.provider_token:
            return
        with self._client() as c:
            r = c.patch(f"/cards/{card.provider_token}", json={"spend_limit": limit, "spend_limit_duration": "MONTHLY"})
            r.raise_for_status()

    # ---------------- payments ----------------
    def authorize(self, card: Card, amount: int, merchant: str, descriptor: str) -> PaymentResult:
        if not self.enabled:
            return PaymentResult(False, "declined", "lithic_disabled", "No Lithic key configured for this company")
        if card.status != "active":
            return PaymentResult(False, "declined", "lithic_frozen", f"Card is {card.status}")
        with self._client() as c:
            pan = self._pan(c, card)
            if not pan:
                return PaymentResult(False, "declined", "lithic_no_pan", "Could not read the sandbox card from Lithic")
            r = c.post("/simulate/authorize", json={"descriptor": (descriptor or merchant)[:25], "pan": pan, "amount": amount})
            del pan
            data = r.json() if r.content else {}
            if r.status_code >= 400:
                return PaymentResult(False, "declined", "lithic_error", data.get("message", f"Lithic error {r.status_code}"), raw=data)
            auth_token = data.get("token", "")
            if not auth_token:
                return PaymentResult(False, "declined", "lithic_no_token", "Lithic did not return an authorization token", raw=data)
            settled, clearing_error = self._clear(c, auth_token, amount)
        card.available_balance = max(card.available_balance - amount, 0)
        raw = {**data, "clearing_error": clearing_error} if clearing_error else data
        return PaymentResult(True, "settled" if settled else "authorized", auth_token, raw=raw)

    def _clear(self, c: httpx.Client, auth_token: str, amount: int) -> tuple[bool, str | None]:
        """Simulate clearing with retries: the sandbox sometimes needs a moment after the authorization exists."""
        import time
        last = None
        for delay in (0.0, 0.8, 2.0, 4.0):
            if delay:
                time.sleep(delay)
            cr = c.post("/simulate/clearing", json={"token": auth_token, "amount": amount})
            if cr.status_code < 400:
                return True, None
            try:
                last = f"{cr.status_code}: {cr.json().get('message') or cr.text[:200]}"
            except Exception:
                last = f"{cr.status_code}: {cr.text[:200]}"
        return False, last

    def settle(self, card: Card, provider_ref: str, amount: int) -> PaymentResult:
        if not self.enabled:
            return PaymentResult(False, "authorized", provider_ref, "No Lithic key configured")
        with self._client() as c:
            ok, err = self._clear(c, provider_ref, amount)
        return PaymentResult(ok, "settled" if ok else "authorized", provider_ref, None if ok else err)

    def balance(self, card: Card) -> int:
        return card.available_balance

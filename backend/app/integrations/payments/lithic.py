"""Lithic sandbox adapter.

Tests a real card-issuer sandbox: creates virtual cards and simulates authorization + clearing events through
Lithic's /simulate endpoints. This is a separate rail from the mock Saudi banks and is NOT presented as control
over an existing Saudi bank card. Lithic sandbox amounts are USD cents; Flaire keeps SAR halalas internally and converts
at FX_SAR_USD (default 3.75) before every issuer call: spend limits, authorizations and clearing. The converted amount
and currency are recorded on the Transaction (issuer_amount, issuer_currency, fx_rate). Not suitable for real money as is.

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
        self.issuer_currency = "USD"
        self.fx_rate = float(self.settings.fx_sar_usd or 3.75)

    def to_issuer_amount(self, halalas: int) -> int:
        """SAR halalas to USD cents at FX_SAR_USD. Never below 1 cent for a positive amount."""
        if halalas <= 0:
            return 0
        return max(1, int(round(halalas / self.fx_rate)))

    def _result(self, ok: bool, status: str, ref: str, reason: str | None = None, raw: dict | None = None, halalas: int = 0) -> PaymentResult:
        return PaymentResult(ok, status, ref, reason, raw=raw, issuer_amount=self.to_issuer_amount(halalas), issuer_currency=self.issuer_currency, fx_rate=self.fx_rate)

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.base, headers={"Authorization": self.api_key or "", "Content-Type": "application/json"}, timeout=20)

    # ---------------- cards ----------------
    def create_card(self, label: str, credit_limit: int, currency: str) -> dict:
        if not self.enabled:
            raise RuntimeError("No Lithic key. Add your Lithic sandbox API key in Settings → Payments first.")
        with self._client() as c:
            r = c.post("/cards", headers={"Idempotency-Key": str(uuid.uuid4())},
                       json={"type": "VIRTUAL", "memo": label[:50], "spend_limit": self.to_issuer_amount(credit_limit), "spend_limit_duration": "MONTHLY", "state": "OPEN"})
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
            r = c.patch(f"/cards/{card.provider_token}", json={"spend_limit": self.to_issuer_amount(limit), "spend_limit_duration": "MONTHLY"})
            r.raise_for_status()

    # ---------------- payments ----------------
    def authorize(self, card: Card, amount: int, merchant: str, descriptor: str) -> PaymentResult:
        """amount is SAR halalas; the issuer is called with USD cents."""
        if not self.enabled:
            return self._result(False, "declined", "lithic_disabled", "No Lithic key configured for this company", halalas=amount)
        if card.status != "active":
            return self._result(False, "declined", "lithic_frozen", f"Card is {card.status}", halalas=amount)
        cents = self.to_issuer_amount(amount)
        with self._client() as c:
            pan = self._pan(c, card)
            if not pan:
                return self._result(False, "declined", "lithic_no_pan", "Could not read the sandbox card from Lithic", halalas=amount)
            r = c.post("/simulate/authorize", json={"descriptor": (descriptor or merchant)[:25], "pan": pan, "amount": cents})
            del pan
            data = r.json() if r.content else {}
            if r.status_code >= 400:
                return self._result(False, "declined", "lithic_error", data.get("message", f"Lithic error {r.status_code}"), raw=data, halalas=amount)
            auth_token = data.get("token", "")
            if not auth_token:
                return self._result(False, "declined", "lithic_no_token", "Lithic did not return an authorization token", raw=data, halalas=amount)
            settled, clearing_error = self._clear(c, auth_token, cents)
        card.available_balance = max(card.available_balance - amount, 0)  # Flaire's own balance stays in SAR
        raw = {**data, "clearing_error": clearing_error, "issuer_amount": cents, "issuer_currency": self.issuer_currency} if clearing_error else {**data, "issuer_amount": cents, "issuer_currency": self.issuer_currency}
        return self._result(True, "settled" if settled else "authorized", auth_token, raw=raw, halalas=amount)

    def _clear(self, c: httpx.Client, auth_token: str, amount: int) -> tuple[bool, str | None]:
        """Simulate clearing with retries: the sandbox sometimes needs a moment after the authorization exists. amount is already in cents."""
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
        """amount is SAR halalas; converted to cents for the issuer."""
        if not self.enabled:
            return self._result(False, "authorized", provider_ref, "No Lithic key configured", halalas=amount)
        with self._client() as c:
            ok, err = self._clear(c, provider_ref, self.to_issuer_amount(amount))
        return self._result(ok, "settled" if ok else "authorized", provider_ref, None if ok else err, halalas=amount)

    def balance(self, card: Card) -> int:
        return card.available_balance

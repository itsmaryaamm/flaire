"""Mock Saudi bank cards.

Simulates existing business cards (for example a fictional SNB card with SAR 10,000 available) so the full
Flaire flow can be demonstrated end to end without touching real money. Balances live on the Card row;
authorizations debit immediately and settle in the same call (a real issuer would hold, then clear).

Decline rules mirror what a real issuer does: frozen card, insufficient funds, currency mismatch.
"""
from __future__ import annotations

import secrets

from app.integrations.payments.base import PaymentResult
from app.models import Card

MOCK_PROVIDERS = {
    "mock_snb": {"bank": "Saudi National Bank", "prefix": "snb"},
    "mock_rajhi": {"bank": "Al Rajhi Bank", "prefix": "rajhi"},
    "mock_riyad": {"bank": "Riyad Bank", "prefix": "riyad"},
}


class MockBankAdapter:
    def __init__(self, provider: str) -> None:
        if provider not in MOCK_PROVIDERS:
            raise ValueError(provider)
        self.provider = provider
        self.bank = MOCK_PROVIDERS[provider]["bank"]
        self._prefix = MOCK_PROVIDERS[provider]["prefix"]

    def create_card(self, label: str, credit_limit: int, currency: str) -> dict:
        return {"last4": f"{secrets.randbelow(10_000):04d}", "provider_token": f"{self._prefix}_card_{secrets.token_hex(6)}", "available_balance": credit_limit}

    def authorize(self, card: Card, amount: int, merchant: str, descriptor: str) -> PaymentResult:
        ref = f"{self._prefix}_auth_{secrets.token_hex(6)}"
        if card.status != "active":
            return PaymentResult(False, "declined", ref, f"Card is {card.status}")
        if card.currency != "SAR":
            return PaymentResult(False, "declined", ref, "Currency mismatch")
        if amount > card.available_balance:
            return PaymentResult(False, "declined", ref, f"Insufficient funds (available SAR {card.available_balance / 100:,.2f})")
        card.available_balance -= amount
        return PaymentResult(True, "settled", ref, raw={"bank": self.bank, "merchant": merchant, "descriptor": descriptor})

    def settle(self, card: Card, provider_ref: str, amount: int) -> PaymentResult:
        return PaymentResult(True, "settled", provider_ref)

    def balance(self, card: Card) -> int:
        return card.available_balance

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.models import Card


@dataclass
class PaymentResult:
    ok: bool
    status: str            # authorized | settled | declined
    provider_ref: str
    decline_reason: str | None = None
    raw: dict | None = None
    # What the issuer saw. Flaire amounts are SAR halalas; a USD issuer gets cents (amount / fx_rate).
    issuer_amount: int | None = None
    issuer_currency: str | None = None
    fx_rate: float | None = None


class PaymentAdapter(Protocol):
    provider: str

    def create_card(self, label: str, credit_limit: int, currency: str) -> dict:
        """Returns {last4, provider_token, available_balance}."""
        ...

    def authorize(self, card: Card, amount: int, merchant: str, descriptor: str) -> PaymentResult: ...

    def settle(self, card: Card, provider_ref: str, amount: int) -> PaymentResult: ...

    def balance(self, card: Card) -> int: ...

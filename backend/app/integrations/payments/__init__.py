"""Payment adapters. Flaire's payment service executes ONLY authorizations that carry a valid signed receipt.

- mock_bank.py  Simulated Saudi business cards (SNB, Al Rajhi, Riyad Bank) with SAR balances. Primary demo rail.
- lithic.py     Lithic sandbox adapter: real card-issuer sandbox API + simulated authorization events.
                Never presented as control over an existing Saudi bank card.
"""
from app.integrations.payments.base import PaymentAdapter, PaymentResult
from app.integrations.payments.lithic import LithicAdapter
from app.integrations.payments.mock_bank import MOCK_PROVIDERS, MockBankAdapter


def get_adapter(provider: str, company=None) -> PaymentAdapter:
    if provider == "lithic":
        key = None
        if company is not None and getattr(company, "lithic_api_key_enc", None):
            from app.core.crypto import decrypt
            key = decrypt(company.lithic_api_key_enc)
        return LithicAdapter(api_key=key)
    if provider in MOCK_PROVIDERS:
        return MockBankAdapter(provider)
    raise ValueError(f"Unknown payment provider '{provider}'")


__all__ = ["PaymentAdapter", "PaymentResult", "MockBankAdapter", "LithicAdapter", "get_adapter", "MOCK_PROVIDERS"]

"""Expense categorization. Normalises whatever an agent sent (free text, typos, synonyms) to Flaire's category set,
using the merchant name and description. Keyword rules first; Claude as a fallback when a key is configured and
the rules are unsure. Always returns one of CATEGORIES so budgets and policies stay consistent.
"""
from __future__ import annotations

CATEGORIES = ["advertising", "software", "equipment", "services", "travel", "logistics", "utilities", "office", "gift_card", "crypto", "cash_withdrawal", "other"]

_KEYWORDS: dict[str, list[str]] = {
    "advertising": ["ads", "ad ", "campaign", "marketing", "snapchat", "tiktok", "meta", "facebook", "instagram", "linkedin", "google ads", "billboard", "influencer", "sponsor"],
    "software": ["saas", "subscription", "software", "license", "licence", "canva", "notion", "slack", "aws", "azure", "google cloud", "openai", "anthropic", "github", "figma", "zoom", "hubspot", "adobe", "microsoft 365", "api"],
    "equipment": ["laptop", "macbook", "monitor", "printer", "phone", "iphone", "hardware", "jarir", "extra", "camera", "server", "router", "keyboard"],
    "services": ["consult", "agency", "freelance", "legal", "accounting", "audit", "design service", "translation", "contractor"],
    "travel": ["flight", "hotel", "saudia", "flynas", "uber", "careem", "taxi", "booking", "airbnb", "visa fee", "train"],
    "logistics": ["aramex", "smsa", "dhl", "fedex", "shipping", "parcel", "courier", "delivery", "freight", "warehouse"],
    "utilities": ["electric", "water bill", "stc", "mobily", "zain", "internet", "telecom", "utility"],
    "office": ["office", "stationery", "coffee", "snack", "furniture", "cleaning", "rent", "supplies"],
    "gift_card": ["gift card", "giftcard", "voucher", "prepaid card", "itunes card", "steam card", "google play card"],
    "crypto": ["crypto", "bitcoin", "btc", "eth", "usdt", "binance", "rain.bh", "coinbase"],
    "cash_withdrawal": ["cash", "atm", "withdraw", "money transfer", "western union", "stc pay transfer"],
}

_ALIASES = {"ad": "advertising", "ads": "advertising", "marketing": "advertising", "saas": "software", "tools": "software", "subscriptions": "software",
            "hardware": "equipment", "devices": "equipment", "shipping": "logistics", "transport": "travel", "bills": "utilities", "misc": "other",
            "supplies": "office", "gifts": "gift_card", "giftcard": "gift_card", "gift cards": "gift_card"}


def categorize(merchant: str, category_hint: str | None, description: str = "") -> tuple[str, str]:
    """Returns (category, how) where how is 'given', 'alias', 'keywords', 'claude' or 'default'."""
    hint = (category_hint or "").strip().lower().replace("-", "_").replace(" ", "_")
    if hint in CATEGORIES:
        # still catch obvious mislabels of prohibited things
        text = f"{merchant} {description}".lower()
        for cat in ("gift_card", "crypto", "cash_withdrawal"):
            if any(k in text for k in _KEYWORDS[cat]):
                return cat, "keywords"
        return hint, "given"
    if hint.replace("_", " ") in _ALIASES:
        return _ALIASES[hint.replace("_", " ")], "alias"
    text = f"{merchant} {description} {hint}".lower()
    scores = {cat: sum(1 for k in kws if k in text) for cat, kws in _KEYWORDS.items()}
    best = max(scores, key=scores.get)
    if scores[best] > 0:
        return best, "keywords"
    claude = _ask_claude(merchant, description)
    if claude:
        return claude, "claude"
    return "other", "default"


def _ask_claude(merchant: str, description: str) -> str | None:
    from app.core.config import get_settings
    settings = get_settings()
    if not settings.claude_enabled:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        resp = client.messages.create(model=settings.claude_model, max_tokens=10,
                                      messages=[{"role": "user", "content": f"Classify this business purchase into exactly one of: {', '.join(CATEGORIES)}. Merchant: {merchant}. Description: {description}. Reply with the category only."}])
        answer = "".join(b.text for b in resp.content if b.type == "text").strip().lower().replace(" ", "_")
        return answer if answer in CATEGORIES else None
    except Exception:
        return None

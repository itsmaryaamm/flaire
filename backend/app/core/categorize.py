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

# Well-known merchants and what they really are. A valid-looking category hint that contradicts this map is corrected,
# so an agent cannot pass a category allowlist by relabelling "Google Ads" as "services". Matched on whole words of the
# merchant name only (never the description), so a stray word in free text cannot flip a category.
KNOWN_MERCHANTS: dict[str, str] = {
    "google ads": "advertising", "snapchat ads": "advertising", "snap ads": "advertising", "tiktok ads": "advertising", "meta ads": "advertising",
    "facebook ads": "advertising", "instagram ads": "advertising", "linkedin ads": "advertising", "twitter ads": "advertising", "x ads": "advertising",
    "youtube ads": "advertising", "apple search ads": "advertising", "amazon ads": "advertising", "bing ads": "advertising", "microsoft ads": "advertising",
    "canva": "software", "notion": "software", "slack": "software", "figma": "software", "github": "software", "zoom": "software", "hubspot": "software",
    "openai": "software", "anthropic": "software", "aws": "software", "amazon web services": "software", "google cloud": "software", "microsoft azure": "software",
    "adobe": "software", "microsoft 365": "software", "atlassian": "software", "jira": "software", "zapier": "software", "mailchimp": "software",
    "aramex": "logistics", "smsa": "logistics", "dhl": "logistics", "fedex": "logistics", "ups": "logistics",
    "jarir": "equipment", "jarir bookstore": "equipment", "extra stores": "equipment", "apple store": "equipment",
    "saudia": "travel", "flynas": "travel", "flyadeal": "travel", "careem": "travel", "uber": "travel", "booking.com": "travel", "airbnb": "travel",
    "stc": "utilities", "mobily": "utilities", "zain": "utilities",
    "binance": "crypto", "coinbase": "crypto", "western union": "cash_withdrawal",
}


def _merchant_tokens(merchant: str) -> str:
    return " " + " ".join("".join(ch if ch.isalnum() or ch == "." else " " for ch in merchant.lower()).split()) + " "


def known_merchant_category(merchant: str) -> str | None:
    """The category a well-known merchant belongs to, or None. Longest name wins so 'google ads' beats 'ads'."""
    text = _merchant_tokens(merchant or "")
    hits = [name for name in KNOWN_MERCHANTS if f" {name} " in text]
    if not hits:
        return None
    return KNOWN_MERCHANTS[max(hits, key=len)]


_ALIASES = {"ad": "advertising", "ads": "advertising", "marketing": "advertising", "saas": "software", "tools": "software", "subscriptions": "software",
            "hardware": "equipment", "devices": "equipment", "shipping": "logistics", "transport": "travel", "bills": "utilities", "misc": "other",
            "supplies": "office", "gifts": "gift_card", "giftcard": "gift_card", "gift cards": "gift_card"}


def categorize(merchant: str, category_hint: str | None, description: str = "") -> tuple[str, str]:
    """Returns (category, how) where how is 'given', 'alias', 'keywords', 'corrected', 'claude' or 'default'.
    'corrected' means the agent sent a valid category that contradicts what the merchant is known to be."""
    hint = (category_hint or "").strip().lower().replace("-", "_").replace(" ", "_")
    if hint in CATEGORIES:
        # still catch obvious mislabels of prohibited things
        text = f"{merchant} {description}".lower()
        for cat in ("gift_card", "crypto", "cash_withdrawal"):
            if any(k in text for k in _KEYWORDS[cat]):
                return cat, "keywords"
        known = known_merchant_category(merchant)
        if known and known != hint:
            return known, "corrected"
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

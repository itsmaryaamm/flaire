"""Field encryption for secrets stored per company (payment provider keys). Fernet key derived from APP_ENCRYPTION_KEY,
falling back to JWT_SECRET so dev works with zero setup. Set APP_ENCRYPTION_KEY separately in production."""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _fernet() -> Fernet:
    s = get_settings()
    raw = (s.app_encryption_key or s.jwt_secret).encode()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw).digest()))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None

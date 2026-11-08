"""Account security: forgot/reset password, change password, two-factor authentication (TOTP).

- Forgot password: POST /auth/forgot {email} always answers 200 (no account enumeration). If the email exists, a
  single-use token (1 hour, stored hashed) is emailed as a link to <DASHBOARD_URL>/reset?token=... When SMTP is not
  configured and ENV is not prod, the link is returned in the response so local demos still work.
- 2FA: TOTP (Google Authenticator, 1Password, Apple Passwords...). Secret stored encrypted. Once enabled, login and
  the Claude connector sign-in both require the 6-digit code. Companies can require 2FA for anyone who approves.
"""
from __future__ import annotations

import base64
import io
import secrets
from datetime import timedelta, timezone, datetime

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core import audit, guard
from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.core.db import get_db
from app.core.security import get_current_user, hash_api_key, hash_password, verify_password, verify_user_password
from app.models import Company, OAuthToken, PasswordReset, User, utcnow

router = APIRouter()
settings = get_settings()


# ---------------------------------------------------------------- helpers
def send_email(to: str, subject: str, body: str) -> tuple[bool, str | None]:
    s = get_settings()
    if not s.smtp_host:
        return False, "SMTP not configured"
    try:
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, (s.smtp_from or s.smtp_user or "flaire@localhost"), to
        msg.set_content(body)
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as c:
            c.starttls()
            if s.smtp_user:
                c.login(s.smtp_user, s.smtp_password or "")
            c.send_message(msg)
        return True, None
    except Exception as exc:
        return False, str(exc)


def totp_ok(user: User, code: str | None) -> bool:
    if not user.totp_enabled:
        return True
    secret = decrypt(user.totp_secret_enc)
    return bool(secret and code and pyotp.TOTP(secret).verify(code.strip().replace(" ", ""), valid_window=1))


# ---------------------------------------------------------------- forgot / reset
class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


@router.post("/auth/forgot", tags=["auth"])
def forgot(body: ForgotIn, request: Request, db: Session = Depends(get_db)):
    guard.check_rate(f"forgot:{guard.client_ip(request)}", limit=5, window=900)
    user = db.query(User).filter(User.email == body.email.lower()).first()
    s = get_settings()
    if user and user.supabase_uid:
        return {"ok": True, "message": "Use the reset link on the sign-in page; your password is managed by the sign-in provider."}
    if user:
        raw = secrets.token_urlsafe(32)
        db.add(PasswordReset(user_id=user.id, token_hash=hash_api_key(raw), expires_at=utcnow() + timedelta(hours=1)))
        link = f"{s.dashboard_url.rstrip('/')}/reset?token={raw}"
        delivered, err = send_email(user.email, "[Flaire] Reset your password",
                                    f"Hi {user.full_name},\n\nReset your Flaire password with this link (valid for 1 hour):\n{link}\n\nIf you did not ask for this, ignore this email.\n")
        audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="auth.reset_requested",
                     details={"delivered": delivered, "error": err, "ip": guard.client_ip(request)})
        db.commit()
        if not delivered and s.env != "prod":
            return {"ok": True, "message": "SMTP is not configured; here is the link (dev only).", "reset_link": link}
    return {"ok": True, "message": "If that email has a Flaire account, a reset link is on its way."}


@router.post("/auth/reset", tags=["auth"])
def reset(body: ResetIn, db: Session = Depends(get_db)):
    row = db.query(PasswordReset).filter(PasswordReset.token_hash == hash_api_key(body.token)).first()
    now = datetime.now(timezone.utc)
    if not row or row.used or row.expires_at.replace(tzinfo=row.expires_at.tzinfo or timezone.utc) < now:
        raise HTTPException(400, "This reset link is invalid or has expired. Request a new one.")
    user = db.get(User, row.user_id)
    user.password_hash = hash_password(body.password)
    row.used = True
    # Changing the password signs out every connected Claude and session token for this user.
    db.query(OAuthToken).filter(OAuthToken.user_id == user.id).update({"revoked": True})
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="auth.password_reset", details={})
    db.commit()
    return {"ok": True, "message": "Password updated. Sign in with your new password."}


# ---------------------------------------------------------------- change password
class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/auth/change-password", tags=["auth"])
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.supabase_uid:
        raise HTTPException(409, "Your password is managed by the sign-in provider. Use the dashboard's reset flow.")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(403, "Current password is wrong.")
    user.password_hash = hash_password(body.new_password)
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="auth.password_changed", details={})
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- two-factor
class CodeIn(BaseModel):
    code: str


class DisableIn(BaseModel):
    password: str
    code: str


@router.get("/auth/2fa", tags=["auth"])
def twofa_status(user: User = Depends(get_current_user)):
    return {"enabled": user.totp_enabled}


@router.post("/auth/2fa/setup", tags=["auth"])
def twofa_setup(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns a new secret (not yet active) plus a QR code. Call /auth/2fa/enable with a code to activate."""
    secret = pyotp.random_base32()
    user.totp_secret_enc = encrypt(secret)
    user.totp_enabled = False
    db.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Flaire")
    import qrcode
    import qrcode.image.svg
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return {"secret": secret, "otpauth_uri": uri, "qr_svg": "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()}


@router.post("/auth/2fa/enable", tags=["auth"])
def twofa_enable(body: CodeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    secret = decrypt(user.totp_secret_enc)
    if not secret or not pyotp.TOTP(secret).verify(body.code.strip().replace(" ", ""), valid_window=1):
        raise HTTPException(400, "That code is not valid. Check the time on your phone and try again.")
    user.totp_enabled = True
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="auth.2fa_enabled", details={})
    db.commit()
    return {"enabled": True}


@router.post("/auth/2fa/disable", tags=["auth"])
def twofa_disable(body: DisableIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_user_password(user, body.password) or not totp_ok(user, body.code):
        raise HTTPException(403, "Password or code is wrong.")
    company = db.get(Company, user.company_id)
    if company.require_2fa_for_all:
        raise HTTPException(409, "Your company requires two-factor authentication for every member. Turn that policy off first.")
    if company.require_2fa_for_approvers and user.role in ("owner", "finance"):
        raise HTTPException(409, "Your company requires 2FA for approvers. Turn that policy off first.")
    user.totp_enabled = False
    user.totp_secret_enc = None
    audit.record(db, user.company_id, actor_type="user", actor_id=user.id, actor_name=user.full_name, event="auth.2fa_disabled", details={})
    db.commit()
    return {"enabled": False}

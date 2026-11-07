"""Approval notifications. Email via SMTP when configured; otherwise the notification is written to the ledger only.

Env: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, DASHBOARD_URL (for the approve link).
Any failure is swallowed and recorded, so a mail outage can never block a purchase decision.
"""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.models import Company, PurchaseRequest, User


def _sar(h: int) -> str:
    return f"SAR {h / 100:,.2f}"


def send_email(to: list[str], subject: str, body: str) -> tuple[bool, str | None]:
    """Returns (delivered, error). Without SMTP_HOST nothing is sent and delivered is False."""
    settings = get_settings()
    if not settings.smtp_host or not to:
        return False, None
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from or settings.smtp_user or "flaire@localhost"
        msg["To"] = ", ".join(to)
        msg.set_content(body)
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password or "")
            s.send_message(msg)
        return True, None
    except Exception as exc:  # never block the caller on mail
        return False, str(exc)


def notify_approval_needed(db: Session, company: Company, pr: PurchaseRequest, recipients: list[User] | None = None) -> None:
    """Tell the people who can act on this hold right now. Without an explicit list, owners, admins and finance are told."""
    settings = get_settings()
    if recipients is None:
        recipients = db.query(User).filter(User.company_id == company.id, User.role.in_(["owner", "admin", "finance"]), User.status == "active").all()
    link = f"{settings.dashboard_url.rstrip('/')}/approvals"
    subject = f"[Flaire] Approval needed: {_sar(pr.amount)} at {pr.merchant}"
    reasons = "\n".join(f"  - {r}" for r in (pr.decision or {}).get("reasons", []))
    body = (f"{pr.agent.name} ({pr.department.name}) requested {_sar(pr.amount)} at {pr.merchant} ({pr.category}).\n\n"
            f"Why: {pr.description or '(no description)'}\n\nPolicy check:\n{reasons}\n\nApprove or reject: {link}\n")
    delivered, error = send_email([u.email for u in recipients], subject, body)
    push = {}
    try:
        from app.core.push import send_to_company_approvers
        push = send_to_company_approvers(db, company.id, f"Approval needed: {_sar(pr.amount)}", f"{pr.agent.name} wants to pay {pr.merchant}. {pr.description[:80]}", link,
                                         user_ids=[u.id for u in recipients])
    except Exception as exc:
        push = {"error": str(exc)}
    chain = (pr.decision or {}).get("chain") or {}
    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="notifier", event="approval.notified",
                 details={"request_id": pr.id, "recipients": [u.email for u in recipients], "delivered": delivered,
                          "channel": "email" if settings.smtp_host else "in-app", "error": error, "push": push, "step": (chain.get("next") or {}).get("step")})


def notify_invite(email: str, company_name: str, role: str, link: str, invited_by: str) -> tuple[bool, str | None]:
    subject = f"[Flaire] {invited_by} invited you to {company_name}"
    body = (f"{invited_by} invited you to join {company_name} on Flaire as {role}.\n\n"
            f"Accept the invite (valid for 7 days): {link}\n\nIf you were not expecting this, ignore this email.\n")
    return send_email([email], subject, body)

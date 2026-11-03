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


def notify_approval_needed(db: Session, company: Company, pr: PurchaseRequest) -> None:
    settings = get_settings()
    approvers = db.query(User).filter(User.company_id == company.id, User.role.in_(["owner", "finance"])).all()
    link = f"{settings.dashboard_url.rstrip('/')}/approvals"
    subject = f"[Flaire] Approval needed: {_sar(pr.amount)} at {pr.merchant}"
    reasons = "\n".join(f"  - {r}" for r in (pr.decision or {}).get("reasons", []))
    body = (f"{pr.agent.name} ({pr.department.name}) requested {_sar(pr.amount)} at {pr.merchant} ({pr.category}).\n\n"
            f"Why: {pr.description or '(no description)'}\n\nPolicy check:\n{reasons}\n\nApprove or reject: {link}\n")
    delivered = False
    error = None
    if settings.smtp_host and approvers:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = settings.smtp_from or settings.smtp_user or "flaire@localhost"
            msg["To"] = ", ".join(u.email for u in approvers)
            msg.set_content(body)
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as s:
                s.starttls()
                if settings.smtp_user:
                    s.login(settings.smtp_user, settings.smtp_password or "")
                s.send_message(msg)
            delivered = True
        except Exception as exc:  # never block the decision on mail
            error = str(exc)
    push = {}
    try:
        from app.core.push import send_to_company_approvers
        push = send_to_company_approvers(db, company.id, f"Approval needed: {_sar(pr.amount)}", f"{pr.agent.name} wants to pay {pr.merchant}. {pr.description[:80]}", link)
    except Exception as exc:
        push = {"error": str(exc)}
    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="notifier", event="approval.notified",
                 details={"request_id": pr.id, "recipients": [u.email for u in approvers], "delivered": delivered,
                          "channel": "email" if settings.smtp_host else "in-app", "error": error, "push": push})

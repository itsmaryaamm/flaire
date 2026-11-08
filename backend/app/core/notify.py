"""Notifications: in-app feed (Notification rows), web push and email.

Every notable event goes through one function here, which writes a Notification row for each recipient and then tries
push and email. Any delivery failure is swallowed and recorded, so a mail or push outage can never block a decision.

Env: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, DASHBOARD_URL (for links in emails).
Push payloads and feed rows carry a relative url ("/?decide=<request_id>") so the installed phone app opens the decision directly.
"""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.models import Company, Notification, PurchaseRequest, User, utcnow


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


# ---------------------------------------------------------------- in-app feed
def add_feed(db: Session, company_id: int, user_ids: list[int], type_: str, title: str, body: str, url: str | None = None, request_id: int | None = None) -> list[Notification]:
    rows = []
    for uid in dict.fromkeys(user_ids):  # dedupe, keep order
        n = Notification(user_id=uid, company_id=company_id, type=type_, title=title[:200], body=body, url=url, request_id=request_id, created_at=utcnow())
        db.add(n)
        rows.append(n)
    db.flush()
    return rows


def decide_url(pr: PurchaseRequest) -> str:
    return f"/?decide={pr.id}"


def hold_context(pr: PurchaseRequest) -> dict:
    """The fields every channel shows for a hold: employee, merchant, amount, reason, why it was held, the chain step."""
    d = pr.decision or {}
    reasons = [r for r in d.get("reasons", []) if r]
    chain = d.get("chain") or {}
    nxt = chain.get("next") or {}
    step = f"Step {nxt['step']} of {chain.get('total_steps', '?')}: needs {nxt.get('label') or nxt.get('role')}" if nxt else None
    return {"request_id": pr.id, "employee": pr.agent.name if pr.agent else "AI employee", "merchant": pr.merchant, "amount": pr.amount, "amount_text": _sar(pr.amount),
            "reason": pr.description or "", "held_because": reasons[0] if reasons else "Needs a human decision.", "step": step, "url": decide_url(pr),
            "category": pr.category, "department": pr.department.name if pr.department else ""}


# ---------------------------------------------------------------- events
def notify_approval_needed(db: Session, company: Company, pr: PurchaseRequest, recipients: list[User] | None = None) -> None:
    """Tell the people who can act on this hold right now. Without an explicit list, owners, admins and finance are told."""
    settings = get_settings()
    if recipients is None:
        recipients = db.query(User).filter(User.company_id == company.id, User.role.in_(["owner", "admin", "finance"]), User.status == "active").all()
    ctx = hold_context(pr)
    link = f"{settings.dashboard_url.rstrip('/')}{ctx['url']}"
    title = f"Approval needed: {ctx['amount_text']} at {ctx['merchant']}"
    body_short = f"{ctx['employee']} wants to pay {ctx['merchant']} {ctx['amount_text']}. {ctx['reason'][:80]}".strip()
    body_short += f" Held: {ctx['held_because']}" + (f" {ctx['step']}." if ctx["step"] else "")
    subject = f"[Flaire] {title}"
    all_reasons = "\n".join(f"  - {r}" for r in (pr.decision or {}).get("reasons", []))
    email_body = (f"{ctx['employee']} ({ctx['department']}) requested {ctx['amount_text']} at {ctx['merchant']} ({ctx['category']}).\n\n"
                  f"Reason: {ctx['reason'] or '(no description)'}\n"
                  f"Why it was held: {ctx['held_because']}\n"
                  + (f"Approval chain: {ctx['step']}\n" if ctx["step"] else "")
                  + f"\nPolicy check:\n{all_reasons}\n\nApprove or reject: {link}\n")
    add_feed(db, company.id, [u.id for u in recipients], "hold", title, body_short, ctx["url"], pr.id)
    delivered, error = send_email([u.email for u in recipients], subject, email_body)
    push = {}
    try:
        from app.core.push import send_to_company_approvers
        push = send_to_company_approvers(db, company.id, title, body_short, ctx["url"], user_ids=[u.id for u in recipients],
                                         extra={"request_id": pr.id, "employee": ctx["employee"], "merchant": ctx["merchant"], "amount": pr.amount, "amount_text": ctx["amount_text"],
                                                "reason": ctx["reason"], "held_because": ctx["held_because"], "step": ctx["step"], "type": "hold"})
    except Exception as exc:
        push = {"error": str(exc)}
    chain = (pr.decision or {}).get("chain") or {}
    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="notifier", event="approval.notified",
                 details={"request_id": pr.id, "recipients": [u.email for u in recipients], "delivered": delivered,
                          "channel": "email" if settings.smtp_host else "in-app", "error": error, "push": push, "step": (chain.get("next") or {}).get("step")})


def notify_decision(db: Session, company: Company, pr: PurchaseRequest, actor: User) -> None:
    """A hold reached its final state: tell every human who approved a step of it (including the one who finished it)."""
    ids = [a.get("user_id", a.get("id")) for a in (pr.decision or {}).get("approvals", [])]
    if pr.approved_by_id:
        ids.append(pr.approved_by_id)
    ids = [i for i in ids if isinstance(i, int)]
    if not ids:
        return
    ctx = hold_context(pr)
    outcome = {"completed": "Paid", "rejected": "Rejected", "denied": "Denied", "failed": "Payment failed", "approved": "Approved"}.get(pr.status, pr.status)
    title = f"{outcome}: {ctx['amount_text']} at {ctx['merchant']}"
    body = f"{ctx['employee']}'s request for {ctx['merchant']} ({ctx['amount_text']}) was {outcome.lower()} by {actor.full_name}."
    err = (pr.decision or {}).get("payment_error")
    if err:
        body += f" {err}"
    add_feed(db, company.id, ids, "decision", title, body, ctx["url"], pr.id)
    try:
        from app.core.push import send_to_company_approvers
        send_to_company_approvers(db, company.id, title, body, ctx["url"], user_ids=ids,
                                  extra={"request_id": pr.id, "employee": ctx["employee"], "merchant": ctx["merchant"], "amount": pr.amount, "amount_text": ctx["amount_text"],
                                         "reason": ctx["reason"], "type": "decision", "status": pr.status})
    except Exception:
        pass


def notify_policy_change(db: Session, company: Company, change, proposer: User) -> None:
    """A loosening change waits for a second admin: tell the other owners and admins."""
    others = db.query(User).filter(User.company_id == company.id, User.role.in_(["owner", "admin"]), User.status == "active", User.id != proposer.id).all()
    if not others:
        return
    fields = ", ".join(f"{f.replace('_', ' ')} to {d.get('to')}" for f, d in (change.changes or {}).items())[:160]
    title = f"Policy change needs you: {change.target_type}"
    body = f"{proposer.full_name} proposed {fields or 'a policy change'}. {change.reason or ''}".strip()
    url = f"/?change={change.id}"
    add_feed(db, company.id, [u.id for u in others], "policy_change", title, body, url, None)
    try:
        from app.core.push import send_to_company_approvers
        send_to_company_approvers(db, company.id, title, body, url, user_ids=[u.id for u in others], extra={"type": "policy_change", "change_id": change.id})
    except Exception:
        pass


def notify_invite_accepted(db: Session, company: Company, inviter_id: int | None, joined: User) -> None:
    if not inviter_id:
        return
    title = f"{joined.full_name} joined {company.name}"
    body = f"{joined.email} accepted the invite and is now {joined.role}."
    add_feed(db, company.id, [inviter_id], "invite_accepted", title, body, "/team", None)


def notify_kill_switch(db: Session, company: Company, actor: User, enabled: bool, reason: str | None) -> None:
    people = db.query(User).filter(User.company_id == company.id, User.role.in_(["owner", "admin", "finance"]), User.status == "active").all()
    title = "Kill switch ON: all spending stopped" if enabled else "Kill switch lifted: spending resumed"
    body = f"{actor.full_name} turned the kill switch {'on' if enabled else 'off'}." + (f" Reason: {reason}" if reason else "")
    add_feed(db, company.id, [u.id for u in people], "kill_switch", title, body, "/", None)
    try:
        from app.core.push import send_to_company_approvers
        send_to_company_approvers(db, company.id, title, body, "/", user_ids=[u.id for u in people], extra={"type": "kill_switch", "enabled": enabled, "reason": reason})
    except Exception:
        pass


def notify_invite(email: str, company_name: str, role: str, link: str, invited_by: str) -> tuple[bool, str | None]:
    subject = f"[Flaire] {invited_by} invited you to {company_name}"
    body = (f"{invited_by} invited you to join {company_name} on Flaire as {role}.\n\n"
            f"Accept the invite (valid for 7 days): {link}\n\nIf you were not expecting this, ignore this email.\n")
    return send_email([email], subject, body)

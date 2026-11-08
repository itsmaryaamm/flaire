"""One card per AI employee.

Every AI employee gets its own virtual card at the issuer (Lithic) the moment it is created, with the issuer's own
monthly spend limit mirrored from Flaire's limit. Pausing the employee pauses the card at the issuer; changing the
monthly limit updates the issuer. There is no shared company card: a card can only ever pay for purchases that
Flaire approved for that employee (see api/asa.py for the real-time check).

In environments without a Lithic key (tests, local demos) a simulated card is issued instead so the flow still runs.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.integrations.payments import get_adapter
from app.models import Agent, Card, Company


def issuer_for(company: Company) -> str:
    """lithic when a key is available, otherwise the simulated issuer (never offered in production UI)."""
    s = get_settings()
    if company.lithic_api_key_enc or s.lithic_api_key:
        return "lithic"
    return "mock_snb"


def issue_card_for_agent(db: Session, company: Company, agent: Agent, actor: str = "system") -> Card | None:
    """Create the employee's card at the issuer. Returns None (and records why) if the issuer is unavailable."""
    provider = issuer_for(company)
    try:
        info = get_adapter(provider, company).create_card(f"{agent.name}", agent.monthly_limit, "SAR")
    except Exception as exc:
        audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="card-service", event="card.issue_failed",
                     details={"agent_id": agent.id, "provider": provider, "error": str(exc)[:200]})
        return None
    card = Card(company_id=company.id, department_id=agent.department_id, agent_id=agent.id, label=agent.name, provider=provider, last4=info["last4"],
                credit_limit=agent.monthly_limit, available_balance=info["available_balance"], provider_token=info["provider_token"], is_default=False)
    db.add(card)
    db.flush()
    agent.card_id = card.id
    audit.record(db, company.id, actor_type="system", actor_id=None, actor_name=actor, event="card.issued",
                 details={"agent_id": agent.id, "card_id": card.id, "provider": provider, "last4": card.last4, "limit": agent.monthly_limit})
    return card


def issue_missing_cards(db: Session, company: Company, actor: str = "system") -> list[Card]:
    """Every active employee without a card gets one. Called when a Lithic key is saved so employees created earlier are covered too."""
    issued: list[Card] = []
    for agent in db.query(Agent).filter(Agent.company_id == company.id, Agent.status == "active").order_by(Agent.id).all():
        card = db.get(Card, agent.card_id) if agent.card_id else None
        if card is not None:
            continue
        card = issue_card_for_agent(db, company, agent, actor=actor)
        if card is not None:
            issued.append(card)
    return issued


def sync_card_with_agent(db: Session, company: Company, agent: Agent) -> None:
    """Mirror limit and status changes to the issuer."""
    if not agent.card_id:
        return
    card = db.get(Card, agent.card_id)
    if not card:
        return
    delta = agent.monthly_limit - (card.credit_limit or 0)
    card.credit_limit = agent.monthly_limit
    card.available_balance = max(0, (card.available_balance or 0) + delta)
    card.label = agent.name
    wanted = "active" if agent.status == "active" and not company.kill_switch else "frozen"
    if card.provider == "lithic":
        adapter = get_adapter("lithic", company)
        try:
            adapter.set_spend_limit(card, agent.monthly_limit)
            if card.status != wanted:
                adapter.set_state(card, "OPEN" if wanted == "active" else "PAUSED")
        except Exception as exc:
            audit.record(db, company.id, actor_type="system", actor_id=None, actor_name="card-service", event="card.sync_failed", details={"card_id": card.id, "error": str(exc)[:200]})
    card.status = wanted

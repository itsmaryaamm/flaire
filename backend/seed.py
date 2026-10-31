"""Seed a demo company so the dashboard has something to show.

    python seed.py            creates Nawah Tech with 3 departments, 3 AI employees, 2 simulated cards
    python seed.py --reset    drops and recreates everything first

Login: demo@flaire.sa / demo1234
"""
import sys

from app.core import audit
from app.core.db import Base, SessionLocal, engine, init_db
from app.core.security import generate_agent_key, hash_password
from app.integrations.payments import get_adapter
from app.models import Agent, Card, Company, Department, User

DEMO_EMAIL = "demo@flaire.sa"
DEMO_PASSWORD = "demo1234"


def seed(reset: bool = False) -> dict:
    if reset:
        Base.metadata.drop_all(bind=engine)
    init_db()
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == DEMO_EMAIL).first():
            print("Demo data already present. Use --reset to start over.")
            return {}

        company = Company(name="Nawah Tech", engine="native")
        db.add(company)
        db.flush()
        owner = User(company_id=company.id, email=DEMO_EMAIL, full_name="Sara Al-Otaibi", password_hash=hash_password(DEMO_PASSWORD), role="owner")
        db.add(owner)
        db.flush()
        audit.record(db, company.id, actor_type="user", actor_id=owner.id, actor_name=owner.full_name, event="company.created", details={"name": company.name})

        depts = {}
        for name, budget in [("Marketing", 500_000), ("Procurement", 800_000), ("Operations", 300_000)]:
            d = Department(company_id=company.id, name=name, monthly_budget=budget)
            db.add(d)
            db.flush()
            depts[name] = d

        keys = {}
        agent_specs = [
            dict(name="Marketing AI", role="marketing", dept="Marketing", per_transaction_limit=100_000, monthly_limit=400_000, approval_threshold=100_000,
                 allowed_categories=["advertising", "software", "services"], blocked_merchants=["Gift card"]),
            dict(name="Procurement AI", role="procurement", dept="Procurement", per_transaction_limit=300_000, monthly_limit=700_000, approval_threshold=150_000,
                 allowed_categories=["software", "equipment", "services", "office"], blocked_merchants=[]),
            dict(name="Operations AI", role="operations", dept="Operations", per_transaction_limit=50_000, monthly_limit=250_000, approval_threshold=50_000,
                 allowed_categories=["logistics", "utilities", "office", "software", "services"], blocked_merchants=[]),
        ]
        for spec in agent_specs:
            plain, h, prefix = generate_agent_key()
            a = Agent(company_id=company.id, department_id=depts[spec.pop("dept")].id, api_key_hash=h, key_prefix=prefix, **spec)
            db.add(a)
            db.flush()
            keys[a.name] = plain
            audit.record(db, company.id, actor_type="user", actor_id=owner.id, actor_name=owner.full_name, event="agent.created", details={"id": a.id, "name": a.name})

        for label, provider, limit, last4, is_default, dept in [("SNB Business", "mock_snb", 1_000_000, "4471", True, None), ("Al Rajhi Marketing", "mock_rajhi", 500_000, "8820", False, "Marketing")]:
            info = get_adapter(provider).create_card(label, limit, "SAR")
            card = Card(company_id=company.id, department_id=depts[dept].id if dept else None, label=label, provider=provider, last4=last4, credit_limit=limit,
                        available_balance=info["available_balance"], provider_token=info["provider_token"], is_default=is_default)
            db.add(card)
            db.flush()
            audit.record(db, company.id, actor_type="user", actor_id=owner.id, actor_name=owner.full_name, event="card.added", details={"id": card.id, "label": label, "last4": last4})

        db.commit()
        print(f"Seeded {company.name}. Login {DEMO_EMAIL} / {DEMO_PASSWORD}")
        print("Agent API keys (shown once, also available via Rotate key in the dashboard):")
        for n, k in keys.items():
            print(f"  {n}: {k}")
        return keys
    finally:
        db.close()


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)

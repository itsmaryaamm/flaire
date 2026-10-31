"""Minimal example of an external AI employee talking to Flaire from anywhere (a script, LangChain, n8n, etc).

    FLAIRE_URL=http://localhost:8000/api/v1 FLAIRE_AGENT_KEY=flk_... python agent_sdk_example.py
"""
import os
import httpx

BASE = os.environ.get("FLAIRE_URL", "http://localhost:8000/api/v1")
KEY = os.environ["FLAIRE_AGENT_KEY"]
H = {"X-Agent-Key": KEY}

me = httpx.get(f"{BASE}/agent/me", headers=H).json()
print(f"I am {me['name']} in {me['department']['name']}. Remaining dept budget: SAR {me['department']['remaining']/100:,.2f}")

r = httpx.post(f"{BASE}/agent/purchase-requests", headers=H,
               json={"amount": 50_000, "merchant": "Google Ads", "category": "advertising", "description": "Ramadan launch campaign"}).json()
print("Flaire says:", r["status"])
for reason in r["decision"]["reasons"]:
    print("  -", reason)

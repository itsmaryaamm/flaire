"""Shotoku integration: the authorization component inside Flaire's backend.

Flaire talks only to `AuthorizationEngine` (interface.py). Two implementations:

- `NativeEngine`  (native_engine.py)   Python port of Shotoku's policy model. Default, zero setup.
- `ShotokuEngine` (shotoku_engine.py)  Calls the real `@shotoku/core` through the Node sidecar in service/.

Swap with the AUTH_ENGINE env var or per company via PATCH /company {"engine": "shotoku"}.
"""
from app.integrations.shotoku.interface import AuthorizationEngine, AuthorizationRequest, Decision
from app.integrations.shotoku.native_engine import NativeEngine
from app.integrations.shotoku.shotoku_engine import ShotokuEngine

__all__ = ["AuthorizationEngine", "AuthorizationRequest", "Decision", "NativeEngine", "ShotokuEngine", "get_engine"]


def get_engine(name: str) -> AuthorizationEngine:
    if name == "shotoku":
        return ShotokuEngine()
    return NativeEngine()

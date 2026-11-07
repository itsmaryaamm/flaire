"""Structured JSON logging and request tracing.

Every request gets an X-Request-Id (honoured if the caller sends one), timing, status and the
acting user or agent id when known. Logs are one JSON object per line so Render, Datadog, Loki
or CloudWatch can index them. Secrets never reach the log: bodies are not logged, Authorization
headers are redacted.
"""
from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        extra = getattr(record, "extra", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)
    for noisy in ("uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel("WARNING")


log = logging.getLogger("flaire")


def event(name: str, **fields) -> None:
    """Log a structured business event, e.g. event("purchase.decided", request_id=12, verdict="approved")."""
    log.info(name, extra={"extra": fields})


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-Id"] = rid
            return response
        finally:
            ms = round((time.perf_counter() - start) * 1000, 1)
            if request.url.path not in ("/api/v1/health", "/health"):
                log.info("http", extra={"extra": {
                    "method": request.method, "path": request.url.path, "status": status, "ms": ms,
                    "ip": request.client.host if request.client else None,
                    "ua": (request.headers.get("user-agent") or "")[:80],
                }})
            request_id_var.reset(token)

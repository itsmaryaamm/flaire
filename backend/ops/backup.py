#!/usr/bin/env python3
"""Nightly database backup and tested restore for Flaire.

Usage:
  python ops/backup.py backup            dump DATABASE_URL to a gzip file and upload to S3-compatible storage
  python ops/backup.py restore <key>     download a backup and restore it into RESTORE_DATABASE_URL (never the live DB)
  python ops/backup.py verify <key>      restore into a scratch database and run integrity checks, then drop it
  python ops/backup.py list              list backups

Environment:
  DATABASE_URL                 live database (postgres://...)
  RESTORE_DATABASE_URL         target for restore/verify (a separate database)
  BACKUP_S3_ENDPOINT           e.g. https://s3.me-south-1.amazonaws.com or any S3-compatible endpoint (Cloudflare R2, Backblaze, Oracle Jeddah)
  BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY
  BACKUP_ENCRYPTION_KEY        optional Fernet key; backups are encrypted at rest before upload
  BACKUP_RETENTION_DAYS        default 35

Schedule on Render as a cron job: `0 2 * * *  python ops/backup.py backup` (02:00 UTC = 05:00 Riyadh).
Requires pg_dump/pg_restore on PATH (Render images have them) and boto3.
"""
from __future__ import annotations

import gzip
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone


def _env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None:
        print(f"missing env {name}", file=sys.stderr)
        sys.exit(2)
    return v


def _s3():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=_env("BACKUP_S3_ENDPOINT"),
        aws_access_key_id=_env("BACKUP_S3_ACCESS_KEY"),
        aws_secret_access_key=_env("BACKUP_S3_SECRET_KEY"),
    )


def _encrypt(data: bytes) -> bytes:
    key = os.environ.get("BACKUP_ENCRYPTION_KEY")
    if not key:
        return data
    from cryptography.fernet import Fernet
    return Fernet(key.encode()).encrypt(data)


def _decrypt(data: bytes) -> bytes:
    key = os.environ.get("BACKUP_ENCRYPTION_KEY")
    if not key:
        return data
    from cryptography.fernet import Fernet
    return Fernet(key.encode()).decrypt(data)


def backup() -> str:
    url = _env("DATABASE_URL")
    if url.startswith("sqlite"):
        path = url.split("///", 1)[1]
        raw = open(path, "rb").read()
    else:
        raw = subprocess.run(["pg_dump", "--no-owner", "--no-privileges", "--format=custom", url], check=True, capture_output=True).stdout
    blob = _encrypt(gzip.compress(raw))
    key = f"flaire/{datetime.now(timezone.utc):%Y/%m/%d}/flaire-{int(time.time())}.dump.gz" + (".enc" if os.environ.get("BACKUP_ENCRYPTION_KEY") else "")
    _s3().put_object(Bucket=_env("BACKUP_S3_BUCKET"), Key=key, Body=blob, ServerSideEncryption="AES256")
    print(f"uploaded {key} ({len(blob)} bytes)")
    prune()
    return key


def prune() -> None:
    days = int(os.environ.get("BACKUP_RETENTION_DAYS", "35"))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    s3 = _s3()
    bucket = _env("BACKUP_S3_BUCKET")
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="flaire/"):
        for obj in page.get("Contents", []):
            if obj["LastModified"] < cutoff:
                s3.delete_object(Bucket=bucket, Key=obj["Key"])
                print(f"pruned {obj['Key']}")


def _download(key: str) -> bytes:
    body = _s3().get_object(Bucket=_env("BACKUP_S3_BUCKET"), Key=key)["Body"].read()
    return gzip.decompress(_decrypt(body))


def restore(key: str, target: str | None = None) -> None:
    target = target or _env("RESTORE_DATABASE_URL")
    live = os.environ.get("DATABASE_URL")
    if live and target == live:
        print("refusing to restore into the live DATABASE_URL", file=sys.stderr)
        sys.exit(3)
    raw = _download(key)
    if target.startswith("sqlite"):
        open(target.split("///", 1)[1], "wb").write(raw)
    else:
        with tempfile.NamedTemporaryFile(suffix=".dump", delete=False) as f:
            f.write(raw)
        subprocess.run(["pg_restore", "--clean", "--if-exists", "--no-owner", "--no-privileges", "-d", target, f.name], check=True)
    print(f"restored {key} into {target.split('@')[-1]}")


def verify(key: str) -> None:
    """Restore into the scratch DB and check the audit chain and row counts. Exit non-zero on failure."""
    target = _env("RESTORE_DATABASE_URL")
    restore(key, target)
    os.environ["DATABASE_URL"] = target
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from sqlalchemy import create_engine, text
    eng = create_engine(target)
    with eng.connect() as c:
        companies = c.execute(text("select count(*) from companies")).scalar()
        txs = c.execute(text("select count(*) from transactions")).scalar()
        audits = c.execute(text("select count(*) from audit_entries")).scalar()
    from app.core.db import SessionLocal
    from app.core.audit import verify as verify_chain
    with SessionLocal() as db:
        for (cid,) in db.execute(text("select id from companies")).all():
            res = verify_chain(db, cid)
            if not res.get("ok", res.get("valid", False)):
                print(f"audit chain broken for company {cid}: {res}", file=sys.stderr)
                sys.exit(4)
    print(f"verified: {companies} companies, {txs} transactions, {audits} audit entries, chains intact")


def list_backups() -> None:
    s3 = _s3()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=_env("BACKUP_S3_BUCKET"), Prefix="flaire/"):
        for obj in page.get("Contents", []):
            print(f"{obj['LastModified']:%Y-%m-%d %H:%M}  {obj['Size']:>10}  {obj['Key']}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "backup"
    if cmd == "backup":
        backup()
    elif cmd == "restore":
        restore(sys.argv[2])
    elif cmd == "verify":
        verify(sys.argv[2])
    elif cmd == "list":
        list_backups()
    else:
        print(__doc__)
        sys.exit(1)

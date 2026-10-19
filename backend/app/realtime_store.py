"""Local, append-only observation store for the research website.

This is an intake boundary, not an official data feed or model input. A caller
must configure an external data directory and an API token before writing.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .realtime_analysis import build_realtime_snapshot
from .realtime_ingestion import record_content_fingerprint

MAX_SNAPSHOT_RECORDS = 100_000


class ObservationConflict(ValueError):
    """The same immutable record ID was previously stored with other content."""


class ObservationLimit(ValueError):
    """A bounded research snapshot cannot be safely constructed."""


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.execute(
        "CREATE TABLE IF NOT EXISTS observations ("
        "record_id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
    )
    return connection


def save_records(path: Path, records: list[dict]) -> dict:
    """Atomically retain canonical records; exact retries are idempotent."""
    encoded = [
        (record["record_id"], json.dumps(record, ensure_ascii=False, sort_keys=True), record)
        for record in records
    ]
    inserted = 0
    repeated = 0
    with closing(_connect(path)) as db:
        with db:
            for record_id, payload, record in encoded:
                existing = db.execute(
                    "SELECT payload FROM observations WHERE record_id = ?", (record_id,)
                ).fetchone()
                if existing:
                    same_content = (
                        existing[0] == payload
                        or (
                            record.get("content_fingerprint") == record_content_fingerprint(record)
                            and json.loads(existing[0]).get("content_fingerprint")
                            == record["content_fingerprint"]
                        )
                    )
                    if not same_content:
                        raise ObservationConflict(record_id)
                    repeated += 1
                else:
                    db.execute(
                        "INSERT INTO observations(record_id, payload) VALUES(?, ?)",
                        (record_id, payload),
                    )
                    inserted += 1
    return {"inserted_count": inserted, "repeated_count": repeated}


def load_snapshot(path: Path, *, as_of: datetime | None = None) -> dict:
    """Describe stored records only; never promote them to forecast input."""
    as_of = as_of or datetime.now(timezone.utc)
    if not path.is_file():
        records = []
    else:
        with closing(_connect(path)) as db:
            count = db.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
            if count > MAX_SNAPSHOT_RECORDS:
                raise ObservationLimit("observation count exceeds analysis limit")
            records = [
                json.loads(row[0]) for row in db.execute(
                    "SELECT payload FROM observations ORDER BY record_id"
                )
            ]
    snapshot = build_realtime_snapshot(records, as_of=as_of)
    snapshot["intake_label"] = "contributed_unverified" if records else "not_connected"
    snapshot["stored_record_count"] = len(records)
    return snapshot

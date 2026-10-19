"""Local intake and website API contracts; no external network or source data."""
import os
import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.app import main
from backend.app.realtime_analysis import build_realtime_snapshot
from backend.app.realtime_store import ObservationConflict, load_snapshot, save_records
from tests.test_realtime_pipeline import AS_OF, _candidate, _poll_records


class RealtimeWebsiteTest(unittest.TestCase):
    def test_empty_snapshot_marks_missing_and_disables_capabilities(self):
        with tempfile.TemporaryDirectory() as folder:
            snapshot = load_snapshot(Path(folder) / "records.sqlite3", as_of=AS_OF)
        self.assertEqual(snapshot["intake_label"], "not_connected")
        self.assertEqual(snapshot["stored_record_count"], 0)
        self.assertEqual(len(snapshot["missing_city_phenomena"]), 25)
        self.assertFalse(snapshot["public_warning_ready"])
        self.assertFalse(snapshot["automatic_dispatch_ready"])

    def test_store_is_idempotent_and_conflicts_rollback(self):
        record = _poll_records([_candidate()])["accepted_records"][0]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "records.sqlite3"
            self.assertEqual(save_records(path, [record])["inserted_count"], 1)
            self.assertEqual(save_records(path, [record])["repeated_count"], 1)
            altered = {**record, "value": 999.0}
            with self.assertRaises(ObservationConflict):
                save_records(path, [altered])
            self.assertEqual(load_snapshot(path, as_of=AS_OF)["stored_record_count"], 1)

    def test_snapshot_rejects_tampered_identity_and_fingerprint(self):
        record = _poll_records([_candidate()])["accepted_records"][0]
        for alteration in ({"record_id": "forged"}, {"value": 999.0}):
            snapshot = build_realtime_snapshot([{**record, **alteration}], as_of=AS_OF)
            self.assertEqual(snapshot["summaries"], [])
            self.assertEqual(snapshot["rejected_counts"]["invalid_record"], 1)

    def test_api_auth_and_unverified_intake(self):
        record = _candidate()
        record["observed_at"] = datetime.now(timezone.utc) - timedelta(minutes=10)
        record["provider_published_at"] = datetime.now(timezone.utc) - timedelta(minutes=9)
        for name in ("observed_at", "provider_published_at"):
            record[name] = record[name].isoformat()
        body = main.RealtimeIntakeRequest(provider_id="test-contributor", records=[record])
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {
                "CITYOS_REALTIME_INGEST_TOKEN": "local-test-token",
                "CITYOS_EXTERNAL_DATA_DIR": folder,
            }), patch.object(main, "EXTERNAL_DATA", Path(folder)):
                with self.assertRaises(HTTPException) as blocked:
                    asyncio.run(main.api_realtime_intake(body, SimpleNamespace(headers={})))
                self.assertEqual(blocked.exception.status_code, 401)
                response = asyncio.run(main.api_realtime_intake(
                    body, SimpleNamespace(headers={"X-CityOS-Intake-Token": "local-test-token"}),
                ))
                self.assertEqual(response["accepted_count"], 1)
                self.assertFalse(response["forecast_input_ready"])
                repeated = asyncio.run(main.api_realtime_intake(
                    body, SimpleNamespace(headers={"X-CityOS-Intake-Token": "local-test-token"}),
                ))
                self.assertEqual(repeated["repeated_count"], 1)
                snapshot = main.api_realtime_snapshot()
                self.assertEqual(snapshot["stored_record_count"], 1)
                self.assertEqual(snapshot["intake_label"], "contributed_unverified")
                self.assertFalse(snapshot["public_warning_ready"])

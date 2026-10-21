import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.app.hydraulic_demo import make_inp
from backend.app.model_release_gate import candidate_digest, review_candidate
from backend.app.sensorthings_provider import candidates_from_page, import_page
from backend.app.realtime_store import load_snapshot
from backend.app.realtime_ingestion import ZHEJIANG_CITY_ORDER

ROOT = Path(__file__).resolve().parents[1]


class HydraulicDeliveryTest(unittest.TestCase):
    def test_published_hydraulics_have_four_complete_city_runs(self):
        data = json.loads((ROOT / 'frontend/public/data/zhejiang-demo-snapshot.json').read_text())
        self.assertEqual(data['model']['engine'], 'epa_swmm')
        h = data['hydraulics']
        self.assertFalse(h['calibrated'])
        self.assertFalse(h['surface_extent_available'])
        for cid in ZHEJIANG_CITY_ORDER:
            depths = h['cities'][cid]['depth_cm_by_point']
            self.assertEqual(len(depths), 25)
            self.assertTrue(all(len(v) == 73 and min(v) >= 0 for v in depths.values()))
            check = h['acceptance']['cities'][cid]
            self.assertEqual(check['dry_peak_cm'], 0)
            self.assertTrue(check['repeat_equal'])
            self.assertLessEqual(check['larger_pipe_peak_cm'], check['baseline_peak_cm'])
            self.assertLess(max(map(abs, check['continuity'].values())), 1)
            for hour, plan in enumerate(h['resource_plans'][cid]):
                self.assertEqual(plan['hour'], hour)
                self.assertEqual(sum(a['teams'] for a in plan['assignments']), plan['assigned_teams'])
                self.assertLessEqual(plan['assigned_teams'], plan['available_teams'])
                self.assertEqual(plan['assigned_teams'] + plan['unmet_teams'], plan['required_teams'])
                self.assertFalse(plan['automatic_dispatch_ready'])

    def test_model_input_has_explicit_synthetic_units_ponding_and_boundaries(self):
        data = json.loads((ROOT / 'frontend/public/data/zhejiang-demo-snapshot.json').read_text())
        inp, points = make_inp(data, 'ningbo')
        self.assertEqual(len(points), 25)
        for token in ['SYNTHETIC', 'FLOW_UNITS CMS', 'ALLOW_PONDING YES', 'FLOW_ROUTING DYNWAVE', '[TIMESERIES]', '10000']:
            self.assertIn(token, inp)
        with self.assertRaises(ValueError):
            make_inp(data, 'shenzhen')
        with self.assertRaises(ValueError):
            make_inp(data, 'ningbo', rain_scale=-1)

    def test_replay_feed_never_emits_future_driver_rows(self):
        frames = [json.loads(line) for line in (ROOT / 'frontend/public/data/hydraulic-demo/feed.ndjson').read_text().splitlines()]
        self.assertEqual(len(frames), 73)
        for hour, frame in enumerate(frames):
            self.assertEqual(frame['scenario_hour'], hour)
            self.assertEqual(len(frame['inputs']), 4)
            self.assertTrue(all(r['hour'] == hour for r in frame['inputs']))
            self.assertIsNone(frame['observed_at'])
            self.assertIsNone(frame['available_at'])


class ReleaseGateTest(unittest.TestCase):
    def setUp(self):
        self.c = {'version': 'v2', 'parent_version': 'v1', 'scope': 'synthetic_demo'}
        self.v = {'candidate_sha256': candidate_digest(self.c), 'max_continuity_error_pct': .01,
                  **{name: True for name in ['frozen_backtest_passed', 'leakage_checks_passed', 'safety_checks_passed', 'shadow_run_passed', 'rollback_test_passed']}}
        self.a = {'reviewer': 'human-test', 'candidate_sha256': candidate_digest(self.c), 'decision': 'approve'}

    def test_tests_or_self_declared_json_cannot_activate_model(self):
        self.assertEqual(review_candidate(self.c, self.v)['status'], 'blocked')
        self.assertEqual(review_candidate(self.c, self.v, self.a)['status'], 'blocked')
        approved = review_candidate(self.c, self.v, self.a, authenticated_reviewer='human-test')
        self.assertEqual(approved['status'], 'eligible_for_manual_release')
        self.assertFalse(approved['automatic_activation'])

    def test_tamper_safety_failure_or_missing_real_evidence_blocks(self):
        for validation in [{**self.v, 'candidate_sha256': 'other'}, {**self.v, 'safety_checks_passed': False}, {**self.v, 'max_continuity_error_pct': float('nan')}]:
            self.assertEqual(review_candidate(self.c, validation, self.a, authenticated_reviewer='human-test')['status'], 'blocked')
        real = {**self.c, 'scope': 'real_city'}
        self.assertIn('real_world_evidence_missing', review_candidate(real, self.v)['blockers'])
        for count in [float('nan'), True, '1', None, 0]:
            evidence = {**self.v, 'independent_observation_count': count, 'event_holdout_count': 1}
            self.assertIn('real_world_evidence_missing', review_candidate(real, evidence)['blockers'])


class SensorThingsIntakeTest(unittest.TestCase):
    def setUp(self):
        self.config = {'provider_id': 'test-provider', 'license_verified': True, 'license_id': 'test-only',
                       'source_name': 'test fixture', 'source_reference': 'https://example.invalid',
                       'streams': {'1': {'city_id': 'ningbo', 'phenomenon': 'rainfall', 'unit': 'mm/h'}}}
        self.page = {'value': [{'@iot.id': 1, 'phenomenonTime': '2026-10-01T00:00:00+08:00', 'resultTime': '2026-10-01T00:01:00+08:00',
                      'result': 15, 'Datastream': {'@iot.id': 1, 'unitOfMeasurement': {'symbol': 'mm/h'}},
                      'FeatureOfInterest': {'feature': {'type': 'Point', 'coordinates': [121.5, 29.8]}}}]}

    def test_mapping_preserves_unknown_publication_and_real_intake_is_idempotent(self):
        candidates = candidates_from_page(self.page, self.config)
        self.assertIsNone(candidates[0]['provider_published_at'])
        with tempfile.TemporaryDirectory() as folder:
            store = Path(folder) / 'test.sqlite3'
            first = import_page(self.page, self.config, store)
            repeated = import_page(self.page, self.config, store)
            self.assertEqual(first['inserted_count'], 1)
            self.assertEqual(repeated['repeated_count'], 1)
            snapshot = load_snapshot(store, city_order=ZHEJIANG_CITY_ORDER)
            self.assertEqual(snapshot['stored_record_count'], 1)
            self.assertFalse(snapshot['public_warning_ready'])
            self.assertFalse(snapshot['automatic_dispatch_ready'])

    def test_wrong_unit_unmapped_or_unlicensed_source_rejects(self):
        with self.assertRaises(ValueError):
            candidates_from_page(self.page, {**self.config, 'license_verified': False})
        with self.assertRaises(ValueError):
            candidates_from_page(self.page, {**self.config, 'streams': {}})
        self.page['value'][0]['Datastream']['unitOfMeasurement']['symbol'] = 'inch'
        with self.assertRaises(ValueError):
            candidates_from_page(self.page, self.config)

    def test_invalid_page_cannot_write_partial_observations(self):
        self.page['value'].append({**self.page['value'][0], '@iot.id': 2, 'result': 'invalid'})
        with tempfile.TemporaryDirectory() as folder:
            store = Path(folder) / 'test.sqlite3'
            with self.assertRaises(ValueError):
                import_page(self.page, self.config, store)
            self.assertFalse(store.exists())

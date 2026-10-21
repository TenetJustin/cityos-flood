"""Bounded, explicit SensorThings -> existing CityOS ingestion contract.

No secrets in output. Caller config maps streams, units, licence and datum.
ResultTime is deliberately not treated as publication/availability time.
"""
import hashlib
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from .realtime_ingestion import ZHEJIANG_CITY_ORDER, poll_provider
from .realtime_store import save_records


def candidates_from_page(page, config):
    if config.get("license_verified") is not True or not config.get("license_id") or not config.get("source_name"):
        raise ValueError("verified licence and source metadata required")
    if not isinstance(page.get("value"), list):
        raise ValueError("SensorThings value array required")
    candidates = []
    for obs in page["value"]:
        stream = obs.get("Datastream", {})
        mapping = config.get("streams", {}).get(str(stream.get("@iot.id")))
        if not mapping:
            raise ValueError("unmapped datastream; no inference of city or units")
        feature = obs.get("FeatureOfInterest", {}).get("feature", {})
        geometry = feature.get("geometry") if feature.get("type") == "Feature" else feature
        if geometry.get("type") != "Point" or "@iot.id" not in obs:
            raise ValueError("point geometry and stable observation ID required")
        lon, lat = geometry["coordinates"][:2]
        if not 118 <= lon <= 124 or not 27 <= lat <= 32 or mapping.get("city_id") not in ZHEJIANG_CITY_ORDER:
            raise ValueError("observation outside Zhejiang study scope")
        if stream.get("unitOfMeasurement", {}).get("symbol") != mapping["unit"]:
            raise ValueError("unit mismatch")
        version = hashlib.sha256(json.dumps(obs, sort_keys=True, allow_nan=False).encode()).hexdigest()
        candidates.append({"provider_record_id": str(obs["@iot.id"]), "provider_record_version": version,
            "city_id": mapping["city_id"], "phenomenon": mapping["phenomenon"], "station_id": str(stream["@iot.id"]),
            "geometry_or_area": str(obs.get("FeatureOfInterest", {}).get("@iot.id", stream["@iot.id"])),
            "longitude": lon, "latitude": lat, "horizontal_crs": "EPSG:4326", "vertical_datum": mapping.get("vertical_datum"),
            "value": obs.get("result"), "unit": mapping["unit"], "observed_at": obs.get("phenomenonTime"),
            "provider_published_at": None, "source_name": config["source_name"], "source_reference": config["source_reference"],
            "license_id": config["license_id"], "quality_flags": ["raw", "source_not_independently_verified"]})
    return candidates


def import_page(page, config, store_path, *, received_at=None):
    received = received_at or datetime.now(timezone.utc)
    processed = max(received, datetime.now(timezone.utc))
    class Provider:
        provider_id = config["provider_id"]
        def fetch(self, **kwargs):
            return candidates_from_page(page, config)
    result = poll_provider(Provider(), since=None, until=processed, received_at=received, processed_at=processed, city_order=ZHEJIANG_CITY_ORDER)
    if result["rejected_count"] or result["status"] in {"rejected", "unavailable"}:
        raise ValueError("provider page rejected; no partial page committed")
    return {**save_records(store_path, result["accepted_records"]), "accepted_count": result["accepted_count"], "forecast_input_ready": False}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("redirect denied; review provider URL before changing it")


def fetch_page(url, *, allowed_origin, bearer_token=None):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or f"{parsed.scheme}://{parsed.netloc}" != allowed_origin:
        raise ValueError("only the explicitly configured HTTPS origin is allowed")
    request = urllib.request.Request(url, headers={"Accept": "application/json", **({"Authorization": f"Bearer {bearer_token}"} if bearer_token else {})})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        raw = response.read(5_000_001)
    if len(raw) > 5_000_000:
        raise ValueError("provider page exceeds 5 MB limit")
    return json.loads(raw)

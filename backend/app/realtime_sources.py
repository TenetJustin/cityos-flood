"""Auditable registry for candidate five-city realtime data sources.

This module records what has actually been discovered about each source.  A
catalog entry is not a working feed, and a working feed is not automatically a
validated model input.  Provider credentials and network clients deliberately
live outside this registry.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Iterable

from .evidence_contract import CITY_IDS


CHECKED_AT = "2026-10-19"
SUPPORTED_PHENOMENA = frozenset({
    "rainfall", "tide_level", "river_level", "flood_depth", "road_closure",
})
ENTRY_TYPES = frozenset({"dataset_candidate", "portal_lead"})
ACCESS_STATES = frozenset({
    "discovered", "catalog_confirmed", "access_confirmed", "access_restricted",
})
MAPPING_STATES = frozenset({"not_assessed", "blocked", "verified"})
ADAPTER_STATES = frozenset({"not_implemented", "legacy_unreviewed", "tested"})


# Keep the entries explicit: missing metadata must remain ``None`` instead of
# being inferred from a portal label or a legacy adapter implementation.
_SOURCES = (
    {
        "source_id": "shanghai-underpass-flood-depth-catalog",
        "city_id": "shanghai",
        "entry_type": "dataset_candidate",
        "publisher": "上海市水务局",
        "source_name": "下立交实时积水深度",
        "source_reference": (
            "https://data.sh.gov.cn/cmsres/c8/"
            "c87badc4f16e4481a8e8a30665b64a1c/938b00188faa9e46ea4f351fa793739a.pdf"
        ),
        "candidate_phenomena": ["flood_depth"],
        "raw_phenomenon": "下立交积水监测数值",
        "access_state": "catalog_confirmed",
        "access_mode": "catalog_lists_unconditional_access_endpoint_not_located",
        "authentication_required": None,
        "expected_update_frequency": "irregular",
        "source_timezone": "Asia/Shanghai",
        "observed_at_field": "监测时间",
        "available_at_semantics": None,
        "horizontal_crs": None,
        "vertical_datum": None,
        "unit": None,
        "license_status": "catalog_access_label_only_dataset_terms_not_reviewed",
        "schema_mapping_status": "blocked",
        "adapter_status": "not_implemented",
        "blockers": [
            "download_or_api_endpoint_not_confirmed",
            "unit_and_coordinate_reference_not_confirmed",
            "actual_available_at_not_defined",
            "dataset_level_terms_not_reviewed",
        ],
    },
    {
        "source_id": "ningbo-public-data-portal-lead",
        "city_id": "ningbo",
        "entry_type": "portal_lead",
        "publisher": "宁波市数据服务体系",
        "source_name": "宁波市数据开放平台入口",
        "source_reference": "https://qf.ningbo.gov.cn/qfpt/fwbk/sjfw/index.html",
        "candidate_phenomena": [],
        "raw_phenomenon": None,
        "access_state": "discovered",
        "access_mode": "portal_or_application",
        "authentication_required": None,
        "expected_update_frequency": None,
        "source_timezone": None,
        "observed_at_field": None,
        "available_at_semantics": None,
        "horizontal_crs": None,
        "vertical_datum": None,
        "unit": None,
        "license_status": "unknown",
        "schema_mapping_status": "not_assessed",
        "adapter_status": "not_implemented",
        "blockers": [
            "no_specific_realtime_flood_dataset_located",
            "access_terms_unknown",
            "schema_unknown",
        ],
    },
    {
        "source_id": "fuzhou-public-data-portal-lead",
        "city_id": "fuzhou",
        "entry_type": "portal_lead",
        "publisher": "福建省人民政府",
        "source_name": "福建省数据开放入口",
        "source_reference": "https://www.fujian.gov.cn/zwgk/index.htm",
        "candidate_phenomena": [],
        "raw_phenomenon": None,
        "access_state": "discovered",
        "access_mode": "portal_or_application",
        "authentication_required": None,
        "expected_update_frequency": None,
        "source_timezone": None,
        "observed_at_field": None,
        "available_at_semantics": None,
        "horizontal_crs": None,
        "vertical_datum": None,
        "unit": None,
        "license_status": "unknown",
        "schema_mapping_status": "not_assessed",
        "adapter_status": "not_implemented",
        "blockers": [
            "monitoring_system_described_but_export_not_located",
            "historical_and_realtime_access_unknown",
            "schema_and_license_unknown",
        ],
    },
    {
        "source_id": "shenzhen-waterlogging-level",
        "city_id": "shenzhen",
        "entry_type": "dataset_candidate",
        "publisher": "深圳市水务局",
        "source_name": "市水务局积涝点水位数据",
        "source_reference": "https://opendata.sz.gov.cn/",
        "external_identifiers": {
            "file_id": "1818478466449911808",
            "resource_id": "29200/01403147",
        },
        "candidate_phenomena": ["flood_depth"],
        "raw_phenomenon": "积涝点水位",
        "access_state": "access_confirmed",
        "access_mode": "authenticated_download_session",
        "authentication_required": True,
        "expected_update_frequency": "near_realtime_portal_updates_observed",
        "source_timezone": "Asia/Shanghai_assumed_by_legacy_parser",
        "observed_at_field": "时间",
        "available_at_semantics": None,
        "horizontal_crs": None,
        "vertical_datum": None,
        "unit": "m_in_legacy_parser_not_source_reviewed",
        "license_status": "dataset_terms_not_reviewed",
        "schema_mapping_status": "blocked",
        "adapter_status": "legacy_unreviewed",
        "blockers": [
            "raw_level_not_proven_equivalent_to_flood_depth",
            "vertical_reference_or_sensor_zero_unknown",
            "actual_available_at_not_recorded",
            "session_credentials_required",
            "dataset_level_terms_not_reviewed",
        ],
    },
    {
        "source_id": "shenzhen-reservoir-rainfall",
        "city_id": "shenzhen",
        "entry_type": "dataset_candidate",
        "publisher": "深圳市水务局",
        "source_name": "水库站点降雨量实时信息",
        "source_reference": "https://opendata.sz.gov.cn/",
        "candidate_phenomena": ["rainfall"],
        "raw_phenomenon": "水库站点降雨量",
        "access_state": "catalog_confirmed",
        "access_mode": "portal_dataset_or_api",
        "authentication_required": None,
        "expected_update_frequency": "near_realtime_portal_updates_observed",
        "source_timezone": None,
        "observed_at_field": None,
        "available_at_semantics": None,
        "horizontal_crs": None,
        "vertical_datum": "not_applicable",
        "unit": None,
        "license_status": "dataset_terms_not_reviewed",
        "schema_mapping_status": "blocked",
        "adapter_status": "not_implemented",
        "blockers": [
            "dataset_schema_not_acquired",
            "observation_interval_and_accumulation_window_unknown",
            "actual_available_at_not_defined",
            "dataset_level_terms_not_reviewed",
        ],
    },
    {
        "source_id": "shenzhen-ground-weather-observation",
        "city_id": "shenzhen",
        "entry_type": "dataset_candidate",
        "publisher": "深圳市气象局（台）",
        "source_name": "地面观测数据_深圳国家基本气象站观测实况",
        "source_reference": "https://opendata.sz.gov.cn/",
        "candidate_phenomena": ["rainfall"],
        "raw_phenomenon": "地面气象站观测实况",
        "access_state": "catalog_confirmed",
        "access_mode": "portal_dataset_or_api",
        "authentication_required": None,
        "expected_update_frequency": "near_realtime_portal_updates_observed",
        "source_timezone": None,
        "observed_at_field": None,
        "available_at_semantics": None,
        "horizontal_crs": None,
        "vertical_datum": "not_applicable",
        "unit": None,
        "license_status": "dataset_terms_not_reviewed",
        "schema_mapping_status": "blocked",
        "adapter_status": "not_implemented",
        "blockers": [
            "dataset_schema_not_acquired",
            "rainfall_field_and_temporal_grain_not_confirmed",
            "actual_available_at_not_defined",
            "dataset_level_terms_not_reviewed",
        ],
    },
    {
        "source_id": "haikou-hainan-data-portal-lead",
        "city_id": "haikou",
        "entry_type": "portal_lead",
        "publisher": "海南省公共数据体系",
        "source_name": "海南省公共数据开放入口候选",
        "source_reference": "https://data.hainan.gov.cn/",
        "candidate_phenomena": [],
        "raw_phenomenon": None,
        "access_state": "discovered",
        "access_mode": "portal_unconfirmed",
        "authentication_required": None,
        "expected_update_frequency": None,
        "source_timezone": None,
        "observed_at_field": None,
        "available_at_semantics": None,
        "horizontal_crs": None,
        "vertical_datum": None,
        "unit": None,
        "license_status": "unknown",
        "schema_mapping_status": "not_assessed",
        "adapter_status": "not_implemented",
        "blockers": [
            "portal_not_reliably_accessible_during_review",
            "no_specific_realtime_flood_dataset_located",
            "schema_and_license_unknown",
        ],
    },
)


def _validate_registry(entries: Iterable[dict]) -> None:
    seen = set()
    for entry in entries:
        source_id = entry.get("source_id")
        if not source_id or source_id in seen:
            raise ValueError("实时来源 source_id 必须存在且唯一")
        seen.add(source_id)
        if entry.get("city_id") not in CITY_IDS:
            raise ValueError(f"{source_id}: 未知城市")
        if entry.get("entry_type") not in ENTRY_TYPES:
            raise ValueError(f"{source_id}: 未知登记类型")
        if entry.get("access_state") not in ACCESS_STATES:
            raise ValueError(f"{source_id}: 未知访问状态")
        if entry.get("schema_mapping_status") not in MAPPING_STATES:
            raise ValueError(f"{source_id}: 未知映射状态")
        if entry.get("adapter_status") not in ADAPTER_STATES:
            raise ValueError(f"{source_id}: 未知适配器状态")
        if not set(entry.get("candidate_phenomena", ())).issubset(SUPPORTED_PHENOMENA):
            raise ValueError(f"{source_id}: 包含未知现象")
        reference = entry.get("source_reference", "")
        if not reference.startswith("https://"):
            raise ValueError(f"{source_id}: 来源引用必须是 HTTPS")
        if not entry.get("blockers"):
            raise ValueError(f"{source_id}: 候选来源必须显式记录未决项")


_validate_registry(_SOURCES)


def _is_realtime_observation_eligible(entry: dict) -> bool:
    """Eligibility is intentionally unreachable until every gate is evidenced."""
    return bool(
        entry["entry_type"] == "dataset_candidate"
        and entry["access_state"] == "access_confirmed"
        and entry["schema_mapping_status"] == "verified"
        and entry["adapter_status"] == "tested"
        and entry["available_at_semantics"]
        and entry["license_status"] == "reviewed_for_research_use"
        and not entry["blockers"]
    )


def source_catalog(city_id: str | None = None,
                   phenomenon: str | None = None) -> dict:
    """Return candidate sources and coverage without claiming live readiness."""
    if city_id is not None and city_id not in CITY_IDS:
        raise ValueError(f"未知城市: {city_id}")
    if phenomenon is not None and phenomenon not in SUPPORTED_PHENOMENA:
        raise ValueError(f"未知现象: {phenomenon}")

    entries = []
    for raw in _SOURCES:
        if city_id is not None and raw["city_id"] != city_id:
            continue
        if phenomenon is not None and phenomenon not in raw["candidate_phenomena"]:
            continue
        item = deepcopy(raw)
        item["realtime_observation_eligible"] = _is_realtime_observation_eligible(item)
        item["forecast_input_ready"] = False
        item["model_assimilation_ready"] = False
        item["public_warning_ready"] = False
        item["automatic_dispatch_ready"] = False
        entries.append(item)
    entries.sort(key=lambda item: (item["city_id"], item["source_id"]))

    selected_cities = [city_id] if city_id else sorted(CITY_IDS)
    coverage = {}
    for selected_city in selected_cities:
        city_entries = [item for item in entries if item["city_id"] == selected_city]
        coverage[selected_city] = {
            "registered_entries": len(city_entries),
            "dataset_candidates": sum(
                item["entry_type"] == "dataset_candidate" for item in city_entries
            ),
            "portal_leads": sum(
                item["entry_type"] == "portal_lead" for item in city_entries
            ),
            "candidate_phenomena": sorted({
                kind for item in city_entries for kind in item["candidate_phenomena"]
            }),
            "eligible_realtime_sources": sum(
                item["realtime_observation_eligible"] for item in city_entries
            ),
            "realtime_analysis_ready": False,
        }

    return {
        "checked_at": CHECKED_AT,
        "status": "registry_only_no_live_five_city_feed",
        "filters": {"city_id": city_id, "phenomenon": phenomenon},
        "sources": entries,
        "coverage": coverage,
        "source_count": len(entries),
        "eligible_realtime_source_count": sum(
            item["realtime_observation_eligible"] for item in entries
        ),
        "forecast_input_ready": False,
        "model_assimilation_ready": False,
        "public_warning_ready": False,
        "automatic_dispatch_ready": False,
        "note": (
            "登记表示已经定位来源或入口；只有访问、许可、时间语义、字段映射、"
            "适配器测试和来源复核全部通过后，记录才可能进入实时研究分析。"
        ),
    }


# -*- coding: utf-8 -*-
"""Human Impact Engine — central parameter registry.

EVERY threshold, probability and weight used by the human-impact pipeline
lives here (never scattered in business code), grouped by stage, and each
group carries an explicit provenance tag:

    observed  — real telemetry / official open data
    derived   — computed from observed data
    estimated — statistical modelling
    assumed   — human-set parameter without local calibration

Anything tagged ``assumed`` is a decision parameter; replace it with
observed/derived values when better local data arrives.
"""
from __future__ import annotations

# ============================================================================
# 1. Time & spatial resolution (derived from existing project convention)
# ============================================================================
GRID_RES = 0.018           # degrees; matches gridrisk.DEFAULT_RES
DAY_SEGMENTS = {           # segment -> (start_h, end_h); commute windows overlap-free
    "morning_commute": (6, 9),
    "daytime": (9, 17),
    "evening_commute": (17, 20),
    "nighttime": (20, 6),  # wraps past midnight
}

# ============================================================================
# 2. Population cohorts — shares of total population per district.
#    Baseline shares approximate Shenzhen census-derived macro structure
#    (assumed, replaceable with district micro-census when available).
#    Per-district elderly/student adjustments are rough (assumed).
# ============================================================================
COHORTS = ("office_worker", "student", "elderly", "resident", "visitor",
           "public_service_worker")

COHORT_SHARE_BASELINE = {          # assumed (citywide macro structure)
    "office_worker": 0.20,
    "student": 0.13,
    "elderly": 0.06,
    "resident": 0.53,
    "visitor": 0.03,
    "public_service_worker": 0.05,
}
# district multipliers applied to the baseline; values are assumed ranks
# (older built-up districts have more elderly; university towns more students).
DISTRICT_COHORT_ADJ = {            # assumed
    "futian":    {"elderly": 1.15, "office_worker": 1.10, "student": 1.00},
    "luohu":     {"elderly": 1.35, "office_worker": 1.10, "student": 0.90},
    "nanshan":   {"elderly": 1.00, "office_worker": 1.25, "student": 1.25},
    "baoan":     {"elderly": 0.95, "office_worker": 0.90, "student": 1.00},
    "longgang":  {"elderly": 0.95, "office_worker": 0.90, "student": 1.05},
    "yantian":   {"elderly": 1.25, "office_worker": 0.80, "student": 0.85},
    "longhua":   {"elderly": 0.90, "office_worker": 1.05, "student": 1.10},
    "pingshan":  {"elderly": 0.80, "office_worker": 0.80, "student": 1.10},
    "guangming": {"elderly": 0.75, "office_worker": 0.95, "student": 1.10},
    "dapeng":    {"elderly": 1.40, "office_worker": 0.60, "student": 0.80},
}

# Which building classes weight each cohort's daytime anchoring cell.
# (observed building_type from OSM unified building_point.csv)
BUILDING_CLASSES = {
    "residential": {"apartments", "house", "residential", "semidetached_house",
                    "dormitory", "terrace"},
    "commercial": {"commercial", "retail", "hotel"},
    "office": {"office", "commercial"},
    "school": {"school", "university", "kindergarten"},
    "industrial": {"industrial", "warehouse", "shed"},
    "service": {"hospital", "service", "transportation", "temple"},
}

# ============================================================================
# 3. Vulnerability weights (assumed; built on district_vulnerability base)
# ============================================================================
VULN_WEIGHTS = {                 # assumed (score composition, see population_base)
    "district_base": 0.55,
    "elderly_share": 0.20,
    "isolation": 0.10,           # low surrounding population density proxy
    "low_elevation": 0.15,
}

# Daytime re-distribution soft cap: single-cell daytime population cannot
# concentrate beyond this multiple of its night population before saturation
# (assumed; dampens anchor weights, keeps global mass conserved).
DAYTIME_SATURATION = {
    "max_multiplier": 6.0,       # rough physical cap multiple
    "soft_saturation": 300.0,    # anchor-weight saturation floor (soft)
}

# ============================================================================
# 4. Exposure thresholds per hazard (assumed unless tagged otherwise)
# ============================================================================
WATER_DEPTH_M = {
    # depth thresholds that matter for people, metres
    "trip_impeded": 0.15,        # wading/roads passable only with care
    "stranded": 0.30,            # cars/buses cannot move; people wade
    "service_loss": 0.50,        # metro/underground facilities flood
}
# per-cohort extra health sensitivity to heat (multiplier on risk, assumed)
HEAT_SENSITIVITY = {
    "elderly": 2.5, "student": 1.3, "resident": 1.0,
    "office_worker": 1.0, "public_service_worker": 1.2, "visitor": 1.2,
}
HEAT_RISK_T_APPARENT = 33.0     # °C apparent threshold to start accumulating (assumed)
HEAT_RISK_T_HARD = 38.0         # °C apparent → high risk (assumed)
HEAT_MED_FACTOR = 0.2           # share of high-risk cohort population counted as medical risk (assumed)

WIND_M_S = {                     # typhoon thresholds (assumed, Beaufort-anchored)
    "trip_avoid": 17.2,          # ≥ 8级: 户外出行显著减少
    "tree_debris": 20.8,         # ≥ 9级: 树木/广告牌倒伏风险 → 路障
    "power_outage": 28.5,        # ≥ 11级: 电力中断概率显著
}
MMI_LEVELS = {                   # earthquake MMI thresholds (assumed, intensity-anchored)
    "felt": 4.0,                 # 有感: 人员离开高层
    "evacuate": 6.0,             # 明显破坏: 疏散建筑
    "road_damage": 6.5,          # 道路受损/桥梁封闭
    "medical_demand": 6.0,       # 伤患上升
}
FOG_VIS_M = {"port_stop": 500.0, "road_hazard": 1000.0}   # assumed
LAND_SLIDE_LEVEL_RED = 3        # susceptibility risk_level >= this → zone alert (derived from 300 pts)
SURGE_OVERBANK_M = 0.5          # coastal overbank depth above normal → inundation (assumed)

# ============================================================================
# 5. Behavior model — action availability + probabilistic response
# ============================================================================
BEHAVIOR_ACTIONS = (
    "stay", "stay_home", "normal_trip", "cancel_trip", "reroute",
    "switch_transport", "evacuate", "seek_shelter", "seek_medical_help",
    "wait", "return_home",
)

# Base action probabilities per cohort during normal conditions (assumed).
BEHAVIOR_BASE = {            # action -> prob (rest filled by stay)
    "normal_trip": 0.45, "stay": 0.30, "stay_home": 0.15, "wait": 0.10,
}

# hazard_type -> (condition predicate key, action shift weights)
# Each entry: action: probability weight applied on top of base when the
# hazard condition matches. Different hazards must produce different mixes.
BEHAVIOR_SHIFTS = {
    "pluvial_flood": {         # 内涝: 绕行/换乘为主
        "reroute": 0.55, "switch_transport": 0.35, "cancel_trip": 0.20,
        "wait": 0.15, "stay_home": 0.10, "normal_trip": -0.45,
    },
    "typhoon": {               # 台风: 居家/取消出行为主
        "stay_home": 0.75, "cancel_trip": 0.55, "return_home": 0.25,
        "seek_shelter": 0.15, "normal_trip": -0.80, "reroute": -0.10,
    },
    "earthquake": {            # 地震: 疏散/寻求避难/医疗为主
        "evacuate": 0.80, "seek_shelter": 0.55, "seek_medical_help": 0.20,
        "wait": 0.30, "normal_trip": -0.90,
    },
    "heatwave": {              # 高温: 减少户外 → 居家/室内
        "stay_home": 0.30, "cancel_trip": 0.20, "wait": 0.10,
        "normal_trip": -0.30,
    },
    "landslide": {             # 滑坡/山洪: 避险撤离（受威胁社区）
        "evacuate": 0.45, "seek_shelter": 0.30, "reroute": 0.20,
        "return_home": -0.05, "normal_trip": -0.40,
    },
    "storm_surge": {           # 风暴潮: 沿海撤离 + 出行取消
        "evacuate": 0.45, "cancel_trip": 0.40, "seek_shelter": 0.35,
        "stay_home": 0.20, "normal_trip": -0.70,
    },
    "flash_flood": {           # 山洪沟道: 撤离 + 绕行
        "evacuate": 0.50, "seek_shelter": 0.25, "reroute": 0.35,
        "cancel_trip": 0.30, "normal_trip": -0.60,
    },
}

# ============================================================================
# 6. Cascade model parameters (assumed)
# ============================================================================
CASCADE = {
    "road_capacity_factor": 0.85,      # reroute congestion multiplier on link
    "metro_capacity_ratio": 0.18,      # metro share of peak trips (assumed)
    "hospital_bed_ratio": 0.0045,      # beds per capita (assumed, ~Shenzhen scale)
    "hospital_occupancy": 0.85,        # baseline bed occupancy
    "shelter_capacity_ratio": 0.004,   # shelter places per capita (assumed)
    "ambulance_response_h": 0.35,      # ~21 min baseline (assumed)
    "traffic_recovery_congestion": 1.4,  # congestion multiplier while reroute persists
}

# ============================================================================
# 7. Recovery model (assumed; per-system hours to restore after end of hazard)
# ============================================================================
RECOVERY_HOURS = {
    "road": 3.0,          # clearing debris/pumping water
    "metro": 10.0,        # track inspection & restart
    "power": 6.0,         # grid re-energize
    "hospital": 4.0,      # triage/supply chain
    "school": 8.0,        # damage inspection
    "shelter": 1.0,       # immediate de-escalation
}
RECOVERY_STATES = {0: "normal", 1: "impacted", 2: "emergency",
                   3: "recovering", 4: "restored"}

# Hazard physical duration (h after T0) before the recovery clock starts.
# Earthquake shaking is instantaneous (0) but impact persists through
# recovery of damaged systems.  All assumed.
HAZARD_END_HOURS = {
    "pluvial_flood": 18.0,
    "typhoon": 24.0,
    "earthquake": 0.0,
    "heatwave": 10.0,
    "landslide": 48.0,
    "storm_surge": 12.0,
    "flash_flood": 12.0,
}

# ============================================================================
# 8. Unified Human Impact Score composition (assumed weights)
# ============================================================================
SCORE_WEIGHTS = {                # component -> weight (must sum to 1.0)
    "exposure_score": 0.25,
    "mobility_loss_score": 0.25,
    "service_loss_score": 0.20,
    "health_risk_score": 0.15,
    "evacuation_pressure_score": 0.15,
}

# ============================================================================
# 9. Provenance registry — every assumed/estimated knob in one place
# ============================================================================
PROVENANCE = {
    "cohort_shares": "assumed(深圳宏观人口结构近似, 基线为全市比例, 区级为相对调整; 可替换为分区普查)",
    "cohort_district_adj": "assumed(按建成年代/大学城等经验排布, 未标定)",
    "vuln_weights": "assumed(评分组成权重, 底座 district_vulnerability 为项目既有估计)",
    "elderly_shares": "assumed(未接入分区 60+ 真实占比前使用; 数值置于 population_base 常量)",
    "water_depth_thresholds": "assumed(0.15m 涉水受限/0.30m 车辆无法通行/0.50m 地铁等地下设施进水; 参考通用内涝分级)",
    "heat_sensitivity": "assumed(相对易感系数)",
    "wind_thresholds": "assumed(按蒲福风级锚定)",
    "mmi_thresholds": "assumed(按中国地震烈度表宏观描述锚定)",
    "behavior_base_and_shifts": "assumed(规则+概率行为参数, 未经行为调查标定)",
    "cascade": "assumed(床位/避难容量/地铁分担率等按深圳量级近似)",
    "recovery_hours": "assumed(系统恢复时长经验值)",
    "score_weights": "assumed(综合评分权重)",
    "facility_locations": "observed(OSM 医院/学校建筑点位) → hospital/school; "
                          "shelter/transport=derived(医院/学校复用+区中心) → assumed 部分",
    "population_base": "observed-derived(GHS-POP E2020 R2023A 100m 栅格聚合; 深圳窗口 22.4–22.9N/113.7–114.6E, 总人口≈1697万)",
    "building_weights": "observed-derived(OSM building_point 87,495 栋, 含 building_type)",
}

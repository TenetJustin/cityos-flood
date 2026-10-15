"""Five-city research scope for the southeast China compound-flood project.

City entries describe intended study domains.  They are not predictions or
evidence that observational data for a city has been connected.
"""
from __future__ import annotations

from .data_paths import EXTERNAL_DATA, research_data_status


CITIES = (
    {
        "id": "shanghai", "name": "上海", "province": "上海",
        "form": "三角洲与河口", "drivers": ["暴雨", "潮位", "河网顶托"],
    },
    {
        "id": "ningbo", "name": "宁波", "province": "浙江",
        "form": "海湾与河口", "drivers": ["台风", "风暴潮", "河流洪水"],
    },
    {
        "id": "fuzhou", "name": "福州", "province": "福建",
        "form": "山海与河谷", "drivers": ["短历时暴雨", "山洪", "闽江潮位顶托"],
    },
    {
        "id": "shenzhen", "name": "深圳", "province": "广东",
        "form": "海湾与丘陵高密城区", "drivers": ["台风", "暴雨", "潮位", "城市快速汇流"],
    },
    {
        "id": "haikou", "name": "海口", "province": "海南",
        "form": "海岛滨海低地", "drivers": ["台风", "风暴潮", "低洼区积水"],
    },
)


def city_catalog() -> dict:
    shenzhen_status = research_data_status()
    cities = []
    for profile in CITIES:
        city_id = profile["id"]
        configured_assets = (
            shenzhen_status["assets"] if city_id == "shenzhen" else {}
        )
        city_dir = EXTERNAL_DATA / "cities" / city_id
        cities.append({
            **profile,
            "implementation_status": (
                "research_prototype" if city_id == "shenzhen" else "configuration_only"
            ),
            "external_city_data_dir": str(city_dir),
            "city_data_dir_present": city_dir.is_dir(),
            "response_observations_file_present": (city_dir / "responses.csv").is_file(),
            "observational_assets": configured_assets,
            "operational_warning_ready": False,
        })
    return {
        "scope": "东南地区台风与城市内涝韧性",
        "coordination_level": "regional_research",
        "cities": cities,
        "note": "城市入选仅界定研究范围；除深圳研究原型外，其余城市尚未接入模型或验证数据。",
    }

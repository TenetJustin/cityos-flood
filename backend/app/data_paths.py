"""Project-local assets and explicitly configured optional research datasets."""
import os
from pathlib import Path

BACKEND_DATA = Path(__file__).resolve().parents[1] / "data"
REAL_GIS = BACKEND_DATA / "real_gis"
EXTERNAL_DATA = Path(
    os.environ.get("CITYOS_EXTERNAL_DATA_DIR")
    or os.environ.get("SZ_FLOOD_DATA_BASE")
    or BACKEND_DATA / "external"
).expanduser().resolve()


class MissingResearchDataError(FileNotFoundError):
    """An optional input needed by a specific research capability is absent."""

    def __init__(self, dataset: str):
        self.dataset = dataset
        super().__init__(f"研究数据未接入: {dataset}")


def external_file(*parts: str) -> Path:
    return EXTERNAL_DATA.joinpath(*parts)


def require_external(*parts: str) -> Path:
    path = external_file(*parts)
    if not path.is_file():
        raise MissingResearchDataError("/".join(parts))
    return path


RESEARCH_ASSETS = {
    "typhoon_track": ("unified", "typhoon_track.csv"),
    "typhoon_forecast": ("unified", "typhoon_forecast.csv"),
    "tide_observations": ("unified", "tide_timeseries.csv"),
    "population_100m": ("unified", "population_grid_100m.csv"),
    "buildings": ("unified", "building_point.csv"),
    "flood_model": ("ml_models", "flood_spatial.pkl"),
    "landslide_model": ("ml_models", "landslide_warning.pkl"),
}


def research_data_status() -> dict:
    assets = {name: {"available": external_file(*parts).is_file(),
                     "relative_path": "/".join(parts)}
              for name, parts in RESEARCH_ASSETS.items()}
    return {
        "external_data_dir": str(EXTERNAL_DATA),
        "assets": assets,
        "required_inputs_present": {
            "typhoon_track": assets["typhoon_track"]["available"],
            "typhoon_whatif": all(assets[k]["available"] for k in
                                       ("typhoon_track", "typhoon_forecast", "landslide_model")),
            "tide_harmonics": assets["tide_observations"]["available"],
            "human_impact": all(assets[k]["available"] for k in
                                ("population_100m", "buildings")),
            "ml_flood_spatial": assets["flood_model"]["available"],
        },
        "note": "这里只检查文件是否存在，不代表内容质量、模型加载或预测精度已通过验证。",
    }


def real_file(name: str) -> str:
    return str(REAL_GIS / name)

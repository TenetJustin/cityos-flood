# 五城数据证据层：来源、检查和当前空白

本文件为研究数据的接入清单，不是五城模型完成声明。可复核的本地结构检查运行：

```bash
backend/.venv/bin/python -m backend.app.evidence_audit > evidence-audit.json
```

输出按资产列出文件缺失、字段缺失、关键字段空值、重复键、时间格式/时区、反应记录的发布时刻早于发生时刻等问题。五城的 `responses.csv` 和 `event_evidence.csv` 均纳入检查；后者另查现象、单位、数值和高程基准的基本规则。`structural_checks_passed` **仅表示这些结构规则通过**，不表示来源真实、观测准确、事件覆盖充分或可用于预警。审计不会下载、改写或补全数据；默认读取仓库内深圳样本和 `CITYOS_EXTERNAL_DATA_DIR/cities/<city_id>/` 下的可选文件。详细列名见 [区域研究路线](REGIONAL_RESEARCH_ROADMAP.md)。

## 跨城候选来源（尚未接入五城模型）

| 要素 | 官方候选来源 | 可支持的用途 | 不能替代的内容 |
|---|---|---|---|
| 台风路径 | [NOAA IBTrACS v4r01](https://www.ncei.noaa.gov/products/international-best-track-archive) | 统一历史台风路径、距城距离和事后复盘 | 当时实际可获得的业务预报、城市内涝实测 |
| 降雨 | [NASA GPM IMERG](https://gpm.nasa.gov/data/imerg) | 跨城一致的卫星降水背景和事件筛选 | 地面分钟级雨量、局地极值的独立核验 |
| 气象背景 | [ECMWF/Copernicus ERA5 单层逐小时再分析](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=overview) | 大尺度背景和历史情景对比 | 街道尺度降雨、事前可用的原始预报 |
| 人口暴露 | [欧盟 GHSL GHS-POP](https://human-settlement.emergency.copernicus.eu/datasets.php) | 跨城一致的人口分布基线 | 实时人口、地下空间在场人数 |
| 地形背景 | [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | 区域地形初筛 | 它是包含建筑和植被的 DSM，不能代替经测绘校验的裸地城市微地形、道路下穿深度和统一高程基准 |

下载前须复核各来源当期授权、版本、粒度、发布时间和适用条件。历史最佳路径与再分析数据是**事后资料**，不能未经时效审计就用于模拟实时预测。

## 五城实施状态与优先补数

| 城市 | 当前本地证据 | 首要缺口 |
|---|---|---|
| 上海 | 尚无城市专属事件/反应数据接入 | 河网与潮位边界、积水/道路中断时序、调度记录 |
| 宁波 | 尚无城市专属事件/反应数据接入 | 台风潮位、甬江水位、积水/交通与响应记录 |
| 福州 | 尚无城市专属事件/反应数据接入 | 山区短历时雨量、闽江水位/潮位、积水与响应记录 |
| 深圳 | 仓库内有事件日降雨、易涝点清单和短时水位切片 | 多年湿事件观测、雨潮河同事件对齐、地下空间/道路影响、居民与部门真实行动 |
| 海口 | 尚无城市专属事件/反应数据接入 | 台风潮位、低洼区积水/道路影响、避险与调度记录 |

五城共同的最低事件包：带来源和使用许可的预报/观测发布时间、雨量、潮位/河水位及其高程基准、可定位积水或道路中断、人口与设施暴露、居民与应急部门**已发生**的反应记录。入库时分开记录“事件发生时刻”和“资料当时可获得时刻”；事后报道不得回填成事前预测特征。城市级可信度需按事件独立验证，跨城比较只能汇总同口径结果。

目前的结构审计不做坐标合理性、雨量/水位物理范围、站点标定、空间代表性、媒体记录真实性和样本选择偏差检查；这些须在相应来源与事件表明确后逐项加入。RSI 仍只允许在人工批准前生成离线候选，不能以这些候选数据自动更新生产模型。

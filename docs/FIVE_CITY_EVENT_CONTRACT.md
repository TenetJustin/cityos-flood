# 五城共用数据与事件接口 v1.0

适用城市：上海、宁波、福州、深圳、海口。代码定义见
`backend/app/evidence_contract.py`。本契约只校验结构和基本语义，不验证来源真伪，
也不会把记录自动升级为训练数据、验证真值、公众预警或调度输入。

## 1. 事件包与读取接口

每个事件使用以下只读目录；原始大数据不提交仓库：

```text
CITYOS_EXTERNAL_DATA_DIR/
└── cities/<city_id>/events/<event_id>/
    ├── manifest.json
    └── assets/                 # 可选；manifest 只引用已获授权的资产
```

读取接口：`GET /api/region/events/{city_id}/{event_id}`。返回值始终包含
`forecast_input_ready=false`、`ground_truth_ready=false`、
`public_warning_ready=false` 和 `automatic_dispatch_ready=false`；后续独立审核不能由
“文件存在”代替。

## 2. 五种证据类别

| `evidence_class` | 含义 | 可否直接作观测真值 |
|---|---|---|
| `observation` | 仪器、人工测量或有明确观测方法的原始/质控记录 | 仍需来源、标定、独立性和事件覆盖审核 |
| `historical_record` | 事后公报、公告、档案或新闻稿中的历史记载 | 否；只支持事件事实或汇总量 |
| `model_inference` | 遥感反演、再分析、插值或模型估计 | 否；须保留模型和版本 |
| `simulation_scenario` | 假设边界、参数化行为或 What-if 输出 | 否；不得描述为已经发生 |
| `missing` | 已知缺失、未公开、未取得、受限或不适用 | 否；`value` 必须为 `null` |

不得用 `derived`、`real`、`truth` 等含混标签绕过这五类。旧
`event_evidence.csv` 是兼容入口，不等于 v1.0 事件包，也不具备真值资格。

## 3. 时间契约

- 五城统一业务时区为 IANA `Asia/Shanghai`；所有事件时间必须带 `+08:00`。
- `observed_at` 是物理现象发生或观测对应的时间。
- `available_at` 是该版本数据实际进入系统、可被当时运行读取的最早时间。
- `source.retrieved_at` 是本项目取得资料的时间，不得代替 `available_at`。
- 同一记录满足 `available_at >= observed_at`。事后公报通常晚于事件发生；如果不知道
  实际可获得时间，该资料不能登记为非缺失记录，应另列缺口；不能用网页当前更新时间
  或本项目下载时间回填。所有非缺失记录必须同时提供两个时间。
- 回测起报时刻 `T0` 只能读取 `available_at <= T0` 的版本；再分析、事后订正和当前网页
  内容只能标为 `hindsight_only`。

## 4. 空间、单位与基准

每条记录必须含 `geometry_or_area`、`horizontal_crs`、`spatial_resolution`。
首选源坐标；跨城汇总前才生成经审计的转换副本。经纬度示例为 `EPSG:4326`；不得把
GCJ-02/BD-09 坐标冒充 EPSG:4326。潮位和河水位非缺失记录必须填写
`vertical_datum`，未知基准的绝对水位不得跨站或与 DEM 直接相减。

推荐规范单位：降雨增量 `mm`、雨强 `mm/h`、水深/潮位/河水位 `m`、流量 `m3/s`、
风速 `m/s`、气压 `hPa`、道路中断 `boolean`、人数 `person`。`unit` 保存源单位；转换值
必须形成新记录并注明转换方法，不能静默覆盖。

## 5. 来源、许可、质量与缺失

`source` 至少保存发布者、标题、稳定引用、取得时间和 `license_id`；已确认时补充
`license_uri` 与 `redistribution_allowed`。网页公开可读不等于允许再分发；条款未核实时
使用 `terms-review-required`，只保存引用和必要摘要。

`quality_flags` 至少一个，可取原始、临时、已质控、可疑、拒绝、空间聚合、时间聚合、
仅事后可用、来源未独立核查或未知。不得删除可疑值后假装数据完整。

缺失记录必须同时满足：`evidence_class=missing`、`value=null`、
`missing_status != present`、`missing_reason` 非空。缺失状态区分未采集、未发布、访问受限、
尚未取得、不适用和未知；`0` 不是缺失，空字符串也不是合法的数值缺失表达。

## 6. 事件状态与晋级

事件状态依次为 `candidate`、`development`、`locked_backtest`。晋级不由接口自动完成。
至少要人工核对原件、许可、双时间、空间/高程基准、仪器质量、缺测机制、事件独立性和
泄漏风险。即使达到锁定回测，也不等于具备公众预警资格。

# 五城市复合风险研究路线（2026-10）

## 范围与架构

上海、宁波、福州、深圳、海口分别代表三角洲河口、海湾河口、山海河谷、高密海湾丘陵、海岛滨海低地。区域层负责统一事件口径、证据状态、跨城对比和资源协调信息；每个城市实例保有自己的高程基准、汇流与排水参数、设施网络和验证事件。共享模型内核提供台风、降雨、潮位、河流边界耦合与影响计算，不能直接套用深圳参数。

完整图见 [东南地区研究架构图](SOUTHEAST_ARCHITECTURE.md)。图中将已发生的真实反应与假设情景分开，并把 RSI 的人工批准和影子运行明确为尚未完成的门槛。

五城首轮官方来源、事件候选、获取权限和回测缺口见
[五城数据源与事件候选登记](FIVE_CITY_SOURCE_EVENT_REGISTER.md)。候选事件不限于台风，
但没有逐站观测、实际可获得时间和独立影响证据的事件不得晋级为锁定回测事件。

`R` 必须是有时间、地点和来源的反应记录。居民侧包括预警接收、理解、延迟、绕行、停工停课、撤离与避难；部门侧包括预警升级、泵闸/水库操作、道路与公交调整、救援投放、避难场所开放。没有观测的行为规则只能标为假设或情景，不得标为“真实居民反应”。

## 数据契约

规范 v1.0 见 [五城共用数据与事件接口](FIVE_CITY_EVENT_CONTRACT.md)，可执行模型位于
`backend/app/evidence_contract.py`。下述 CSV 是旧版兼容入口；新事件应优先使用
`cities/<city_id>/events/<event_id>/manifest.json`，并严格区分 observation、
historical_record、model_inference、simulation_scenario 和 missing。

每条用于验证或响应分析的事件记录至少应有：`city_id`、`event_id`、`phenomenon`、`source_name`、`source_reference`、`observed_at`、`available_at`、`geometry_or_area`、`spatial_resolution`、`temporal_resolution`、`value`、`unit`、`datum`（若涉及高程）、`quality_flags`、`license`、`evidence_level`。`evidence_level` 取 `observed`、`official_record`、`derived`、`modelled`、`parameterized`、`scenario`、`assumed`。居民和部门行动还要记录 `actor_type`、`action_type`、`action_start`、`action_end`、`affected_count` 或 `asset_id`，以及“计划、已执行、事后核实”的状态。

进入跨城比较前必须核对时间与时区、潮位/地面高程基准、空间粒度、缺测与重复、事件窗口、发布时刻，避免把事后数据泄漏到事前预测中。

居民和应急部门行动的首个接入入口为 `CITYOS_EXTERNAL_DATA_DIR/cities/<city_id>/responses.csv`，API 是 `GET /api/region/responses/<city_id>?event_id=...`。CSV 必须包含以下列：

```text
city_id,event_id,actor_type,action_type,action_status,observed_at,available_at,area,source_name,source_reference,evidence_level,affected_count
```

`actor_type` 只接受 `resident` 或 `emergency_department`；`action_status` 只接受 `reported`、`executed`、`verified`；`evidence_level` 只接受 `observed` 或 `official_record`；两个时间需有时区。`affected_count` 可留空。该接口只接收有明确来源的记录，返回值仍标记为“来源已登记、未独立核查”，当前不会自动反馈给影响模型。

同事件雨量、潮位、河水位、积水深度与道路中断的首个接入口为 `CITYOS_EXTERNAL_DATA_DIR/cities/<city_id>/event_evidence.csv`，查询接口是 `GET /api/region/evidence/<city_id>?event_id=...&phenomenon=...`。CSV 列为：

```text
record_id,city_id,event_id,phenomenon,site_id,area,observed_at,available_at,value,unit,datum,spatial_resolution,temporal_resolution,source_name,source_reference,license,evidence_level,quality_flags
```

一行表示某事件、某站点/路段、某现象、某观测时刻的一条记录。`phenomenon` 取 `rainfall`（mm）、`tide_level`/`river_level`/`flood_depth`（m）或 `road_closure`（0/1，`boolean`）；潮位和河水位必须填写明确高程基准。`observed_at` 与 `available_at` 均须有时区，后者不得早于前者。`evidence_level` 限 `observed`、`official_record`、`derived`，卫星估计或推算结果应标为 `derived`。不适用的高程基准填 `not_applicable`；无额外质量标记填 `none`。不能凭自填来源字段认定原件真实，接口仅检查结构和基本领域规则，明确返回 `ground_truth_ready=false`、`forecast_input_ready=false`。

## 实施门槛

1. **深圳基线**：可重复安装、启动、测试；缺失可选数据时返回明确状态；修正夸大的真实性表述。现阶段已启动这一部分。
2. **数据证据层**：把五城公开数据和真实事件按上述契约登记；先用 `python -m backend.app.evidence_audit` 审计当前本地资产的结构性问题，范围和缺口见 [五城数据证据层](FIVE_CITY_DATA_EVIDENCE.md)。结构通过不等于来源、准确性或事件覆盖已验证；置信区间须待独立事件样本后估计。
3. **城市模型**：为每城建立边界条件、地形/排水参数、设施与暴露层；按历史事件独立验证。区域层只汇总已验证输出。
4. **真实反应层**：与居民报告、交通运行、应急公告、实际调度与恢复记录对齐；估计警报到行动的延迟与遵从率，并反馈到影响模型。
5. **受控 RSI**：对真实结果与预测差异进行归因，仅生成参数、规则或模型组合的候选版本；完成多城多事件回测、来源检查、越界与安全校验后，由人工批准并影子运行。任何候选都不能自行修改安全门槛、自动接管现实设施或将模型输出当作真实标签。

发布任何“预警能力”或“调度能力”声明前，还需要独立事件验证、数据更新服务等级、值班责任、与主管部门的联动协议及可回退演练。当前交付属于研究型决策支持原型。

## 分阶段实施与退出条件

| 阶段 | 交付 | 退出条件 | 当前状态 |
|---|---|---|---|
| 0 基线审计 | remote/分支、代码、架构、测试和真实性声明清单 | 可重复测试；所有缺失依赖可见 | 已完成本地基线；137 项通过、3 项因外部数据缺失跳过 |
| 1 证据契约 | 五城事件 manifest、五类证据、双时间、空间/高程、许可、质量和缺失语义 | 契约测试通过；事件不能自动晋级真值 | 本次实现 |
| 2 事件证据包 | 每城至少一个有来源的候选事件；深圳 9·7 为首个端到端候选 | 原件/许可核对；逐站雨水潮河与影响数据缺口清零或量化 | 未达到；见事件证据清单 |
| 3 五城模型 | 共用物理/统计内核 + 五城独立边界、参数、版本和验证事件 | 每城事件外回测；不得复用深圳参数冒充本地校准 | 未实现 |
| 4 区域统筹 | 同口径指标、不确定性和证据等级汇总 | 只汇总已验证结果；缺城不插补成“区域结论” | 未实现 |
| 5 影响评估 | 居民、交通、关键设施和部门行动的观测/情景分层 | 真实行动与假设行为完全分离；偏差和覆盖率已报告 | 未实现 |
| 6 受控 RSI | 误差诊断、候选调整、冻结回测、安全检查、人工批准、影子运行、回退 | 全部门槛有审计记录；版本变更必须人工签署 | 仅有原则，无闭环实现 |

第一阶段不编辑预测或调度算法。DeepSeek Harness 的独立任务边界和验收见
[任务卡](DEEPSEEK_HARNESS_TASK_CARD_PHASE1.md)；其分支完成后必须先独立审查和回测，
未经批准不合并主分支。

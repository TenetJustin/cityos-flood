# 五城市复合风险研究路线（2026-10）

## 范围与架构

上海、宁波、福州、深圳、海口分别代表三角洲河口、海湾河口、山海河谷、高密海湾丘陵、海岛滨海低地。区域层负责统一事件口径、证据状态、跨城对比和资源协调信息；每个城市实例保有自己的高程基准、汇流与排水参数、设施网络和验证事件。共享模型内核提供台风、降雨、潮位、河流边界耦合与影响计算，不能直接套用深圳参数。

完整图见 [东南地区研究架构图](SOUTHEAST_ARCHITECTURE.md)。图中将已发生的真实反应与假设情景分开，并把 RSI 的人工批准和影子运行明确为尚未完成的门槛。

`R` 必须是有时间、地点和来源的反应记录。居民侧包括预警接收、理解、延迟、绕行、停工停课、撤离与避难；部门侧包括预警升级、泵闸/水库操作、道路与公交调整、救援投放、避难场所开放。没有观测的行为规则只能标为假设或情景，不得标为“真实居民反应”。

## 数据契约

每条用于验证或响应分析的事件记录至少应有：`city_id`、`event_id`、`phenomenon`、`source_name`、`source_reference`、`observed_at`、`available_at`、`geometry_or_area`、`spatial_resolution`、`temporal_resolution`、`value`、`unit`、`datum`（若涉及高程）、`quality_flags`、`license`、`evidence_level`。`evidence_level` 取 `observed`、`official_record`、`derived`、`modelled`、`parameterized`、`scenario`、`assumed`。居民和部门行动还要记录 `actor_type`、`action_type`、`action_start`、`action_end`、`affected_count` 或 `asset_id`，以及“计划、已执行、事后核实”的状态。

进入跨城比较前必须核对时间与时区、潮位/地面高程基准、空间粒度、缺测与重复、事件窗口、发布时刻，避免把事后数据泄漏到事前预测中。

居民和应急部门行动的首个接入入口为 `CITYOS_EXTERNAL_DATA_DIR/cities/<city_id>/responses.csv`，API 是 `GET /api/region/responses/<city_id>?event_id=...`。CSV 必须包含以下列：

```text
city_id,event_id,actor_type,action_type,action_status,observed_at,available_at,area,source_name,source_reference,evidence_level,affected_count
```

`actor_type` 只接受 `resident` 或 `emergency_department`；`action_status` 只接受 `reported`、`executed`、`verified`；`evidence_level` 只接受 `observed` 或 `official_record`；两个时间需有时区。`affected_count` 可留空。该接口只接收有明确来源的记录，返回值仍标记为“来源已登记、未独立核查”，当前不会自动反馈给影响模型。

## 实施门槛

1. **深圳基线**：可重复安装、启动、测试；缺失可选数据时返回明确状态；修正夸大的真实性表述。现阶段已启动这一部分。
2. **数据证据层**：把五城公开数据和真实事件按上述契约登记；先用 `python -m backend.app.evidence_audit` 审计当前本地资产的结构性问题，范围和缺口见 [五城数据证据层](FIVE_CITY_DATA_EVIDENCE.md)。结构通过不等于来源、准确性或事件覆盖已验证；置信区间须待独立事件样本后估计。
3. **城市模型**：为每城建立边界条件、地形/排水参数、设施与暴露层；按历史事件独立验证。区域层只汇总已验证输出。
4. **真实反应层**：与居民报告、交通运行、应急公告、实际调度与恢复记录对齐；估计警报到行动的延迟与遵从率，并反馈到影响模型。
5. **受控 RSI**：对真实结果与预测差异进行归因，仅生成参数、规则或模型组合的候选版本；完成多城多事件回测、来源检查、越界与安全校验后，由人工批准并影子运行。任何候选都不能自行修改安全门槛、自动接管现实设施或将模型输出当作真实标签。

发布任何“预警能力”或“调度能力”声明前，还需要独立事件验证、数据更新服务等级、值班责任、与主管部门的联动协议及可回退演练。当前交付属于研究型决策支持原型。

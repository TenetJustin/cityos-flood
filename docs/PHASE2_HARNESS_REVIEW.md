# DeepSeek Harness 第二阶段独立审查

审查日期：2026-10-19。审查对象：`phase2/realtime-observation-core`，
`c2a3e2de87dccde8cf8cac46197f19f277b4e38d`，基线
`904571cbc460af6e2cb9e8e719a48ca069de9989`。

## 已核对

- Git 差异仅增加 `backend/app/realtime_ingestion.py`、
  `backend/app/realtime_analysis.py`、`tests/test_realtime_pipeline.py`，未改写
  Codex 来源注册表或现有 API。Harness 工作树干净，`git diff --check` 通过。
- 独立复跑阶段一及阶段二专项测试：73 项通过。
- 在可写隔离副本复跑全量测试：226 项通过、3 项跳过。
- 在 Harness 原目录复跑全量测试时，旧决策模块的 3 个测试因沙箱不能写入
  `data/_test_decisions.json` 而报 `PermissionError`；隔离副本通过，判定为该目录
  的执行权限差异，非本次代码回归。
- 所有阶段二测试使用内存 fake provider；没有五城真实供应方调用或真实观测回放。

## 需在原 Harness 分支修订的发现

### R1：分析入口未校验规范记录 ID 与内容指纹（高）

`backend/app/realtime_analysis.py` 的 `_normalise_record` 只要求 `record_id` 是非空字符串，
随后接受 `value` 等字段并重新生成内部指纹；它没有用 `canonical_record_id` 重算 ID，
也没有比对输入中的 `content_fingerprint`。独立复现：取 `poll_provider` 返回的一条合格
规范记录，将 `record_id` 改为 `forged-record-id`，再传给 `build_realtime_snapshot`，结果为
`degraded`、零拒绝并把伪造 ID 放入 `selected_record_ids`。仅改 `value` 为 `999.0`，结果
统计均值为 `999.0`，同样零拒绝。

当前没有外部 API 调用该分析入口，因此还不是线上数据事故；但在接入持久化、历史重放
或只读 API 前必须修复，否则记录血缘和内容校验形同虚设。建议用规范字段重算并核对 ID；
若输入带 `content_fingerprint`，也必须核对原始规范内容。任何不一致返回明确拒绝原因，
不得进入统计。测试须分别覆盖篡改 ID 和篡改值。

### R2：快照 ID 的语义须在接入缓存前固定（中）

`build_realtime_snapshot([], as_of=T)` 与
`build_realtime_snapshot([{"bad": "record"}], as_of=T)` 得到相同 `snapshot_id`，但后者
有 `missing_field` 拒绝记录。原因是 `_snapshot_id` 的负载只包含分析结果、版本链和
入选记录，遗漏输入拒绝计数及排除血缘。这与任务卡的“规范化内容 + as_of”定义
可以相容，但下游若以它做完整批次审计索引，就会误认两次质量事件为同一批次。

建议明确 `snapshot_id` 是“分析视图 ID”还是“完整批次审计 ID”。若仅代表分析视图，
保持现有哈希，同时另增批次审计 ID；若用于后者，哈希须包含稳定排序后的拒绝代码、
排除记录标识与冲突摘要，不得包含原始敏感 payload。测试须覆盖空批次、非法批次、
冲突批次及输入顺序不变性。

## 暂不晋级的边界

- 第二阶段核心尚无真实供应方适配器、跨轮询持久化或定时编排。
- 深圳旧的“积涝点水位”尚未证明可映射为统一 `flood_depth`；许可、传感器零点、
  垂直基准和实际可获得时间仍未复核。
- 不运行五城真实历史回测，也不据合成测试宣称预测技巧。
- `forecast_input_ready`、`model_assimilation_ready`、`public_warning_ready` 和
  `automatic_dispatch_ready` 必须继续为 `false`。
- 审查结论：**代码范围与既有测试通过；R1 修订复测、R2 的标识语义固定前不接入
  缓存或只读 API，不合并主分支，不晋级为可交付实时分析。**

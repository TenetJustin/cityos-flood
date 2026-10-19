# DeepSeek Harness 任务卡：历史事件回测评估器（第一阶段）

## 目标

实现一个纯离线、fail-closed 的历史事件回测评估器。它只消费已经通过
`backend.app.evidence_contract.EventManifest` 校验的事件数据，检查起报时点可见性并在
独立观测充分时计算指标。它不下载数据、不训练模型、不生成预警、不提出或执行调度。

## 独占编辑范围

只允许创建或编辑：

- `backend/app/historical_replay.py`
- `tests/test_historical_replay.py`

禁止编辑其他任何文件，尤其是 `backend/app/evidence_contract.py`、`backend/app/main.py`、
`backend/app/forecasting.py`、`backend/app/wam.py`、`backend/data/**`、`docs/**` 和现有测试。
若契约不足，请在交付说明中提出，不得自行扩大范围。任务完成前，项目负责人不会同时
编辑上述两个独占文件。

## 输入契约

公开函数：

```python
evaluate_replay(
    manifest: EventManifest,
    forecasts: list[dict],
    *,
    issued_cutoff_at: datetime,
    evaluation_cutoff_at: datetime,
) -> dict
```

每个 forecast 必须有：`forecast_id`、`issued_at`、`valid_at`、`geometry_or_area`、`phenomenon`、
`value`、`unit`、`model_version`、`input_record_ids`（可为空列表，但须显式提供）。所有时间
必须有时区并为 UTC+08:00。`issued_cutoff_at` 是冻结预报输入的起报时刻；
`evaluation_cutoff_at` 是事后收齐真值的评估时刻，必须晚于或等于起报时刻。

每条预报须满足 `issued_at <= issued_cutoff_at < valid_at`。对其引用的每个输入
`input_record_id`，只允许 `observation` 或当时已经发布的 `historical_record`，且记录的
`available_at <= issued_at`；缺失引用、事后才可获得的版本或其他证据类别均判为泄漏。
空 `input_record_ids` 只表示评估器没有输入血缘可审计，结果必须保留
`input_lineage_verified=false`，不得声称完成了全部泄漏检查。

只有同时满足下列条件的 manifest 记录可以作为数值真值：

- `evidence_class == "observation"`
- `missing_status == "present"`
- `available_at` 非空且 `available_at <= evaluation_cutoff_at`
- `quality_flags` 含 `quality_controlled`，且不含 `suspect`/`rejected`
- `value` 为有限数值
- 与 forecast 的现象、`geometry_or_area`、有效时间和单位完全一致

`historical_record`、`model_inference`、`simulation_scenario` 和 `missing` 永远不能转换为
观测真值。真值可以在起报之后、评估之前取得；不得因其晚于起报时刻而排除。

## 输出契约

返回普通字典：

```text
status: evaluated | insufficient_data | rejected
event_id, issued_cutoff_at, evaluation_cutoff_at, model_versions
matched_pairs, excluded_counts
leakage_checks: {passed, violations, input_lineage_verified}
metrics: {mae, rmse, bias} | null
promotion_allowed: false
public_warning_ready: false
automatic_dispatch_ready: false
```

无匹配的合格观测时返回 `insufficient_data`，不得产生 0 分、NaN 指标或技巧声明。任何
起报后签发、未来输入引用、重复键、单位不一致、非有限值或企图把非观测记录用作真值时
返回 `rejected` 并列出原因。允许其他类别留在 manifest 中，但它们不得进入指标。

## 必须测试

1. 合格的两个观测—预报配对能正确计算 MAE、RMSE、bias。
2. 五种证据类别中只有 `observation` 能进入指标。
3. 起报后、评估前才可获得的独立观测可用于评分；评估后才可获得的观测被排除。
4. `issued_at > issued_cutoff_at`、`valid_at <= issued_cutoff_at` 和起报后才可获得的输入引用均被拒绝。
5. 缺测、可疑/拒绝质量、单位不一致、重复键、NaN/Inf 均 fail closed。
6. 输入列表顺序不改变结果。
7. 所有返回路径的三个能力标记保持 `false`。
8. 输入血缘为空时 `input_lineage_verified=false`，不得报告完整无泄漏结论。

## 验收

- `python -m unittest tests.test_historical_replay -v` 通过。
- `python -m unittest discover -s tests -q` 不产生新增失败。
- 分支 diff 只包含两个允许文件。
- 不新增第三方依赖，不访问网络或文件系统，不更改模型版本。
- 交付 commit SHA、测试命令和完整输出；不得合并 `main`，不得声称可用于公众预警。
- 基于项目负责人公布的阶段一固定提交创建独立分支；不要从尚未包含
  `backend.app.evidence_contract` 的 `main` 直接开始。

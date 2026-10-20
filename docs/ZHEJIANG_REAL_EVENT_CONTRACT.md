# 浙江四城真实事件记录契约（v1）

适用城市：宁波、台州、温州、杭州。适用事件：台风、暴雨及其他导致城市积水的事件；`event_id` 可为 `null`，不强制归入台风。当前 GitHub Pages 无常驻后端，`frontend/public/data/zhejiang-real-events.json` 是构建时或人工审核后发布的只读快照。仓库中的初始文件为 `state: unavailable` 且记录为空，不表示四城无积水。

## 快照字段

```json
{
  "schema_version": 1,
  "state": "unavailable",
  "retrieved_at": null,
  "sources": [],
  "flood_points": [],
  "resident_impacts": [],
  "department_responses": []
}
```

接入后 `state` 为 `ok`，`retrieved_at` 为本系统取得快照的 UTC 时间。`sources[]` 每项包含唯一 `id`、`name`、可访问的 `url` 和非空 `license`。该许可字段必须写明实际允许的用途和署名要求；只知道“公开可浏览”时，先不发布原始记录。

三类记录都必须包含：唯一 `id`、四城之一的 `city_id`、可为空的 `event_id`、`evidence_type`（`observation` 或 `historical_record`）、`source_id`、`quality`（`source_recorded` 或有独立证据时的 `independently_verified`）、`observed_at`、可为空的 `available_at`、`retrieved_at`。标记 `independently_verified` 时还需填写另一登记来源的 `verification_source_id`。所有时间为带 `Z` 的 UTC；前端转换为北京时间。`available_at: null` 表示无法证明该版本何时实际可获得，不能把抓取时间填入，也不能进入 as-of 回测。

| 数组 | 附加字段 | 页面解释 |
|---|---|---|
| `flood_points` | `place_name`、`coordinates: [WGS84 经度, 纬度]`、`water_depth_cm: number \| null`、`status: waterlogged \| receding \| cleared` | 只绘制取得坐标的积水点；空深度显示“深度未报”。清除记录不计入仍有积水报告的点位数。 |
| `resident_impacts` | `area_name`、`metric: affected \| transferred \| sheltered \| stranded`、非负整数 `count`、`status: reported \| confirmed` | 只接收区域汇总，不接收姓名、电话、个人轨迹或推测的个体选择。不同指标不能相加为唯一人数。 |
| `department_responses` | `area_name`、`action`、`status: announced \| in_progress \| completed \| cancelled` | 发布、进行、完成分开记录。系统建议不能写成部门行动。 |

仅当有记录、来源、许可、时间、质量和空间字段且校验通过，页面才显示数据。当前工作区只筛选近 24 小时的 `observation` 记录；四城状态中“有报告”只基于近 6 小时未清除的积水记录，数量是报告条数，不是去重后的易涝点数。筛选窗口与站点覆盖率不同，窗口内零条记录只表示**没有接入符合条件的报告**。历史资料将按事件另行展示，不混入当前状态。

## 接收与发布步骤

1. 保存原始文件、来源页面和下载/收到时间，核对合法再利用范围；不得把受限原始资料放入公开仓库或 Pages 构建工件。
2. 校对坐标、时间、单位、指标口径、记录状态和去重键；独立核验应有可追溯的第二证据。将不满足条件的记录隔离并报告缺口。
3. 生成符合本契约的脱敏快照，经 `assessRealEventSnapshot` 校验，再由 `frontend/scripts/evidence-manifest.mjs` 记录字节数与 SHA-256。GitHub Actions 构建产物留存 90 天。
4. 在页面检查积水地图、居民汇总、部门行动及“无报告/数据缺失”状态；将来源报告与模型推断、模拟情景分别展示。

需要长期在线采集、重试和事件日志时，应在资源与数据授权明确后增加后端。当前静态站点的浏览器每 5 分钟检查一次 JSON，但新快照的产生频率由数据源与 Pages 构建决定，不能称为 5 分钟实时观测。

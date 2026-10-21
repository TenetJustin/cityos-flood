# CityOS 开源计算链交付与复现

更新时间：2026-10-21。范围：宁波、台州、温州、杭州；演示输入全部为合成数据。首页、既有导航与独立自定义推演保持原有入口。

## 已实际运行的链路

合成台风小时驱动 → EPA SWMM 5.2.4 → 100个节点蓄水序列 → 点位排序 / 人群规则估算 → NetworkX资源候选分配 → 地图、二维点位矩阵、三维相对地形与复核包。

每城25个独立微汇水区，73个小时状态，13个六小时建议汇集点。浏览器展示预计算结果，不在 GitHub Pages 上运行原生求解器；这不是滚动预报准确率声明。合成事件的完整未来驱动预先已知，`feed.ndjson`只按小时释放当时输入，所有时间为相对情景时间，不编造真实观测时间。

### 模型与单位

- EPA 官方源码版本 `v5.2.4`、commit `7952ca837988b1c32f791812eccc9fd64547e093`，无源码改动，串行 C 编译；直接调用官方 C API，不使用有问题的本机预编译 Python 轮子。
- SWMM 单位 CMS，雨量 mm/h；HORTON入渗、DYNWAVE动态管流；4 ha/微区、180 m管长、2 m节点深度、10,000 m²节点蓄水面积。管径 `0.25 + 0.35 × 排水能力指数` m；其它参数见可下载 `.inp`。
- 潮河指数到合成出水口水位的转换：`stage = ground - 2.3 + 0.8*tide*coastalExposure + 0.6*river*riverExposure` m，所有出水口设止回门。这是合成试验边界，不是潮位实测或潮河耦合二维模型。
- 显示水深 `max(SWMM水头−合成地面高程,0)×100` cm。水深不是手绘曲线；但节点蓄水**不等于二维淹没范围**。现有微区是独立单元，不声称计算了街道间漫流。
- 实际3D地形与GeoTIFF同源；纵向视觉放大辅助辨认高低。水斑为点位符号，没有拿圆形面积冒充淹没面积。
- 点位优先级按8/30/60 cm演示阈值分层，再按水深、假设人口、道路重要性和低洼度排序；这些不是地方管控标准。
- 人群规则保留暴露人数=留置+自主避险+需协助的守恒；没有训练真实居民行为模型。详见产品说明的公式。
- NetworkX求解最小费用最大流，每城两个虚构资源驻地、共8支队伍。每个湿点需求1支、≥60 cm需求2支；先满足需求量，再最小化优先级代价与平面距离代价。输出分配、缺口和待人工复核状态。未建路网，不输出安全行驶路线；不进行跨城自动调拨。

## 验收证据

本机运行16组SWMM计算（每城基准、无雨且边界干燥、管径×1.4、基准重复），全部通过。数值门槛是工程自检，不能代替历史验证。

| 城市 | 基准峰值 cm | 扩大管径后峰值 cm | 无驱动峰值 cm | 产流/管流连续性误差 % |
|---|---:|---:|---:|---|
| 宁波 | 142.31 | 11.66 | 0 | -0.01207 / 0.00158 |
| 台州 | 124.50 | 2.37 | 0 | -0.00273 / -0.00241 |
| 温州 | 203.33 | 51.11 | 0 | -0.00110 / -0.00160 |
| 杭州 | 35.40 | 0 | 0 | -0.03603 / -0.02630 |

重复的逐点逐小时输出完全相同。Rasterio/GDAL写入并回读四城GeoTIFF，Shapely检查100个点位；全部点位采样与合成高程一致。结果包含模型源码版本、输入和报告SHA256、单位、空间基准和验收结果。

下载入口：`data/hydraulic-demo/results.json`、`feed.ndjson`、`peak-points.geojson`以及 `{city}.inp/.rpt/.tif`。它们是合成案例工件；软件许可与真实数据许可彼此独立。

## 一次复现

Python3.12、Node20、C编译器、Git；首次下载官方源码需要网络。环境隔离，不安装系统服务。

```bash
python3.12 -m venv .venv-hydro
.venv-hydro/bin/python -m pip install -r backend/requirements-hydrology.txt
.venv-hydro/bin/python backend/scripts/build_swmm.py
node frontend/scripts/generate-zhejiang-demo.mjs
.venv-hydro/bin/python -m backend.scripts.run_hydraulic_demo
node frontend/scripts/publish-hydraulic-demo.mjs
cd frontend
npm ci
npm test
VITE_STATIC_PAGES=true VITE_BASE_PATH=/cityos-flood/ npm run build:pages
npm run check:pages
```

先生成输入、再求解、最后合并输出。输入哈希不一致或守恒门槛未通过时禁止合并输出。GitHub Verify工作流增加同一条独立计算任务，不以检查已提交JSON代替真正运行求解器。原始求解器输出和检查目录留在`.tmp/`，不上传用户资料。

## 真实接入准备

`backend/app/sensorthings_provider.py`将已授权SensorThings流映射到现有接收契约；`backend/scripts/poll_sensorthings.py`单次抓取最多10页、每页5MB、20秒超时，限制同源HTTPS、禁止重定向，不输出密钥。每页原子导入SQLite、重复记录幂等、冲突拒绝。未配置供应商时不执行抓取。

配置示例（保存于忽略的本地目录，不把令牌放JSON）：

```json
{
  "url": "https://YOUR-APPROVED-PROVIDER/v1.1/Observations?$expand=Datastream,FeatureOfInterest",
  "provider_id": "approved-provider",
  "source_name": "经核验的供应商",
  "source_reference": "https://YOUR-APPROVED-PROVIDER/catalogue",
  "license_verified": true,
  "license_id": "填写已核验许可",
  "token_env": "CITYOS_PROVIDER_TOKEN",
  "streams": {"1": {"city_id": "ningbo", "phenomenon": "rainfall", "unit": "mm/h", "vertical_datum": null}}
}
```

```bash
python -m backend.scripts.poll_sensorthings --config .tmp/provider.json --store backend/data/external/zhejiang.sqlite3 --snapshot .tmp/realtime-snapshot.json
```

请按已部署API实际数据库路径配置`--store`；不要写到旧五城库。API默认位置见`_zhejiang_realtime_store_path()`。`resultTime`不是公开可获得时间，适配器保留供应方发布时间未知；本系统首次可用时间由接收处理时刻记录。定时器/服务凭据由运营环境配置，网站前端不保存密钥。

## 受控RSI与历史验证

`model_release_gate.py`已经实现候选摘要绑定、冻结回测、泄漏检查、安全检查、影子运行、回退测试以及经认证人工批准的拒绝式关口。它不生成模型、不认证审核人、不自动部署；生产身份系统要在服务端提供可信审核人身份，网页传一个姓名无效。

已有历史回测器会拒绝未来可用数据、单位/点位不匹配与模拟真值。浙江当前缺独立逐点水深真值、精细地形、管网和可获得时间，真实预测MAE/RMSE保持“未评估”，不把合成试验填成真实回测通过。

## 剩余事项及替代路线

| 事项 | 当前可交付替代 | 真正升级所需 |
|---|---|---|
| 真实积水预测 | SWMM合成节点算例，独立真实来源模式与缺失提示 | 获准片区地形/管网/潮河驱动、历史独立真值；标定与事件外验证 |
| 二维淹没面 | 同源二维节点图与三维点位水深 | 用SFINCS或ANUGA另建二维网格、边界和地表水交换；不是本轮已运行能力 |
| 持续在线实时计算 | 静态快照+可复现离线计算；可配置接收/轮询工具 | 持续运行环境、监控备份、供应商权限、真实输入映射与现场验收 |
| 居民与部门实际反应 | 规则影响估算、容量约束的候选分配 | 匿名事件记录、设施/路网/资源台账、验证与授权 |

SWMM、SFINCS、ANUGA是可选/互补计算路线，不同时安装全部。现有SQLite满足小样例审计；PostGIS待空间数据规模增长再引入。Leaflet/Three已经承载当前规模，无需为“采用开源”而强制迁移MapLibre。SUMO/FIAT需真实网络/资产和验证，当前以NetworkX+透明影响规则交付可审阅替代，不声称已接入它们。

## 官方来源与软件许可

- [EPA SWMM](https://github.com/USEPA/Stormwater-Management-Model)：官方C源码，Public Domain；保留上游说明，非EPA背书。
- [Rasterio](https://github.com/rasterio/rasterio)：BSD-3-Clause；通过其GDAL运行时实际写入/读取GeoTIFF；GDAL为MIT风格许可。
- [Shapely](https://github.com/shapely/shapely)：BSD-3-Clause；其GEOS依赖另有LGPL许可。
- [NetworkX](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.flow.max_flow_min_cost.html)：BSD-3-Clause，容量优化。
- [OGC SensorThings](https://www.ogc.org/standards/sensorthings/)：接口标准，不是数据授权。

未向前端打包或重新分发这些Python/C二进制。数据与报告为本项目生成的合成案例，保留来源标签；第三方底图、真实观测和天气模式仍依其各自许可使用。

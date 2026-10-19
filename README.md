# 东南地区台风与城市内涝韧性 · 研究原型

本项目从深圳城市内涝模型扩展为五城市研究框架：上海、宁波、福州、深圳、海口。研究目标是识别台风、暴雨、潮位和河流相互作用形成的复合风险，评估居民与设施影响，并把结果转译为可核查的应急信息。当前可运行代码主要是**深圳研究原型**；其他四城已纳入区域目录，尚未接入城市模型和验证数据。

**[查看五城总体架构图：数据证据 → 城市模型 → 真实反应 → 区域统筹 → 受控 RSI](docs/SOUTHEAST_ARCHITECTURE.md)**

共享事件契约见 [五城共用数据与事件接口](docs/FIVE_CITY_EVENT_CONTRACT.md)；首个候选端到端
样例及其缺口见 [深圳 2023 年“9·7”极端特大暴雨](docs/events/2023-09-07_SHENZHEN_EVIDENCE.md)。

项目混合使用真实观测、公开空间数据、参数化模型、规则假设和情景推演。不同端点的数据依据不同，不能将所有输出理解为实况、经过独立验证的预测，或官方预警。当前系统不具备真实城市预警、泵闸调度、道路管制或救援指挥资质。

## 当前可运行部分

- 深圳项目内的 GIS、历史易涝点、站点和水位缓存资料；部分服务提供研究型内涝、潮位、台风与影响情景推演。
- 后端 `GET /api/data/research-status` 列出外部研究数据是否已接入。缺失数据所依赖的接口返回 HTTP 503 和缺失文件名称。
- `GET /api/region/cities` 给出五城市研究范围及各城市当前实施状态。城市入选不代表该城已有预测服务。
- `GET /api/region/responses/{city_id}` 接收带来源与时间的居民、应急部门行动记录；未接入时返回 503。记录尚未自动进入影响模型。
- `GET /api/region/evidence/{city_id}` 读取按城市、事件和现象登记的雨量、潮位、河水位、积水深度及道路中断证据；缺失或不符合契约时明确报错。记录不会自动成为预报输入或验证真值。
- `GET /api/region/events/{city_id}/{event_id}` 校验 v1.0 事件 manifest，并分别统计真实观测、历史记录、模型推断、模拟情景和缺失；接口固定 fail closed，不授予真值、预警或调度资格。
- `python -m backend.app.evidence_audit` 同时检查五城事件包结构、证据类别与缺失覆盖；检查通过只代表文件符合契约。
- 兼容接口 `POST /api/dispatch` 仅将研究情景建议保存为本地记录；不调用 Webhook 或任何公众告警通道，即使环境变量 `ALERT_WEBHOOK` 已设置也不会外发。建议不是操作指令，必须由主管部门核验。
- 居民行为与应急响应中的一部分目前由规则和假设产生；真实响应观测的接入与校验仍是后续工作。
- WAM 提供受约束的方案建议与人工批准记录；自动误差诊断、跨事件回测和受控 RSI 更新尚未实现。

## 本地启动

建议使用 Python 3.12。后端依赖列在 `backend/requirements.txt`；前端使用 Node 18+。

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

另一个终端启动前端：

```bash
cd frontend
npm ci
npm run dev
```

可选外部研究数据放在 `backend/data/external/`，或设置 `CITYOS_EXTERNAL_DATA_DIR` 指向现有数据根目录。需要的相对文件名可从 `/api/data/research-status` 查看。目录已加入 `.gitignore`；添加数据后请重启后端以刷新缓存。模型 `.pkl` 仅应加载自己信任的文件。无外部数据时基础服务仍可启动，但潮位谐波、居民影响细栅格、部分 What-if 链路不会给出数值结果。

## 验证和研究路线

```bash
backend/.venv/bin/python -m unittest discover -s tests
backend/.venv/bin/python -m backend.app.evidence_audit
cd frontend && npm run build
```

缺少真实人口和潮位原始文件时，相关集成测试会明确跳过；跳过不等于完成验证。历史验证指标需与具体数据和模型版本一起复核。原有 `verify_truth.py` 和 `e2e_journey.py` 含外部实时源、缺失模型或旧口径断言，尚不能作为完整真实性或运营就绪证明。

详细数据契约与实施顺序见 [区域研究路线](docs/REGIONAL_RESEARCH_ROADMAP.md)；五城数据缺口和结构性审计的边界见 [五城数据证据层](docs/FIVE_CITY_DATA_EVIDENCE.md)。

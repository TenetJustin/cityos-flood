# 浙江四城研究网站交付说明

## 当前交付

默认网站是浙江宁波、台州、温州、杭州四城研究工作台，日常栏目为实时态势、影响与建议、推演；产品说明单独呈现来源、方法和使用边界。没有数据的区域明确显示待核实/缺失，不用演示值补齐。原上海、宁波、福州、深圳、海口实验代码仍留在仓库，但不是当前浙江网站的城市范围或生产服务。

### 两种运行环境

| 环境 | 提供能力 | 不提供能力 |
|---|---|---|
| GitHub Pages 公开站 | 浙江四城静态目录、历史事件证据、公开天气模式快照、缺口与安全边界 | FastAPI、持续实时接入、认证复核、浙江模型运行、公众预警、自动调度 |
| 本地/受控研究环境 | 配置外部数据目录与接入令牌后，可使用浙江四城 `/api/zhejiang/realtime/intake` 和只读 `/api/zhejiang/realtime/snapshot` | 未经独立核验的资料不能自动成为预测输入；无生产预警资格 |

公开站地址：`https://tenetjustin.github.io/cityos-flood/`。`main` 上的 `frontend/**` 变更会触发 `.github/workflows/pages.yml`，使用 `/cityos-flood/` 基路径构建，为已知路由生成静态入口，并复制 `index.html` 为 `404.html` 处理未知路径。公开站不存放凭据或受限原始数据。目录快照日期不是观测时间、可获得时间或页面刷新时间。

网站已具备可运行但**未配置实际供应商**的实时接入边界。旧版五城路径仍为 `POST /api/realtime/intake` 与 `GET /api/realtime/snapshot`。新增浙江四城独立路径 `POST /api/zhejiang/realtime/intake` 与 `GET /api/zhejiang/realtime/snapshot`，采用宁波、台州、温州、杭州专属城市范围和独立 SQLite 文件，避免把旧五城记录混入浙江状态。服务端记录实际 `received_at`、`processed_at`、`available_at`，并作只读描述性汇总；所有提交都加 `source_not_independently_verified`。接入不等于源真实性、许可、城市覆盖或模型输入资格通过审核。

浙江工作台可通过构建变量 `VITE_REALTIME_API_BASE` 连接部署后的只读 API，并每分钟检查一次；未配置时保留 GitHub Pages 静态快照模式并显示“未配置实时服务”。页面检查间隔不代表数据源更新频率，也不把浏览器刷新称为实时观测。当前 Pages 没有配置该变量，后端也没有生产部署，因此实时连接仍未启用。

## 本地启动与接入

安装方式见仓库 README。启动后端前须设置：

- `CITYOS_EXTERNAL_DATA_DIR`：仅存放获准保留的研究数据的绝对目录，且后端进程可写。
- `CITYOS_REALTIME_INGEST_TOKEN`：随机生成、仅交给获授权提供方的秘密令牌。未设置这两个变量时写接口返回 HTTP 503；只读首页仍可显示空状态。
- `CITYOS_CORS_ORIGINS`：可选的逗号分隔浏览器来源白名单；默认只允许本地 Vite 开发地址和 `https://tenetjustin.github.io`。不接受 `*`。额外托管前端应按精确 HTTPS 来源配置；数据提供方写入宜采用服务端调用，不在浏览器中保存接入令牌。

调用方将令牌放入 `X-CityOS-Intake-Token` 请求头，发送 JSON `{ "provider_id": "<稳定的提供方 ID>", "records": [<观测候选记录>] }`。单批 1–500 条。候选记录只能包含 `backend/app/realtime_ingestion.py` 的 `CANDIDATE_FIELDS`；城市、现象、单位、时区、坐标、高程基准、质量标记和时间顺序均按该模块校验。提供方应使用稳定的 `provider_record_id` 与 `provider_record_version`，不得把事后订正伪装成原版。返回 `accepted_count`、`rejected_count`、`inserted_count`、`repeated_count` 和固定为 `false` 的预测/同化/预警/调度能力标记；同 ID 异内容返回 HTTP 409。重复提交同一内容只保留最早接收版本。

开发地址分别为 `http://127.0.0.1:5173/` 和 `http://127.0.0.1:8000/api/zhejiang/realtime/snapshot`。执行 `cd frontend && npm ci && npm test && npm run build` 后，后端启动时会检测 `frontend/dist` 并在同一进程的 `/` 提供静态网站，`/api` 仍由 FastAPI 处理。跨域浏览器请求使用明确来源白名单；不得启用通配来源。要将后端公开托管，还需 HTTPS 反向代理，保护令牌和外部数据目录；不得直接公开开发服务器。部署前还要落实服务端身份认证、访问控制、日志保留、备份、速率/请求体限制及来源数据再分发许可。GitHub Pages 的公开前端不构成已上线的实时分析服务。

## 可验收与未完成边界

- 已验证：无数据时五城研究路径的 25 个、浙江路径的 20 个城市×现象组合均明确缺失；接入核心的批次校验、区域范围隔离、幂等存储、描述性快照与令牌边界测试；前端静态目录、浙江实时快照契约校验与静态 Pages 构建。完整后端测试在项目虚拟环境中通过（247 项，3 项按既有条件跳过）；本机预览服务器因环境禁止监听端口，未完成浏览器截图检查。
- 尚缺：浙江四城经过独立核验并获许可的持续观测源、逐城模型校准、独立历史真值和当时签发的预报快照、交通/居民/部门行动样本、城市间事件外回测、生产托管与安全运营。因此不能把网站称为已交付**预测模型或公众预警产品**。
- 深圳 2023 年“9·7”暴雨仍只是复盘候选。官方事后汇总属于 `historical_record`，不是分钟级实测真值；详见 `docs/events/2023-09-07_SHENZHEN_EVIDENCE.md`。历史回测评估器当前必须在缺证时 fail closed。
- 受控 RSI 只能生成候选调整；跨事件回测、安全检查和人工批准之前，不得变更模型版本。任何实时输入不得自动触发公众预警或泵闸/道路调度。

`snapshot_id` 是当前描述性分析视图的标识，不是全量接入批次的不可抵赖审计凭证。当前 SQLite 用于单实例本地研究；多实例生产环境需要事务性数据库、独立批次审计和运维设计。

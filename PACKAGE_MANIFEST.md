# 打包清单 PACKAGE_MANIFEST

## 交付包
| 项 | 值 |
|---|---|
| 文件名 | `cityos-shenzhen-full-20260903-0809.zip`（原 20260902-1319 全量包增量更新并重命名） |
| 类型 | 全量交付包（源码 + 依赖 + 数据 + 文档） |
| 顶层 | `cityos-flood-github/`（主项目）、`shenzhen-flood/`（数据仓库） |
| 版本 | v5 / P1-A（WebGPU SWE 30m 主干 + LarNO 校验框架） |
| 打包方式 | 2026-09 对既有 3.8 GB 全量包做 `zip -u` 增量更新 |

## zip 顶层结构（条目按目录）
```
cityos-flood-github/
├── PITCH.md / START_HERE.md        # 项目入口说明
├── frontend/
│   ├── src/                        # React 源码（App/组件/SWE 引擎）
│   ├── public/swe/                 # SWE 运行时资产（见下）
│   ├── dist/                       # 生产构建（静态部署用）
│   └── package.json
├── backend/
│   ├── app/                        # FastAPI 应用（/api/*，含 larno.py）
│   ├── scripts/                    # swe_cpu_ref_check.py、larno_compare.py 等
│   └── requirements.txt
├── docs/                           # 验证与设计文档（见文档清单）
└── tests/
shenzhen-flood/
├── data/processed/                 # NASADEM30/CHIRPS/坡度/流向等
├── data/larno/region1_20m/         # LarNO 基准：dem.npy + 77 场 event*/{h,rainfall}.npy + georef.yaml
└── data/...                        # 原始台账/OSM/实测数据
```

## SWE 运行时资产（frontend/public/swe/）
| 文件 | 说明 |
|---|---|
| `futian/mesh.bin`（60 m） | P0 验证网格：三角网/高程/粗糙度/latC/lonC（61,490 tri） |
| `futian30/mesh.bin`（30 m） | P1-A 全分辨率网格（246,820 tri，NASADEM 原分辨率） |
| `futian30/drain_rate.bin` | LarNO 退水标定排水容量场（derived） |
| `futian30/dist_idx.bin` | 区级索引（行为链映射用） |
| `rain_profiles.json` | CHIRPS 历史暴雨日→设计雨型（20140511/20230907/20180830） |

## 文档清单（docs/）
| 文件 | 内容 |
|---|---|
| `WEBSITE_USAGE_GUIDE.md`（zip 内 ASCII 名；磁盘源 `docs/网站功能使用指南.md`） | **各页面功能与操作介绍（本包新增，11 页全覆盖）** |
| `swe_p0_validation.md` | P0 60m 引擎验证记录 |
| `swe_p1_validation.md` | P1-A 30m/排水/事件/框架验证与 A2 阻塞记录 |
| `swe_p1_audit_round6.md` | P1-A 交付审计清单 + 坐标到位后执行清单 |
| `larno_georef_request.md` | 向作者请求网格坐标的 issue/邮件草稿（含 caoxiaoyan@stu.pku.edu.cn） |
| `data_dictionary.md` / `opendata_access_guide.md` 等 | 数据字典与获取指南 |
| `multihazard_v4_architecture.md` / `wam_decision_loop.md` 等 | 架构与算法设计 |

## 版本记录
| 日期 | 内容 |
|---|---|
| 2026-09-02 | v4 全量包（P0 + 多灾种平台） |
| 2026-09（本次） | **P1-A 增量**：30m 网格、排水三件套、CHIRPS 雨型、LarNO 校验框架（三模式）、georef 配置、使用指南、本清单 |

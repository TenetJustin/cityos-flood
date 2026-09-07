# P1-A 交付审计清单（round 6，2026-09）

## 状态总览
目标 (1)(3)(4)(6) + (5) 框架全部完成并验证；(2) LarNO 锚定唯一缺口 = 作者坐标
（自主渠道 8+ 个穷尽，见 docs/swe_p1_validation.md；issue 草稿 docs/larno_georef_request.md）。

## 全链路回归（round 6 复验，全部绿）
| 项 | 命令/方式 | 结果 |
|---|---|---|
| CPU 湖静止 200s | swe_cpu_ref_check.py lake | drift 0 / speed 9.9e-5 / pass=True |
| CPU 守恒 600s | swe_cpu_ref_check.py rain | err -1.97e-07 / maxH 0.08m |
| GPU 双网格湖静止 | E2E headless SwiftShader | 60m & 30m drift 0 |
| UI 全套件 | E2E | LarNO 面板实时数据 / 网格切换 / 事件按钮 / 排水开关 |
| 框架 --ts | larno_compare.py --ts | norm MSE 0.0548 |
| 框架 --sim(provisional) | --sim-meta + --larno-grid | overlap 0.811km² / RMSE 0.374m |

## 坐标到位后的执行清单（作者答复 → georef.yaml bbox/crs/orientation + georef_status: confirmed）
1. `shenzhen-flood/data/larno/region1_20m/georef.yaml` 填入确认值
2. 跑逐格校验（真实变换自动启用）：
   `backend/scripts/larno_compare.py --sim <30m 峰值场 npy> --sim-meta <cell_deg,lon0,lat_top> --larno-dir ... --event-ids 1,3,5`
3. 产出：面积重合 / bias-RMSE / 峰值-时序报告（JSON + docs 摘要），更新 LarNO 对照面板
4. 关闭 (2)(5)：docs 标注 georef confirmed + 校验数字

## 交付物索引（P1-A）
- 引擎/前端：frontend/src/swe/*、frontend/src/components/SwePage.jsx
- 资产：frontend/public/swe/futian30/（mesh/drain_rate/rain_profiles/dist_idx）、futian/（P0+drain_rate）
- CPU 参考：backend/scripts/swe_cpu_ref_check.py（drain 三件套 + pit + lonC/latC 输出）
- 校验框架：backend/scripts/larno_compare.py（域级/时序/真实投影三模式 + georef 读取）
- georef 配置：shenzhen-flood/data/larno/region1_20m/georef.yaml（awaiting，bbox null）
- 验证文档：docs/swe_p0_validation.md、docs/swe_p1_validation.md
- 作者联系：docs/larno_georef_request.md

# P1-A 格级推演主干 — 验证记录（增量，承接 docs/swe_p0_validation.md）

## 已完成
1) **30m 全分辨率网格**（NASADEM30 原分辨率采样，`--res 30`）
   - `futian30/`：246,820 三角 / 124,128 顶点 / 109.24 km² / 11.9MB
   - CPU 参考（f64）：湖静止 200 s drift 0、maxSpeed 1.76e-4；600s@50mm/h 质量误差 -2.54e-07
   - 浏览器 GPU（SwiftShader E2E）：60m 与 30m 双网格湖静止 200 s drift 0 / speed 0（真执行验证：marker 写入 + 读回双 half 确认 kernel 生效）
2) **排水三件套**（全部由 UI「管网排水」总开关控制；湖静止自检在闭合域跑，不受影响）
   - (a) 海/河出口：边界低床（bed<2m，深圳湾/深圳河口）cell 指数弛豫向海面 0，τ=600s —— 之前 wall 封闭域把水困在域内（这是与 LarNO 峰值差距主因之一）
   - (b) 管网：drain_rate.bin 容量场 k = LarNO 77 场中位退水 1.47%/5min 标定（4.94e-5 s⁻¹ 基）× 建成度空间分布（derived）
   - (c) 山溪坑：谷底 cell（bed>8m 且低于全部邻居 ≥0.5m）按溪流排走 τ=900s（DEM 级网格谷底无溪线，防止单点深坑伪影）
   - CPU 6h 事件（60m，2014-05-11 169mm）：排水总量 8.0Mm³/18.4Mm³=44%（管网+溪+海）；GPU 30m 同事件 6.0Mm³=33%
3) **历史暴雨事件驱动**（CHIRPS 日雨 → derived 线性升/降雨型，5min×72 段，总量严格守恒）
   - rain_profiles.json：2014-05-11（169mm/d）、2023-09-07（97mm）、2018-08-30（65mm）
   - 分块推演（每 5min 段恒定 rain + 双参数 buffer 切换），CPU 6h 与浏览器 GPU 30m 6h 均全量跑通（SwiftShader 131 s）
4) **前端**：网格 60m/30m 切换、雨型模式（恒定/历史事件）、事件推演按钮（进度）、排水开关（文案=LarNO 校准）、统计面板加稳健指标（>5cm/>15cm 面积、p90 水深）
5) **浏览器 GPU 30m 全事件终验**（20140511，6 h）：vol 12.48Mm³，>5cm 23.8km²，>15cm **15.1km²**，p90 水深 0.54m，maxH 7.6m（谷底单点伪影，见局限）
   UI 行为链（60m，1h@60mm/h 排水开）：福田 16cm/22.1km²、罗湖 20cm/3.9km² → 罗湖受影响 107 万 / 福田 86 万（真 kernel 数据）

## 域级对照（LarNO 未锚定，仅形状/量级，非逐格）
- 退水：标定源即 LarNO 中位 1.47%/5min（−17%/h）；CPU 0.2m 层 100min 排水 −17.4% 复现 ✓
- >15cm 面积：本 GPU 30m 极端事件 15.1km² vs LarNO 2014-05 场 ~5.2km²（量级偏大 ~3×：无蓄滞/溪线几何、标定为 77 场中位而非事件特定、f32）
- 稳健指标（p90 0.54m）落在 MIKE+ 类模型域级量级内；maxH 单点不作对照依据

## 排障记录（本轮）
- WGSL **不支持三元 `?:` 运算符**：pit 行 `(cond)?a:b` 使 ShaderModule 无效 → 所有 dispatch 静默丢弃、湖静止"假阳性通过"（读初始 half）→ 改用 if/else 后 kernel 复活；教训：任何 shader 改动后必须做 marker 写入读回的真执行检查（lake 恒态无法发现 kernel 未执行）
- SwiftShader uniform 读 0（JS readback 正常、kernel 全零）→ 参数改走 **storage 双缓冲**（与 states 同 ping-pong），storage 写路径可靠
- 参数 struct 加 pad 后 parity u32 从 offset 28 → 32，JS 写入偏移需同步（f 8 个 + u[8]/u[9]）

## LarNO 校验框架（目标(5)，backend/scripts/larno_compare.py）
- 端到端可用：`--sim <30m 栅格场 npy> --larno-dir region1_20m --event-ids 1,3` →
  域级稳健指标 + sim 场投到 LarNO 网格的 bias/RMSE/面积重合报告（JSON）
- 演示（60m CPU 事件 20140511 峰值场 × LarNO event1/3）：
  - LarNO event1 >15cm 5.24 km² / 峰值 2.71 m；本模拟投影 >15cm 7.95 km² / 5.73 m（60m 网格）
  - bias_rmse 0.19 m；wet_overlap 0.4-0.5 km² —— **锚定前占位投影（等经纬度双线性），重合面积无意义**，仅验证管线
- A2 锚定后替换真实地理变换即可启用逐格/面积重合/时序指标

## A2 地理锚定 —— 渠道全打通后的确定性结论（本轮）
已遍历全部在线渠道（网络此轮已部分恢复：GitHub API/Crossref/OpenAlex/Semantic Scholar/arXiv 可达）：
- HF 数据卡（huggingface/dataset_card.md，GitHub 镜像）：域描述仅 "Futian ~100 km² / 400×560@20m"，**无坐标**
- LarNO 代码仓全部 172 文件：无任何 lon/lat/EPSG/transform 引用
- 论文元数据（Crossref/OpenAlex/Semantic Scholar）：无 abstract 可用、无坐标
- 结论：**LarNO 发布物（含数据卡/教程/仓库/元数据）均不发布域坐标**（与管网保密同政策）
- 全文/OA 渠道穷尽（第 3 轮复验）：OpenAlex OA locations 无副本、Unpaywall 无记录、Europe PMC 无记录、arXiv 无预印本、figshare API/网页 403、ScienceDirect 403 → A2 锚定需论文全文（SD 机构网络）或联系作者 → 挂起（依赖人工源，阻塞条件 ≥3 轮同因）
- Round5 追加探测：Google Scholar 精确命中论文条目（唯一链接=ScienceDirect PII S0022169426007833，无 OA/PDF/预印本）；Zenodo/OSF 无记录；linkinghub.elsevier.com 仅为重定向壳（无元数据）；Elsevier TDM API 需机构 key → 自主渠道全部关闭，唯一剩余=作者答复（issue 草稿见 docs/larno_georef_request.md）
- 替代：域级形状/退水/稳健指标对照 + **无坐标时序/面积-深度对照**（本轮新增，见下）

## LarNO georef 可替换配置 + 匹配实验（用户提供 coarse window 后本轮）
- 新配置 `shenzhen-flood/data/larno/region1_20m/georef.yaml`（用户建议结构 + 扩展）：width/height/resolution_m/crs/bbox/orientation/georef_status，**bbox=null、status=awaiting_author_confirmation**——不硬编码推测
- `larno_compare.py` 增加 georef 加载器：读数据目录旁 yaml → 输出标头携带 georef 状态；bbox 非 null 后自动启用真实地理变换（代码路径就绪，冒烟通过）
- 匹配实验（福田官方范围 lon 113.9833–114.1000 / lat 22.5000–22.6000 为 coarse window，放大 ~1.6× 作搜索场）：
  - NASADEM30 × LarNO dem：clip[0,50] + 250m–660m 多尺度 boxcar + FFT raw 相关与归一化 NCC、双朝向
  - raw 高分收敛单一斑块（lon 114.017–114.117, lat 22.545–22.617, row0=south）但经 NCC 检验为 clip-50 平台规模假象（NCC 负值）→ **无真实结构信号**
  - LarNO dem 无 NaN（建筑掩膜缺失，与数据卡描述不符）→ OSM buildings 匹配不可用
- 结论记录于 yaml notes：LarNO dem 为 MIKE+ 模型地形（边界 ~50m 高墙 + 盆地化），与 NASADEM 无可自证的唯一对应 → 权威来源仍需作者确认/论文全文
- 作者联系材料：docs/larno_georef_request.md（issue 草稿 + ORCID 线索：holmescao=Xiaoyan Cao；通讯 Huapeng Qin）
- 真实投影路径就绪：larno_compare.py --sim-meta（cell_deg/lon0/lat_top）+ --larno-grid（Lon_W Lat_N）→ 经纬双线性投影到 LarNO 20m 网格（行南向、lat 格宽 20/111320、lon 格宽按中心纬度 20/(111320·cosφ)）
  - provisional 演示（60m CPU 事件峰值场 × 候选角点 114.017/22.617）：event1 wet>15cm 5.24 km²、sim 投影 14.4 km²、overlap 0.81 km²、RMSE 0.37 m —— 候选未确认，仅供管线验证
  - LarNO 网格面积元按 20m²修正（初版误用 30m 元致 2.25× 高估，已修）

## LarNO 时序对照（无地理需求，本轮新增）
- 提取 LarNO event1/3/5 逐 5min 序列（vol/峰值水深/>15cm 面积）与 rain 总量：event1 = 116mm、峰值 2.71m @225min
- 本模拟 60m 事件 20140511（169mm）同序列导出 → 逐 5min 对照 JSON（/tmp/swe_ts.json vs /tmp/larno_ts.json）
- 比较口径（诚实）：LarNO 雨强场为观测输入（实测/再分析），本模拟雨型为 CHIRPS 日雨→design hyetograph（derived）；体积/峰值时相可对照，绝对量因雨量与排水配置不同不作严格归因

## 待办/阻塞
- LarNO 逐格/面积重合校验：需真实地理变换（A2 锚定）——坐标不在发布物，挂人工源；框架与脚本已就绪
- maxH 单点（谷底 7.6m）为无溪线/蓄滞网格伪影 → 报告 p90 与淹没面积

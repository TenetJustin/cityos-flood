P0 SWE 引擎验证记录（2026-09）
==========================
1) well-balanced 湖静止：真实 NASADEM30 地形上 eta=3.0m 静水面 200s
   CPU 参考(f64)  drift=0.000 m, maxSpeed 9.9e-5 m/s
   浏览器 GPU(f32) drift=0.000 m, maxSpeed 0 m/s（headless SwiftShader 端到端）
2) 降雨守恒：600 s @ 50 mm/h（福田 61,490 三角）
   期望水量 0.9071 Mm3
   CPU f64  -> 0.9071 Mm3  err -1.97e-07
   CPU f32  -> 0.8660 Mm3  err -4.5%   （单精度主导）
   GPU f32  -> 0.8869 Mm3  err -2.2%   （SwiftShader E2E）
   结论：f32 守恒损失 2~4% 为已知单精度效应，P1 平移坐标/双精度累加缓解
3) LarNO event1 量级对照（福田窗 60m 无管网 vs LarNO 20m 含管网，域不同逐格不可比）：
   域均强度 5.2 mm/h × 6 h（本实现，f64）:
     vol 3.40 Mm3 (= 期望 3.40) | maxH 3.78 m
     h>15cm 6.94 km2  h>30cm 3.23 km2
   LarNO event1（域均累计 23.2 mm / 6h）:
     maxH 2.71 m | h>15cm 5.2 km2 | h>50cm 0.51 km2
   同量级；最大深偏高 ~40%（无管网/出口 wall 汇聚）
4) 全链路 E2E（浏览器 GPU 快照 -> 行为层）:
   60 mm/h × 1 h -> 福田 19cm/22.8 km2、罗湖 23cm/4.1 km2
   -> /api/swe/impact 行为链：罗湖 123 万受影响(54 格)、福田 106 万(54 格)，source=swe_webgpu
关键修复史：mesh.bin 加 header；CPU 邻居表 tri-major 转置修正（此前 flux 全错乱）；
W_edge=max(eta,Bm) 无假层湿化（质量守恒关键）；statesBuf 补 COPY_DST；
uniform parity 双 buffer + bindGroup 切换（单 buffer 循环 writeBuffer 只留末值 bug）。

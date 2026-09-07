# 向 LarNO 作者请求 region1_20m 地理配准信息（草稿）

## 背景
LarNO (Journal of Hydrology 2026, DOI 10.1016/j.jhydrol.2026.135686) 公开数据集
`region1_20m`（福田，深圳，400×560 @ 20 m）不含任何 georeferencing
（CRS / GeoTransform / bbox / 角点坐标均缺）。论文 5 m 版 1600×2240 为同一物理域。
我们本地已有 77 场 event{h, rainfall}.npy 与 dem.npy，但无法将其投影到真实地理坐标，
因而无法与外部地形/管网/校验基准对齐。

## 请求渠道
1. GitHub issue：https://github.com/holmescao/LarNO/issues （作者 holmescao = Xiaoyan Cao，活跃维护）
2. 邮件：**Xiaoyan Cao 直接邮箱 caoxiaoyan@stu.pku.edu.cn**（holmescao.github.io 公开）
   —— 通讯作者 Huapeng Qin 0000-0002-5132-5329（北大深研院环境与能源学院）

## Issue 正文（中文/英文均可用，英文优先）

---
**Title:** Request: georeferencing (bbox/CRS) for region1_20m Futian benchmark

Hi, thanks for releasing LarNO! I am working with `region1_20m` (400×560 @ 20 m,
77 events) and would like to align its `dem.npy` / `h.npy` fields to real-world
coordinates for cross-validation with independent terrain data.

Could you share the **grid corner coordinates** (e.g. bbox lon/lat of the NW and
SE corners, or the CRS + affine transform) for `region1_20m`? Even approximate
values would help a lot. (For context: the official Futian district extent is
lon 113°59′–114°06′, lat 22°30′–22°36′; the paper describes the domain as
~100 km² of central Shenzhen.)

Thank you!
---

## 收到答复后填入
`shenzhen-flood/data/larno/region1_20m/georef.yaml` 的 `bbox`/`crs`/`orientation`，
`georef_status` 改 `confirmed` → 逐格校验自动启用：
`backend/scripts/larno_compare.py --sim <场> --sim-meta <geo> --larno-dir <dir>`
（真实经纬双线性投影路径已就绪并冒烟通过，见 docs/swe_p1_validation.md）

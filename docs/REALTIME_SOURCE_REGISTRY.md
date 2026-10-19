# 五城实时数据来源注册表

更新日期：2026-10-19。

代码注册表位于 `backend/app/realtime_sources.py`，只读接口为
`GET /api/realtime/sources`，支持以 `city_id` 和 `phenomenon` 筛选。这个接口只报告
候选来源、访问状态、字段映射缺口和许可缺口，不抓取数据，也不表示已经存在五城实时流。

## 当前结论

- **上海**：官方目录列出“下立交实时积水深度”，但尚未定位下载/API 地址，单位、坐标、
  实际可获得时间和数据集级条款尚未复核。
- **宁波**：已定位数据服务和开放平台入口，尚未定位可供本项目使用的实时雨量、水位或
  积水数据集。
- **福州**：官方资料证明本地系统接入大量雨量、水位、路面积水和管网传感器，但研究项目
  尚未取得实时或历史导出权限；系统规模不能当作数据。
- **深圳**：官方平台当前展示积涝点水位、自动站实况、降雨和水库水位等持续更新的数据集。
  仓库旧适配器只覆盖积涝点水位下载，并依赖登录会话。原始“水位”是否等价于统一契约的
  “积水深度”、其传感器零点/垂直基准以及真实 `available_at` 均未核对，所以仍不能进入
  五城实时分析核心或模型同化。
- **海口**：目前只有海南公共数据入口候选，审查期间访问不稳定，尚未定位具体城市内涝
  实时数据集。

因此当前所有来源的 `realtime_observation_eligible` 都是 `false`，接口固定返回：

```text
forecast_input_ready=false
model_assimilation_ready=false
public_warning_ready=false
automatic_dispatch_ready=false
```

## 来源晋级门槛

一个候选源只有同时满足以下条件，才可能从注册表进入实时研究管线：

1. 确认实际下载或 API 调用方式，且账号和凭据不进入代码或日志；
2. 复核数据集级许可、署名、缓存和再分发条件；
3. 取得字段字典和样例响应，确认主键、时间粒度、单位、CRS 与垂直基准；
4. 区分 `observed_at`、供应方发布时间、系统接收时间和校验完成后的 `available_at`；
5. 用捕获的去敏样例完成 schema、重复、缺失、未来时间、迟到版本和订正版本测试；
6. 适配器在无凭据、超时、限流、空响应和 schema 漂移时 fail closed；
7. 来源人工复核完成，并保留检查日期和原响应校验值。

实时描述性统计可在上述门槛后接入，但进入预测模型、同化、公众预警或调度仍需要各自独立
审查，不能由来源注册状态自动推导。

## 首轮官方依据

- [上海市公共数据目录](https://data.sh.gov.cn/cmsres/c8/c87badc4f16e4481a8e8a30665b64a1c/938b00188faa9e46ea4f351fa793739a.pdf)
- [宁波市数据服务入口](https://qf.ningbo.gov.cn/qfpt/fwbk/sjfw/index.html)
- [福建省数据开放入口](https://www.fujian.gov.cn/zwgk/index.htm)
- [深圳市政府数据开放平台](https://opendata.sz.gov.cn/)
- [深圳市气象局关于公众获取气象数据的说明](https://weather.sz.gov.cn/hudongjiaoliu/yewuzhishiku/qixiangfuwulei/content/post_11815788.html)
- [海南省公共数据入口候选](https://data.hainan.gov.cn/)


# 浙江四城数据准入记录

更新：2026-10-20。此记录区分“已在网站使用的数据”与“官方来源可行性”；目录或公开页面不构成接口已接入。四城为宁波、台州、温州、杭州。

| 来源 | 可提供的证据 | 许可与访问核查 | 当前结论 |
|---|---|---|---|
| NOAA AWC METAR | 机场点位气象实况，逐条有观测时刻；构建时抓取四站，本轮覆盖按响应显示 | [API](https://aviationweather.gov/data/api/) 公开访问；原始报文再利用条款继续核对 | 已接入、已做结构/时序校验；不是城区雨量或积水真值 |
| NOAA IBTrACS v04r01 | 西北太平洋事后最佳路径；站点无关，按四城中心 500 km 形成候选 | [产品页](https://www.ncei.noaa.gov/products/international-best-track-archive) 说明公开获取和引用；保留版本、哈希、抓取时间 | 已接入历史快照；单条路径首次公开时间未知，不用于 as-of 回测 |
| ECMWF IFS Open Data | 逐次签发的全球天气模式预报，可作为 0–72 小时外部天气驱动候选 | [官方说明](https://www.ecmwf.int/en/forecasts/datasets/open-data)：免费公开子集按 CC BY 4.0 和附加条款；0.25° GRIB2；最近约 12 个起报周期滚动保留 | 准入候选；须验证降雨参数、累计量转换、起报/发布/抓取时刻、四城格点代表性及文件存档，不能当作城区内涝预测 |
| NASA GPM IMERG Early/Late | 0.1°、半小时卫星降水估计；Early 约 4 小时、Late 约 12 小时延迟 | [数据目录](https://gpm.nasa.gov/data/directory) 和 [IMERG 说明](https://gpm.nasa.gov/data/imerg)；PPS 归档访问可能需要注册。旧 [Publisher API 文档](https://gpm.nasa.gov/precip-apps/doc) 所示端点在 2026-10-20 实测返回 HTML 而非 JSON | 准入候选；先确定有效 API/下载、使用政策、格点取样和质量字段；卫星估计不能标成地面雨量站观测 |
| IOC Sea Level Monitoring Facility | 实时沿海潮位站可能提供外部边界条件 | [V2 API](https://api.ioc-sealevelmonitoring.org/v2/doc) 需注册获取密钥；[数据政策](https://www.ioc-sealevelmonitoring.org/disclaimer.php) 限非商业用途，原始实时数据未经充分质控 | 暂不接入；先核站点是否覆盖研究河口、垂直基准、许可范围与 API 权限 |
| 浙江省与四城公开平台 | 城区雨量、水位、潮位、易涝点及泵站目录 | 逐个核验平台申请、条款、时间序列与站点坐标 | 多数仍是目录线索，尚无可审计接口数据 |

## 下一次准入的最低条件

1. 先拿到可以重复请求的真实样本，以及该样本对应的版本/许可证明；不能以宣传页代替数据。
2. 每条数值保留 `evidence_type`、`observed_at` 或预报的 `issued_at`/`valid_at`、实际 `available_at`、`retrieved_at`、时区、单位、CRS/垂直基准、来源 URL/版本、质量标记与显式缺失。
3. 用两个不同日期和四城各一个空间样本核对字段、单位、时序、断流和异常；实际可获得时间无法证明时写 `null`，不得进入 as-of 回测。
4. 降水模式、卫星估计、站点观测和历史最佳路径分层显示；它们不能互相冒充，也不能单独校准城市积水或居民响应。
5. 通过质量门槛后才接入自动刷新；先对每个来源单独展示健康、延迟和覆盖率，再允许进入组合分析。

当前最有希望的无需专属城市权限的下一条链路是 ECMWF 公开预报和 NASA IMERG 卫星估计；它们可改善四城天气驱动证据，但**不替代**街道级实测积水、潮河水位、排水资产和独立影响真值。

// Zhejiang workbench catalogue. Entries describe source leads, not ingested observations.
export const ZHEJIANG_CITIES = [
  { id: 'ningbo', name: '宁波', center: [29.87, 121.55], focus: '潮位 · 甬江河网 · 排水', context: '沿海河口', airport: 'ZSNB', accent: '#79b9d9' },
  { id: 'taizhou', name: '台州', center: [28.66, 121.42], focus: '台风暴雨 · 山地汇流 · 老城', context: '山海交汇', airport: 'ZSLQ', accent: '#84c6b5' },
  { id: 'wenzhou', name: '温州', center: [27.99, 120.7], focus: '台风雨带 · 瓯江 · 快速汇流', context: '山地沿海', airport: 'ZSWZ', accent: '#a8b8df' },
  { id: 'hangzhou', name: '杭州', center: [30.27, 120.15], focus: '外围暴雨 · 钱塘江 · 内河', context: '河网城区', airport: 'ZSHC', accent: '#d7bd92' },
]

export const ZHEJIANG_SOURCES = [
  { id: 'awc', city: 'all', category: '气象观测', name: '浙江四城机场 METAR', publisher: 'NOAA Aviation Weather Center', access: '已接入公开快照', cadence: '构建时抓取；逐条检查观测时间', coverage: '机场站点气温、气压、风速；各站覆盖按实际响应', license: '公开 API；原始报文再利用条款待独立核对', url: 'https://aviationweather.gov/data/api/', note: '不代表城区雨量或内涝。' },
  { id: 'ibtracs', city: 'all', category: '历史台风', name: 'IBTrACS 浙江邻近最佳路径', publisher: 'NOAA NCEI', access: '已接入历史快照', cadence: '手动抓取近三年索引；来源更新状态按快照展示', coverage: '四城中心 500 km 邻近路径候选；非降雨或积水事件', license: 'NOAA 开放研究数据；使用时引用数据集；其他用途条款待核对', url: 'https://www.ncei.noaa.gov/products/international-best-track-archive', note: '事后最佳路径；单条路径的最早公开可获得时间未知。' },
  { id: 'ecmwf', city: 'all', category: '天气模式预报', name: 'IFS 开放降雨预报格点', publisher: 'ECMWF', access: '已接入公开模式快照', cadence: '同一起报 6/12/24/48/72 小时累计降雨；页面按 24 小时起报龄失效', coverage: '四城中心最近 0.25° 格点；非城区积水预测', license: 'CC BY 4.0 + ECMWF Terms of Use；需署名', url: 'https://www.ecmwf.int/en/forecasts/datasets/open-data', note: '正式发布时刻未核实；本系统首次抓取时间保留。' },
  { id: 'ghcnd', city: 'all', category: '历史降雨', name: 'GHCN-Daily 2021 年 7 月站点切片', publisher: 'NOAA NCEI', access: '已接入历史快照', cadence: '2021-07-20 至 28，逐日；非实时源', coverage: '杭州站 9/9 日；定海、大陈岛、瑞安区域参照各 9/9 日；温州本地站缺失', license: '公开下载；保留 DOI 引用和来源标志', url: 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt', note: 'S 来源为逐时报文推算的日降水，可能与真正逐日值显著不同；不可做 as-of 回测。' },
  { id: 'zj-rain', city: 'all', category: '降水', name: '浙江省降水量信息', publisher: '浙江省数据开放平台', access: '需注册申请', cadence: '待核验', coverage: '站点与时段待核验', license: '按平台条款核验', url: 'https://data.zjzwfw.gov.cn/jdop_front/detail/api.do?iid=14701', note: '接口申请完成后才能接入。' },
  { id: 'zj-reservoir', city: 'all', category: '水文', name: '浙江省水库水情', publisher: '浙江省数据开放平台', access: '需注册申请', cadence: '待核验', coverage: '水库水情；非城市积水', license: '按平台条款核验', url: 'https://data.zjzwfw.gov.cn/jdop_front/detail/api.do?iid=27987', note: '不能代替城区河网或积水观测。' },
  { id: 'wz-typhoon', city: 'wenzhou', category: '台风', name: '台风路径实况', publisher: '温州市数据开放平台', access: '需注册申请', cadence: '待核验', coverage: '路径与强度字段待接口核验', license: '按平台条款核验', url: 'https://data.wenzhou.gov.cn/jdop_front/detail/api.do?iid=16397', note: '目录存在不代表已获得接口数据。' },
  { id: 'wz-points', city: 'wenzhou', category: '历史点位', name: '市区易涝点信息', publisher: '温州市数据开放平台', access: '公开目录；181 条记录已核字段', cadence: '年度更新；目录日期 2024-01-17', coverage: '字段只有标识码、名称、时间；当前未提供坐标或积水深度', license: '门户标记完全开放；未见单独再利用许可条款', url: 'https://data.wenzhou.gov.cn/jdop_front/detail/data.do?iid=6478', note: '不可用于空间暴露计算或作为实时积水真值。' },
  { id: 'wz-rain-history', city: 'wenzhou', category: '历史降雨', name: '瑞安市水旱灾害雨情信息', publisher: '瑞安市水利局 / 温州市数据开放平台', access: '公开下载已抽查；未接入模型', cadence: '目录宣称 2000 年至今、年度更新；公开导出受 800,000 条限制', coverage: '本次导出 800,000 条、221 个站码，时间仅覆盖 2023-09-01 至 09-14；站点名与坐标缺失', license: '门户标记完全开放；未见单独再利用许可条款', url: 'https://data.wenzhou.gov.cn/jdop_front/detail/data.do?iid=11666', note: '异常标记在样本中全为“无记录”；不能视作通过质量检查或实时数据。' },
  { id: 'wz-river-history', city: 'wenzhou', category: '历史河道水位', name: '温州水文河道水情信息', publisher: '温州市水利局 / 温州市数据开放平台', access: '公开下载已抽查；未接入模型', cadence: '目录宣称 2015–2019、年度更新；公开导出受 800,000 条限制', coverage: '本次导出 800,000 条、263 个站码，时间 2015-08-19 至 2019-09-23；缺站点位置、单位和垂直基准', license: '门户标记完全开放；未见单独再利用许可条款', url: 'https://data.wenzhou.gov.cn/jdop_front/detail/data.do?iid=6352', note: '范围 -1.87 至 779.51，5.03% 大于 100、0.97% 小于 0；缺单位/基准时不能判错或作物理解释。' },
  { id: 'wz-tide', city: 'wenzhou', category: '潮位', name: '温州水文潮汐水情观测序列', publisher: '温州市水利局 / 温州市数据开放平台', access: '公开下载已抽查；质量与站点待核', cadence: '目录标注小时级；本次快照最新至 2026-10-16', coverage: '1,000,000 条、38 个站码；缺站点位置、单位、时区和垂直基准', license: '门户标记完全开放；未见单独再利用许可条款', url: 'https://data.wenzhou.gov.cn/jdop_front/detail/data.do?iid=6348', note: '合并测站码 100% 为空；潮位范围 -42.437–653.24，未核单位/基准前不能作定量边界。' },
  { id: 'wz-tide-annual', city: 'wenzhou', category: '潮位站元数据', name: '温州年潮位表信息', publisher: '温州市水利局 / 温州市数据开放平台', access: '登录开放；需用户授权', cadence: '1991–2022 年值；目录 2026-10-01 更新', coverage: '106 条，含站码、站名与年度潮位统计；未见经纬度', license: '登录开放；需按平台许可核验', url: 'https://data.wenzhou.gov.cn/jdop_front/detail/data.do?iid=16726', note: '可能支持潮位站码解释；尚未取得记录，不能用于补齐坐标或垂直基准。' },
  { id: 'zj-pumps', city: 'all', category: '排水资产', name: '泵站名录', publisher: '浙江省数据开放平台', access: '需注册申请', cadence: '静态名录', coverage: '泵站属性；非运行状态', license: '按平台条款核验', url: 'https://data.zjzwfw.gov.cn/jdop_front/detail/api.do?iid=27444', note: '无泵站实时能力或调度状态。' },
]

export const ZHEJIANG_EVENTS = [
  { id: 'meihua-2022', year: '2022', title: '台风“梅花”', type: '台风 / 复盘资料', city: 'ningbo', grade: 'D · 资料登记', source: '宁波市鄞州区姜山镇防御复盘', url: 'https://www.nbyz.gov.cn/art/2022/9/23/art_1229109350_59191168.html', note: '事后复盘；不作为当时可获得的预报或点位真值。' },
  { id: 'infa-2021', year: '2021', title: '台风“烟花”', type: '台风 / 求助报道', city: 'ningbo', grade: 'D · 资料登记', source: '宁波 12345 求助报道', url: 'http://cxnews.cnnb.com.cn/system/2021/07/27/012251035.shtml', note: '聚合报道；不推断个体居民行为。' },
]

export const CITY_CHECKS = {
  ningbo: ['核查低洼道路与下穿通道的现场积水', '比对甬江水位、潮位及排水口状态', '联系属地确认巡查与泵站运行记录'],
  taizhou: ['核查山地来水与低洼道路现场情况', '比对椒江河网水位与城市排水状态', '联系属地确认老城及下穿通道巡查'],
  wenzhou: ['核查台风雨带与山区汇流变化', '比对瓯江及飞云江水位和潮位边界', '联系属地确认易涝点与泵闸运行'],
  hangzhou: ['核查短时强降雨及道路积水信息', '比对钱塘江潮位与内河水位变化', '联系属地确认下穿通道和排水设施状态'],
}

export function scenarioAssessment({ rain, tide, river, drainage }) {
  const rainfall = Number(rain)
  const score = (rainfall >= 100 ? 2 : rainfall >= 50 ? 1 : 0)
    + (tide === 'high' ? 1 : 0)
    + (river === 'high' ? 1 : 0)
    + (drainage === 'reduced' ? 1 : 0)
  return {
    score,
    label: score >= 4 ? '优先核查' : score >= 2 ? '加强核查' : '常规核查',
    detail: '基于用户输入的规则演练优先级；不代表积水概率、预测等级或官方预警。',
  }
}

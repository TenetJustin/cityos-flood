// Public, read-only research metadata. This is a catalogue snapshot, not live data.
// Keep in step with backend/app/region.py and backend/app/realtime_sources.py.
export const catalogCheckedAt = '2026-10-19'

export const cities = [
  { id: 'shanghai', name: '上海', province: '上海', form: '三角洲与河口', drivers: ['暴雨', '潮位', '河网顶托'], center: [31.23, 121.47], status: '仅配置' },
  { id: 'ningbo', name: '宁波', province: '浙江', form: '海湾与河口', drivers: ['台风', '风暴潮', '河流洪水'], center: [29.87, 121.55], status: '仅配置' },
  { id: 'fuzhou', name: '福州', province: '福建', form: '山海与河谷', drivers: ['短历时暴雨', '山洪', '闽江潮位顶托'], center: [26.08, 119.30], status: '仅配置' },
  { id: 'shenzhen', name: '深圳', province: '广东', form: '海湾与丘陵高密城区', drivers: ['台风', '暴雨', '潮位', '城市快速汇流'], center: [22.54, 114.06], status: '研究原型' },
  { id: 'haikou', name: '海口', province: '海南', form: '海岛滨海低地', drivers: ['台风', '风暴潮', '低洼区积水'], center: [20.04, 110.32], status: '仅配置' },
]

export const sources = [
  { id: 'shanghai-underpass-flood-depth-catalog', city: 'shanghai', name: '下立交实时积水深度', publisher: '上海市水务局', type: '数据集候选', access: '目录已确认，接口未定位', mapping: '阻塞', license: '条款待核', phenomena: '积水监测数值', url: 'https://data.sh.gov.cn/cmsres/c8/c87badc4f16e4481a8e8a30665b64a1c/938b00188faa9e46ea4f351fa793739a.pdf', gaps: ['下载或 API 地址未确认', '单位、坐标基准未确认', '实际可获得时间未定义'] },
  { id: 'ningbo-public-data-portal-lead', city: 'ningbo', name: '宁波市数据开放平台入口', publisher: '宁波市数据服务体系', type: '门户线索', access: '已发现', mapping: '未评估', license: '未知', phenomena: '未找到具体实时内涝数据集', url: 'https://qf.ningbo.gov.cn/qfpt/fwbk/sjfw/index.html', gaps: ['具体数据集未定位', '接入条款及结构未知'] },
  { id: 'fuzhou-public-data-portal-lead', city: 'fuzhou', name: '福建省数据开放入口', publisher: '福建省人民政府', type: '门户线索', access: '已发现', mapping: '未评估', license: '未知', phenomena: '监测数据导出未定位', url: 'https://www.fujian.gov.cn/zwgk/index.htm', gaps: ['历史与实时访问未知', '结构及许可未知'] },
  { id: 'shenzhen-waterlogging-level', city: 'shenzhen', name: '市水务局积涝点水位数据', publisher: '深圳市水务局', type: '数据集候选', access: '需认证下载', mapping: '阻塞', license: '条款待核', phenomena: '积涝点水位；不能直接等同积水深度', url: 'https://opendata.sz.gov.cn/', gaps: ['水位零点或高程基准未知', '实际可获得时间未记录', '需会话凭据'] },
  { id: 'shenzhen-reservoir-rainfall', city: 'shenzhen', name: '水库站点降雨量实时信息', publisher: '深圳市水务局', type: '数据集候选', access: '目录已确认', mapping: '阻塞', license: '条款待核', phenomena: '站点降雨量', url: 'https://opendata.sz.gov.cn/', gaps: ['结构与累积时段未知', '实际可获得时间未定义'] },
  { id: 'shenzhen-ground-weather-observation', city: 'shenzhen', name: '深圳国家基本气象站观测实况', publisher: '深圳市气象局（台）', type: '数据集候选', access: '目录已确认', mapping: '阻塞', license: '条款待核', phenomena: '地面气象站观测实况', url: 'https://opendata.sz.gov.cn/', gaps: ['降雨字段与时间粒度未核', '实际可获得时间未定义'] },
  { id: 'haikou-hainan-data-portal-lead', city: 'haikou', name: '海南省公共数据开放入口候选', publisher: '海南省公共数据体系', type: '门户线索', access: '已发现', mapping: '未评估', license: '未知', phenomena: '具体内涝数据集未定位', url: 'https://data.hainan.gov.cn/', gaps: ['具体数据集、结构、许可未确认'] },
]

export const evidenceTypes = [
  { id: 'observation', name: '真实观测', description: '有可追溯原始记录、观测时间和来源；当前公开站点未加载合格观测。' },
  { id: 'historical_record', name: '历史记录', description: '事后发布的官方或档案材料；不能当作事件发生时可用的输入。' },
  { id: 'model_inference', name: '模型推断', description: '必须附模型版本、起报时刻、输入快照和不确定性；不能称为观测。' },
  { id: 'simulation_scenario', name: '模拟情景', description: '仅供假设分析；不能冒充真实发生过的事件。' },
  { id: 'missing', name: '缺失数据', description: '明确保留空值、缺口原因与阻塞的下游分析。' },
]

export const event = {
  id: 'shenzhen-2023-09-07', city: 'shenzhen', title: '深圳 2023 年“9·7”极端暴雨', date: '2023-09-07', kind: '极端暴雨 / 复合致涝',
  description: '端到端研究候选。已登记可核验的官方事后材料；尚无满足双时间、独立真值要求的完整事件包，因此不能给出有效预测技巧结论。',
  records: [
    { source: '深圳市气象局 2023 年气候公报', fact: '最大 24 小时滑动雨量 560 mm', url: 'https://weather.sz.gov.cn/qixiangfuwu/qihoufuwu/qihouguanceyupinggu/nianduqihougongbao/content/post_11121693.html' },
    { source: '深圳市气象局 2023-09-10 工作动态', fact: '事后说明 9 月 7 日傍晚至 8 日降雨过程', url: 'https://weather.sz.gov.cn/gkmlpt/content/10/10827/post_10827001.html' },
    { source: '深圳市水务局 2023 年统计', fact: '全市平均雨量 281.7 mm；属于事后汇总', url: 'https://swj.sz.gov.cn/sjfb/swjcsj/content/post_11813429.html' },
  ],
  gaps: ['逐站 observed_at 与 available_at 双时间观测', '独立积水深度真值及站点空间基准', '当时签发的预报快照与模型版本', '居民个体行为和应急执行日志'],
}

export const labModules = [
  { id: 'overview', name: '旧版态势实验', category: '研究原型', detail: '既有深圳页面依赖后端与混合来源；公开静态站不执行其预报。' },
  { id: 'world', name: '世界模型推演', category: '模拟情景', detail: '空间耦合、可达性与反事实研究需要受控输入。' },
  { id: 'wam', name: '方案建议 WAM', category: '受控建议', detail: '仅输出研究建议，不触发设施、人员或模型版本变更。' },
  { id: 'human-impact', name: '居民影响', category: '影响评估', detail: '当前缺可靠个体行为观测，不展示虚构反应。' },
  { id: 'swe', name: 'SWE 物理引擎', category: '模拟情景', detail: '物理试验依赖本地运行环境，公开站不提供实时计算。' },
  { id: 'knowledge', name: '知识库', category: '历史记录', detail: '历史材料需逐项溯源，旧推断不视为可核验事实。' },
  { id: 'typhoon', name: '台风实验', category: '研究原型', detail: '历史路径与情景页面需审计来源与许可。' },
  { id: 'surge', name: '风暴潮实验', category: '研究原型', detail: '潮位与高程基准未核齐，不输出综合水深。' },
  { id: 'landslide', name: '滑坡实验', category: '研究原型', detail: '跨灾种模块，不代表五城内涝模型已验证。' },
  { id: 'earthquake', name: '地震实验', category: '研究原型', detail: '跨灾种模块，不属于当前五城内涝交付范围。' },
  { id: 'reservoir', name: '水库与山洪实验', category: '受控研究', detail: '不具备真实预泄或调度权限。' },
]

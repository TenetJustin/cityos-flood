import { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ResearchHome from './components/ResearchHome.jsx'
import OverviewPage from './components/OverviewPage.jsx'
import WorldModelPage from './components/WorldModelPage.jsx'
import OptimizationPage from './components/OptimizationPage.jsx'
import KnowledgeBasePanel from './components/KnowledgeBasePanel.jsx'
import TyphoonPage from './components/TyphoonPage.jsx'
import SurgePage from './components/SurgePage.jsx'
import LandslidePage from './components/LandslidePage.jsx'
import EarthquakePage from './components/EarthquakePage.jsx'
import ReservoirPanel from './components/ReservoirPanel.jsx'
import HumanImpactPage from './components/HumanImpactPage.jsx'
import SwePage from './components/SwePage.jsx'
import { getPredict } from './api'

/* ============ 主题上下文 ============ */
const ThemeCtx = createContext({ theme: 'dark', toggle: () => {} })
export const useTheme = () => useContext(ThemeCtx)

/* ============ 时钟 ============ */
function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/* ============ 导航结构 ============ */
const NAV = [
  {
    section: '五城研究',
    items: [{ id: 'research', icon: '◉', label: '数据与分析', desc: '五城观测 · 来源审计 · 缺口' }],
  },
  {
    section: '深圳实验模块',
    items: [
      { id: 'overview', icon: '◎', label: '旧版态势实验', desc: '含模型推断、预报和回退数据' },
    ],
  },
  {
    section: '推演实验',
    items: [
      { id: 'world', icon: '◈', label: '推演与反事实', desc: '空间耦合 · 可达性 · 同化' },
      { id: 'wam', icon: '⬢', label: '方案建议 WAM', desc: '研究建议，不能自动调度' },
      { id: 'human-impact', icon: '🧍', label: '居民影响', desc: '灾害→人群→行为→级联→恢复' },
      { id: 'swe', icon: '🌊', label: 'SWE 物理引擎', desc: 'WebGPU 浅水方程 · 福田三角网格' },
    ],
  },
  {
    section: '知识',
    items: [
      { id: 'knowledge', icon: '▤', label: '沉淀知识库', desc: '案例沉淀 · 城安助手 RAG' },
    ],
  },
  {
    section: '灾种专页',
    items: [
      { id: 'typhoon', icon: '🌀', label: '台风', desc: '路径库 · 链式预测 · 3D 叠加' },
      { id: 'surge', icon: '🌊', label: '风暴潮', desc: '潮位站 · 波浪事件 · 海洋点位' },
      { id: 'landslide', icon: '⛰', label: '滑坡', desc: '隐患点 · 分区风险' },
      { id: 'earthquake', icon: '🌍', label: '地震', desc: '断裂带 · 烈度评估 · 风险分级' },
    ],
  },
  {
    section: '水务实验',
    items: [
      { id: 'reservoir', icon: '🏞️', label: '水库与山洪', desc: '蓄洪余量 · 预泄 · 沟道预警' },
    ],
  },
]

const PAGE_TITLES = {
  research: { title: '五城数据与分析', sub: '观测证据 · 来源可用性 · 数据缺口' },
  overview: { title: '旧版态势实验', sub: '第三方预报、模型推断与可能的回退数据；并非核验实况' },
  world: { title: '世界模型推演', sub: '空间耦合 · 可达性 · 反事实 · 数据同化' },
  wam: { title: '方案建议 WAM', sub: '实验性建议输出；未经人工批准不改变模型或设施状态' },
  knowledge: { title: '沉淀知识库', sub: '真实事件案例 · 城安助手 RAG 问答 · 城市底座' },
  typhoon: { title: '台风灾害', sub: '历史路径库 · 多灾种链式预测 · 3D 路径叠加' },
  surge: { title: '风暴潮灾害', sub: '潮位站统计 · 四大事件波浪 · 历史档案' },
  landslide: { title: '滑坡灾害', sub: '在册隐患点 · 分区风险 · 官方预警模型' },
  'human-impact': { title: '居民影响与行为', sub: '灾害→人口暴露→居民行为→交通/医疗/避难级联→恢复' },
  earthquake: { title: '地震灾害', sub: '断裂带 · 历史目录 · 烈度快速评估 · 区级风险' },
  reservoir: { title: '水库调度与山洪预警', sub: '蓄洪余量 · 预泄方案 · 下游河道与山洪沟道联合预警' },
  swe: { title: 'SWE 底层物理引擎 (WebGPU)', sub: '福田 60m 非结构三角网格 · 二维浅水方程实时推演 · 降雨→积水→(P1)道路/设施' },
}

export default function App() {
  const [page, setPage] = useState('research')
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('cityos-theme') || 'dark')
  const [predict, setPredict] = useState(null)
  const [liveStatus, setLiveStatus] = useState(null)
  const now = useClock()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('cityos-theme', theme)
  }, [theme])

  useEffect(() => {
    if (page === 'research') return
    getPredict(3).then(setPredict).catch(() => setPredict(null))
    fetch('/api/live').then(r => r.json()).then(d => setLiveStatus(d)).catch(() => setLiveStatus(null))
  }, [page])

  const themeApi = useMemo(() => ({
    theme,
    toggle: () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
  }), [theme])

  return (
    <ThemeCtx.Provider value={themeApi}>
      <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
        {/* ===== 顶栏 ===== */}
        <header className="topbar">
          <button className="icon-btn" onClick={() => setCollapsed(c => !c)} title="收起/展开侧栏">
            {collapsed ? '»' : '«'}
          </button>
          <div className="topbar-brand">
            <span className="brand-mark">C</span>
            <div className="brand-text">
              <b>CITY OS</b>
              <span>东南地区城市内涝韧性研究</span>
            </div>
          </div>
          <div className="topbar-live">
            <span className="live-dot off" />
            非公众预警
          </div>
          <div className="topbar-clock">
            <div style={{ textAlign: 'right' }}>
              <div className="clock-time">{now.toLocaleTimeString('zh-CN', { hour12: false })}</div>
              <div className="clock-date">{now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</div>
            </div>
            <button className="icon-btn" onClick={themeApi.toggle} title="切换深浅主题">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </header>

        {/* ===== 侧边导航 ===== */}
        <nav className="sidebar">
          {NAV.map(sec => (
            <div key={sec.section} className="side-section">
              <div className="side-label">{sec.section}</div>
              {sec.items.map(it => (
                <button
                  key={it.id}
                  className={`nav-item ${page === it.id ? 'on' : ''}`}
                  onClick={() => setPage(it.id)}
                  title={it.desc}
                >
                  <span className="nav-icon">{it.icon}</span>
                  <span className="nav-text">{it.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="side-foot">
            守恒状态空间 + 本体脆弱性<br />+ 反事实 + EnSRF + CEM<br /><br />
            <span style={{ opacity: 0.7 }}>研究演示原型<br />不替代正式预警</span>
          </div>
        </nav>

        {/* ===== 内容区 ===== */}
        <main className="content">
          <div className="page-head">
            <div className="page-title">
              <h1>{PAGE_TITLES[page].title}</h1>
              <p>{PAGE_TITLES[page].sub}</p>
            </div>
          </div>
          <div className="page-enter" key={page}>
            <ErrorBoundary fallback={<div className="err-box">模块加载失败</div>}>
              {page !== 'research' && <div className="research-error" style={{ marginBottom: 16 }}>深圳实验模块：包含模型推断、模拟情景及可能的回退数据，不代表五城真实观测或可执行调度。</div>}
              {page === 'research' && <ResearchHome />}
              {page === 'overview' && <OverviewPage predictData={predict} />}
              {page === 'world' && <WorldModelPage predictData={predict} />}
              {page === 'wam' && <OptimizationPage predictData={predict} />}
              {page === 'knowledge' && <KnowledgeBasePanel />}
              {page === 'typhoon' && <div className="legacy-wrap"><TyphoonPage /></div>}
              {page === 'surge' && <div className="legacy-wrap"><SurgePage /></div>}
              {page === 'landslide' && <div className="legacy-wrap"><LandslidePage /></div>}
              {page === 'earthquake' && <div className="legacy-wrap"><EarthquakePage /></div>}
              {page === 'reservoir' && <div className="legacy-wrap"><ReservoirPanel /></div>}
              {page === 'human-impact' && <div className="legacy-wrap"><HumanImpactPage /></div>}
              {page === 'swe' && <div className="legacy-wrap"><SwePage /></div>}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </ThemeCtx.Provider>
  )
}

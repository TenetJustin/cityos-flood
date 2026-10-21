import { demoActionForPoint, estimateResidentScenario } from './demoFloodModel.js'
import { demoTimeLabel } from './zhejiangDemoData.js'

export default function FloodGridView({ dataset, cityId, points, hour, selectedId, onSelect }) {
  const selected = points.find((p) => p.point_id === selectedId) || points[0]
  const plan = dataset.hydraulics?.resource_plans?.[cityId]?.[hour]
  const ordered = [...points].sort((a, b) => b.terrain_z - a.terrain_z || a.terrain_x - b.terrain_x)
  const curve = selected ? dataset.hydraulics?.cities?.[cityId]?.depth_cm_by_point?.[selected.point_id] : null
  const people = selected && Number.isFinite(selected.population_base) ? estimateResidentScenario(selected, selected.current_depth_cm) : null
  const ceiling = Math.max(60, ...(curve || []))
  const toY = (value) => 92 - value / ceiling * 72
  const assigned = plan?.assignments.filter((a) => a.point_id === selected?.point_id).reduce((n, a) => n+a.teams, 0) || 0
  const exportPacket = () => {
    const packet = { label: 'CityOS 情景决策复核包 · 非实际行动', city_id: cityId, scenario_hour: hour,
      time_label: dataset.scenario?.landfall_hour === 24 ? demoTimeLabel(hour) : `情景第${hour}小时`, model: dataset.model, scenario: dataset.scenario, input_sha256: dataset.hydraulics?.input_sha256,
      evidence_type: 'simulated_scenario', human_approval: 'pending', points, resource_plan: plan,
      safety_boundary: '节点蓄水不等于二维淹没面；资源连线不是核验过的行车路线；不得用于公众预警或自动调度。' }
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `CityOS-${cityId}-h${hour}-review.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="z-hydraulic-grid" aria-label="动态二维点位网格与决策复核">
    <div className="z-hydraulic-title"><div><small>{dataset.model?.engine === 'epa_swmm' ? '2D / NODE PONDING' : '2D / RULE SCENARIO'}</small><h3>微区点位水深 · 点击查看影响与建议</h3></div><button type="button" onClick={exportPacket}>导出当前复核包 ↓</button></div>
    <div className="z-hydraulic-layout">
      <div><div className="z-hydraulic-cells" aria-label="25个合成微区点位">
        {ordered.map((point) => <button type="button" key={point.point_id} aria-pressed={point.point_id === selected?.point_id} aria-label={`${point.label}，水深${point.current_depth_cm}厘米，相对高程${point.relative_elevation_m}米`} className={`z-hydraulic-cell ${point.priority_tier.toLowerCase()}`} onClick={() => onSelect(point.point_id)}>
          <span>{point.label}</span><strong>{point.current_depth_cm.toFixed(2)}<small> cm</small></strong><span>地势 {point.relative_elevation_m.toFixed(1)} m</span>
        </button>)}
      </div><div className="z-hydraulic-legend"><span>灰 ＜8 cm</span><span>蓝 8–30</span><span>橙 30–60</span><span>红 ≥60</span></div><small>北↑ · 合成点位排列，不是街道淹没面积</small></div>
      <div className="z-hydraulic-detail" aria-live="polite">
        {selected && <><h4>{selected.label} · {selected.priority_tier}</h4><p>{demoActionForPoint(selected, selected.current_depth_cm).action}</p>
          <dl><div><dt>{curve ? '当前 / 过程最高水深' : '当前规则水深'}</dt><dd>{selected.current_depth_cm.toFixed(2)}{curve ? ` / ${Math.max(...curve).toFixed(2)}` : ''} cm</dd></div>{people && <div><dt>情景暴露 / 需要协助</dt><dd>{people.exposed} / {people.assisted} 人</dd></div>}{plan && <div><dt>候选安排</dt><dd>{assigned} 支队伍 · 待复核</dd></div>}</dl>
          {curve && <svg viewBox="0 0 300 112" role="img" aria-label={`${selected.label}73小时节点水深变化，当前${demoTimeLabel(hour)}`}><path d={curve.map((v, h) => `${h ? 'L' : 'M'} ${8+h*284/72} ${toY(v)}`).join(' ')} fill="none" stroke="#376eab" strokeWidth="2.5"/><line x1={8+hour*284/72} x2={8+hour*284/72} y1="12" y2="94" stroke="#8b3746" strokeDasharray="3 3"/><text x="8" y="110">T−24h</text><text x="118" y="110">登陆 T0</text><text x="250" y="110">T+48h</text></svg>}
        </>}
        {plan && <div className="z-capacity-summary"><strong>本城资源测算</strong><span>可用 {plan.available_teams} 支 · 已分配 {plan.assigned_teams} 支 · 缺口 <b>{plan.unmet_teams}</b> 支</span><small>NetworkX 容量优化；队伍与可达条件为情景输入，非部门实况。</small></div>}
      </div>
    </div>
  </section>
}

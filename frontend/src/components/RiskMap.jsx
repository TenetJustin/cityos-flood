import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
} from 'react-leaflet'
import {
  depthQuantilesM,
  exceedanceProbability,
  fmtTime,
  formatDepthM,
  formatPercent,
  getDrainageNetStats,
  getDrainageNetwork,
  getDrainagePoints,
  getGridImageBBox,
  getGridRisk,
  getPumpStations,
  getWaternetLayer,
} from '../api'

const clamp01 = (value = 0) => Math.max(0, Math.min(1, Number(value) || 0))
const depthLevel = (depthM = 0) => depthM >= 0.5 ? 4 : depthM >= 0.3 ? 3 : depthM >= 0.15 ? 2 : depthM >= 0.05 ? 1 : 0

const PALETTES = {
  depth: ['#38BDF8', '#2DD4BF', '#A3E635', '#FB923C', '#F43F5E'],
  probability: ['#BAE6FD', '#67E8F9', '#22D3EE', '#FBBF24', '#FB7185'],
  vulnerability: ['#60A5FA', '#22D3EE', '#2DD4BF', '#FBBF24', '#F97316'],
}

const MODE_META = {
  depth: {
    label: 'P50 水深',
    eyebrow: 'ENSEMBLE MEDIAN',
    legend: ['< 5cm', '5–15cm', '15–30cm', '30–50cm', '≥ 50cm'],
  },
  probability: {
    label: '超 15cm 概率',
    eyebrow: 'THRESHOLD PROBABILITY',
    legend: ['< 20%', '20–40%', '40–60%', '60–80%', '≥ 80%'],
  },
  vulnerability: {
    label: '本底脆弱性',
    eyebrow: 'BASE VULNERABILITY',
    legend: ['很低', '较低', '中等', '较高', '很高'],
  },
}

const bucketColor = (value, palette) => palette[Math.min(4, Math.floor(clamp01(value) * 5))]
const depthColor = (depthM) => PALETTES.depth[depthLevel(depthM)]
const districtShortName = (name = '') => name.replace(/(新区|区)$/, '')

// 水网样式：河流深蓝、溪流浅蓝、排水渠/运河青色虚线
const WATER_KIND_STYLES = {
  river: { color: '#2b6cb0', weight: 2.4, opacity: 0.75, dashArray: null, label: '河流' },
  stream: { color: '#63b3ed', weight: 1.4, opacity: 0.65, dashArray: null, label: '溪流' },
  drain: { color: '#38b2ac', weight: 1.8, opacity: 0.75, dashArray: '5 4', label: '排水渠' },
  canal: { color: '#4fd1c5', weight: 1.8, opacity: 0.7, dashArray: '5 4', label: '运河' },
}

// 排涝泵站标记样式（天地图地理编码近似坐标）
const PUMP_COLOR = '#f6893d'

// GeoJSON [lon,lat] → Leaflet [lat,lon]
const toLatLng = (coords) => coords.map(([lon, lat]) => [lat, lon])

function gridCellAt(grid, cell, cellIndex, hour) {
  const stepCount = Number(grid?.timeseries_encoding?.shape?.[1])
    || grid?.times?.length
    || cell.risk?.length
    || cell.depth_p50_m?.length
    || 0
  if (!stepCount) return { probability: 0, depthM: 0 }

  const timeIndex = Math.max(0, Math.min(hour, stepCount - 1))
  const offset = cellIndex * stepCount + timeIndex
  const probabilityBytes = grid?._riskU8
  const depthBytes = grid?._depthU16LEBytes
  const compactShape = grid?.timeseries_encoding?.shape
  const compactLengthValid = (
    compactShape?.[0] === grid?.cells?.length
    && probabilityBytes?.length === grid.cells.length * stepCount
    && depthBytes?.length === grid.cells.length * stepCount * 2
  )

  if (compactLengthValid) {
    const depthOffset = offset * 2
    return {
      probability: probabilityBytes[offset] / 255,
      depthM: (depthBytes[depthOffset] + 256 * depthBytes[depthOffset + 1]) / 1000,
    }
  }

  return {
    probability: clamp01(cell.risk?.[timeIndex]),
    depthM: Math.max(0, Number(cell.depth_p50_m?.[timeIndex]) || 0),
  }
}

function cellAppearance(mode, cell, probability, depthM) {
  if (mode === 'vulnerability') {
    const value = clamp01(cell.vulnerability)
    return {
      color: bucketColor(value, PALETTES.vulnerability),
      radius: 2.4 + value * 2.3,
      opacity: 0.32 + value * 0.48,
    }
  }

  if (mode === 'probability') {
    const active = probability >= 0.01
    return {
      color: bucketColor(probability, PALETTES.probability),
      radius: active ? 2.5 + probability * 2.7 : 1.25,
      opacity: active ? 0.24 + probability * 0.66 : 0.055,
    }
  }

  const active = depthM >= 0.005 || probability >= 0.01
  return {
    color: depthColor(depthM),
    radius: active ? 2.5 + Math.min(depthM / 0.5, 1) * 2.7 : 1.25,
    opacity: active ? 0.28 + Math.max(probability, Math.min(depthM / 0.5, 1)) * 0.62 : 0.055,
  }
}

export default function RiskMap({ data, view, hour }) {
  const center = data.city.center
  const [gridState, setGridState] = useState({ status: 'loading', data: null, error: '' })
  const [mode, setMode] = useState('depth')
  const [img, setImg] = useState(false)
  const [imgState, setImgState] = useState({ status: 'idle', meta: null, error: '' })
  const [waterNet, setWaterNet] = useState({ show: true, status: 'idle', features: [], meta: null, error: '' })
  // 排水管网：SWMManywhere 合成管道（默认关，避免与格点/水网视觉冲突）
  const [drainNet, setDrainNet] = useState({ show: false, status: 'idle', features: [], meta: null, error: '', trunkOnly: false })
  const [drainPoints, setDrainPoints] = useState({ show: false, status: 'idle', features: [], meta: null, error: '' })
  const [drainStats, setDrainStats] = useState(null)
  // 排涝泵站点位（水务局统计表 + 天地图编码，默认显示）
  const [pumps, setPumps] = useState({ show: true, status: 'idle', stations: [], meta: null, error: '' })

  useEffect(() => {
    let active = true
    setGridState({ status: 'loading', data: null, error: '' })
    getGridRisk(data.forecast_days, 0.018, data.forecast_run_id)
      .then((nextGrid) => {
        if (!active || nextGrid.forecast_run_id !== data.forecast_run_id) return
        setGridState({ status: 'ready', data: nextGrid, error: '' })
      })
      .catch((error) => {
        if (active) setGridState({ status: 'error', data: null, error: error?.message || '格点数据加载失败' })
      })
    return () => { active = false }
  }, [data.forecast_days, data.forecast_run_id])

  // 水网图层（静态几何，一次性加载）
  useEffect(() => {
    if (!waterNet.show) return undefined
    if (waterNet.features.length) return undefined
    let active = true
    setWaterNet((s) => ({ ...s, status: 'loading', error: '' }))
    getWaternetLayer('river,stream,drain,canal', 0.3, 2000)
      .then((layer) => {
        if (!active) return
        setWaterNet({
          show: true,
          status: 'ready',
          features: layer.features || [],
          meta: layer.meta || null,
          error: '',
        })
      })
      .catch((error) => {
        if (active) setWaterNet((s) => ({ ...s, status: 'error', error: error?.message || '水网图层加载失败' }))
      })
    return () => { active = false }
  }, [waterNet.show])

  // 排水管网图层（SWMManywhere 合成管道 + 统计）
  useEffect(() => {
    if (!drainNet.show) return undefined
    if (drainNet.features.length && drainNet.trunkOnly === drainNet._loadedTrunk) return undefined
    let active = true
    setDrainNet((s) => ({ ...s, status: 'loading', error: '' }))
    const minDiam = drainNet.trunkOnly ? 0.5 : 0
    getDrainageNetwork(2500, minDiam)
      .then((layer) => {
        if (!active) return
        setDrainNet({
          show: true,
          status: 'ready',
          features: layer.features || [],
          meta: layer.meta || null,
          error: '',
          trunkOnly: drainNet.trunkOnly,
          _loadedTrunk: drainNet.trunkOnly,
        })
      })
      .catch((error) => {
        if (active) setDrainNet((s) => ({ ...s, status: 'error', error: error?.message || '排水管网加载失败' }))
      })
    return () => { active = false }
  }, [drainNet.show, drainNet.trunkOnly])

  // 真实排水点位（OSM 检查井 + 开放平台区级台账）
  useEffect(() => {
    if (!drainPoints.show) return undefined
    if (drainPoints.features.length) return undefined
    let active = true
    setDrainPoints((s) => ({ ...s, status: 'loading', error: '' }))
    getDrainagePoints()
      .then((layer) => {
        if (!active) return
        setDrainPoints({ show: true, status: 'ready', features: layer.features || [], meta: layer.meta || null, error: '' })
      })
      .catch((error) => {
        if (active) setDrainPoints((s) => ({ ...s, status: 'error', error: error?.message || '排水点位加载失败' }))
      })
    return () => { active = false }
  }, [drainPoints.show])

  // 排水管网统计摘要（一次加载）
  useEffect(() => {
    let active = true
    getDrainageNetStats()
      .then((s) => { if (active) setDrainStats(s) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // 排涝泵站点位（静态，一次性加载）
  useEffect(() => {
    if (!pumps.show) return undefined
    if (pumps.stations.length) return undefined
    let active = true
    setPumps((s) => ({ ...s, status: 'loading', error: '' }))
    getPumpStations()
      .then((layer) => {
        if (!active) return
        setPumps({
          show: true, status: 'ready',
          stations: layer.stations || [],
          meta: { count: layer.count, byDistrict: layer.by_district },
          error: '',
        })
      })
      .catch((error) => {
        if (active) setPumps((s) => ({ ...s, status: 'error', error: error?.message || '泵站图层加载失败' }))
      })
    return () => { active = false }
  }, [pumps.show])

  useEffect(() => {
    if (!img || mode !== 'depth') {
      setImgState({ status: 'idle', meta: null, error: '' })
      return undefined
    }

    let active = true
    const controller = new AbortController()
    setImgState({ status: 'loading', meta: null, error: '' })
    getGridImageBBox(data.forecast_days, data.forecast_run_id, hour, controller.signal)
      .then((meta) => {
        if (!active) return
        setImgState({ status: meta.empty ? 'empty' : 'image-loading', meta, error: '' })
      })
      .catch((error) => {
        if (active && error?.name !== 'AbortError') {
          setImgState({ status: 'error', meta: null, error: error?.message || '500m 图层加载失败' })
        }
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [data.forecast_days, data.forecast_run_id, hour, img, mode])

  const grid = gridState.data
  const cells = grid?.cells || []
  const imgMeta = imgState.meta
  const imgBounds = imgMeta
    ? [[imgMeta.south, imgMeta.west], [imgMeta.north, imgMeta.east]]
    : [[22.44, 113.72], [22.88, 114.66]]
  const imgURL = imgMeta?.url || `/api/risk/grid/image?res=0.0045&forecast_days=${data.forecast_days}&hour_index=${hour}&forecast_run_id=${encodeURIComponent(data.forecast_run_id || '')}`

  const cellView = useMemo(() => cells.map((cell, index) => {
    const values = gridCellAt(grid, cell, index, hour)
    return { cell, ...values, appearance: cellAppearance(mode, cell, values.probability, values.depthM) }
  }), [cells, grid, hour, mode])

  const citySummary = useMemo(() => view.reduce((summary, district) => {
    const depth = depthQuantilesM(district.at)
    const probability = exceedanceProbability(district.at, 0.15)
    return {
      maxDepth: Math.max(summary.maxDepth, depth.p50 || 0),
      maxProbability: Math.max(summary.maxProbability, probability || 0),
    }
  }, { maxDepth: 0, maxProbability: 0 }), [view])

  const metric = MODE_META[mode]

  return (
    <section className="map-wrap map-wrap-v2" aria-label="深圳内涝彩色态势地图">
      <header className="map-head-v2">
        <div className="map-heading">
          <div className="map-kicker">FORECAST MAP · {metric.eyebrow}</div>
          <h2 className="map-title-v2">深圳内涝 · 彩色态势图</h2>
          <div className="map-summary-row">
            <span className="map-status-dot live" />{fmtTime(data.hours?.[hour]) || '当前时次'}
            <span>最高 P50 <b>{formatDepthM(citySummary.maxDepth)}</b></span>
            <span>最高超阈概率 <b>{formatPercent(citySummary.maxProbability)}</b></span>
          </div>
        </div>
        <div className="map-toolbar" role="group" aria-label="地图指标切换">
          {Object.entries(MODE_META).map(([key, meta]) => (
            <button
              key={key}
              type="button"
              className={`map-chip ${mode === key ? 'on' : ''}`}
              aria-pressed={mode === key}
              onClick={() => {
                setMode(key)
                if (key !== 'depth') setImg(false)
              }}
            >
              {meta.label}
            </button>
          ))}
          <button
            type="button"
            className={`map-chip detail ${img ? 'on' : ''}`}
            aria-pressed={img}
            aria-busy={img && ['loading', 'image-loading'].includes(imgState.status)}
            disabled={mode !== 'depth'}
            title={mode === 'depth' ? '叠加当前时次约 500m GIS 下尺度图层' : '仅在 P50 水深模式可用'}
            onClick={() => setImg((value) => !value)}
          >
            500m 精细层
          </button>
          <button
            type="button"
            className={`map-chip detail water ${waterNet.show ? 'on' : ''}`}
            aria-pressed={waterNet.show}
            aria-busy={waterNet.show && waterNet.status === 'loading'}
            title="叠加 OSM 河流/排水渠水网几何"
            onClick={() => setWaterNet((s) => ({ ...s, show: !s.show }))}
          >
            {waterNet.status === 'loading' ? '水网加载中…' : `水网 ${waterNet.features.length || ''}`}
          </button>
          <button
            type="button"
            className={`map-chip detail drain ${drainNet.show ? 'on' : ''}`}
            aria-pressed={drainNet.show}
            aria-busy={drainNet.show && drainNet.status === 'loading'}
            title="叠加 SWMManywhere 合成地下排水管网（沿道路布管）"
            onClick={() => setDrainNet((s) => ({ ...s, show: !s.show }))}
          >
            {drainNet.status === 'loading' ? '管网加载中…' : `管网 ${drainNet.features.length || ''}`}
          </button>
          {drainNet.show && drainNet.features.length > 0 && (
            <button
              type="button"
              className={`map-chip detail trunk ${drainNet.trunkOnly ? 'on' : ''}`}
              aria-pressed={drainNet.trunkOnly}
              title={drainNet.trunkOnly ? '当前仅显示干管（管径 ≥ 0.5 m）' : '切换为仅干管（管径 ≥ 0.5 m）'}
              onClick={() => setDrainNet((s) => ({ ...s, trunkOnly: !s.trunkOnly }))}
            >
              干管
            </button>
          )}
          <button
            type="button"
            className={`map-chip detail wells ${drainPoints.show ? 'on' : ''}`}
            aria-pressed={drainPoints.show}
            aria-busy={drainPoints.show && drainPoints.status === 'loading'}
            title="叠加真实排水点位：OSM 检查井 + 开放平台泵站/内涝点（区级近似）"
            onClick={() => setDrainPoints((s) => ({ ...s, show: !s.show }))}
          >
            {drainPoints.status === 'loading' ? '点位加载中…' : `井/泵/涝点 ${drainPoints.features.length || ''}`}
          </button>
          <button
            type="button"
            className={`map-chip detail pump ${pumps.show ? 'on' : ''}`}
            aria-pressed={pumps.show}
            aria-busy={pumps.show && pumps.status === 'loading'}
            title="叠加 78 座排涝泵站点位（水务局统计表 + 天地图地理编码近似坐标）"
            onClick={() => setPumps((s) => ({ ...s, show: !s.show }))}
          >
            {pumps.status === 'loading' ? '泵站加载中…' : `泵站 ${pumps.stations.length || ''}`}
          </button>
        </div>
      </header>

      <div className="map-stage">
        <MapContainer
          center={center}
          zoom={10}
          minZoom={9}
          maxZoom={13}
          maxBounds={[[22.30, 113.45], [23.05, 114.95]]}
          maxBoundsViscosity={0.65}
          className="map map-colorful"
          scrollWheelZoom={false}
          zoomControl={false}
          preferCanvas
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
          />
          <ZoomControl position="topright" />

          {/* 水网图层：OSM 河流/溪流/排水渠/运河（几何线，压在格点之下） */}
          {waterNet.show && waterNet.features.map((feature, index) => {
            const style = WATER_KIND_STYLES[feature.properties.kind]
            if (!style) return null
            return (
              <Polyline
                key={`water-${index}`}
                positions={toLatLng(feature.geometry.coordinates)}
                pathOptions={{
                  color: style.color,
                  weight: style.weight,
                  opacity: style.opacity,
                  dashArray: style.dashArray || undefined,
                }}
                eventHandlers={{
                  mouseover: (e) => { e.target.setStyle({ weight: style.weight + 2, opacity: 0.95 }) },
                  mouseout: (e) => { e.target.setStyle({ weight: style.weight, opacity: style.opacity }) },
                }}
              >
                <Tooltip sticky className="grid-tooltip" opacity={1}>
                  <div className="grid-tip-head">{style.label}</div>
                  <div><span>名称</span><b>{feature.properties.name || '（未命名）'}</b></div>
                  <div><span>长度</span><b>{feature.properties.length_km} km</b></div>
                </Tooltip>
              </Polyline>
            )
          })}

          {/* 排水管网图层：SWMManywhere 合成管道（沿道路布管，示意性几何） */}
          {drainNet.show && drainNet.features.map((feature, index) => {
            const p = feature.properties
            const trunk = p.diameter_m >= 0.5
            return (
              <Polyline
                key={`drain-${index}`}
                positions={toLatLng(feature.geometry.coordinates)}
                pathOptions={{
                  color: trunk ? '#7c2d12' : '#b45309',
                  weight: trunk ? 2.0 : 1.0,
                  opacity: trunk ? 0.8 : 0.45,
                }}
                eventHandlers={{
                  mouseover: (e) => { e.target.setStyle({ weight: trunk ? 2.8 : 1.8, opacity: 0.95 }) },
                  mouseout: (e) => { e.target.setStyle({ weight: trunk ? 2.0 : 1.0, opacity: trunk ? 0.8 : 0.45 }) },
                }}
              >
                <Tooltip sticky className="grid-tooltip" opacity={1}>
                  <div className="grid-tip-head">{trunk ? '排水干管' : '排水支管'}（合成）</div>
                  <div><span>管径</span><b>{p.diameter_m.toFixed(2)} m</b></div>
                  <div><span>长度</span><b>{p.length_m.toFixed(1)} m</b></div>
                  <div><span>坡度</span><b>{p.slope.toFixed(4)}</b></div>
                </Tooltip>
              </Polyline>
            )
          })}

          {/* 真实排水点位：OSM 检查井（真实坐标）/ 泵站 / 内涝点 / 运营单位（区级近似） */}
          {drainPoints.show && drainPoints.features.map((feature, index) => {
            const p = feature.properties
            const style = {
              check_well: { color: '#0f766e', radius: 2.6, fillOpacity: 0.75, label: '检查井' },
              pump_station: { color: '#7c3aed', radius: 4.2, fillOpacity: 0.9, label: '排涝泵站' },
              waterlogging: { color: '#dc2626', radius: 4.6, fillOpacity: 0.9, label: '积水内涝点' },
              operator: { color: '#ea580c', radius: 3.8, fillOpacity: 0.9, label: '排水运营单位' },
            }[p.category] || { color: '#64748b', radius: 3, fillOpacity: 0.8, label: p.category }
            return (
              <CircleMarker
                key={`point-${index}`}
                center={[feature.geometry.coordinates[1], feature.geometry.coordinates[0]]}
                radius={style.radius}
                pathOptions={{
                  color: style.color,
                  fillColor: style.color,
                  fillOpacity: style.fillOpacity,
                  opacity: 0.95,
                  weight: 1,
                }}
              >
                <Tooltip direction="top" className="grid-tooltip" opacity={1}>
                  <div className="grid-tip-head">{style.label}{p.approximate ? '（区级近似）' : ''}</div>
                  {p.name && <div><span>名称</span><b>{p.name}</b></div>}
                  {p.district && <div><span>区域</span><b>{p.district}</b></div>}
                  {p.detail && <div><span>类型</span><b>{p.detail}</b></div>}
                  {p.phone && <div><span>电话</span><b>{p.phone}</b></div>}
                </Tooltip>
              </CircleMarker>
            )
          })}

          {/* 排涝泵站点位（78 座，水务局统计表 + 天地图地理编码近似） */}
          {pumps.show && pumps.stations.map((station, index) => (
            <CircleMarker
              key={`pump-${index}`}
              center={[station.lat, station.lon]}
              radius={3.2}
              pathOptions={{
                color: '#FFFFFF',
                fillColor: PUMP_COLOR,
                fillOpacity: 0.92,
                opacity: 0.9,
                weight: 1.2,
              }}
            >
              <Tooltip direction="top" className="grid-tooltip" opacity={1}>
                <div className="grid-tip-head">排涝泵站</div>
                <div><span>名称</span><b>{station.name}</b></div>
                <div><span>行政区</span><b>{station.district_name}</b></div>
                <div><span>坐标</span><b>{station.lat.toFixed(4)}, {station.lon.toFixed(4)}</b></div>
                <div style={{ fontSize: 9, color: 'var(--ink-4)', marginTop: 2 }}>坐标为天地图地理编码近似值</div>
              </Tooltip>
            </CircleMarker>
          ))}

          {img && mode === 'depth' && ['image-loading', 'ready'].includes(imgState.status) && (
            <ImageOverlay
              key={imgURL}
              url={imgURL}
              bounds={imgBounds}
              opacity={0.92}
              zIndex={320}
              eventHandlers={{
                load: () => setImgState((current) => current.meta?.url === imgURL
                  ? { ...current, status: 'ready', error: '' }
                  : current),
                error: () => setImgState((current) => current.meta?.url === imgURL
                  ? { ...current, status: 'error', error: '精细层图像解码或传输失败' }
                  : current),
              }}
            />
          )}

          {!(img && mode === 'depth' && ['image-loading', 'ready'].includes(imgState.status)) && cellView.map(({ cell, probability, depthM, appearance }, index) => (
            <CircleMarker
              key={`grid-${index}`}
              center={[cell.lat, cell.lon]}
              radius={appearance.radius}
              pathOptions={{
                color: appearance.color,
                fillColor: appearance.color,
                fillOpacity: appearance.opacity,
                opacity: Math.min(appearance.opacity + 0.12, 0.82),
                weight: 0.35,
              }}
            >
              <Tooltip direction="top" className="grid-tooltip" opacity={1}>
                <div className="grid-tip-head">{cell.district_id || '深圳格点'}</div>
                <div><span>P50 水深</span><b>{formatDepthM(depthM)}</b></div>
                <div><span>P(水深 ≥ 15cm)</span><b>{formatPercent(probability)}</b></div>
                <div><span>本底脆弱性</span><b>{formatPercent(cell.vulnerability)}</b></div>
                <div><span>地形</span><b>{Number(cell.elevation || 0).toFixed(0)}m · 不透水 {formatPercent(cell.impervious)}</b></div>
                {cell.water_corridor_factor > 0 && (
                  <div><span>水网廊道</span><b>+{(cell.water_corridor_factor * 100).toFixed(1)}%</b></div>
                )}
              </Tooltip>
            </CircleMarker>
          ))}

          {view.map((district) => {
            const depth = depthQuantilesM(district.at)
            const exceedance = exceedanceProbability(district.at, 0.15)
            const markerColor = depth.available ? depthColor(depth.p50) : bucketColor(exceedance, PALETTES.probability)
            return (
              <Fragment key={district.id}>
                <CircleMarker
                  center={district.center}
                  radius={14}
                  interactive={false}
                  pathOptions={{
                    color: markerColor,
                    fillColor: markerColor,
                    fillOpacity: 0.15,
                    opacity: 0.28,
                    weight: 1,
                  }}
                />
                <CircleMarker
                  center={district.center}
                  radius={6.5}
                  pathOptions={{
                    color: '#FFFFFF',
                    fillColor: markerColor,
                    fillOpacity: 0.98,
                    opacity: 0.96,
                    weight: 2,
                  }}
                >
                  <Tooltip permanent direction="top" offset={[0, -7]} className="district-label">
                    {districtShortName(district.name)}
                  </Tooltip>
                  <Popup>
                    <div className="pop">
                      <div className="pop-h">{district.name}</div>
                      <div className="pop-row"><b style={{ color: markerColor }}>{district.at.level_label || '—'}风险</b><strong>{depth.available ? formatDepthM(depth.p50) : formatPercent(exceedance)}</strong></div>
                      {depth.available && <div className="pop-row"><span>水深 P10–P90</span><span>{formatDepthM(depth.p10)}–{formatDepthM(depth.p90)}</span></div>}
                      <div className="pop-row"><span>P(水深 ≥ 15cm)</span><span>{formatPercent(exceedance)}</span></div>
                      <div className="pop-row"><span>排水设计</span><span>{district.drainage} mm/h</span></div>
                      <div className="pop-row"><span>本底脆弱性</span><span>{formatPercent(district.vulnerability)}</span></div>
                      <div className="pop-row"><span>主要驱动</span><span>{district.at.driver || '—'}</span></div>
                      <div className="pop-row"><span>预报峰值</span><span>{fmtTime(district.peak.time)}（{district.peak.level_label}）</span></div>
                      {district.water_network && district.water_network.total_conduit_km > 0 && (
                        <>
                          <div className="pop-row"><span>水网（河流+渠）</span><span>{district.water_network.total_conduit_km} km · 密度 {district.water_network.density_km_per_km2} km/km²</span></div>
                          <div className="pop-row"><span>质心近水距离</span><span>{district.water_network.centroid_nearest_conduit_km} km</span></div>
                        </>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              </Fragment>
            )
          })}
        </MapContainer>

        {gridState.status === 'loading' && (
          <div className="map-grid-state" role="status">
            <span className="map-loader" />正在装载集合格点…
          </div>
        )}
        {gridState.status === 'error' && (
          <div className="map-grid-state error-state" role="alert">
            格点图层暂不可用 · {gridState.error}
          </div>
        )}

        {img && ['loading', 'image-loading'].includes(imgState.status) && (
          <div className="map-detail-state loading-state" role="status">
            <span className="map-loader" />正在生成当前时次 500m 精细层…
          </div>
        )}
        {img && imgState.status === 'empty' && (
          <div className="map-detail-state empty-state" role="status">
            <b>500m 图层正常</b>
            <span>当前时次没有可着色的 P50 积水；可拖动时间轴检查后续时次，持续为空即为本次预报的干态结果。</span>
          </div>
        )}
        {img && imgState.status === 'error' && (
          <div className="map-detail-state error-state" role="alert">
            <b>500m 图层不可用</b>
            <span>{imgState.error}</span>
          </div>
        )}
        {img && imgState.status === 'ready' && (
          <div className="map-detail-state ready-state" role="status">
            <b>500m 精细层已叠加</b>
            <span>{imgMeta?.visibleCells ?? '—'} 个着色像元 · 最大 P50 {formatDepthM(imgMeta?.maxDepthM)}</span>
          </div>
        )}

        <div className="map-legend-panel" aria-label={`${metric.label}图例`}>
          <div className="map-legend-title"><span>{metric.label}</span><small>{metric.eyebrow}</small></div>
          <div className="map-legend-bar" style={{ background: `linear-gradient(90deg, ${PALETTES[mode].join(', ')})` }} />
          <div className="map-legend-labels">
            {metric.legend.map((label) => <span key={label}>{label}</span>)}
          </div>
          {waterNet.show && waterNet.features.length > 0 && (
            <>
              <div className="map-legend-title" style={{ marginTop: 8 }}><span>水网</span><small>OSM GEOMETRY</small></div>
              {Object.entries(WATER_KIND_STYLES)
                .filter(([kind]) => waterNet.features.some((f) => f.properties.kind === kind))
                .map(([kind, style]) => (
                  <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '1.5px 0' }}>
                    <span style={{
                      display: 'inline-block', width: 18, height: 0,
                      borderTop: `${Math.min(style.weight, 3)}px ${style.dashArray ? 'dashed' : 'solid'} ${style.color}`,
                    }} />
                    <span style={{ color: 'var(--ink-2)' }}>{style.label} · {waterNet.features.filter((f) => f.properties.kind === kind).length} 段</span>
                  </div>
                ))}
            </>
          )}
          {(drainNet.show || drainPoints.show) && (
            <>
              <div className="map-legend-title" style={{ marginTop: 8 }}><span>地下排水</span><small>SWMM + OSM</small></div>
              {drainNet.show && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '1.5px 0' }}>
                    <span style={{ display: 'inline-block', width: 18, height: 0, borderTop: '2px solid #7c2d12' }} />
                    <span style={{ color: 'var(--ink-2)' }}>排水干管 ≥ 0.5 m · {drainNet.features.filter((f) => f.properties.diameter_m >= 0.5).length} 段</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '1.5px 0' }}>
                    <span style={{ display: 'inline-block', width: 18, height: 0, borderTop: '1px solid #b45309' }} />
                    <span style={{ color: 'var(--ink-2)' }}>排水支管 · {drainNet.features.filter((f) => f.properties.diameter_m < 0.5).length} 段</span>
                  </div>
                </>
              )}
              {drainPoints.show && [
                ['#0f766e', '检查井 (OSM)'],
                ['#7c3aed', '排涝泵站'],
                ['#dc2626', '积水内涝点'],
                ['#ea580c', '排水运营单位'],
              ].map(([color, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '1.5px 0' }}>
                  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color }} />
                  <span style={{ color: 'var(--ink-2)' }}>{label}</span>
                </div>
              ))}
              {drainStats?.synthetic_model && (
                <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4 }}>
                  合成：{drainStats.synthetic_model.pipes.toLocaleString()} 管 · {drainStats.synthetic_model.total_length_km} km · 管径 0.15–3.0 m
                </div>
              )}
            </>
          )}
          {pumps.show && pumps.stations.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '2.5px 0 0' }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: PUMP_COLOR, border: '1.5px solid #fff',
              }} />
              <span style={{ color: 'var(--ink-2)' }}>排涝泵站 · {pumps.stations.length} 座</span>
            </div>
          )}
        </div>
      </div>

      <footer className="map-footnote">
        <span>{img && imgMeta
          ? `${Number(imgMeta.totalCells || 0).toLocaleString()} 格 · 约 0.5km 精细栅格`
          : grid
            ? `${grid.n_cells || cells.length} 格 · 约 ${((grid.resolution_deg || 0.018) * 111).toFixed(1)}km`
            : '集合格点载入中'}</span>
        <span className="map-boundary-note">区名为中心参考点；格点是有界 GIS 下尺度，非完整行政边界裁切或二维水动力淹没范围。</span>
      </footer>
    </section>
  )
}

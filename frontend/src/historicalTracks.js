export function assessTrackSnapshot(snapshot) {
  const issues = []
  if (snapshot?.schema_version !== 1 || snapshot?.evidence_type !== 'historical_record') issues.push('classification_invalid')
  if (snapshot?.source?.crs !== 'EPSG:4326' || snapshot?.source?.timezone !== 'UTC' || !snapshot?.source?.url || !snapshot?.source?.citation) issues.push('source_metadata_invalid')
  if (!snapshot?.retrieved_at || !Number.isFinite(Date.parse(snapshot.retrieved_at)) || !snapshot?.source_sha256) issues.push('provenance_invalid')
  if (!Object.hasOwn(snapshot || {}, 'available_at') || snapshot.available_at !== null) issues.push('availability_invalid')
  if (!Number.isFinite(snapshot?.screening?.city_center_near_km) || snapshot.screening.city_center_near_km <= 0) issues.push('screening_invalid')
  if (!Array.isArray(snapshot?.tracks)) return { valid: false, issues: [...issues, 'tracks_missing'], count: 0 }
  const keys = new Set()
  for (const track of snapshot.tracks) {
    if (!track?.sid || !['MAIN', 'PROVISIONAL', 'US-PROVISIONAL'].includes(track.track_type)) issues.push('track_identity_invalid')
    const key = `${track?.sid}:${track?.track_type}`
    if (keys.has(key)) issues.push('track_duplicate')
    keys.add(key)
    if (!Array.isArray(track?.points) || !track.points.length) { issues.push('track_points_missing'); continue }
    if (!Object.values(track.city_min_km || {}).some((distance) => Number.isFinite(distance) && distance <= snapshot?.screening?.city_center_near_km)) issues.push('track_screening_invalid')
    let prior = -Infinity
    for (const point of track.points) {
      const time = Date.parse(point?.time_utc || '')
      if (!Number.isFinite(time) || time <= prior) issues.push('track_time_invalid')
      prior = time
      if (typeof point?.lat !== 'number' || point.lat < -90 || point.lat > 90 || typeof point?.lon !== 'number' || point.lon < -180 || point.lon > 180) issues.push('track_geometry_invalid')
    }
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)], count: snapshot.tracks.length }
}

export function nearbyTracks(snapshot, cityId) {
  if (!snapshot?.tracks) return []
  return cityId ? snapshot.tracks.filter((track) => typeof track.city_min_km?.[cityId] === 'number' && track.city_min_km[cityId] <= snapshot.screening.city_center_near_km) : snapshot.tracks
}

export function tracksForYear(snapshot, cityId, year) {
  return nearbyTracks(snapshot, cityId).filter((track) => !year || track.points.some((point) => point.time_utc.slice(0, 4) === String(year)))
}

export function trackSegments(points, maxGapHours = 12) {
  const segments = []
  let previous = null
  for (const point of points || []) {
    if (!previous || Date.parse(point.time_utc) - Date.parse(previous.time_utc) > maxGapHours * 3_600_000) segments.push([])
    segments.at(-1).push([point.lat, point.lon])
    previous = point
  }
  return segments
}

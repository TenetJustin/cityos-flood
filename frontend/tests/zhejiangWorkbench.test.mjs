import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarioAssessment, ZHEJIANG_CITIES, ZHEJIANG_EVENTS, ZHEJIANG_SOURCES } from '../src/zhejiangData.js'
import { assessZhejiangSnapshot, normalizeZhejiangMetars, unavailableZhejiangSnapshot } from '../src/zhejiangObservations.js'

test('Zhejiang scope contains four distinct cities and source leads retain access status', () => {
  assert.deepEqual(ZHEJIANG_CITIES.map(({ id }) => id), ['ningbo', 'taizhou', 'wenzhou', 'hangzhou'])
  assert.equal(new Set(ZHEJIANG_CITIES.map(({ id }) => id)).size, 4)
  assert.ok(ZHEJIANG_SOURCES.every((source) => source.url && source.publisher && source.access && source.license))
  assert.equal(ZHEJIANG_SOURCES.filter((source) => source.access === '已接入公开快照').length, 1)
  const rainArchive = ZHEJIANG_SOURCES.find(({ id }) => id === 'wz-rain-history')
  const riverArchive = ZHEJIANG_SOURCES.find(({ id }) => id === 'wz-river-history')
  assert.match(rainArchive.access, /未接入模型/)
  assert.match(rainArchive.coverage, /800,000.*221.*2023-09-01.*09-14/)
  assert.match(riverArchive.access, /未接入模型/)
  assert.match(riverArchive.coverage, /263.*2015-08-19.*2019-09-23/)
  assert.match(riverArchive.note, /779\.51/)
  const tideArchive = ZHEJIANG_SOURCES.find(({ id }) => id === 'wz-tide')
  assert.match(tideArchive.access, /质量与站点待核/)
  assert.match(tideArchive.coverage, /1,000,000.*38.*单位、时区和垂直基准/)
  assert.match(tideArchive.note, /-42\.437–653\.24/)
  const tideMetadata = ZHEJIANG_SOURCES.find(({ id }) => id === 'wz-tide-annual')
  assert.match(tideMetadata.access, /需用户授权/)
})

test('scenario rule responds to compound assumptions without returning a flood probability', () => {
  assert.equal(scenarioAssessment({ rain: 0, tide: 'normal', river: 'normal', drainage: 'normal' }).label, '常规核查')
  assert.equal(scenarioAssessment({ rain: 100, tide: 'normal', river: 'normal', drainage: 'normal' }).label, '加强核查')
  const compound = scenarioAssessment({ rain: 100, tide: 'high', river: 'high', drainage: 'reduced' })
  assert.equal(compound.label, '优先核查')
  assert.equal('probability' in compound, false)
})

test('2021 In-Fa event cites an official retrospective and keeps aggregate impacts out of resident truth', () => {
  const event = ZHEJIANG_EVENTS.find(({ id }) => id === 'infa-2021')
  assert.equal(event.url, 'https://www.fh.gov.cn/art/2021/7/29/art_1229045201_59057535.html')
  assert.equal(event.grade, 'D · 事后记录')
  assert.match(event.note, /69,299 人.*25 处积水点/)
  assert.match(event.note, /不.*逐人反应或积水真值/)
})

test('four-city airport adapter preserves missing stations and observation time', () => {
  const fetchedAt = '2026-10-20T00:00:00.000Z'
  const snapshot = normalizeZhejiangMetars([
    { icaoId: 'ZSNB', obsTime: Date.parse('2026-10-19T23:00:00.000Z') / 1000, temp: 21, altim: 1012, wspd: 7 },
    { icaoId: 'ZSHC', obsTime: Date.parse('2026-10-19T22:00:00.000Z') / 1000, temp: 20, altim: 1011, wspd: 5 },
  ], fetchedAt)
  assert.equal(snapshot.stations.length, 4)
  assert.deepEqual(snapshot.stations.map(({ city, status }) => [city, status]), [['ningbo', 'current'], ['taizhou', 'missing'], ['wenzhou', 'missing'], ['hangzhou', 'current']])
  assert.equal(snapshot.stations[0].latest.observed_at, '2026-10-19T23:00:00.000Z')
  assert.equal(snapshot.stations[0].latest.available_at, null)
  assert.equal(snapshot.stations[1].latest, null)
  assert.equal(unavailableZhejiangSnapshot(fetchedAt).stations.every((station) => station.latest === null), true)
  assert.deepEqual(assessZhejiangSnapshot(snapshot).missing, ['taizhou', 'wenzhou'])
  assert.equal(assessZhejiangSnapshot(snapshot).valid, true)
  assert.equal(assessZhejiangSnapshot(unavailableZhejiangSnapshot(fetchedAt)).valid, true)
})

test('snapshot quality check rejects absent availability time and duplicate city rows', () => {
  const snapshot = normalizeZhejiangMetars([{ icaoId: 'ZSNB', obsTime: Date.parse('2026-10-19T23:00:00.000Z') / 1000 }], '2026-10-20T00:00:00.000Z')
  const missingTime = structuredClone(snapshot)
  delete missingTime.stations[0].history[0].available_at
  assert.deepEqual(assessZhejiangSnapshot(missingTime).issues, ['available_at_invalid'])
  const duplicateCity = structuredClone(snapshot)
  duplicateCity.stations[1] = structuredClone(duplicateCity.stations[0])
  assert.equal(assessZhejiangSnapshot(duplicateCity).valid, false)
  assert.ok(assessZhejiangSnapshot(duplicateCity).issues.includes('station_identity_invalid'))
})

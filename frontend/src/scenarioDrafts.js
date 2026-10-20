import { SCENARIO_MODEL_VERSION, normalizeScenario, validBeijingLocal, weatherDriverIssue } from './scenarioWorkbench.js'

export const PLAN_DRAFTS_KEY = 'cityos-zhejiang-plan-drafts-v2'
export const SCENARIOS_KEY = 'cityos-zhejiang-scenarios-v1'
const CITY_IDS = new Set(['ningbo', 'taizhou', 'wenzhou', 'hangzhou'])
const MAX_MARKDOWN_LENGTH = 100_000

export function validDraftRecord(record) {
  if (!record || typeof record !== 'object' || !CITY_IDS.has(record.cityId) || typeof record.id !== 'string' || !/^[\da-f-]{36}$/i.test(record.id)) return false
  if (typeof record.name !== 'string' || record.name.length > 80 || typeof record.markdown !== 'string' || record.markdown.length > MAX_MARKDOWN_LENGTH) return false
  if (record.evidenceType !== 'simulated_scenario' || typeof record.modelVersion !== 'string' || !/^tabletop-rules-v\d+$/.test(record.modelVersion) || !validBeijingLocal(record.startBjt)) return false
  if (!Number.isFinite(Date.parse(record.createdAt || '')) || !Number.isFinite(Date.parse(record.updatedAt || ''))) return false
  if (!record.input || typeof record.input !== 'object' || Array.isArray(record.input)) return false
  return true
}

export function validSavedScenario(record) {
  if (!record || typeof record !== 'object' || !CITY_IDS.has(record.cityId) || typeof record.id !== 'string' || !/^[\da-f-]{36}$/i.test(record.id)) return false
  if (typeof record.name !== 'string' || !record.name || record.name.length > 80 || typeof record.modelVersion !== 'string' || !/^tabletop-rules-v\d+$/.test(record.modelVersion) || !validBeijingLocal(record.startBjt) || !Number.isFinite(Date.parse(record.createdAt || ''))) return false
  if (!record.input || typeof record.input !== 'object' || Array.isArray(record.input)) return false
  if (record.modelVersion === SCENARIO_MODEL_VERSION) {
    try { normalizeScenario(record.input) } catch { return false }
  }
  return record.weatherDriver == null || !weatherDriverIssue(record.weatherDriver, record.cityId, record.input, record.startBjt, Date.parse(record.weatherDriver.availableAt || ''))
}

export function readScenarioState(storage) {
  let raw
  try { raw = storage.getItem(SCENARIOS_KEY) } catch { return { records: [], writable: false, issue: '浏览器不允许读取本机情景；当前仍可推演和下载草案。' } }
  if (raw === null) return { records: [], writable: true, issue: '' }
  try {
    const records = JSON.parse(raw)
    if (!Array.isArray(records) || !records.every(validSavedScenario) || new Set(records.map((item) => item.id)).size !== records.length) throw new Error('invalid scenarios')
    return { records, writable: true, issue: '' }
  } catch {
    return { records: [], writable: false, issue: '本机情景存储格式异常；为避免覆盖，当前只在本次会话保留新增情景。' }
  }
}

export function persistScenarios(storage, records) {
  if (!Array.isArray(records) || !records.every(validSavedScenario)) return false
  try { storage.setItem(SCENARIOS_KEY, JSON.stringify(records)); return true } catch { return false }
}

export function readDraftState(storage) {
  let raw
  try { raw = storage.getItem(PLAN_DRAFTS_KEY) } catch { return { records: [], writable: false, issue: '浏览器不允许读取本机草案；当前仍可编辑并下载。' } }
  if (raw === null) return { records: [], writable: true, issue: '' }
  try {
    const records = JSON.parse(raw)
    if (!Array.isArray(records) || !records.every(validDraftRecord) || new Set(records.map((item) => item.id)).size !== records.length) throw new Error('invalid drafts')
    return { records, writable: true, issue: '' }
  } catch {
    return { records: [], writable: false, issue: '本机草案存储格式异常；为避免覆盖，当前只允许编辑和下载，不写回本机。' }
  }
}

export function upsertDraft(records, draft) {
  if (!validDraftRecord(draft)) throw new RangeError('Invalid plan draft')
  return [...records.filter((item) => item.id !== draft.id), draft]
}

export function persistDrafts(storage, records) {
  if (!Array.isArray(records) || !records.every(validDraftRecord)) return false
  try { storage.setItem(PLAN_DRAFTS_KEY, JSON.stringify(records)); return true } catch { return false }
}

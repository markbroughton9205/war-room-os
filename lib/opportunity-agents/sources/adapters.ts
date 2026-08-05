import { descriptorById, envConfigured } from './registry'
import type { NormalizedOpportunitySourceRecord, OpportunitySourceAdapter, SourceAdapterHealthResult, SourceRefreshResult, SourceConnectionDescriptor, SourceConnectionState } from './types'

const REQUEST_TIMEOUT_MS = 8000
let sourceFetch: typeof fetch = fetch

export function __setOpportunitySourceFetchForTests(fetchImpl: typeof fetch | null): void {
  sourceFetch = fetchImpl ?? fetch
}

function nowIso(): string { return new Date().toISOString() }
function sourceDescriptor(id: string): SourceConnectionDescriptor {
  const descriptor = descriptorById(id)
  if (!descriptor) throw new Error(`Unknown source adapter: ${id}`)
  return descriptor
}
function fingerprint(sourceId: string, parts: (string | null | undefined)[]): string {
  return `${sourceId}:${parts.map(part => String(part ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')).join(':')}`.replace(/-+/g, '-')
}
function expired(date: string | null): boolean {
  if (!date) return false
  const parsed = Date.parse(date)
  return Number.isFinite(parsed) && parsed < Date.now()
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return value.split(/[,;|]/).map(item => item.trim()).filter(Boolean)
  return []
}
function nestedText(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>
      for (const nestedKey of ['name', 'code', 'value', 'description', 'city', 'state', 'country']) {
        const nestedValue = nested[nestedKey]
        if (typeof nestedValue === 'string' && nestedValue.trim()) return nestedValue.trim()
      }
    }
  }
  return null
}
function samPlaceOfPerformance(item: Record<string, unknown>): string | null {
  const direct = textOrNull(item.placeOfPerformance) ?? textOrNull(item.placeOfPerformanceText)
  if (direct) return direct
  const pop = item.placeOfPerformance && typeof item.placeOfPerformance === 'object' ? item.placeOfPerformance as Record<string, unknown> : null
  if (!pop) return null
  const parts = [nestedText(pop, ['city']), nestedText(pop, ['state']), nestedText(pop, ['country'])].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}
function normalizeSamRecord(item: Record<string, unknown>, descriptorName: string): NormalizedOpportunitySourceRecord | null {
  const title = String(item.title ?? item.noticeTitle ?? '').trim()
  if (!title) return null
  const deadline = textOrNull(item.responseDeadLine) ?? textOrNull(item.responseDeadline)
  const urlValue = textOrNull(item.uiLink) ?? textOrNull(item.url)
  const noticeId = textOrNull(item.noticeId)
  const solicitationNumber = textOrNull(item.solicitationNumber)
  const naicsCodes = stringList(item.naicsCode ?? item.naicsCodes)
  const pscCodes = stringList(item.classificationCode ?? item.pscCode ?? item.pscCodes)
  const setAsideCode = textOrNull(item.typeOfSetAside)
  const setAsideDescription = textOrNull(item.typeOfSetAsideDescription)
  return {
    sourceId: 'sam_gov', sourceName: descriptorName, title,
    summary: String(item.description ?? item.fullParentPathName ?? 'Open SAM.gov opportunity.'),
    url: urlValue,
    sourceReference: [noticeId ? `notice:${noticeId}` : null, solicitationNumber ? `solicitation:${solicitationNumber}` : null].filter(Boolean).join(' | ') || null,
    noticeId,
    solicitationNumber,
    placeOfPerformance: samPlaceOfPerformance(item),
    naicsCodes,
    pscCodes,
    setAsideCode,
    setAsideDescription,
    publicationDate: textOrNull(item.postedDate),
    retrievedAt: nowIso(), deadline, expiry: deadline, isActive: !expired(deadline),
    evidenceStatus: 'LIVE_VERIFIED', freshnessStatus: expired(deadline) ? 'EXPIRED' : 'CURRENT',
    dedupeFingerprint: fingerprint('sam_gov', [title, urlValue, noticeId, solicitationNumber]),
    estimatedValue: null, categoryHint: 'government_procurement', rawMetadata: item,
  }
}
async function fetchJson(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await sourceFetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    return { ok: res.ok, status: res.status, data, text }
  } finally {
    clearTimeout(timeout)
  }
}
function health(sourceId: string, state: SourceConnectionState, failure: string | null, success: string | null = null): SourceAdapterHealthResult {
  return { sourceId, state, checkedAt: nowIso(), lastSuccessfulResponse: success, failure, rateLimit: state === 'RATE_LIMITED' ? { limited: true, retryAfterSeconds: null } : null }
}
function emptyRefresh(sourceId: string, status: SourceRefreshResult['status'], failure: string | null, healthResult: SourceAdapterHealthResult): SourceRefreshResult {
  const at = nowIso()
  return { sourceId, status, requestedAt: at, completedAt: at, retrieved: 0, accepted: 0, duplicates: 0, expired: 0, records: [], rejected: [], failure, health: healthResult, pagination: { pagesRequested: 0, pagesSucceeded: 0, recordsReceived: 0, recordsAccepted: 0, recordsRejected: 0, duplicates: 0, partialFailure: false } }
}
function adapterUnavailable(id: string, state: SourceConnectionState, failure: string): OpportunitySourceAdapter {
  const descriptor = sourceDescriptor(id)
  return {
    descriptor,
    async testConnection() { return health(id, state, failure) },
    async refresh() { return emptyRefresh(id, 'not_configured', failure, health(id, state, failure)) },
  }
}

export function samGovAdapter(env: NodeJS.ProcessEnv = process.env): OpportunitySourceAdapter {
  const descriptor = sourceDescriptor('sam_gov')
  const key = env.SAM_GOV_API_KEY?.trim()
  return {
    descriptor,
    async testConnection() {
      if (!key) return health('sam_gov', 'KEY_MISSING', 'SAM_GOV_API_KEY is required for the official Opportunities v2 API.')
      const url = new URL('https://api.sam.gov/opportunities/v2/search')
      url.searchParams.set('api_key', key)
      url.searchParams.set('limit', '1')
      url.searchParams.set('postedFrom', new Date(Date.now() - 14 * 86400000).toLocaleDateString('en-US'))
      url.searchParams.set('postedTo', new Date().toLocaleDateString('en-US'))
      const res = await fetchJson(url.toString())
      if (res.status === 401 || res.status === 403) return health('sam_gov', 'AUTHENTICATION_FAILED', 'SAM.gov rejected the API key.')
      if (res.status === 429) return health('sam_gov', 'RATE_LIMITED', 'SAM.gov rate limit reached.')
      if (!res.ok) return health('sam_gov', 'DEGRADED', `SAM.gov test failed with HTTP ${res.status}.`)
      return health('sam_gov', 'CONNECTED', null, 'Opportunities v2 returned JSON.')
    },
    async refresh(input = {}) {
      const requestedAt = nowIso()
      const healthResult = await this.testConnection()
      if (healthResult.state !== 'CONNECTED' || !key) return emptyRefresh('sam_gov', 'not_configured', healthResult.failure, healthResult)
      const pageLimit = Math.max(1, Math.min(input.limit ?? 25, 50))
      const maxPages = Math.max(1, Math.min(input.maxPages ?? 3, 10))
      const maxRecords = Math.max(1, Math.min(input.maxRecords ?? pageLimit * maxPages, 250))
      const seen = new Set<string>()
      const records: NormalizedOpportunitySourceRecord[] = []
      const rejected: SourceRefreshResult['rejected'] = []
      let pagesRequested = 0
      let pagesSucceeded = 0
      let recordsReceived = 0
      let duplicates = 0
      let partialFailure = false
      let failure: string | null = null

      for (let page = 0; page < maxPages && recordsReceived < maxRecords; page += 1) {
        const offset = page * pageLimit
        pagesRequested += 1
        const url = new URL('https://api.sam.gov/opportunities/v2/search')
        url.searchParams.set('api_key', key)
        url.searchParams.set('limit', String(Math.min(pageLimit, maxRecords - recordsReceived)))
        url.searchParams.set('offset', String(offset))
        url.searchParams.set('postedFrom', new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-US'))
        url.searchParams.set('postedTo', new Date().toLocaleDateString('en-US'))
        url.searchParams.set('ptype', 'o')
        url.searchParams.set('keyword', input.query ?? 'transportation logistics courier delivery artificial intelligence technology services')
        const res = await fetchJson(url.toString())
        if (res.status === 429) {
          partialFailure = page > 0
          failure = 'SAM.gov rate limit reached during pagination.'
          if (!partialFailure) return emptyRefresh('sam_gov', 'failed', failure, health('sam_gov', 'RATE_LIMITED', failure))
          break
        }
        if (!res.ok) {
          partialFailure = page > 0
          failure = `SAM.gov refresh page ${page + 1} failed with HTTP ${res.status}.`
          if (!partialFailure) return emptyRefresh('sam_gov', 'failed', failure, healthResult)
          break
        }
        pagesSucceeded += 1
        const data = res.data as { opportunitiesData?: unknown[]; totalRecords?: number }
        const rows = Array.isArray(data.opportunitiesData) ? data.opportunitiesData : []
        if (rows.length === 0) break
        recordsReceived += rows.length
        for (const row of rows) {
          const item = row as Record<string, unknown>
          const normalized = normalizeSamRecord(item, descriptor.displayName)
          if (!normalized) continue
          if (!normalized.isActive) {
            rejected.push({ title: normalized.title, reason: 'Expired SAM.gov notice rejected as inactive.' })
            continue
          }
          if (seen.has(normalized.dedupeFingerprint)) {
            duplicates += 1
            continue
          }
          seen.add(normalized.dedupeFingerprint)
          records.push(normalized)
          if (records.length >= maxRecords) break
        }
        if (rows.length < pageLimit) break
      }
      const recordsRejected = rejected.length
      return {
        sourceId: 'sam_gov',
        status: partialFailure ? 'partial_success' : 'success',
        requestedAt,
        completedAt: nowIso(),
        retrieved: recordsReceived,
        accepted: records.length,
        duplicates,
        expired: rejected.length,
        records,
        rejected,
        failure,
        health: partialFailure ? { ...healthResult, state: 'DEGRADED', failure } : healthResult,
        pagination: {
          pagesRequested,
          pagesSucceeded,
          recordsReceived,
          recordsAccepted: records.length,
          recordsRejected,
          duplicates,
          partialFailure,
        },
      }
    },
  }
}

export function usaSpendingAdapter(): OpportunitySourceAdapter {
  const descriptor = sourceDescriptor('usaspending')
  return {
    descriptor,
    async testConnection() {
      const res = await fetchJson('https://api.usaspending.gov/api/v2/search/spending_by_award/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { time_period: [{ start_date: '2023-01-01', end_date: new Date().toISOString().slice(0, 10) }], award_type_codes: ['A', 'B', 'C', 'D'] }, fields: ['Award ID', 'Recipient Name', 'Award Amount'], page: 1, limit: 1 }) })
      if (res.status === 429) return health('usaspending', 'RATE_LIMITED', 'USAspending rate limit reached.')
      if (!res.ok) return health('usaspending', 'DEGRADED', `USAspending test failed with HTTP ${res.status}.`)
      return health('usaspending', 'CONNECTED', null, 'USAspending public API returned JSON.')
    },
    async refresh(input = {}) {
      const requestedAt = nowIso()
      const healthResult = await this.testConnection()
      if (healthResult.state !== 'CONNECTED') return emptyRefresh('usaspending', 'failed', healthResult.failure, healthResult)
      const res = await fetchJson('https://api.usaspending.gov/api/v2/search/spending_by_award/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { keywords: [input.query ?? 'logistics technology services'], time_period: [{ start_date: '2022-01-01', end_date: new Date().toISOString().slice(0, 10) }], award_type_codes: ['A', 'B', 'C', 'D'] }, fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date', 'End Date'], page: 1, limit: Math.max(1, Math.min(input.limit ?? 10, 50)) }) })
      if (!res.ok) return emptyRefresh('usaspending', 'failed', `USAspending refresh failed with HTTP ${res.status}.`, healthResult)
      const results = ((res.data as { results?: unknown[] })?.results ?? []) as Record<string, unknown>[]
      const records = results.map(item => {
        const title = `${String(item['Awarding Agency'] ?? 'Agency')} historical award to ${String(item['Recipient Name'] ?? 'recipient')}`
        return { sourceId: 'usaspending', sourceName: descriptor.displayName, title, summary: 'Historical spending intelligence only; not an open opportunity.', url: null, sourceReference: String(item['Award ID'] ?? ''), noticeId: null, solicitationNumber: null, placeOfPerformance: null, naicsCodes: [], pscCodes: [], setAsideCode: null, setAsideDescription: null, publicationDate: typeof item['Start Date'] === 'string' ? item['Start Date'] as string : null, retrievedAt: nowIso(), deadline: null, expiry: null, isActive: false, evidenceStatus: 'HISTORICAL' as const, freshnessStatus: 'HISTORICAL' as const, dedupeFingerprint: fingerprint('usaspending', [title, String(item['Award ID'] ?? '')]), estimatedValue: item['Award Amount'] == null ? null : String(item['Award Amount']), categoryHint: 'historical_spending_intelligence', rawMetadata: item }
      })
      return { sourceId: 'usaspending', status: 'success', requestedAt, completedAt: nowIso(), retrieved: results.length, accepted: records.length, duplicates: 0, expired: 0, records, rejected: [], failure: null, health: healthResult, pagination: { pagesRequested: 1, pagesSucceeded: 1, recordsReceived: results.length, recordsAccepted: records.length, recordsRejected: 0, duplicates: 0, partialFailure: false } }
    },
  }
}

export function nwsAdapter(env: NodeJS.ProcessEnv = process.env): OpportunitySourceAdapter {
  const descriptor = sourceDescriptor('nws')
  const ua = env.WAR_ROOM_NWS_USER_AGENT?.trim()
  return {
    descriptor,
    async testConnection() {
      if (!ua) return health('nws', 'KEY_MISSING', 'WAR_ROOM_NWS_USER_AGENT is required by api.weather.gov usage policy.')
      const res = await fetchJson('https://api.weather.gov/alerts/active?area=GA', { headers: { 'User-Agent': ua, Accept: 'application/geo+json' } })
      if (res.status === 429) return health('nws', 'RATE_LIMITED', 'National Weather Service rate limit reached.')
      if (!res.ok) return health('nws', 'DEGRADED', `National Weather Service test failed with HTTP ${res.status}.`)
      return health('nws', 'CONNECTED', null, 'api.weather.gov returned active alerts JSON.')
    },
    async refresh() {
      const healthResult = await this.testConnection()
      return emptyRefresh('nws', healthResult.state === 'CONNECTED' ? 'success' : 'not_configured', null, healthResult)
    },
  }
}

export function boundaryAdapter(id: string, env: NodeJS.ProcessEnv = process.env): OpportunitySourceAdapter {
  const descriptor = sourceDescriptor(id)
  if (id === 'walmart_load_board') return adapterUnavailable(id, envConfigured(descriptor, env) ? 'APPROVAL_REQUIRED' : 'ACCOUNT_REQUIRED', 'CARRIER_APPROVAL_AND_CREDENTIALS_REQUIRED')
  if (descriptor.category === 'media') return adapterUnavailable(id, envConfigured(descriptor, env) ? 'APPROVAL_REQUIRED' : 'KEY_MISSING', `${descriptor.displayName} adapter boundary prepared; no generation or publishing is authorized.`)
  return adapterUnavailable(id, envConfigured(descriptor, env) ? 'CONNECTION_UNVERIFIED' : 'KEY_MISSING', `${descriptor.displayName} connection test is not implemented in this package.`)
}

export function getOpportunitySourceAdapter(id: string, env: NodeJS.ProcessEnv = process.env): OpportunitySourceAdapter {
  if (id === 'sam_gov') return samGovAdapter(env)
  if (id === 'usaspending') return usaSpendingAdapter()
  if (id === 'nws') return nwsAdapter(env)
  return boundaryAdapter(id, env)
}

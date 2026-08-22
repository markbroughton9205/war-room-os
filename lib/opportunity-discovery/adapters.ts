import { qualifyOpportunity, sanitizeOfficialUrl, stableId } from './core'
import type { DiscoveryOpportunity, DiscoveryProvider, ProviderDiscoveryResult } from './types'

let discoveryFetch: typeof fetch = fetch
export function __setDiscoveryFetchForTests(value: typeof fetch | null): void { discoveryFetch = value ?? fetch }
const now = () => new Date().toISOString()
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const date = (value: unknown) => text(value) && Number.isFinite(Date.parse(String(value))) ? new Date(String(value)).toISOString() : null

async function json(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await discoveryFetch(url, { ...init, signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'WarRoomOS/OpportunityDiscovery', ...(init?.headers ?? {}) } })
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) }
  } finally { clearTimeout(timer) }
}

type Base = Omit<DiscoveryOpportunity, 'matchReasons' | 'matchSignals' | 'confidence'>
function finish(value: Base): DiscoveryOpportunity { return qualifyOpportunity({ ...value, matchReasons: [], matchSignals: [], confidence: 0 }) }
function result(provider: DiscoveryProvider, state: ProviderDiscoveryResult['state'], records: DiscoveryOpportunity[], error: string | null): ProviderDiscoveryResult { return { provider, state, records, error, retrievedAt: now() } }

export function normalizeRemoteOk(item: Record<string, unknown>, retrievedAt = now()): DiscoveryOpportunity | null {
  const title = text(item.position) ?? text(item.title)
  const providerId = text(item.id) ?? text(item.slug)
  if (!title || !providerId) return null
  const location = text(item.location)
  const remoteEvidence = text(item.location) || 'Remote OK official API record'
  return finish({ id: stableId('remote_ok', providerId, title), provider: 'remote_ok', providerRecordId: providerId, title, organization: text(item.company), description: text(item.description), location, remoteStatus: /onsite|on-site/i.test(remoteEvidence) ? 'ONSITE' : 'REMOTE', opportunityType: 'JOB', employmentType: text(item.type), compensation: number(item.salary_min) !== null || number(item.salary_max) !== null ? { minimum: number(item.salary_min), maximum: number(item.salary_max), text: null } : null, currency: number(item.salary_min) !== null || number(item.salary_max) !== null ? 'USD' : null, publishedAt: date(item.date) ?? (typeof item.epoch === 'number' ? new Date(item.epoch * 1000).toISOString() : null), deadline: null, officialUrl: sanitizeOfficialUrl(item.url), discoveredAt: retrievedAt, retrievedAt, attribution: 'Remote OK — remoteok.com', provenance: { endpoint: 'https://remoteok.com/api', classification: 'official_api_job' }, rawSourceClassification: 'REMOTE_JOB', liveVerificationState: 'LIVE_VERIFIED' })
}

export function normalizeAdzuna(item: Record<string, unknown>, retrievedAt = now()): DiscoveryOpportunity | null {
  const title = text(item.title); const providerId = text(item.id)
  if (!title || !providerId) return null
  const company = item.company && typeof item.company === 'object' ? text((item.company as Record<string, unknown>).display_name) : null
  const location = item.location && typeof item.location === 'object' ? text((item.location as Record<string, unknown>).display_name) : null
  const label = item.contract_type && typeof item.contract_type === 'string' ? item.contract_type : null
  const remote = /remote|work from home|telecommut/i.test(`${title} ${text(item.description) ?? ''} ${location ?? ''}`)
  const min = number(item.salary_min); const max = number(item.salary_max)
  return finish({ id: stableId('adzuna', providerId, title), provider: 'adzuna', providerRecordId: providerId, title, organization: company, description: text(item.description), location, remoteStatus: remote ? 'REMOTE_ELIGIBLE' : 'UNKNOWN', opportunityType: label === 'contract' ? 'CONTRACT' : 'JOB', employmentType: label, compensation: min !== null || max !== null ? { minimum: min, maximum: max, text: null } : null, currency: min !== null || max !== null ? 'USD' : null, publishedAt: date(item.created), deadline: null, officialUrl: sanitizeOfficialUrl(item.redirect_url), discoveredAt: retrievedAt, retrievedAt, attribution: 'Adzuna', provenance: { endpoint: 'https://api.adzuna.com/v1/api/jobs/us/search/1', classification: 'official_api_job' }, rawSourceClassification: 'JOB', liveVerificationState: 'LIVE_VERIFIED' })
}

export function normalizeSam(item: Record<string, unknown>, retrievedAt = now()): DiscoveryOpportunity | null {
  const activeFlag = text(item.active)
  if (activeFlag && activeFlag.toLowerCase() !== 'yes') return null
  if (text(item.archiveDate)) return null
  const title = text(item.title) ?? text(item.noticeTitle); const providerId = text(item.noticeId) ?? text(item.solicitationNumber)
  if (!title || !providerId) return null
  const description = text(item.description) ?? text(item.fullParentPathName)
  const pop = item.placeOfPerformance && typeof item.placeOfPerformance === 'object' ? item.placeOfPerformance as Record<string, unknown> : null
  const location = text(item.placeOfPerformanceText) ?? (pop ? [text(pop.city), text(pop.state), text(pop.country)].filter(Boolean).join(', ') || null : null)
  return finish({ id: stableId('sam_gov', providerId, title), provider: 'sam_gov', providerRecordId: providerId, title, organization: text(item.department) ?? text(item.subTier), description, location, remoteStatus: /remote|virtual|telework/i.test(`${description ?? ''} ${location ?? ''}`) ? 'REMOTE_ELIGIBLE' : 'UNKNOWN', opportunityType: 'GOVERNMENT_SOLICITATION', employmentType: text(item.type), compensation: null, currency: null, publishedAt: date(item.postedDate), deadline: date(item.responseDeadLine) ?? date(item.responseDeadline), officialUrl: sanitizeOfficialUrl(item.uiLink) ?? sanitizeOfficialUrl(item.url), discoveredAt: retrievedAt, retrievedAt, attribution: 'SAM.gov', provenance: { endpoint: 'https://api.sam.gov/opportunities/v2/search', classification: 'official_open_solicitation' }, rawSourceClassification: text(item.type) ?? 'SOLICITATION', liveVerificationState: 'LIVE_VERIFIED' })
}

export function normalizeUsaSpending(item: Record<string, unknown>, retrievedAt = now()): DiscoveryOpportunity | null {
  const providerId = text(item['Award ID']); if (!providerId) return null
  const agency = text(item['Awarding Agency']); const recipient = text(item['Recipient Name'])
  const amount = number(item['Award Amount'])
  return finish({ id: stableId('usaspending', providerId, providerId), provider: 'usaspending', providerRecordId: providerId, title: `${agency ?? 'Federal agency'} historical award to ${recipient ?? 'recipient'}`, organization: agency, description: text(item.Description) ?? 'Historical award/spending intelligence; this is not an open solicitation.', location: null, remoteStatus: 'UNKNOWN', opportunityType: 'HISTORICAL_AWARD_INTELLIGENCE', employmentType: null, compensation: amount === null ? null : { minimum: amount, maximum: amount, text: null }, currency: amount === null ? null : 'USD', publishedAt: date(item['Start Date']), deadline: null, officialUrl: null, discoveredAt: retrievedAt, retrievedAt, attribution: 'USAspending.gov', provenance: { endpoint: 'https://api.usaspending.gov/api/v2/search/spending_by_award/', classification: 'historical_award_intelligence' }, rawSourceClassification: 'HISTORICAL_AWARD', liveVerificationState: 'HISTORICAL_INTELLIGENCE' })
}

export async function fetchProvider(provider: DiscoveryProvider, env: NodeJS.ProcessEnv = process.env): Promise<ProviderDiscoveryResult> {
  const retrievedAt = now()
  try {
    if (provider === 'remote_ok') {
      const response = await json('https://remoteok.com/api')
      if (!response.ok) return result(provider, 'FAILED', [], `Remote OK returned HTTP ${response.status}.`)
      const rows = Array.isArray(response.data) ? response.data : []
      return result(provider, 'LIVE_VERIFIED', rows.map(row => normalizeRemoteOk(row as Record<string, unknown>, retrievedAt)).filter((x): x is DiscoveryOpportunity => Boolean(x)), null)
    }
    if (provider === 'adzuna') {
      const id = env.ADZUNA_APP_ID?.trim(); const key = env.ADZUNA_APP_KEY?.trim()
      if (!id || !key) return result(provider, 'BLOCKED_BY_ENVIRONMENT', [], 'ADZUNA_APP_ID and ADZUNA_APP_KEY are required.')
      const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1'); url.searchParams.set('app_id', id); url.searchParams.set('app_key', key); url.searchParams.set('results_per_page', '50'); url.searchParams.set('what_or', 'software engineer AI automation machine learning data engineer'); url.searchParams.set('content-type', 'application/json')
      const response = await json(url.toString()); if (!response.ok) return result(provider, 'FAILED', [], `Adzuna returned HTTP ${response.status}.`)
      const rows = (response.data as { results?: unknown[] } | null)?.results ?? []
      return result(provider, 'LIVE_VERIFIED', rows.map(row => normalizeAdzuna(row as Record<string, unknown>, retrievedAt)).filter((x): x is DiscoveryOpportunity => Boolean(x)), null)
    }
    if (provider === 'sam_gov') {
      const key = env.SAM_GOV_API_KEY?.trim(); if (!key) return result(provider, 'BLOCKED_BY_ENVIRONMENT', [], 'SAM_GOV_API_KEY is required.')
      const url = new URL('https://api.sam.gov/opportunities/v2/search'); url.searchParams.set('api_key', key); url.searchParams.set('limit', '100'); url.searchParams.set('postedFrom', new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-US')); url.searchParams.set('postedTo', new Date().toLocaleDateString('en-US')); url.searchParams.set('keyword', 'software artificial intelligence automation machine learning data engineering'); url.searchParams.set('status', 'active')
      const response = await json(url.toString()); if (!response.ok) return result(provider, 'FAILED', [], `SAM.gov returned HTTP ${response.status}.`)
      const rows = (response.data as { opportunitiesData?: unknown[] } | null)?.opportunitiesData ?? []
      return result(provider, 'LIVE_VERIFIED', rows.map(row => normalizeSam(row as Record<string, unknown>, retrievedAt)).filter((x): x is DiscoveryOpportunity => Boolean(x)), null)
    }
    const body = { filters: { keywords: ['software', 'artificial intelligence', 'machine learning', 'data engineering'], time_period: [{ start_date: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10) }], award_type_codes: ['A', 'B', 'C', 'D'] }, fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date', 'Description'], page: 1, limit: 50 }
    const response = await json('https://api.usaspending.gov/api/v2/search/spending_by_award/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) return result(provider, 'FAILED', [], `USAspending returned HTTP ${response.status}.`)
    const rows = (response.data as { results?: unknown[] } | null)?.results ?? []
    return result(provider, 'HISTORICAL_INTELLIGENCE', rows.map(row => normalizeUsaSpending(row as Record<string, unknown>, retrievedAt)).filter((x): x is DiscoveryOpportunity => Boolean(x)), null)
  } catch (error) { return result(provider, 'FAILED', [], error instanceof Error ? error.message : 'Provider request failed.') }
}

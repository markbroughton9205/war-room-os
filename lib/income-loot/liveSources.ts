import { normalizeLootCandidate, type LootRawCandidate } from './normalize'
import { insertIncomeLootOpportunity } from './store'
import type { LootCategory, LootOpportunity, LootProvenance } from './types'

export const INCOME_LOOT_SOURCE_STATUSES = ['LIVE_VERIFIED', 'BLOCKED_BY_ENVIRONMENT', 'DOCUMENTED_NOT_IMPLEMENTED', 'UNSUPPORTED', 'DISABLED', 'UNVERIFIED'] as const
export type IncomeLootSourceStatus = (typeof INCOME_LOOT_SOURCE_STATUSES)[number]
export type IncomeLootSource = { id: string; providerName: string; category: LootCategory; officialUrl: string; accessMode: 'public_api' | 'personal_account' | 'partner_api' | 'not_available'; credentialRequirement: 'none' | 'personal_account' | 'api_key' | 'partner_approval'; status: IncomeLootSourceStatus; statusReason: string; supportsLiveDiscovery: boolean; implementationState: 'IMPLEMENTED' | 'NOT_IMPLEMENTED'; lastVerifiedAt: string | null; notes: string }
export type LiveSourceFailure = { code: 'BLOCKED_BY_ENVIRONMENT' | 'HTTP_ERROR' | 'MALFORMED_RESPONSE' | 'NETWORK_ERROR'; safeMessage: string; httpStatus: number | null }
export type LiveSourceResult = { sourceId: string; status: IncomeLootSourceStatus; retrievedAt: string; recordsReturned: number; candidates: LootRawCandidate[]; failure: LiveSourceFailure | null }
export type LiveIncomeSourceAdapter = { source: IncomeLootSource; inspectAvailability(): Pick<IncomeLootSource, 'status' | 'statusReason'>; discover(ownerUserId: string, fetcher?: typeof fetch): Promise<LiveSourceResult> }

export const INCOME_LOOT_SOURCE_REGISTRY: readonly IncomeLootSource[] = [
  { id: 'clinicaltrials-gov', providerName: 'ClinicalTrials.gov', category: 'SURVEY', officialUrl: 'https://clinicaltrials.gov/data-api/about-api', accessMode: 'public_api', credentialRequirement: 'none', status: 'UNVERIFIED', statusReason: 'Implemented public API adapter; only a successful real request and normalization can produce LIVE_VERIFIED at runtime.', supportsLiveDiscovery: true, implementationState: 'IMPLEMENTED', lastVerifiedAt: null, notes: 'Recruiting research-study listings only. Compensation, eligibility, and enrollment are not asserted.' },
  { id: 'prolific', providerName: 'Prolific', category: 'SURVEY', officialUrl: 'https://www.prolific.com/', accessMode: 'personal_account', credentialRequirement: 'personal_account', status: 'BLOCKED_BY_ENVIRONMENT', statusReason: 'Participant opportunities require an authenticated personal account; no credential is inspected or used by this adapter.', supportsLiveDiscovery: false, implementationState: 'NOT_IMPLEMENTED', lastVerifiedAt: null, notes: 'No login scraping or survey automation.' },
  { id: 'rakuten-advertising', providerName: 'Rakuten Advertising', category: 'CASHBACK', officialUrl: 'https://rakutenadvertising.com/', accessMode: 'partner_api', credentialRequirement: 'partner_approval', status: 'BLOCKED_BY_ENVIRONMENT', statusReason: 'Partner API access and approval are required; no partner credential is configured.', supportsLiveDiscovery: false, implementationState: 'NOT_IMPLEMENTED', lastVerifiedAt: null, notes: 'Partner integration is not assumed to expose consumer cashback offers.' },
  { id: 'receipt-rewards', providerName: 'Receipt reward platforms', category: 'RECEIPT_REWARD', officialUrl: 'https://www.fetch.com/', accessMode: 'not_available', credentialRequirement: 'personal_account', status: 'UNSUPPORTED', statusReason: 'No verified public opportunity-discovery API is used; authenticated scraping is prohibited.', supportsLiveDiscovery: false, implementationState: 'NOT_IMPLEMENTED', lastVerifiedAt: null, notes: 'Receipt upload and reward claiming remain user-directed.' },
  { id:'user-interviews',providerName:'User Interviews',category:'SURVEY',officialUrl:'https://www.userinterviews.com/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Public study discovery may be reviewed; personal matched feed requires legitimate account authentication and is not connected.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Official participant flow; prepare/deep-link only until a supported mechanism is verified.' },
  { id:'respondent',providerName:'Respondent',category:'SURVEY',officialUrl:'https://www.respondent.io/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Participant account flow is documented; no authenticated adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Registry metadata only.' },
  { id:'dscout',providerName:'dscout',category:'SURVEY',officialUrl:'https://dscout.com/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Participant access is account/app dependent; no adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Registry metadata only.' },
  { id:'cloudresearch-connect',providerName:'CloudResearch Connect',category:'SURVEY',officialUrl:'https://connect.cloudresearch.com/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Participant marketplace requires account access; no adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Registry metadata only.' },
  { id:'usertesting',providerName:'UserTesting',category:'SURVEY',officialUrl:'https://www.usertesting.com/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Participant testing flow requires account access; no adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'IntelliZoom consolidated here; no separate connector.' },
  { id:'field-agent',providerName:'Field Agent',category:'STORE_SCAN',officialUrl:'https://www.fieldagent.net/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Mobile and location participant workflow; no adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Registry metadata only.' },
  { id:'gigwalk',providerName:'Gigwalk',category:'STORE_SCAN',officialUrl:'https://gigwalk.com/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Mobile/local task workflow; no adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Registry metadata only.' },
  { id:'observa',providerName:'Observa',category:'STORE_SCAN',officialUrl:'https://www.observanow.com/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Mobile/local task workflow; no adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Registry metadata only.' },
  { id:'premise',providerName:'Premise',category:'STORE_SCAN',officialUrl:'https://www.premise.com/',accessMode:'personal_account',credentialRequirement:'personal_account',status:'DOCUMENTED_NOT_IMPLEMENTED',statusReason:'Mobile/local task workflow; no adapter is implemented.',supportsLiveDiscovery:false,implementationState:'NOT_IMPLEMENTED',lastVerifiedAt:null,notes:'Registry metadata only.' },
] as const

function safeHttpMessage(status: number): string { return `Source request failed with HTTP ${status}.` }
function studyCandidate(ownerUserId: string, study: unknown, retrievedAt: string): LootRawCandidate | null {
  if (!study || typeof study !== 'object') return null
  const protocol = (study as { protocolSection?: Record<string, unknown> }).protocolSection
  const identification = protocol?.identificationModule as { nctId?: unknown; briefTitle?: unknown } | undefined
  const status = protocol?.statusModule as { overallStatus?: unknown; studyFirstPostDateStruct?: { date?: unknown } } | undefined
  const design = protocol?.designModule as { studyType?: unknown } | undefined
  const contacts = protocol?.contactsLocationsModule as { overallOfficials?: unknown; centralContacts?: unknown; locations?: unknown } | undefined
  const nctId = typeof identification?.nctId === 'string' ? identification.nctId.trim() : ''
  const title = typeof identification?.briefTitle === 'string' ? identification.briefTitle.trim() : ''
  if (!nctId || !title || status?.overallStatus !== 'RECRUITING') return null
  const location = Array.isArray(contacts?.locations) ? contacts.locations.map(item => typeof item === 'object' && item ? [String((item as { city?: unknown }).city ?? '').trim(), String((item as { state?: unknown }).state ?? '').trim(), String((item as { country?: unknown }).country ?? '').trim()].filter(Boolean).join(', ') : '').filter(Boolean).slice(0, 3).join(' | ') || null : null
  const eligibility = [`Study type: ${typeof design?.studyType === 'string' ? design.studyType : 'not stated'}`, 'Enrollment and compensation must be confirmed directly with the study contact.']
  const provenance: LootProvenance = { sourceAdapterId: 'clinicaltrials-gov', sourceType: 'provider_api', sourceUrl: `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`, retrievedAt, searchQuery: 'paid research participant', providerRecordId: nctId, freshness: 'current', isHistorical: false }
  return { ownerUserId, provider: 'ClinicalTrials.gov', providerOpportunityId: nctId, title, description: 'Recruiting research study listed by ClinicalTrials.gov. Reward is not represented unless the source explicitly states it.', url: provenance.sourceUrl, category: 'SURVEY', reward: null, estimatedTimeMinutes: null, eligibility, locationRequirement: location, evidenceRequirement: [], confidence: 65, provenance }
}

export const clinicalTrialsGovAdapter: LiveIncomeSourceAdapter = {
  source: INCOME_LOOT_SOURCE_REGISTRY[0],
  inspectAvailability: () => ({ status: 'UNVERIFIED', statusReason: 'Public API is implemented but has not been claimed live-verified without a real response.' }),
  async discover(ownerUserId, fetcher = fetch) {
    const retrievedAt = new Date().toISOString()
    try {
      const response = await fetcher('https://clinicaltrials.gov/api/v2/studies?query.term=paid%20research%20participant&filter.overallStatus=RECRUITING&pageSize=20&format=json', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
      if (!response.ok) return { sourceId: this.source.id, status: 'UNVERIFIED', retrievedAt, recordsReturned: 0, candidates: [], failure: { code: 'HTTP_ERROR', safeMessage: safeHttpMessage(response.status), httpStatus: response.status } }
      const data: unknown = await response.json()
      const studies = data && typeof data === 'object' && Array.isArray((data as { studies?: unknown }).studies) ? (data as { studies: unknown[] }).studies : null
      if (!studies) return { sourceId: this.source.id, status: 'UNVERIFIED', retrievedAt, recordsReturned: 0, candidates: [], failure: { code: 'MALFORMED_RESPONSE', safeMessage: 'Source response did not contain a studies array.', httpStatus: response.status } }
      const candidates = studies.map(study => studyCandidate(ownerUserId, study, retrievedAt)).filter((value): value is LootRawCandidate => value !== null)
      return { sourceId: this.source.id, status: 'LIVE_VERIFIED', retrievedAt, recordsReturned: studies.length, candidates, failure: null }
    } catch (error) { return { sourceId: this.source.id, status: 'UNVERIFIED', retrievedAt, recordsReturned: 0, candidates: [], failure: { code: 'NETWORK_ERROR', safeMessage: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[redacted-url]') : 'Network request failed.', httpStatus: null } } }
  },
}

export async function discoverLiveIncomeSource(ownerUserId: string, adapter: LiveIncomeSourceAdapter = clinicalTrialsGovAdapter, fetcher?: typeof fetch): Promise<{ result: LiveSourceResult; opportunities: LootOpportunity[] }> {
  const result = await adapter.discover(ownerUserId, fetcher)
  if (result.status !== 'LIVE_VERIFIED') return { result, opportunities: [] }
  const opportunities = result.candidates.flatMap(candidate => { const normalized = normalizeLootCandidate(candidate); const inserted = normalized ? insertIncomeLootOpportunity(normalized) : null; return inserted ? [inserted] : [] })
  return { result, opportunities }
}

import type { EndpointType, FreshnessClass, PlanetaryGeography, PlanetaryTopic, SourceClass, SourceLifecycleState } from './types'
import type { LocalityClass } from './sourceGeography'

export const SOURCE_ROLE_CLASSES = [
  'HYPERLOCAL',
  'CITY_LOCAL',
  'REGIONAL',
  'NATIONAL',
  'INTERNATIONAL',
  'SPECIALIST',
  'OFFICIAL',
  'SCIENTIFIC',
  'TRADE',
  'PUBLIC_SAFETY',
  'WEATHER',
  'TRANSPORT',
  'UTILITY',
  'HEALTH',
  'EDUCATION',
  'NGO',
  'INDIGENOUS',
  'DIASPORA',
  'PUBLIC_BROADCASTER',
  'COMMERCIAL_BROADCASTER',
  'COMMUNITY',
  'OTHER',
] as const
export type SourceRoleClass = (typeof SOURCE_ROLE_CLASSES)[number]

export const VERIFICATION_STAGES = [
  'DISCOVERED',
  'DOMAIN_VERIFY',
  'SOURCE_IDENTITY_VERIFY',
  'GEOGRAPHY_VERIFY',
  'LANGUAGE_VERIFY',
  'SOURCE_TYPE_VERIFY',
  'ENDPOINT_DISCOVERY',
  'ACCESS_POLICY_CHECK',
  'OWNERSHIP_ORIGIN_CHECK',
  'HEALTH_CHECK',
  'LIVE',
] as const
export type VerificationStage = (typeof VERIFICATION_STAGES)[number]

export const WAVE1_CANDIDATE_CAP = 1000
export const WAVE2_ACTIVATION_CAP = 150
export const WAVE2_DOCS_PER_ENDPOINT = 8
export const WAVE3_NEW_SOURCES_PER_CELL = 10
export const WAVE3_NEW_SOURCES_HARD_CAP = 80
export const WAVE3_DOCS_PER_ENDPOINT = 8
export const WAVE3_TRANSIENT_EXCERPTS_PER_ENDPOINT = 3
export const WAVE3_DEFAULT_WINDOW_HOURS = 72
export const WAVE3_ACADEMIC_WINDOW_HOURS = 720
export const WAVE4_NEW_SOURCES_PER_CELL = 5
export const WAVE4_NEW_SOURCES_HARD_CAP = 35
export const WAVE4_DOCS_PER_ENDPOINT = 8
export const WAVE4_TRANSIENT_EXCERPTS_PER_ENDPOINT = 3

export const ENDPOINT_ACTIVATION_STATES = [
  'DISCOVERED',
  'PROBING',
  'LIVE',
  'STALE',
  'OFFLINE',
  'BLOCKED',
  'RATE_LIMITED',
  'INVALID',
  'HTML_ONLY',
  'NO_MACHINE_ENDPOINT',
  'REVIEW_REQUIRED',
] as const
export type EndpointActivationState = (typeof ENDPOINT_ACTIVATION_STATES)[number]

export type RegistryParentCompany = {
  parentId: string
  canonicalName: string
  ownershipType: string
  country: string | null
  homepage: string | null
}

export type RegistryPublisher = {
  publisherId: string
  canonicalName: string
  parentId: string | null
  country: string | null
  homepage: string | null
}

export type RegistrySource = {
  sourceId: string
  canonicalName: string
  aliases: string[]
  canonicalDomain: string
  domainAliases: string[]
  sourceType: SourceClass
  journalismType: string | null
  sourceRole: SourceRoleClass
  ownershipType: string
  publisherId: string
  parentCompanyId: string | null
  country: string | null
  region: PlanetaryGeography | null
  continent: string | null
  stateProvince: string | null
  countyDistrict: string | null
  cityLocality: string | null
  localityClass: LocalityClass
  hqGeography: PlanetaryGeography | null
  coverageGeography: PlanetaryGeography | null
  datelineGeography: PlanetaryGeography | null
  coverageGeometry: Record<string, unknown> | null
  administrativeAreas: string[]
  primaryLanguage: string
  supportedLanguages: string[]
  requestedDiscoveryLanguage: string | null
  actualQueryLanguage: string | null
  topics: PlanetaryTopic[]
  originalReportingCapability: boolean
  homepage: string
  status: SourceLifecycleState
  discoveryMethod: string
  discoveredAt: string
  lastVerifiedAt: string | null
  lastHealthyAt: string | null
  freshnessClass: FreshnessClass
  robotsPolicy: 'UNKNOWN' | 'ALLOWED' | 'DISALLOWED'
  termsMetadata: string | null
  licenseMetadata: string | null
  retentionPolicy: 'METADATA_ONLY' | 'FULL_TEXT_LAWFUL' | 'HASH_ONLY'
  reliabilityMetadata: string | null
  wireRelationship: string | null
  notes: string | null
  gapPriority: string | null
  verification: Partial<Record<VerificationStage, { ok: boolean; detail: string }>>
}

export type RegistryEndpoint = {
  endpointId: string
  sourceId: string
  endpointType: EndpointType
  url: string
  status: 'IDLE' | 'OK' | 'NOT_MODIFIED' | 'RATE_LIMITED' | 'ERROR'
  lastFetchAt: string | null
  lastSuccessAt: string | null
  etag: string | null
  lastModified: string | null
  retryAfter: string | null
  observedPublishCadenceSeconds: number | null
  recommendedPollIntervalSeconds: number
  errorClass: string | null
  consecutiveFailures: number
  httpStatus: number | null
  latencyMs: number | null
  activationState: EndpointActivationState
  contentType: string | null
  itemCount: number | null
}

export type Wave1Candidate = {
  canonicalName: string
  homepage: string
  country: string
  region: PlanetaryGeography
  continent: string
  localityClass: LocalityClass
  sourceRole: SourceRoleClass
  primaryLanguage: string
  supportedLanguages: string[]
  sourceType: SourceClass
  ownershipType: string
  publisher: string
  parentCompany: string | null
  cityLocality?: string | null
  stateProvince?: string | null
  endpointUrl?: string | null
  endpointType?: EndpointType | null
  retentionPolicy?: RegistrySource['retentionPolicy']
  discoveryMethod: string
  requestedDiscoveryLanguage: string
  actualQueryLanguage: string
  gapPriority?: string | null
  topics?: PlanetaryTopic[]
  originalReporting?: boolean
  journalismType?: string | null
  freshnessClass?: FreshnessClass
  wireRelationship?: string | null
}

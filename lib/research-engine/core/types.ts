/**
 * Shared types for the War Room Research Engine.
 *
 * The Research Engine is read-only intelligence infrastructure: every type in
 * this module describes evidence gathered from external public/government
 * data providers, never an action taken against them. See
 * docs/RESEARCH_ENGINE_SECURITY.md for the boundary this module exists to
 * enforce.
 */

export type ResearchProviderId =
  | 'exa'
  | 'github'
  | 'sam_gov'
  | 'fmcsa'
  | 'ncbi'
  | 'fred'
  | 'semantic_scholar'
  | 'arxiv'
  | 'crossref'
  | 'nasa'
  | 'nasa_gibs'
  | 'uspto'
  | 'courtlistener'
  | 'internet_archive'
  | 'wayback'
  | 'world_bank_indicators'
  | 'world_bank_data_catalog'
  | 'world_bank_projects'
  | 'world_bank_finances'
  | 'world_bank_climate'
  | 'imf_sdmx'
  | 'usgs_water'
  | 'usgs_earthquake'
  | 'usgs_earthquake_feed'
  | 'usgs_national_map'
  | 'usgs_sciencebase'
  | 'library_of_congress'
  | 'wikidata'
  | 'common_crawl'

export type ResearchProviderCategory =
  | 'general_web'
  | 'code'
  | 'government_contracts'
  | 'transportation'
  | 'scholarly'
  | 'economics'
  | 'space_earth'
  | 'legal'
  | 'patents'
  | 'web_archive'
  | 'global_development'
  | 'hydrology_hazards'
  | 'geospatial'
  | 'cultural_heritage'
  | 'knowledge_graph'
  | 'climate_environment'

export type ResearchProviderCapability =
  | 'search'
  | 'getById'
  | 'list'
  | 'timeSeries'
  | 'geoSearch'
  | 'related'
  | 'citations'
  | 'historicalCaptures'
  | 'compareCaptures'
  | 'mapLayers'
  | 'healthCheck'

/**
 * Safe, non-secret configuration status for a provider. Never derived from a
 * live network call — see ResearchHealthStatus for that. There is currently
 * no Research Engine disable mechanism, so a provider is never reported
 * `disabled`; if one is added later, reintroduce that value alongside the
 * code path that actually produces it.
 */
export type ResearchProviderConfigStatus =
  | 'configured'
  | 'unavailable'
  | 'pending'

/**
 * Live/explicit health status. Distinct from ResearchProviderConfigStatus:
 * config status is env-presence only; this requires an actual (cached,
 * rate-limited) request.
 */
export type ResearchHealthState =
  | 'ready'
  | 'degraded'
  | 'unavailable'
  | 'rate_limited'
  | 'authentication_failed'
  | 'not_configured'
  | 'not_implemented'

export type ResearchHealthStatus = {
  provider: ResearchProviderId
  state: ResearchHealthState
  checkedAt: string
  detail: string | null
  durationMs: number | null
}

export type ResearchQueryIntent =
  | 'general_web'
  | 'software_code'
  | 'scholarly'
  | 'medical_biomedical'
  | 'legal_case_law'
  | 'patents_inventions'
  | 'government_contracts'
  | 'transportation_carriers'
  | 'economics_macro'
  | 'global_development'
  | 'finance_public_data'
  | 'climate_environment'
  | 'earthquakes_hazards'
  | 'water_hydrology'
  | 'maps_geospatial'
  | 'historical_web'
  | 'cultural_history'
  | 'entity_knowledge_graph'
  | 'space_science'

export type ResearchQuery = {
  text: string
  intent?: ResearchQueryIntent | null
  providers?: ResearchProviderId[] | null
  maxResults?: number
  dateFrom?: string | null
  dateTo?: string | null
  requireCurrent?: boolean
}

export type ResearchRequest = ResearchQuery & {
  requestedBy: string
  requestedAt: string
}

export type ResearchCitation = {
  provider: ResearchProviderId
  title: string
  canonicalUrl: string | null
  providerRecordId: string | null
  authorOrOrganization: string | null
  publishedAt: string | null
  retrievedAt: string
  datasetOrSeriesId: string | null
  identifiers: Record<string, string>
  captureTimestamp: string | null
  licenseOrAccessWarning: string | null
}

export type ResearchProvenance = {
  provider: ResearchProviderId
  sourceUrl: string
  retrievedAt: string
  requestDurationMs: number
  fromCache: boolean
  /** True when this record represents an archived/historical capture, not a live current source. */
  isHistorical: boolean
}

export type ResearchEntity = {
  id: string
  label: string
  description: string | null
  aliases: string[]
  types: string[]
}

export type ResearchTimeSeriesPoint = {
  date: string
  value: number | null
  note: string | null
}

export type ResearchTimeSeries = {
  seriesId: string
  title: string
  unit: string | null
  frequency: string | null
  points: ResearchTimeSeriesPoint[]
}

export type ResearchGeoFeature = {
  id: string
  geometryType: string
  coordinates: unknown
  properties: Record<string, unknown>
}

export type ResearchDocument = {
  id: string
  provider: ResearchProviderId
  providerRecordId: string | null
  title: string
  summary: string | null
  contentSnippet: string | null
  canonicalUrl: string | null
  sourceUrl: string | null
  sourceName: string
  contentType: string
  authors: string[]
  organization: string | null
  publishedAt: string | null
  updatedAt: string | null
  retrievedAt: string
  geography: string | null
  language: string | null
  identifiers: Record<string, string>
  subjects: string[]
  license: string | null
  accessStatus: 'open' | 'restricted' | 'unknown'
  score: number | null
  providerRank: number | null
  citations: ResearchCitation[]
  provenance: ResearchProvenance
  warnings: string[]
}

export type ResearchProviderError = {
  provider: ResearchProviderId
  category: 'not_configured' | 'timeout' | 'rate_limited' | 'upstream_error' | 'parse_error' | 'blocked_host' | 'unknown'
  message: string
  httpStatus: number | null
}

export type ResearchProviderResponse = {
  provider: ResearchProviderId
  ok: boolean
  documents: ResearchDocument[]
  timeSeries: ResearchTimeSeries[]
  geoFeatures: ResearchGeoFeature[]
  entities: ResearchEntity[]
  error: ResearchProviderError | null
  durationMs: number
  fromCache: boolean
}

export type ResearchRouteDecision = {
  intent: ResearchQueryIntent | null
  selectedProviders: ResearchProviderId[]
  rejectedProviders: { provider: ResearchProviderId; reason: string }[]
  freshnessRequirement: 'current' | 'historical' | 'either'
  maxResults: number
}

export type ResearchExecutionSummary = {
  requestId: string
  requestedAt: string
  completedAt: string
  durationMs: number
  route: ResearchRouteDecision
  providerResponses: ResearchProviderResponse[]
  resultCount: number
  deduplicatedCount: number
  partialFailure: boolean
}

export type ResearchComparison = {
  subject: string
  documents: ResearchDocument[]
  agreement: 'corroborated' | 'conflicting' | 'single_source' | 'insufficient_evidence'
  note: string
}

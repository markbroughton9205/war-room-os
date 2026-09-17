import type { DivergentProtocolSeat, FirstPassDiscoverySeat } from './identity'

export const PLANETARY_PROTOCOL_ROUNDS = [
  'ROUND_0_COMMANDER_INTENT',
  'ROUND_1_INVESTIGATION_PLAN',
  'ROUND_2_BLIND_DIVERGENT_COLLECTION',
  'ROUND_3_CPU_DEDUP_ORIGIN_COVERAGE',
  'ROUND_4_CONDITIONAL_GAP_FILL',
  'ROUND_5_PHOENIX_ADVERSARIAL',
  'ROUND_6_LUMEN_VERIFICATION',
  'ROUND_7_EVIDENCE_ORIGIN_FUSION',
  'ROUND_8_AURORA_SYNTHESIS',
] as const
export type PlanetaryProtocolRound = (typeof PLANETARY_PROTOCOL_ROUNDS)[number]

export const QUERY_COMPLEXITY = ['NARROW_FACTUAL', 'SCOPED_RESEARCH', 'BROAD_PLANETARY'] as const
export type QueryComplexity = (typeof QUERY_COMPLEXITY)[number]

export const SOURCE_CLASSES = [
  'JOURNALISM',
  'PRIMARY_PUBLIC_SIGNAL',
  'OFFICIAL_RECORD',
  'SCIENTIFIC_SOURCE',
  'TRADE_SOURCE',
  'COMMUNITY_SOURCE',
  'ALERT_FEED',
  'ACADEMIC_SOURCE',
  'GOVERNMENT',
  'EMERGENCY_MANAGEMENT',
  'PUBLIC_SAFETY',
  'WEATHER',
  'TRANSPORT',
  'UTILITIES',
  'PUBLIC_HEALTH',
  'REGULATOR',
  'NGO',
] as const
export type SourceClass = (typeof SOURCE_CLASSES)[number]

export const EVIDENCE_CLASSES = [
  'PRIMARY_EVIDENCE',
  'SECONDARY_EVIDENCE',
  'LOCAL_REPORTING',
  'REGIONAL_REPORTING',
  'WIRE_SYNDICATION',
  'OFFICIAL_STATEMENT',
  'DATASET',
  'TECHNICAL_DOCUMENT',
  'RESEARCH_PAPER',
  'ALERT',
  'CONTEXTUAL',
] as const
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number]

export const EVIDENCE_EDGE_RELATIONS = [
  'SUPPORTS',
  'CONTRADICTS',
  'REPORTS',
  'PRIMARY_EVIDENCE',
  'SECONDARY_EVIDENCE',
  'CONTEXTUALIZES',
  'DUPLICATES',
] as const
export type EvidenceEdgeRelation = (typeof EVIDENCE_EDGE_RELATIONS)[number]

export const COVERAGE_CELL_STATUSES = [
  'COVERED',
  'WEAK',
  'MISSING',
  'BLOCKED',
  'NOT_ASSESSED',
] as const
export type CoverageCellStatus = (typeof COVERAGE_CELL_STATUSES)[number]

export const SOURCE_LIFECYCLE_STATES = [
  'DISCOVERED',
  'VERIFYING',
  'TYPE_CLASSIFICATION',
  'GEO_CLASSIFICATION',
  'LANGUAGE_CLASSIFICATION',
  'ENDPOINT_DISCOVERY',
  'ACCESS_POLITENESS_CHECK',
  'OWNERSHIP_ORIGIN_ANALYSIS',
  'LIVE',
  'CONFIG_NEEDED',
  'BLOCKED',
  'STALE',
  'OFFLINE',
  'DEAD',
  'ARCHIVED',
  'REVIEW_REQUIRED',
] as const
export type SourceLifecycleState = (typeof SOURCE_LIFECYCLE_STATES)[number]

export const ENDPOINT_TYPES = [
  'RSS',
  'ATOM',
  'NEWS_SITEMAP',
  'SITEMAP',
  'API',
  'HTML',
  'PUBLIC_ALERT_FEED',
  'PUBLIC_SOCIAL_FEED',
  'OTHER_PUBLIC_ENDPOINT',
] as const
export type EndpointType = (typeof ENDPOINT_TYPES)[number]

export const FRESHNESS_CLASSES = ['BREAKING_EMERGENCY', 'NATIONAL_REGIONAL', 'COMMUNITY_HYPERLOCAL', 'DORMANT'] as const
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number]

export const GEO_SCOPES = [
  'GLOBAL',
  'CONTINENTAL',
  'NATIONAL',
  'REGIONAL',
  'STATE_PROVINCE',
  'COUNTY_DISTRICT',
  'CITY',
  'TOWN',
  'MUNICIPAL',
  'NEIGHBORHOOD',
  'HYPERLOCAL',
] as const
export type GeoScope = (typeof GEO_SCOPES)[number]

export const PLANETARY_GEOGRAPHIES = [
  'NORTH_AMERICA',
  'LATIN_AMERICA',
  'EUROPE',
  'AFRICA',
  'MIDDLE_EAST',
  'EAST_ASIA',
  'SOUTH_ASIA',
  'SOUTHEAST_ASIA',
  'OCEANIA',
  'WEST_AFRICA',
  'CENTRAL_AFRICA',
  'EAST_AFRICA',
] as const
export type PlanetaryGeography = (typeof PLANETARY_GEOGRAPHIES)[number]

export const PLANETARY_TOPICS = [
  'BREAKING_EVENTS',
  'LOCAL_GOVERNANCE',
  'INFRASTRUCTURE',
  'ENERGY',
  'TRANSPORT',
  'TELECOMMUNICATIONS',
  'CYBER',
  'TECHNOLOGY',
  'SCIENCE',
  'ECONOMICS',
  'PUBLIC_SAFETY',
  'WEATHER',
  'HEALTH',
  'CONFLICT',
  'ENVIRONMENT',
] as const
export type PlanetaryTopic = (typeof PLANETARY_TOPICS)[number]

export const ROOT_CAUSE_CLASSES = [
  'RETRIEVAL_CONVERGENCE_CONFIRMED',
  'SHARED_BACKEND_REPRESENTATIONAL_CONVERGENCE',
  'SYNDICATION_FALSE_CONSENSUS',
] as const
export type RootCauseClass = (typeof ROOT_CAUSE_CLASSES)[number]

export const TERRA_INFO_LAYERS = [
  'NEWS_COVERAGE',
  'LOCAL_JOURNALISM',
  'PUBLIC_SAFETY',
  'OFFICIAL_GOVERNMENT',
  'SCIENCE',
  'WEATHER',
  'TRANSPORT',
  'INFRASTRUCTURE',
  'LANGUAGE_COVERAGE',
  'SOURCE_OWNERSHIP',
  'COVERAGE_GAPS',
  'LIVE_STORY_CLUSTERS',
] as const
export type TerraInfoLayer = (typeof TERRA_INFO_LAYERS)[number]

export type InvestigationTask = {
  taskId: string
  missionId: string
  seat: DivergentProtocolSeat
  timeRange: string
  geographicScope: PlanetaryGeography | 'GLOBAL'
  topic: PlanetaryTopic
  languages: string[]
  sourceTypes: SourceClass[]
  evidenceTypes: EvidenceClass[]
  noveltyObjective: 'MAXIMIZE_DISCOVERY' | 'SYSTEMS_CONSEQUENCE' | 'LONG_TAIL' | 'VERIFY_PRIMARY' | 'DISCONFIRM' | 'SYNTHESIZE'
  verificationDepth: 'NONE' | 'LIGHT' | 'TARGETED' | 'PRIMARY_RECORD'
  searchBudget: number
  priority: number
  query: string
  queryLanguage: string
  requestedLanguage: string
  preferredProviders: string[]
  reason?: string
}

export type InvestigationPlan = {
  missionId: string
  commanderIntent: string
  complexity: QueryComplexity
  createdAt: string
  protocol: 'NARROW_BYPASS' | 'DIVERGENT_BROAD'
  tasks: InvestigationTask[]
  skippedRounds: PlanetaryProtocolRound[]
  executedRounds: PlanetaryProtocolRound[]
  notes: string[]
}

export type RetrievedDocument = {
  documentId: string
  url: string
  canonicalUrl: string
  title: string
  publisher: string
  outlet: string
  parentCompany: string | null
  sourceOriginId: string | null
  independentOriginId: string | null
  retrievalProvider: string
  query: string
  queryLanguage: string
  requestedLanguage?: string
  detectedLanguage: string | null
  detectedLanguageConfidence?: number
  evidenceLanguageMatch?: boolean
  queryLanguageClass?: 'NATIVE_QUERY_CONFIRMED' | 'MIXED_LANGUAGE_QUERY' | 'ENGLISH_FALLBACK' | 'LANGUAGE_GENERATION_FAILED'
  originalText: string
  translatedText: string | null
  translationMethod: string | null
  translationTime: string | null
  translationConfidence: number | null
  publishedAt: string | null
  contentHash: string
  simhash: string
  geography: PlanetaryGeography | null
  taskGeography?: PlanetaryGeography | 'GLOBAL' | null
  eventGeography?: PlanetaryGeography | null
  sourceHeadquartersGeography?: PlanetaryGeography | null
  sourceCoverageGeography?: PlanetaryGeography | null
  datelineGeography?: PlanetaryGeography | null
  localityClass?: 'HYPERLOCAL' | 'CITY_LOCAL' | 'REGIONAL' | 'NATIONAL' | 'INTERNATIONAL' | 'SPECIALIST' | 'OFFICIAL' | 'UNKNOWN'
  sourceGeographyMatch?: 'MATCH' | 'PARTIAL_MATCH' | 'NO_MATCH' | 'UNKNOWN'
  observedTopic?: PlanetaryTopic | null
  topic: PlanetaryTopic | null
  sourceClass: SourceClass
  evidenceClass: EvidenceClass
  wireAttribution: string | null
  byline: string | null
  dateline: string | null
  promptInjectionDetected: boolean
}

export type LanePacket = {
  missionId: string
  taskId: string
  laneId: string
  seat: DivergentProtocolSeat
  timestamp: string
  hash: string
  queries: string[]
  documents: RetrievedDocument[]
  claims: LedgerClaim[]
  immutable: boolean
  lockedAt: string | null
}

export type LedgerClaim = {
  claimId: string
  missionId: string
  laneId: string
  agent: DivergentProtocolSeat
  normalizedClaim: string
  originalClaim: string
  originalLanguage: string
  topic: PlanetaryTopic | null
  geography: PlanetaryGeography | null
  time: string | null
  confidence: number
  verificationState: 'UNVERIFIED' | 'SUPPORTED' | 'DISPUTED' | 'CONTRADICTED' | 'INSUFFICIENT'
  storyClusterId: string | null
  independentOriginIds: string[]
}

export type EvidenceEdge = {
  edgeId: string
  missionId: string
  claimId: string
  documentId: string
  relation: EvidenceEdgeRelation
  originId: string | null
}

export type SeatOverlapRecord = {
  seat: DivergentProtocolSeat
  generatedQuery: string
  queryLanguage: string
  retrievalProvider: string
  retrievedUrls: string[]
  canonicalUrls: string[]
  publishers: string[]
  outlets: string[]
  sourceOrigins: string[]
  storyClusters: string[]
  claimClusters: string[]
  finalResponse: string
}

export type OverlapMetrics = {
  urlJaccard: number
  canonicalSourceOverlap: number
  evidenceOriginOverlap: number
  claimOverlap: number
  reportEmbeddingSimilarity: number | null
  geographicDistribution: Record<string, number>
  topicDistribution: Record<string, number>
  effectiveRank: number
  independentOriginRatio: number
  duplicateDocumentRatio: number
  agentAgreement: number
  independentOrigins: number
  urlCount: number
}

export type CoverageCell = {
  cellId: string
  geography: PlanetaryGeography | 'GLOBAL'
  topic: PlanetaryTopic
  language: string
  sourceType: SourceClass
  time: string
  evidenceQuality: EvidenceClass
  claims: number
  independentOrigins: number
  freshestEvidence: string | null
  qualityDistribution: Record<string, number>
  verification: string
  status: CoverageCellStatus
  qualifyingDocumentCount: number
  languageMatchedCount: number
  geographyMatchedCount: number
  sourceClassMatchedCount: number
  rejectionReasons: string[]
  explanation: string
}

export type SourceRecord = {
  sourceId: string
  canonicalName: string
  outletName: string
  publisher: string
  parentCompany: string | null
  ownershipType: 'INDEPENDENT' | 'CORPORATE_GROUP' | 'PUBLIC_BROADCASTER' | 'GOVERNMENT' | 'NGO' | 'UNIVERSITY' | 'UNKNOWN'
  canonicalDomain: string
  domainAliases: string[]
  country: string | null
  region: PlanetaryGeography | null
  stateProvince: string | null
  countyDistrict: string | null
  city: string | null
  locality: string | null
  latitude: number | null
  longitude: number | null
  primaryLanguage: string
  supportedLanguages: string[]
  sourceType: SourceClass
  topicSpecialties: PlanetaryTopic[]
  primaryOrSecondary: 'PRIMARY' | 'SECONDARY' | 'UNKNOWN'
  originalReportingCapability: boolean
  url: string
  status: SourceLifecycleState
  wireRelationship: string | null
  parentNetwork: string | null
  discoveryMethod: string
  discoveredAt: string
  lastChecked: string | null
  lastSuccessfulFetch: string | null
  observedPublishRate: number | null
  freshnessClass: FreshnessClass
  robotsStatus: 'UNKNOWN' | 'ALLOWED' | 'DISALLOWED'
  termsStatus: 'UNKNOWN' | 'PERMITTED' | 'RESTRICTED'
  retentionClass: 'METADATA_ONLY' | 'FULL_TEXT_LAWFUL' | 'HASH_ONLY'
  licenseMetadata: string | null
}

export type SourceEndpoint = {
  endpointId: string
  sourceId: string
  type: EndpointType
  url: string
  etag: string | null
  lastModified: string | null
  lastFetch: string | null
  nextFetch: string | null
  fetchIntervalSeconds: number
  status: 'IDLE' | 'OK' | 'NOT_MODIFIED' | 'RATE_LIMITED' | 'ERROR'
  errorCount: number
  rateLimitState: string | null
}

export type CommanderIntelligenceDisplay = {
  uniqueClaims: number
  independentEvidenceOrigins: number
  syndicatedCopiesCollapsed: number
  verifiedClaims: number
  disputedClaims: number
  coverageGaps: number
}

export type GapFillTask = InvestigationTask & {
  reason: string
  targetCellId: string
  failedDimension?: string
}

export type FusionResult = {
  claimId: string
  agentAgreement: number
  independentOrigins: number
  urlCount: number
  confidence: number
  method: 'INDEPENDENT_ORIGIN_WEIGHTED'
  note: string
}

export type ProtocolResult = {
  missionId: string
  complexity: QueryComplexity
  plan: InvestigationPlan
  packets: LanePacket[]
  ledgerClaims: LedgerClaim[]
  edges: EvidenceEdge[]
  coverage: CoverageCell[]
  gapFillTasks: GapFillTask[]
  fusion: FusionResult[]
  phoenixFindings: string[]
  lumenVerifications: string[]
  auroraBriefing: string
  metrics: OverlapMetrics
  display: CommanderIntelligenceDisplay
  insufficientCoverage: string[]
  serialGpu: true
  roundsExecuted: PlanetaryProtocolRound[]
}

export type BaselineSnapshot = {
  query: string
  recordedAt: string
  seats: SeatOverlapRecord[]
  pairwise: Record<string, OverlapMetrics>
  aggregate: OverlapMetrics
  rootCauses: RootCauseClass[]
  notes: string[]
}

export type FirstPassSeat = FirstPassDiscoverySeat

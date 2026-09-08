import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'

export const COUNCIL_SWARM_PHASES = [
  'MISSION_DECOMPOSITION',
  'INDEPENDENT_DISCOVERY',
  'POSITION_FREEZE',
  'CROSS_REVIEW',
  'VERIFICATION',
  'SYNTHESIS',
  'PERSISTENCE',
] as const

export type CouncilSwarmPhase = (typeof COUNCIL_SWARM_PHASES)[number]

export const SWARM_PHASE_ORDER: readonly CouncilSwarmPhase[] = COUNCIL_SWARM_PHASES

export type ResearchProfileName = 'LIGHT_RESEARCH' | 'STANDARD_RESEARCH' | 'DEEP_RESEARCH' | 'GLOBAL_SCATTER'

export type GeographicRegion =
  | 'NORTH_AMERICA'
  | 'LATIN_AMERICA'
  | 'EUROPE'
  | 'AFRICA'
  | 'MIDDLE_EAST'
  | 'EAST_ASIA'
  | 'SOUTH_ASIA'
  | 'OCEANIA'

export const GEOGRAPHIC_REGIONS: readonly GeographicRegion[] = [
  'NORTH_AMERICA',
  'LATIN_AMERICA',
  'EUROPE',
  'AFRICA',
  'MIDDLE_EAST',
  'EAST_ASIA',
  'SOUTH_ASIA',
  'OCEANIA',
]

export type PulsarScoutType =
  | 'PRIMARY_SOURCE'
  | 'WEB_CURRENT'
  | 'ACADEMIC'
  | 'INDUSTRY'
  | 'REGIONAL'
  | 'HISTORICAL'
  | 'CONTRADICTION'

export type OrionScoutType =
  | 'RUNTIME'
  | 'REPO'
  | 'TEST'
  | 'DATA'
  | 'PROVIDER'
  | 'EXTERNAL_DOCS'

export type LumenScoutType =
  | 'PRIMARY_VERIFY'
  | 'CLAIM_DECOMPOSE'
  | 'ENTAILMENT'
  | 'DATE_FRESHNESS'
  | 'AUTHORITY_CHECK'
  | 'CROSS_SOURCE'

export type PhoenixScoutType =
  | 'DISPROVE'
  | 'ALTERNATIVE_EXPLANATION'
  | 'SOURCE_ATTACK'
  | 'TIMELINE'
  | 'CAUSALITY'
  | 'INJECTION'
  | 'HALLUCINATION'

export type NovaScoutType =
  | 'PATH_A'
  | 'PATH_B'
  | 'PATH_C'
  | 'CONSTRAINTS'
  | 'SECOND_ORDER'
  | 'TIMING'

export type SolaraScoutType =
  | 'COST'
  | 'ACCESS'
  | 'LABOR'
  | 'SMALL_BUSINESS'
  | 'LOCAL_COMMUNITY'
  | 'LIVED_EXPERIENCE'

export type ScoutType =
  | PulsarScoutType
  | OrionScoutType
  | LumenScoutType
  | PhoenixScoutType
  | NovaScoutType
  | SolaraScoutType
  | GeographicRegion

export type FrozenReportKind =
  | 'ASTRA_MISSION_REPORT'
  | 'PULSAR_RESEARCH_REPORT'
  | 'ORION_ENGINEERING_REPORT'
  | 'LUMEN_VERIFICATION_REPORT'
  | 'PHOENIX_RED_TEAM_REPORT'
  | 'NOVA_STRATEGY_REPORT'
  | 'SOLARA_IMPACT_REPORT'
  | 'AURORA_FINAL_SYNTHESIS'

export type ClaimVerificationStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'CONTRADICTED'
  | 'STALE'
  | 'SOURCE_MISMATCH'

export type ConvergenceClaimState =
  | 'INDEPENDENT_CONVERGENCE'
  | 'CONTESTED'
  | 'WEAKLY_SUPPORTED'
  | 'UNRESOLVED'
  | 'REJECTED'

export type EvidenceClass =
  | 'official'
  | 'research'
  | 'reported_experience'
  | 'anecdote'
  | 'model_inference'

export type RoundIdentity = {
  missionId: string
  roundRequestId: string
  logicalRequestId: string
}

export const SWARM_SEAT_BY_AGENT: Readonly<Record<Exclude<NebulaAgentId, 'astra'>, CouncilOrchestrationFamily>> = {
  aurora: 'chatgpt',
  orion: 'claude',
  pulsar: 'grok',
  lumen: 'gemini',
  nova: 'kimi',
  phoenix: 'red_team',
  solara: 'baby',
}

export const SWARM_AGENT_BY_SEAT: Readonly<Partial<Record<CouncilOrchestrationFamily, NebulaAgentId>>> = {
  chatgpt: 'aurora',
  claude: 'orion',
  grok: 'pulsar',
  gemini: 'lumen',
  kimi: 'nova',
  red_team: 'phoenix',
  baby: 'solara',
}

export const REPORT_KIND_BY_AGENT: Readonly<Record<NebulaAgentId, FrozenReportKind>> = {
  astra: 'ASTRA_MISSION_REPORT',
  pulsar: 'PULSAR_RESEARCH_REPORT',
  orion: 'ORION_ENGINEERING_REPORT',
  lumen: 'LUMEN_VERIFICATION_REPORT',
  phoenix: 'PHOENIX_RED_TEAM_REPORT',
  nova: 'NOVA_STRATEGY_REPORT',
  solara: 'SOLARA_IMPACT_REPORT',
  aurora: 'AURORA_FINAL_SYNTHESIS',
}

export type SourceTerritory =
  | 'government_regulator'
  | 'trade_publications'
  | 'authoritative_confirmation'
  | 'contradictory_alternate'
  | 'operational_local'
  | 'strategic_scenarios'
  | 'human_impact'
  | 'regional_public'

export type SeatAssignment = {
  agentId: Exclude<NebulaAgentId, 'astra'>
  seat: CouncilOrchestrationFamily
  objective: string
  sourceTerritory: SourceTerritory
  scoutTypes: ScoutType[]
  liveResearch: boolean
  kimiStored: boolean
  regions: GeographicRegion[]
  /** Explicit AURORA research is off unless this is true. */
  auroraDiscovery: boolean
}

export type AstraMissionPlan = {
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  commanderDecree: string
  createdAt: string
  domains: string[]
  freshnessRequirement: 'live' | 'recent' | 'any' | 'none'
  geographicScope: 'local' | 'national' | 'regional' | 'global' | 'none'
  sourceClassesNeeded: string[]
  selectedPermanentSeats: Exclude<NebulaAgentId, 'astra'>[]
  assignments: SeatAssignment[]
  unresolvedQuestions: string[]
  likelyContradictionTargets: string[]
  liveResearchRequired: boolean
  kimiStoredRequired: boolean
  regionalScatter: GeographicRegion[]
  researchProfile: ResearchProfileName
  astraProvidesSubstantiveAnswer: false
  notes: string[]
}

export type ScoutPlan = {
  scoutId: string
  scoutType: ScoutType
  seatId: CouncilOrchestrationFamily
  agentId: NebulaAgentId
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  query: string
  assignment: string
  region?: GeographicRegion
  sourceTerritory: SourceTerritory
  spawnDepth: 1
  languageAccess: 'native' | 'not_available'
  preferLocalTruth: boolean
  executeLive: boolean
  queryLanguage?: string
  preferredProviders?: string[]
}

export type ScoutGovernorLimits = {
  maxScoutsPerSeat: number
  maxTotalScoutsPerRound: number
  maxConcurrentModelCalls: number
  maxConcurrentWebCalls: number
  perScoutTimeoutMs: number
  phaseTimeoutMs: number
  maxSpawnDepth: 1
}

export type ScoutMetadata = {
  scoutId: string
  scoutType: ScoutType
  seatId: CouncilOrchestrationFamily
  agentId: NebulaAgentId
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  query: string
  assignment: string
  region?: GeographicRegion
  provider: string
  resultCount: number
  evidenceIds: string[]
  findings: string
  uncertainties: string[]
  confidence: number | null
  startedAt: string
  completedAt: string | null
  aborted: boolean
  staleDiscarded: boolean
  timeout: boolean
  languageAccess: 'native' | 'not_available'
  abortReason?: ScoutAbortReason
  fallbackUsed?: boolean
  fallbackReason?: string | null
  preferredProviders?: string[]
  queryLanguage?: string
}

export type ScoutLedgerEntry = {
  evidenceId: string
  scoutId: string
  scoutType: ScoutType
  seatId: CouncilOrchestrationFamily
  agentId: NebulaAgentId
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  query: string
  region?: GeographicRegion
}

export type PrivateSeatLedger = {
  agentId: NebulaAgentId
  seatId: CouncilOrchestrationFamily
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  entries: ScoutLedgerEntry[]
  evidence: IntelligenceEvidenceItem[]
}

export type FrozenSeatReport = {
  report_id: string
  report_kind: FrozenReportKind
  mission_id: string
  roundRequestId: string
  logicalRequestId: string
  seat: CouncilOrchestrationFamily | 'astra'
  agentId: NebulaAgentId
  createdAt: string
  frozen_at: string
  phase: Extract<CouncilSwarmPhase, 'POSITION_FREEZE' | 'SYNTHESIS'>
  assignment: string
  conclusion: string
  evidence_ids: string[]
  confidence: number | null
  uncertainties: string[]
  contradictions: string[]
  unanswered_questions: string[]
  scout_summary: string
  immutable: true
}

export type CrossReviewRevision = {
  revision_id: string
  report_id: string
  reviewer: NebulaAgentId
  createdAt: string
  targetClaimIds: string[]
  notes: string
  surviving: boolean
}

export type AuthorityMatch = 'MATCH' | 'MISMATCH' | 'PARTIAL' | 'UNKNOWN'

export type AtomicClaim = {
  claim_id: string
  claim_text: string
  seat: NebulaAgentId
  report_id: string
  supporting_evidence_ids: string[]
  supporting_independence_keys: string[]
  contradicting_evidence_ids: string[]
  contradicting_independence_keys: string[]
  verification_status: ClaimVerificationStatus
  authority_match: AuthorityMatch
  freshness_status: string
  notes: string
}

export type PhoenixChallengeResult = {
  claim_id: string
  alternateExplanation: string
  missingSourceSearch: string
  timelineCheck: string
  sourceAuthorityCheck: string
  causalLeap: boolean
  injectionRisk: boolean
  survived: boolean
  notes: string
  duplicateSourceFamilies: boolean
  circularReporting: boolean
  missingPrimaryAuthority: boolean
  wrongJurisdiction: boolean
  staleEvidence: boolean
  derivativeEvidence: boolean
  sourceMismatch: boolean
  publicationChronology: string
}

export type ConvergenceClaim = {
  claim_id: string
  claim_text: string
  state: ConvergenceClaimState
  independently_supported_by: NebulaAgentId[]
  independently_contradicted_by: NebulaAgentId[]
  independent_support_count: number
  independent_contradiction_count: number
  independent_report_ids: string[]
  lumen_status: ClaimVerificationStatus | null
  phoenix_survived: boolean | null
  phoenix_status: 'SURVIVED' | 'FAILED' | 'NOT_RUN'
  freshness: string
  freshness_quality: string
  origin_distribution: Record<string, number>
  source_family_diversity: number
  regional_diversity: number
  authority_quality: 'PRIMARY' | 'SECONDARY' | 'TERTIARY' | 'UNKNOWN' | 'MISMATCH'
  primary_source_presence: boolean
  confidence: number | null
  unresolved_gaps: string[]
}

export type ConvergenceMap = {
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  claims: ConvergenceClaim[]
  notes: string[]
}

export type IsolationAudit = {
  pass: boolean
  phase: CouncilSwarmPhase
  leaks: string[]
  checkedSeats: NebulaAgentId[]
}

export type ScoutSwarmPublicMeta = {
  phase: CouncilSwarmPhase
  scoutsActive: boolean
  scoutsBySeat: Partial<Record<NebulaAgentId, number>>
  totalScouts: number
  independentReportsFrozen: number
  crossReviewStarted: boolean
  evidenceCount: number
  isolationPass: boolean
  degraded?: boolean
  phaseTimedOut?: boolean
  researchProfile?: ResearchProfileName
}

export type ScoutAbortReason = 'signal' | 'timeout' | 'superseded' | 'governor' | 'isolation'

export type EvidenceIndependenceSummary = {
  rawCount: number
  canonicalUrlUnique: number
  clusterCount: number
  independentKeyCount: number
  sourceFamilyDiversity: number
  regionalDiversity: number
}

export type CouncilSwarmPersistence = {
  missionId: string
  phase: 'PERSISTENCE'
  astraMission: AstraMissionPlan
  reports: FrozenSeatReport[]
  scoutMetadata: ScoutMetadata[]
  revisions: CrossReviewRevision[]
  convergence: ConvergenceMap | null
  isolation: IsolationAudit | null
  evidenceIndependence?: EvidenceIndependenceSummary | null
  claims?: AtomicClaim[]
  degraded?: boolean
  phaseTimedOut?: boolean
}

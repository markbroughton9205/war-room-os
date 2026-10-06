/**
 * Council Intelligence Architecture contracts.
 * Extends Evidence-Board Council. Does not replace EBC claim/evidence vocabularies.
 * Role ≠ provider. WRIM is an optional future fulfiller, not a second Council.
 */

import type { EbcMissionClass, EvidenceKind, ClaimStatus, TemporalLayer } from '@/lib/council/evidence-board/types'
import type { AuthorityClass, RiskClass } from '@/lib/council/gi/types'

export const INTELLIGENCE_SCHEMA = 'war-room.council-intelligence.v1' as const
export const MISSION_CONTRACT_SCHEMA = 'war-room.mission-contract.v1' as const
export const ATLAS_PLAN_SCHEMA = 'war-room.atlas-plan.v1' as const
export const JANUS_SCENARIO_SCHEMA = 'war-room.janus-scenarios.v1' as const
export const SENTINEL_REVIEW_SCHEMA = 'war-room.sentinel-review.v1' as const
export const KNOWLEDGE_GRAPH_SCHEMA = 'war-room.knowledge-graph.v1' as const
export const MEMORY_GATE_SCHEMA = 'war-room.memory-gate.v1' as const
export const RECEIPT_SCHEMA = 'war-room.execution-receipt.v1' as const

export const INTELLIGENCE_ROLES = [
  'CLASSIFIER',
  'MISSION_UNDERSTANDING',
  'ATLAS',
  'JANUS',
  'SENTINEL',
  'ORION',
  'PULSAR',
  'LUMEN',
  'PHOENIX',
  'AURORA',
  'RETRIEVAL',
  'VERIFICATION',
  'SYNTHESIS',
] as const
export type IntelligenceRole = (typeof INTELLIGENCE_ROLES)[number]

export const PROVIDER_KINDS = ['deterministic', 'frontier', 'local', 'wrim'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/** Overlay classes that change intelligence-layer routing without renaming EBC classes. */
export const INTELLIGENCE_MISSION_CLASSES = [
  'SOCIAL_CHECKIN',
  'SYSTEM_STATUS',
  'DEEP_RESEARCH',
  'CURRENT_INTEL',
  'ENGINEERING_MISSION',
  'ARCHITECTURE_REVIEW',
  'DECISION_SUPPORT',
  'ANALYTICAL_COMPARISON',
  'RISK_REVIEW',
  'INCIDENT_RESPONSE',
  'DOCUMENT_ANALYSIS',
] as const
export type IntelligenceMissionClass = (typeof INTELLIGENCE_MISSION_CLASSES)[number]

export const AUTHORITY_LEVELS = [
  'READ_ONLY',
  'LOCAL_REPAIR',
  'COMMANDER_APPROVAL_REQUIRED',
  'REFUSED',
] as const
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number]

export const CONTRACT_RISK_LEVELS = ['LOW', 'MED', 'HIGH', 'CRITICAL'] as const
export type ContractRiskLevel = (typeof CONTRACT_RISK_LEVELS)[number]

export const PLAN_STEP_STATUSES = [
  'PLANNED',
  'READY',
  'BLOCKED_BY_AUTHORITY',
  'BLOCKED_BY_RISK',
  'BLOCKED_BY_EVIDENCE',
  'OPTIONAL',
  'SKIPPED',
] as const
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number]

export const STATEMENT_KINDS = ['FACT', 'INFERENCE', 'PROJECTION', 'UNKNOWN'] as const
export type StatementKind = (typeof STATEMENT_KINDS)[number]

export const SENTINEL_CATEGORIES = [
  'DATA_LOSS',
  'SECRET_EXPOSURE',
  'AUTHORITY_VIOLATION',
  'PRODUCTION_MUTATION',
  'FINANCIAL_ACTION',
  'IRREVERSIBILITY',
  'SECURITY',
  'PRIVACY',
  'AVAILABILITY',
  'DEPENDENCY',
  'RESOURCE_EXHAUSTION',
  'MODEL_UNCERTAINTY',
  'EXTERNAL_SIDE_EFFECT',
] as const
export type SentinelCategory = (typeof SENTINEL_CATEGORIES)[number]

export const SENTINEL_SEVERITIES = ['LOW', 'MED', 'HIGH', 'CRITICAL'] as const
export type SentinelSeverity = (typeof SENTINEL_SEVERITIES)[number]

export const SENTINEL_ACTIONS = [
  'ALLOW_WITHIN_EXISTING_AUTHORITY',
  'WARN',
  'REQUIRE_APPROVAL',
  'BLOCK',
] as const
export type SentinelAction = (typeof SENTINEL_ACTIONS)[number]

export const KG_NODE_TYPES = [
  'WAR_ROOM',
  'TERRA',
  'FOUNDRY',
  'COUNCIL',
  'WRIM',
  'HIGHER_VISION',
  'RUNTIME',
  'INSTALL',
  'PROVIDER',
  'TOOL',
  'MISSION',
  'EVIDENCE',
  'CAPABILITY',
  'VALIDATION',
  'ARTIFACT',
] as const
export type KgNodeType = (typeof KG_NODE_TYPES)[number]

export const KG_EDGE_TYPES = [
  'DEPENDS_ON',
  'RUNS_ON',
  'VALIDATED_BY',
  'PROVIDED_BY',
  'OWNS',
  'SUPERSEDES',
  'SUPERSEDED_BY',
  'VALID_AT',
  'DERIVED_FROM',
  'OBSERVED_AT',
  'SUPPORTED_BY',
  'MISSION_USED',
  'INSTALLED_AS',
  'USES',
  'PRODUCES',
  'ROUTES_TO',
  'BLOCKED_BY',
  'PART_OF',
  'REQUIRES',
] as const
export type KgEdgeType = (typeof KG_EDGE_TYPES)[number]

export const TEMPORAL_STATES = [
  'CURRENT',
  'HISTORICAL',
  'SUPERSEDED',
  'STALE',
  'UNKNOWN',
] as const
export type TemporalState = (typeof TEMPORAL_STATES)[number]

export const MEMORY_SCOPES = ['SESSION', 'MISSION', 'PROJECT', 'COMMANDER_APPROVED'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export const MEMORY_DECISIONS = [
  'EPHEMERAL',
  'MISSION_ONLY',
  'PROJECT_CANDIDATE',
  'REJECTED',
  'SUPERSEDED',
] as const
export type MemoryDecision = (typeof MEMORY_DECISIONS)[number]

/** Evidence-backed truth states. No decorative percentages. Maps onto EBC claim statuses. */
export const TRUTH_STATES = [
  'VERIFIED',
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'CONFLICTED',
  'UNVERIFIED',
  'UNKNOWN',
] as const
export type TruthState = (typeof TRUTH_STATES)[number]

export const SOURCE_QUALITY_STATES = [
  'LIVE_TELEMETRY',
  'TOOL_RESULT',
  'PRIMARY_EXTERNAL',
  'OFFICIAL_DOC',
  'SECONDARY',
  'USER_REPORTED',
  'INFERRED',
] as const
export type SourceQualityState = (typeof SOURCE_QUALITY_STATES)[number]

export const GOVERNOR_VERDICTS = [
  'ALLOW',
  'ALLOW_WITH_RECEIPT',
  'REQUIRE_COMMANDER_APPROVAL',
  'DENY',
] as const
export type GovernorVerdict = (typeof GOVERNOR_VERDICTS)[number]

export const SIDE_EFFECT_CLASSES = [
  'NONE',
  'READ',
  'LOCAL_WRITE',
  'EXTERNAL_READ',
  'EXTERNAL_MUTATION',
  'FINANCIAL',
  'IRREVERSIBLE',
] as const
export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[number]

export type MissionAuthority = {
  local_repair: boolean
  commit: boolean
  push: boolean
  production_deploy: boolean
  spend: boolean
  trade: boolean
  wager: boolean
  settlement_submit: boolean
  irreversible_external: boolean
  commander_override: boolean
}

export type MissionContractField<T> = {
  value: T
  kind: 'REQUIREMENT' | 'ASSUMPTION' | 'KNOWN' | 'UNKNOWN'
  source: 'commander' | 'classifier' | 'runtime' | 'amendment'
}

export type MissionContractRevision = {
  revision: number
  amended_at: string
  reason: string
  changed_fields: string[]
  receipt_id: string | null
}

export type MissionContractV1 = {
  schema: typeof MISSION_CONTRACT_SCHEMA
  mission_id: string
  mission_class: IntelligenceMissionClass
  ebc_mission_class: EbcMissionClass
  version: number
  objective: string
  scope: string[]
  explicit_requirements: string[]
  explicit_exclusions: string[]
  constraints: string[]
  known_facts: string[]
  unknowns: string[]
  assumptions: string[]
  required_evidence: string[]
  required_tools: string[]
  risk_level: ContractRiskLevel
  authority_level: AuthorityLevel
  approval_requirements: string[]
  completion_criteria: string[]
  success_conditions: string[]
  failure_conditions: string[]
  temporal_requirements: string[]
  privacy_requirements: string[]
  estimated_complexity: 'LOW' | 'MED' | 'HIGH'
  authority: MissionAuthority
  commander_wording: string
  created_at: string
  updated_at: string
  revisions: MissionContractRevision[]
  lightweight: boolean
}

export type AtlasPlanStep = {
  step_id: string
  title: string
  purpose: string
  depends_on: string[]
  required_capabilities: string[]
  required_evidence: string[]
  expected_output: string
  reversible: boolean
  approval_required: boolean
  risk_level: ContractRiskLevel
  status: PlanStepStatus
  required: boolean
  parallel_group: string | null
  blocked_reason: string | null
}

export type AtlasPlanGraph = {
  schema: typeof ATLAS_PLAN_SCHEMA
  mission_id: string
  role: 'ATLAS'
  provider_kind: ProviderKind
  steps: AtlasPlanStep[]
  parallelizable_groups: string[][]
  hard_dependencies: Array<{ from: string; to: string }>
  blockers: string[]
  created_at: string
}

export type JanusStatement = {
  text: string
  kind: StatementKind
  evidence_ids: string[]
}

export type JanusScenario = {
  scenario_id: string
  option: string
  family: 'BASELINE' | 'OPTION_A' | 'OPTION_B' | 'OPTION_C' | 'DO_NOTHING' | 'ROLLBACK' | 'STAGED_MIGRATION'
  assumptions: JanusStatement[]
  benefits: JanusStatement[]
  costs: JanusStatement[]
  risks: JanusStatement[]
  dependencies: string[]
  reversibility: 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE'
  evidence_ids: string[]
  unknowns: string[]
  failure_modes: JanusStatement[]
  migration_impact: JanusStatement[]
  time: JanusStatement[]
  resource_demand: JanusStatement[]
  operational_complexity: JanusStatement[]
  security: JanusStatement[]
  authority: JanusStatement[]
}

export type JanusAnalysis = {
  schema: typeof JANUS_SCENARIO_SCHEMA
  mission_id: string
  role: 'JANUS'
  provider_kind: ProviderKind
  invoked: boolean
  skip_reason: string | null
  scenarios: JanusScenario[]
  created_at: string
}

export type SentinelRisk = {
  risk_id: string
  category: SentinelCategory
  severity: SentinelSeverity
  likelihood_class: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  impact_class: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  detectability: 'LOW' | 'MEDIUM' | 'HIGH'
  reversibility: 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE'
  time_to_harm: 'IMMEDIATE' | 'SHORT' | 'DELAYED' | 'UNKNOWN'
  residual_risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  affected_steps: string[]
  evidence_ids: string[]
  mitigation: string
  approval_required: boolean
  blocking: boolean
  action: SentinelAction
  status: 'OPEN' | 'MITIGATED' | 'ACCEPTED_BY_COMMANDER' | 'BLOCKED'
}

export type SentinelReview = {
  schema: typeof SENTINEL_REVIEW_SCHEMA
  mission_id: string
  role: 'SENTINEL'
  provider_kind: ProviderKind
  invoked: boolean
  skip_reason: string | null
  risks: SentinelRisk[]
  grants_authority: false
  created_at: string
}

export type KgNode = {
  node_id: string
  node_type: KgNodeType
  canonical_name: string
  status: string
  version: string | null
  last_verified_at: string | null
  source_evidence_ids: string[]
  current_runtime_identity: string | null
  owner_system: string
  metadata: Record<string, string | number | boolean | null>
  confidence_state: TruthState
  temporal_state: TemporalState
  observed_at: string | null
  valid_from: string | null
  valid_until: string | null
  superseded_at: string | null
  superseded_by: string | null
}

export type KgEdge = {
  edge_id: string
  kind: KgEdgeType
  from_id: string
  to_id: string
  evidence_ids: string[]
  observed_at: string
  temporal_state: TemporalState
}

export type KnowledgeGraph = {
  schema: typeof KNOWLEDGE_GRAPH_SCHEMA
  nodes: KgNode[]
  edges: KgEdge[]
  seeded_at: string | null
}

export type MemoryCandidate = {
  fact_id: string
  text: string
  scope: MemoryScope
  truth_state: TruthState
  source_quality: SourceQualityState
  evidence_ids: string[]
  sensitivity: 'NONE' | 'INTERNAL' | 'SECRET'
  temporal_state: TemporalState
  speculative: boolean
}

export type MemoryGateResult = {
  schema: typeof MEMORY_GATE_SCHEMA
  mission_id: string
  decisions: Array<{
    fact_id: string
    decision: MemoryDecision
    reason: string
    scope: MemoryScope | null
  }>
}

export type CapabilityRecord = {
  capability_id: string
  name: string
  system: 'Council' | 'Broker' | 'Foundry' | 'Terra' | 'HVS' | 'Runtime' | 'Files'
  read_or_write: 'read' | 'write' | 'mixed'
  local_or_external: 'local' | 'external' | 'hybrid'
  reversible: boolean
  approval_required: boolean
  financial: boolean
  production_mutation: boolean
  secret_access: boolean
  health: 'INDEXED' | 'UNKNOWN'
  last_success: string | null
  last_failure: string | null
  latency_ms: number | null
  version_provider: string
  council_executable: boolean
  notes: string
}

export type GovernorDecision = {
  step_id: string
  capability_id: string
  verdict: GovernorVerdict
  reason: string
  authority_class: AuthorityClass
  sentinel_blocking: boolean
  commander_override: boolean
}

export type ExecutionReceipt = {
  schema: typeof RECEIPT_SCHEMA
  receipt_id: string
  mission_id: string
  step_id: string | null
  capability: string
  requested_action: string
  authority_result: GovernorVerdict
  started_at: string
  completed_at: string
  success: boolean
  result_summary: string
  evidence_ids: string[]
  side_effect_class: SideEffectClass
  reversible: boolean
  error: string | null
  runtime_identity: string | null
}

export type RoleFulfillment = {
  role: IntelligenceRole
  provider_kind: ProviderKind
  provider_id: string | null
  wrim_eligible: boolean
  wrim_active: false
}

export type IntelligenceRouting = {
  intelligence_class: IntelligenceMissionClass
  ebc_mission_class: EbcMissionClass
  mission_contract: 'none' | 'lightweight' | 'full'
  atlas: boolean
  janus: boolean
  sentinel: boolean
  ebc: boolean
  orion: boolean
  pulsar: boolean
  lumen: boolean
  phoenix: boolean
  aurora: boolean
  knowledge_graph: boolean
  memory_gate: boolean
  self_awareness: boolean
  reason: string
}

export type StructuredRationale = {
  mission_objective: string
  plan_steps: Array<{ step_id: string; title: string; status: PlanStepStatus }>
  evidence: Array<{ evidence_id: string; summary: string }>
  scenario_comparison: Array<{ option: string; reversibility: string }>
  risks: Array<{ risk_id: string; category: SentinelCategory; blocking: boolean }>
  authority_constraints: string[]
  chain_of_thought_exposed: false
}

export type SelfAwarenessSnapshot = {
  install_id: string | null
  runtime_3847: { pid: number | null; process: string | null; last_verified_at: string }
  runtime_3848: { pid: number | null; process: string | null; last_verified_at: string }
  council_state: string
  local_backend_state: string
  general_model: string | null
  providers: Array<{ id: string; healthy: boolean; detail: string }>
  tools_available: string[]
  evidence_board_active: boolean
  mission_id: string | null
  authorized: string[]
  requires_approval: string[]
  last_verified_at: string
  source: 'live_telemetry'
  bounded: boolean
}

export type IntelligenceMetrics = {
  latency_ms: number
  seat_count: number
  tool_calls: number
  model_provider_calls: number
  evidence_count: number
  mission_duration_ms: number
  layers_invoked: string[]
}

export type CouncilIntelligencePublic = {
  schema: typeof INTELLIGENCE_SCHEMA
  mission_id: string
  intelligence_class: IntelligenceMissionClass
  routing: IntelligenceRouting
  contract: MissionContractV1 | null
  plan: AtlasPlanGraph | null
  scenarios: JanusAnalysis | null
  risks: SentinelReview | null
  knowledge: { node_count: number; edge_count: number; current_install: string | null }
  memory: MemoryGateResult | null
  receipts: ExecutionReceipt[]
  governor: GovernorDecision[]
  self_awareness: SelfAwarenessSnapshot | null
  rationale: StructuredRationale | null
  roles: RoleFulfillment[]
  metrics: IntelligenceMetrics
  ebc_truth_spine: true
  orchestration: import('./orchestrationTypes').CouncilOrchestrationPublic | null
  conversational_failure_code?: import('@/lib/council/commander-chat/conversationalAurora').ConversationalFailureCode | null
  conversational_model?: { role: 'AURORA'; provider: string | null; model: string | null; latency_ms: number } | null
}

export type MapEbcClaimStatus = (status: ClaimStatus) => TruthState
export type MapEbcEvidenceKind = (kind: EvidenceKind) => SourceQualityState
export type MapEbcTemporal = (layer: TemporalLayer) => TemporalState

export { type EbcMissionClass, type AuthorityClass, type RiskClass }

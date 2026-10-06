/**
 * Evidence-Board Council (EBC) contracts.
 * Source of truth is the Mission Evidence Board, not chat transcript.
 * Callsigns are routing IDs / functional roles — not backstory.
 */

export const AGENT_ENVELOPE_SCHEMA = 'ebc.agent-envelope.v1' as const
export const MISSION_TELEMETRY_SCHEMA = 'ebc.mission-telemetry.v1' as const
export const EVIDENCE_BOARD_SCHEMA = 'ebc.mission-evidence-board.v1' as const

export const EBC_AGENT_IDS = ['ORION', 'LUMEN', 'PULSAR', 'NOVA', 'PHOENIX', 'AURORA'] as const
export type EbcAgentId = (typeof EBC_AGENT_IDS)[number]

export const EBC_MISSION_CLASSES = [
  'SYSTEM_STATUS',
  'DEEP_RESEARCH',
  'ARCHITECTURE_REVIEW',
  'INCIDENT_RESPONSE',
  'ENGINEERING',
  'CURRENT_INTEL',
  'DOCUMENT_ANALYSIS',
  'SOCIAL_CHECKIN',
] as const
export type EbcMissionClass = (typeof EBC_MISSION_CLASSES)[number]

export const PARTICIPATION_PRESETS = ['focused', 'standard', 'comprehensive'] as const
export type EbcParticipationPreset = (typeof PARTICIPATION_PRESETS)[number]

export const CLAIM_STATUSES = [
  'PROPOSED',
  'SUPPORTED',
  'VERIFIED',
  'UNVERIFIED',
  'CONTRADICTED',
  'STALE',
  'TOOL_BLOCKED',
  'WITHDRAWN',
] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const COMPLETION_STATES = [
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'UNVERIFIED',
  'CONTRADICTED',
  'TOOL_BLOCKED',
  'STALE',
  'BUDGET_EXHAUSTED',
  'REFUSED',
] as const
export type CompletionState = (typeof COMPLETION_STATES)[number]

export const TEMPORAL_LAYERS = ['HISTORICAL', 'LAST_VERIFIED', 'CURRENT_LIVE'] as const
export type TemporalLayer = (typeof TEMPORAL_LAYERS)[number]

export const EVIDENCE_KINDS = [
  'live_telemetry',
  'tool_result',
  'repo_config',
  'logs',
  'primary_external',
  'secondary_external',
  'inference',
  'model_prior',
] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export const EVIDENCE_KIND_RANK: Record<EvidenceKind, number> = {
  live_telemetry: 1,
  tool_result: 2,
  repo_config: 3,
  logs: 4,
  primary_external: 5,
  secondary_external: 6,
  inference: 7,
  model_prior: 8,
}

export const CLAIM_LABELS = ['VERIFIED_FACT', 'INFERENCE', 'RECOMMENDATION'] as const
export type ClaimLabel = (typeof CLAIM_LABELS)[number]

export const NOVELTY_KINDS = [
  'NEW_EVIDENCE',
  'NEW_CLAIM',
  'NEW_CONTRADICTION',
  'NEW_RISK',
  'NEW_TEST',
  'NEW_CAUSAL_EXPLANATION',
  'NEW_STRUCTURE',
  'NEW_QUANT_RESULT',
] as const
export type NoveltyKind = (typeof NOVELTY_KINDS)[number]

export const BOARD_RELATIONS = ['supports', 'contradicts', 'derived_from', 'stale_of', 'supersedes'] as const
export type BoardRelationKind = (typeof BOARD_RELATIONS)[number]

export const LUMEN_VERDICTS = ['SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED', 'UNKNOWN'] as const
export type LumenVerdict = (typeof LUMEN_VERDICTS)[number]

export const PEER_VISIBILITY = ['HIDDEN', 'SEALED', 'BOARD'] as const
export type PeerVisibility = (typeof PEER_VISIBILITY)[number]

export type EvidenceRequirementLayer = 'CURRENT_LIVE' | 'LAST_VERIFIED' | 'NONE'

export type EbcCapability =
  | 'ops_probe'
  | 'verification'
  | 'adversarial_review'
  | 'synthesis'
  | 'live_intel'
  | 'structure'
  | 'planning'
  | 'document_analysis'
  | 'presence'

export type EbcClaim = {
  claim_id: string
  text: string
  status: ClaimStatus
  evidence_ids: string[]
  confidence: number
  label: ClaimLabel
  temporal_layer: TemporalLayer
  critical: boolean
  agent_id: EbcAgentId
  round: number
}

export type EbcEvidence = {
  evidence_id: string
  kind: EvidenceKind
  summary: string
  pointer: string
  source?: string | null
  url?: string | null
  title?: string | null
  final_url?: string | null
  source_type?: 'primary_external' | 'secondary_external' | 'browser_capture' | 'document' | 'tool_result' | null
  worker_id?: string | null
  retrieved_at: string
  observed_at?: string | null
  verified_at?: string | null
  valid_from?: string | null
  valid_to?: string | null
  verification_method?: string | null
  tool_name: string
  ok: boolean
  temporal_layer: TemporalLayer
  hash?: string | null
  content_hash?: string | null
  license_class?: string | null
  args_fingerprint?: string | null
  agent_id: EbcAgentId
  round: number
  stale_reason?: string | null
  supersedes_id?: string | null
  status_code?: number | null
}

export type EbcConflict = {
  conflict_id: string
  claim_ids: string[]
  reason: string
  required_test: string
  contradicting_evidence_ids: string[]
  open: boolean
  agent_id: EbcAgentId
  round: number
}

export type EbcRisk = {
  risk_id: string
  text: string
  claim_ids: string[]
  agent_id: EbcAgentId
}

export type EbcTestRecommended = {
  test_id: string
  text: string
  claim_ids: string[]
  agent_id: EbcAgentId
}

export type EbcUnknown = {
  unknown_id: string
  text: string
  agent_id: EbcAgentId
}

export type NoveltyRecord = {
  adds: NoveltyKind[]
  suppressed: boolean
  reason?: string | null
  similarity?: number | null
}

export type AgentEnvelopeV1 = {
  schema: typeof AGENT_ENVELOPE_SCHEMA
  agent_id: EbcAgentId
  mission_id: string
  mission_class: EbcMissionClass
  round: number
  claims: EbcClaim[]
  evidence: EbcEvidence[]
  contradictions: EbcConflict[]
  risks: EbcRisk[]
  tests_recommended: EbcTestRecommended[]
  unknowns: EbcUnknown[]
  novelty: NoveltyRecord
  omit_reason: string | null
  tools_used: string[]
  tokens_used: number
  latency_ms: number
  peer_visibility: PeerVisibility
  sibling_draft_tokens_seen: number
  prose?: string | null
}

export type EbcTask = {
  task_id: string
  mission_id: string
  owner: EbcAgentId
  objective: string
  tools: string[]
  acceptance: string
  depends_on: string[]
  parallel_group: string
  critical: boolean
}

export type AssemblyPlanV1 = {
  mission_id: string
  mission_class: EbcMissionClass
  selected_agents: EbcAgentId[]
  required_tools: string[]
  optional_tools: string[]
  evidence_requirement: EvidenceRequirementLayer
  ttl_seconds: number
  participation_preset: EbcParticipationPreset
  budget_tokens: number
  budget_ms: number
  phoenix_required: boolean
  aurora_required: boolean
  phoenix_max_hard_passes: number
  max_substantive_rounds: number
  required_capabilities: EbcCapability[]
  uncertainty_flags: string[]
}

export type MissionClassifierOutput = AssemblyPlanV1 & {
  confidence: number
  source: 'deterministic' | 'composed_existing'
  turn_intent: string
  adaptive_kind: string
  astra_intent: string
  llm_classification_used: boolean
}

export type BoardRelation = {
  relation_id: string
  kind: BoardRelationKind
  from_id: string
  to_id: string
  agent_id: EbcAgentId
  round: number
  timestamp: string
}

export type BoardRowProvenance = {
  mission_id: string
  agent_id: EbcAgentId
  round: number
  timestamp: string
  provenance: string
}

export type MissionEvidenceBoard = {
  schema: typeof EVIDENCE_BOARD_SCHEMA
  mission: {
    mission_id: string
    mission_class: EbcMissionClass
    question: string
    agents: EbcAgentId[]
    ttl_seconds: number
    budgets: { tokens: number; ms: number }
    created_at: string
  }
  tasks: Array<EbcTask & BoardRowProvenance>
  evidence: Array<EbcEvidence & BoardRowProvenance>
  claims: Array<EbcClaim & BoardRowProvenance>
  conflicts: Array<EbcConflict & BoardRowProvenance>
  decisions: Array<{ decision_id: string; text: string; advisory: true } & BoardRowProvenance>
  relations: BoardRelation[]
  suppressed: Array<{ envelope: AgentEnvelopeV1; reason: string } & BoardRowProvenance>
  chat_partition_forbidden: true
}

export type BoardSnapshot = {
  mission_id: string
  mission_class: EbcMissionClass
  claims: EbcClaim[]
  evidence: EbcEvidence[]
  conflicts: EbcConflict[]
  unknowns: EbcUnknown[]
  tool_blocks: Array<{ tool_name: string; reason: string; evidence_id?: string }>
  risks: EbcRisk[]
  tests_recommended: EbcTestRecommended[]
}

export type LumenVerification = {
  claim_id: string
  verdict: LumenVerdict
  reason: string
  rechecked_evidence_ids: string[]
  independent_probe: boolean
  independent_corroboration?: boolean
  circular?: boolean
  duplicate_source?: boolean
  wording_similarity_only?: boolean
  evidence_refs?: string[]
  source_count?: number
}

export const PHOENIX_CHALLENGE_TYPES = [
  'CAUSAL_GAP',
  'STALE_EVIDENCE',
  'SINGLE_SOURCE',
  'ASSUMPTION',
  'AUTHORITY_RISK',
  'MISSING_TEST',
  'CONTRADICTION',
  'OVERCONFIDENCE',
] as const
export type PhoenixChallengeType = (typeof PHOENIX_CHALLENGE_TYPES)[number]

export type PhoenixChallenge = {
  claim_id: string
  challenge_type: PhoenixChallengeType
  weakness: string
  why_it_matters: string
  evidence_or_test_needed: string
  resolution_condition: string
}

export type PhoenixPassResult = {
  pass: number
  conflicts: EbcConflict[]
  risks: EbcRisk[]
  tests_recommended: EbcTestRecommended[]
  rhetoric_only: boolean
  successful: boolean
  challenges?: PhoenixChallenge[]
}

export type AuroraSynthesisV1 = {
  mission_class: EbcMissionClass
  completion_state: CompletionState
  confidence: number
  verified_facts: Array<{ text: string; evidence_ids: string[]; temporal_layer: TemporalLayer; claim_id: string }>
  partially_verified: Array<{ text: string; evidence_ids: string[]; claim_id: string }>
  unverified: Array<{ text: string; claim_id: string }>
  conflicts: Array<{ id: string; summary: string; claim_ids: string[] }>
  unknowns: string[]
  tool_blocks: string[]
  risks: string[]
  next_actions: Array<{ action: string; owner: string }>
  advisory: true
  commander_authority: 'REQUIRED_FOR_ACTION'
  degraded?: string[]
}

export type MissionTelemetryV1 = {
  schema: typeof MISSION_TELEMETRY_SCHEMA
  mission_id: string
  mission_class: EbcMissionClass
  agent_count: number
  selected_agents: EbcAgentId[]
  tool_count: number
  tool_fingerprints: string[]
  tokens_per_agent: Record<string, number>
  latency_per_agent: Record<string, number>
  total_latency_ms: number
  completion_state: CompletionState
  claims_count: number
  evidence_count: number
  phoenix_challenges: number
  phoenix_hard_passes: number
  aurora_exclusions: number
  early_stop_reason: string | null
  estimated_cost: number | null
  peer_visibility_round1: PeerVisibility
  sibling_draft_tokens_before_submit: number
  fallback_lineage: Array<{ primary: string; fallback: string; primary_failure: string }>
  unique_source_count?: number
  discovered_source_count?: number
  selected_source_count?: number
  opened_source_count?: number
  usable_source_count?: number
  primary_source_count?: number
  failed_source_count?: number
}

export type ToolCallRecord = {
  tool_name: string
  args_fingerprint: string
  ok: boolean
  blocked: boolean
  denied: boolean
  summary: string
  pointer: string
  url?: string | null
  title?: string | null
  status_code?: number | null
  kind: EvidenceKind
  retrieved_at: string
  temporal_layer: TemporalLayer
  coalesced_from?: string[]
  payload?: unknown
}

export type EbcPublicSourceRow = {
  id: string
  url: string
  title: string
  source_type: string
  primary: boolean
  authoritative: boolean
  published_at: string | null
  observed_at: string | null
  relevance_decision: string
  usable: boolean
}

export type EbcPublicEvidenceRow = {
  id: string
  source_id: string
  claim_ids: string[]
  support_type: string
  usable: boolean
  verification_state: string
}

export type EbcPublicSnapshot = {
  mission_id: string
  mission_class: EbcMissionClass
  selected_agents: EbcAgentId[]
  tasks: Array<{ task_id: string; owner: EbcAgentId; objective: string; tools: string[] }>
  tool_calls: Array<{ tool_name: string; ok: boolean; fingerprint: string }>
  evidence_count: number
  unique_source_count?: number
  discovered_source_count?: number
  selected_source_count?: number
  opened_source_count?: number
  usable_source_count?: number
  primary_source_count?: number
  failed_source_count?: number
  claims_count: number
  lumen: LumenVerification[]
  phoenix_conflicts: EbcConflict[]
  aurora: AuroraSynthesisV1
  completion_state: CompletionState
  confidence: number
  latency_ms: number
  suppressed_contributions: number
  peer_visibility_round1: PeerVisibility
  sources?: EbcPublicSourceRow[]
  evidence?: EbcPublicEvidenceRow[]
  research_domain?: string | null
  freshness_window_days?: number | null
  /** Optional intelligence overlay. Absent on pre-expansion snapshots. EBC remains truth spine. */
  intelligence?: import('@/lib/council/intelligence/types').CouncilIntelligencePublic
  /** Optional ENGINE-01 overlay. Absent on pre-engine snapshots. EBC remains canonical. */
  engines?: import('@/lib/council/engines/integration/ebc').CouncilEnginePublic
  /** Optional recovery-wave transparency. Not a second source store. */
  research_ledger?: import('./evidenceRecovery').ResearchLedger
}

/**
 * What a saved local transcript keeps of a research snapshot: the class, the state and the source rows, not the full board.
 * Readers of a persisted message must tolerate every other field being absent.
 */
export type EbcPublicSnapshotSummary = Partial<Pick<EbcPublicSnapshot, 'mission_class' | 'completion_state' | 'usable_source_count' | 'sources' | 'evidence'>>

export type EbcMissionResult = {
  classification: MissionClassifierOutput
  assembly: AssemblyPlanV1
  board: MissionEvidenceBoard
  envelopes: AgentEnvelopeV1[]
  suppressed: Array<{ envelope: AgentEnvelopeV1; reason: string }>
  lumen: LumenVerification[]
  phoenix: PhoenixPassResult[]
  aurora: AuroraSynthesisV1
  telemetry: MissionTelemetryV1
  snapshot: EbcPublicSnapshot
  commander_brief: string
  /** Process ledger. Absent when no recovery ran. Not an evidence store. */
  research_ledger?: import('./evidenceRecovery').ResearchLedger
  hidden_first_pass: {
    peer_visibility: 'HIDDEN'
    sibling_draft_tokens_before_submit: number
    worker_contexts: Array<{ agent_id: EbcAgentId; task_id: string; saw_sibling_draft: false }>
  }
}

export const POETIC_STATUS_LEXICON = [
  'poised',
  'quiet before the storm',
  'ready and waiting',
  'stands ready',
  'quiet preparation',
  'quiet strength',
  'the war room stands',
  'in quiet',
  'awaiting the call',
  'humming with potential',
] as const

export const FOUNDRY_MUTATION_TOOLS = [
  'foundry.execute',
  'foundry.mutate',
  'git.commit',
  'git.push',
  'deploy.run',
  'installer.install_production',
  'file.write',
  'runtime.transition_to_active',
  'package.run',
  'build.run',
] as const

export const DEFAULT_ECHO_THRESHOLD = 0.92
export const MAX_CLAIM_CHARS_WITHOUT_EVIDENCE = 280
export const MAX_PHOENIX_HARD_PASSES = 2
export const DEFAULT_PHOENIX_HARD_PASSES = 1

/**
 * ENGINE-04 durable contracts.
 * Coordinates around existing execution stack. Does not replace EBC or CouncilExecutive.
 */
export const LONG_HORIZON_MISSION_SCHEMA = 'long-horizon-mission.v1' as const
export const MISSION_CHECKPOINT_SCHEMA = 'mission-checkpoint.v1' as const
export const MEMORY_RETRIEVAL_SCHEMA = 'memory-retrieval.v1' as const
export const TEMPORAL_WORLD_STATE_SCHEMA = 'temporal-world-state.v1' as const
export const ENGINE_04_POLICY_VERSION = 'long-horizon+checkpoint+memory-retrieval+temporal-world.v1' as const

export const MISSION_STATES = [
  'CREATED',
  'PLANNING',
  'READY',
  'RUNNING',
  'WAITING_DEPENDENCY',
  'WAITING_AUTHORITY',
  'WAITING_EXTERNAL',
  'PAUSING',
  'PAUSED',
  'RESUMING',
  'VERIFYING',
  'SYNTHESIZING',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'TOOL_BLOCKED',
  'BUDGET_EXHAUSTED',
  'FAILED',
  'CANCELLED',
] as const
export type MissionState = (typeof MISSION_STATES)[number]

export const TERMINAL_MISSION_STATES: readonly MissionState[] = [
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'TOOL_BLOCKED',
  'BUDGET_EXHAUSTED',
  'FAILED',
  'CANCELLED',
]

export const PHASE_KINDS = ['DISCOVER', 'COLLECT', 'VERIFY', 'SYNTHESIZE', 'WAIT_AUTHORITY', 'FOLLOW_UP', 'RECOVERY'] as const
export type PhaseKind = (typeof PHASE_KINDS)[number]

export type MissionOwners = {
  mission_owner: 'LongHorizonMissionEngine'
  session_owner: 'commander-session'
  ebc_owner: 'EvidenceBoardCouncil'
  checkpoint_owner: 'CheckpointResumeEngine'
  execution_owner: 'LiveExecutionEngine'
}

export type MissionBudgetState = {
  tool_calls_used: number
  tool_calls_max: number
  retry_count: number
  retry_max: number
  wall_ms_used: number
  wall_ms_max: number
  local_model_calls: number
  local_model_max: 1
  external_calls: number
}

export type PendingApproval = {
  approval_id: string
  mission_id: string
  task_id: string
  action: string
  action_fingerprint: string
  authority: 'COMMANDER'
  state: 'PENDING' | 'APPROVED' | 'DECLINED'
  created_at: string
}

export type MissionPhase = {
  phase_id: string
  mission_id: string
  kind: PhaseKind
  objective: string
  dependencies: string[]
  task_refs: string[]
  status: MissionState
  started_at: string | null
  completed_at: string | null
  checkpoint_ref: string | null
  completion_condition: string
  authority_requirement: 'NONE' | 'COMMANDER'
}

export type LongHorizonMission = {
  schema: typeof LONG_HORIZON_MISSION_SCHEMA
  mission_id: string
  parent_mission_id: string | null
  commander_request_id: string | null
  conversation_id: string | null
  session_id: string | null
  mission_type: string
  objective: string
  normalized_objective: string
  created_at: string
  updated_at: string
  started_at: string | null
  paused_at: string | null
  resumed_at: string | null
  completed_at: string | null
  mission_state: MissionState
  completion_state: string | null
  plan_ref: string | null
  ebc_ref: string | null
  ebc_evidence_ids: string[]
  question_graph: { question_id: string; text: string; answer_state: string }[]
  hypotheses: { id: string; statement: string; status: string }[]
  current_phase_id: string | null
  phases: MissionPhase[]
  current_task_ids: string[]
  completed_task_ids: string[]
  blocked_task_ids: string[]
  failed_task_ids: string[]
  cancelled_task_ids: string[]
  completed_dispatch_ids: string[]
  execution_wave_refs: string[]
  checkpoint_refs: string[]
  authority_state: 'NONE' | 'WAITING_AUTHORITY' | 'APPROVED' | 'DECLINED'
  pending_approval_refs: PendingApproval[]
  budget_state: MissionBudgetState
  memory_context_refs: string[]
  temporal_context_refs: string[]
  last_known_runtime: string | null
  runtime_generation: string | null
  resume_cursor: string | null
  failure_state: string | null
  diagnosis_refs: string[]
  terminal_reason: string | null
  plan_snapshot: unknown | null
  grants_authority: false
  ebc_canonical: true
  hidden_cot: false
}

export type MissionCheckpoint = {
  schema: typeof MISSION_CHECKPOINT_SCHEMA
  checkpoint_id: string
  mission_id: string
  parent_checkpoint_id: string | null
  created_at: string
  reason: string
  schema_version: typeof MISSION_CHECKPOINT_SCHEMA
  mission: LongHorizonMission
  resume_cursor: string | null
  runtime_identity: string | null
  integrity_hash: string
  resume_eligible: boolean
  hidden_cot: false
}

export const MEMORY_TYPES = [
  'MISSION_EXPERIENCE',
  'VERIFIED_FACT',
  'SUPPORTED_FACT',
  'HISTORICAL_FACT',
  'PROCEDURE',
  'PLAYBOOK',
  'FAILURE_PATTERN',
  'TOOL_HISTORY',
  'USER_APPROVED_MEMORY',
  'UNVERIFIED_HISTORY',
] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export type MemoryHit = {
  memory_ref: string
  memory_type: MemoryType
  source_mission_id: string
  source_evidence_refs: string[]
  content_summary: string
  relevance: number
  temporal_state: 'CURRENT' | 'HISTORICAL' | 'STALE' | 'SUPERSEDED' | 'TIME_UNKNOWN'
  truth_state: 'VERIFIED' | 'SUPPORTED' | 'UNVERIFIED' | 'UNKNOWN' | 'CONFLICTED'
  confidence_state: 'PROVEN' | 'HYPOTHESIS' | 'UNCERTAIN'
  reason_selected: string
  selected: boolean
}

export type MemoryRetrievalResult = {
  schema: typeof MEMORY_RETRIEVAL_SCHEMA
  mission_id: string
  hits: MemoryHit[]
  retrieved_count: number
  included_count: number
  excluded_count: number
  token_estimate: number
  trains_wrim: false
}

export type TemporalFactRecord = {
  schema: typeof TEMPORAL_WORLD_STATE_SCHEMA
  fact_id: string
  claim_id: string
  entity_ids: string[]
  statement: string
  valid_from: string | null
  valid_to: string | null
  observed_at: string | null
  published_at: string | null
  updated_at: string | null
  source_refs: string[]
  evidence_refs: string[]
  truth_state: 'VERIFIED' | 'SUPPORTED' | 'UNVERIFIED' | 'UNKNOWN'
  freshness_state: 'CURRENT' | 'HISTORICAL' | 'STALE' | 'SUPERSEDED' | 'FUTURE_SCHEDULED' | 'TIME_UNKNOWN'
  supersedes: string | null
  superseded_by: string | null
  temporal_scope: string
  world_state_version: number
}

export type RefreshSignal = 'REFRESH_REQUIRED' | 'FRESH' | 'UNKNOWN'

import type { CaptureExperienceInput } from '@/lib/agi-experience/types'
import type { PromotionState } from '@/lib/wrim1-training/types'
import type { ToolId } from '@/lib/tools/toolRegistry'

export const WRIM0_ID = 'WRIM-0' as const
export const WRIM0_CHECKPOINT_SHA = 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015'
export const WR_TOKENIZER_0_SHA = '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7'

export type RuntimeIdentityKind = 'CORE' | 'CAPABILITY_MODULE' | 'COMPOSED_RUNTIME'

export type CapabilityModuleType = 'LORA' | 'ADAPTER' | 'CLASSIFIER_HEAD' | 'ROUTER_HEAD'

/** Module lifecycle. Maps onto existing promotion states without replacing them. */
export type CapabilityModuleState =
  | 'DESIGN'
  | 'SHADOW'
  | 'CANDIDATE'
  | 'PROMOTED'
  | 'REJECTED'
  | 'ARCHIVED'

export const CAPABILITY_MODULE_STATES: readonly CapabilityModuleState[] = [
  'DESIGN',
  'SHADOW',
  'CANDIDATE',
  'PROMOTED',
  'REJECTED',
  'ARCHIVED',
]

export const LEGAL_MODULE_TRANSITIONS: Record<CapabilityModuleState, CapabilityModuleState[]> = {
  DESIGN: ['SHADOW', 'REJECTED', 'ARCHIVED'],
  SHADOW: ['CANDIDATE', 'REJECTED', 'ARCHIVED'],
  CANDIDATE: ['PROMOTED', 'REJECTED', 'SHADOW'],
  PROMOTED: ['ARCHIVED', 'REJECTED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
}

/**
 * Mapping only — existing WRIM-1 promotion.ts is unchanged.
 * ACTIVE serving is ActiveRuntimeState, not a promotion state.
 */
export const MODULE_STATE_TO_PROMOTION: Record<CapabilityModuleState, PromotionState | null> = {
  DESIGN: 'TRAINING_NOT_STARTED',
  SHADOW: 'EVALUATING',
  CANDIDATE: 'EVALUATED',
  PROMOTED: 'PROMOTED',
  REJECTED: 'PROMOTION_REJECTED',
  ARCHIVED: null,
}

export type ToolDecision = 'TOOL' | 'NO_TOOL'

export type ToolIntentParseStatus = 'PARSED' | 'MALFORMED'

export type ToolValidationCode =
  | 'VALID'
  | 'INVALID_TOOL'
  | 'MISSING_ARGUMENT'
  | 'INVALID_ARGUMENT'
  | 'UNAVAILABLE'
  | 'SCHEMA_INCOMPATIBLE'
  | 'UNKNOWN_ARGUMENT'
  | 'UNVALIDATED'
  | 'INVALID'

export type ToolArgType = 'string' | 'number' | 'boolean' | 'integer'

export type ToolArgumentSchema = {
  name: string
  type: ToolArgType
  required: boolean
}

export type ToolAuthority = 'war_room_tool_registry' | 'agi_gym_bounded' | 'curriculum_synthetic'

export type ToolExecutionProvider =
  | 'war_room_api'
  | 'agi_gym_sha256'
  | 'dry_run'
  | 'mock'
  | 'none'

export type UnifiedToolDefinition = {
  toolId: string
  displayName: string
  enabled: boolean
  available: boolean
  authority: ToolAuthority
  requiresAuth: boolean
  endpoint?: string
  warRoomToolId?: ToolId
  executionProvider: ToolExecutionProvider
  arguments: ToolArgumentSchema[]
  schemaSpecified: boolean
  capabilityMetadata: Record<string, string>
}

export type ToolIntent = {
  decision: ToolDecision
  tool_id: string | null
  arguments: Record<string, string>
  confidence: number | null
  source_model: string
  source_module: string | null
  raw_intent: string
  parse_status: ToolIntentParseStatus
  validation_status: ToolValidationCode
  errors: string[]
}

export type NormalizedToolRequest = {
  tool: string
  arguments: Record<string, string | number | boolean>
}

export type ToolRouterStage = 'parse' | 'validate' | 'normalize' | 'execution_boundary'

export type ToolRouterResult = {
  intent: ToolIntent
  validation: ToolValidationCode
  normalized: NormalizedToolRequest | null
  executed: false
  stageReached: ToolRouterStage
  errors: string[]
}

export type ToolResultStatus = 'ok' | 'error' | 'dry_run' | 'mock' | 'not_executed'

export type ToolResult = {
  tool_id: string
  status: ToolResultStatus
  result: unknown
  error: string | null
  provenance: Record<string, string>
  started_at: string
  completed_at: string
  duration_ms: number
  request_id: string
}

export type CapabilityModuleRecord = {
  capability_id: string
  module_id: string
  version: string
  module_type: CapabilityModuleType
  base_model_id: string
  base_checkpoint_sha: string
  tokenizer_sha: string
  artifact_hash: string | null
  training_dataset_identity: string | null
  held_out_eval_identity: string | null
  status: CapabilityModuleState
  metrics: Record<string, number>
  promotion_history: Array<{ at: string; from: CapabilityModuleState; to: CapabilityModuleState; note: string }>
  compatibility: Record<string, string | number | boolean>
  test_only: boolean
}

export type ActiveRuntimeState = {
  kind: RuntimeIdentityKind
  activeCoreId: string
  activeCoreCheckpointSha: string
  activeModuleIds: string[]
  composedRuntimeId: string
}

export type FailedModulePacket = {
  module_id: string
  status: 'REJECTED'
  active_core_untouched: true
  artifact_preserved: true
  failure_evidence_preserved: true
  eval_deltas_preserved: true
  gradients_or_metrics_preserved: boolean
  forensic_work_item: { title: string; summary: string; auto_promotion: false }
  core_rollback_required: false
}

export type ToolExperienceFields = {
  request: string
  decision: ToolDecision
  selected_tool: string | null
  arguments: Record<string, string>
  tool_result: unknown
  success: boolean
  correction: string | null
  provenance: Record<string, string>
  capability_family: string
}

export type CurriculumStage =
  | 'runtime_experience'
  | 'evidence_validation'
  | 'capability_curriculum_candidate'
  | 'adapter_training_dataset'
  | 'clean_heldout_eval'
  | 'shadow_adapter_training'
  | 'evaluation'
  | 'candidate'
  | 'commander_promotion_decision'

export type ExperienceCaptureHook = CaptureExperienceInput & {
  toolExperience?: ToolExperienceFields
}

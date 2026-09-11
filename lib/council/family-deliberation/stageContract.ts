import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type {
  DeliberationCompletionStatus,
  DeliberationTurn,
  DeliberationTurnRole,
} from './types'

/**
 * Single internal deliberation stage contract for family_to_family_v1.
 * Reuses existing DeliberationTurnRole ids — no duplicate stage enum.
 *
 * opening_position remains a dormant compatibility role: default primary
 * execution uses direct_response. Do not add a redundant opening call.
 */
export type DeliberationStageId = DeliberationTurnRole

export type DeliberationPipelineOutcome = 'COMPLETE' | 'DEGRADED' | 'FAILED'

export type DeliberationStageProgressCode =
  | 'PRIMARY_STARTED'
  | 'PRIMARY_COMPLETED'
  | 'RED_TEAM_STARTED'
  | 'RED_TEAM_COMPLETED'
  | 'REVISION_STARTED'
  | 'REVISION_COMPLETED'
  | 'SYNTHESIS_STARTED'
  | 'SYNTHESIS_COMPLETED'
  | 'DELIBERATION_DEGRADED'
  | 'DELIBERATION_COMPLETED'
  | 'DELIBERATION_FAILED'

export type DeliberationStageStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'skipped'
  | 'degraded'

export type DeliberationStageRecord = {
  stage_id: DeliberationStageId
  status: DeliberationStageStatus
  participating_seats: CouncilOrchestrationFamily[]
  input_evidence_ids: string[]
  prior_turn_ids: string[]
  challenge_turn_ids: string[]
  revision_target_turn_ids: string[]
  result_turn_ids: string[]
  failure_reason: string | null
  provider_runtime_truth: Array<{
    seat: CouncilOrchestrationFamily
    provider_label: string
    provider_model: string | null
    backend_type: 'LOCAL' | 'EXTERNAL' | null
    backend_provider: string | null
    backend_runtime: string | null
    completion_status: DeliberationCompletionStatus
  }>
  started_at: string | null
  completed_at: string | null
}

export type DeliberationPipelineProvenance = {
  schema_version: '16.deliberation-pipeline.v1'
  stages_executed: DeliberationStageRecord[]
  outcome: DeliberationPipelineOutcome
  opening_position_policy: 'dormant_compatibility'
  continuation_policy: 'deferred_to_17'
  authoritative_turn_ids: string[]
  challenge_linkage: Array<{ challenge_turn_id: string; target_turn_ids: string[] }>
  revision_linkage: Array<{
    revision_turn_id: string
    original_turn_id: string | null
    decision: string | null
  }>
  synthesis_turn_id: string | null
  failed_seats: CouncilOrchestrationFamily[]
  evidence_ids: string[]
}

export const DEFAULT_FAMILY_DELIBERATION_SEQUENCE: readonly DeliberationStageId[] = [
  'direct_response',
  'red_team_challenge',
  'revision_or_stand_firm',
  'council_synthesis',
] as const

export const OPENING_POSITION_POLICY =
  'dormant_compatibility' as const

export const CONTINUATION_POLICY =
  'deferred_to_17' as const

export function progressCodeForStage(
  stage: DeliberationStageId,
  phase: 'started' | 'completed',
): DeliberationStageProgressCode | null {
  if (stage === 'direct_response' || stage === 'opening_position') {
    return phase === 'started' ? 'PRIMARY_STARTED' : 'PRIMARY_COMPLETED'
  }
  if (stage === 'red_team_challenge') {
    return phase === 'started' ? 'RED_TEAM_STARTED' : 'RED_TEAM_COMPLETED'
  }
  if (stage === 'revision_or_stand_firm') {
    return phase === 'started' ? 'REVISION_STARTED' : 'REVISION_COMPLETED'
  }
  if (stage === 'council_synthesis') {
    return phase === 'started' ? 'SYNTHESIS_STARTED' : 'SYNTHESIS_COMPLETED'
  }
  return null
}

export function createEmptyStageRecord(
  stageId: DeliberationStageId,
  seats: CouncilOrchestrationFamily[],
  evidenceIds: string[],
): DeliberationStageRecord {
  return {
    stage_id: stageId,
    status: 'pending',
    participating_seats: [...seats],
    input_evidence_ids: [...evidenceIds],
    prior_turn_ids: [],
    challenge_turn_ids: [],
    revision_target_turn_ids: [],
    result_turn_ids: [],
    failure_reason: null,
    provider_runtime_truth: [],
    started_at: null,
    completed_at: null,
  }
}

export function runtimeTruthFromTurn(turn: DeliberationTurn): DeliberationStageRecord['provider_runtime_truth'][number] {
  return {
    seat: turn.provider_family,
    provider_label: turn.provider_label,
    provider_model: turn.provider_model,
    backend_type: turn.backend_type ?? null,
    backend_provider: turn.backend_provider ?? null,
    backend_runtime: turn.backend_runtime ?? null,
    completion_status: turn.completion_status,
  }
}

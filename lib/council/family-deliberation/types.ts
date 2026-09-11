import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DeliberationPipelineProvenance } from './stageContract'

export type DeliberationTurnRole =
  | 'opening_position'
  | 'direct_response'
  | 'red_team_challenge'
  | 'revision_or_stand_firm'
  | 'council_synthesis'

export type DeliberationCompletionStatus =
  | 'complete'
  | 'failed'
  | 'timed_out'
  | 'unavailable'
  | 'unresolved'

export type DeliberationClaimLabel = 'evidence_backed' | 'model_judgment' | 'unresolved'

export type DeliberationEvidenceReference = {
  evidence_reference_id: string
  label: string
  source_kind: string
  url: string | null
  origin_type?: string
}

export type DeliberationClaim = {
  claim_id: string
  text: string
  label: DeliberationClaimLabel
  evidence_reference_ids: string[]
}

export type DeliberationTurn = {
  turn_id: string
  session_id: string
  round_id: string
  commander_turn_id: string
  mission_id: string
  mission_version: number
  provider_family: CouncilOrchestrationFamily
  provider_label: string
  provider_model: string | null
  turn_role: DeliberationTurnRole
  speaking_order: number
  input_message_ids: string[]
  evidence_reference_ids: string[]
  challenge_target_ids: string[]
  revision_of_message_id: string | null
  output_message_id: string | null
  completion_status: DeliberationCompletionStatus
  started_at: string
  completed_at: string | null
  failure_reason: string | null
  executive_position: string
  full_response: string
  claims: DeliberationClaim[]
  direct_agreements: string[]
  direct_disagreements: string[]
  risks_or_limitations: string[]
  confidence: number | null
  recommended_action: string
  revision_status: 'not_revision' | 'revised' | 'stood_firm' | 'invalid_revision'
  /** Structured revision decision when stage is revision_or_stand_firm. */
  revision_decision?: 'REVISE' | 'STAND_FIRM' | null
  challenge_addressed?: 'yes' | 'no' | 'partial' | null
  revision_decision_source?: 'structured' | 'heuristic' | 'none' | null
  evidence_ids_used?: string[]
  unsupported_claim_warnings?: string[]
  agent_identity?: string | null
  backend_type?: 'LOCAL' | 'EXTERNAL' | null
  backend_provider?: string | null
  backend_runtime?: string | null
  fallback_from?: 'LOCAL' | 'EXTERNAL' | null
  error_code?: string | null
}

export type DeliberationSession = {
  schema_version: '48c3a.family-deliberation.v1'
  session_id: string
  round_id: string
  commander_turn_id: string
  mission_id: string
  mission_version: number
  commander_message_id: string
  commander_message: string
  evidence_references: DeliberationEvidenceReference[]
  turns: DeliberationTurn[]
  synthesis_turn_id: string | null
  completion_status: 'complete' | 'partial' | 'failed'
  provider_boundaries: string[]
  diagnostics: string[]
  /** #16 deliberation pipeline provenance — persisted via existing conversation payload. */
  pipeline?: DeliberationPipelineProvenance
  scout_swarm?: import('@/lib/council/scout-swarm/types').ScoutSwarmPublicMeta
}

export type DeliberationProviderResult = {
  family: CouncilOrchestrationFamily
  providerLabel: string
  providerModel: string | null
  content: string
  status: DeliberationCompletionStatus
  failureReason?: string | null
  backendType?: 'LOCAL' | 'EXTERNAL' | null
  backendProvider?: string | null
  backendRuntime?: string | null
  fallbackFrom?: 'LOCAL' | 'EXTERNAL' | null
  errorCode?: string | null
}

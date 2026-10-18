/**
 * #22 Phase 14 — Canonical handoff + workflow contracts.
 * Supports ASTRA / existing agents. Not a second control plane.
 */
import type { PolicyAuthorityLevel, TechnicalReachLevel } from '@/lib/agent-capability-matrix/types'

export const INTEGRATION_ACTORS = [
  'COMMANDER',
  'ASTRA',
  'COUNCIL',
  'TERRA',
  'RESEARCH_AGENT',
  'WORLD_LEARNING_AGENT',
  'DATA_CORPUS_AGENT',
  'TERRA_INTELLIGENCE_AGENT',
  'NAVIGATION_AGENT',
  'OPERATIONS_AGENT',
  'SECURITY_RED_TEAM_AGENT',
  'ENGINEERING_AGENT',
  'COUNCIL_VALIDATOR',
] as const
export type IntegrationActor = (typeof INTEGRATION_ACTORS)[number]

export const INTEGRATION_FAILURE_CODES = [
  'AGENT_DISABLED',
  'AUTHORITY_DENIED',
  'OWNER_MISMATCH',
  'EVIDENCE_INSUFFICIENT',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'VALIDATION_FAILED',
  'HANDOFF_EXPIRED',
  'MISSION_PARTIAL',
  'HANDOFF_LIMIT_EXCEEDED',
  'STEP_LIMIT_EXCEEDED',
  'REVISION_LIMIT_EXCEEDED',
  'AGENT_SPAWN_DENIED',
  'CROSS_USER_DENIED',
  'OWNER_REQUIRED',
  'FORBIDDEN_ACTION',
  'SQL_APPLY_DENIED',
  'PHASE58A_APPLY_DENIED',
] as const
export type IntegrationFailureCode = (typeof INTEGRATION_FAILURE_CODES)[number]

export const CORPUS_CANDIDATE_REVIEW_STATES = [
  'PROPOSED',
  'CURATED',
  'REQUIRES_REVIEW',
  'REJECTED',
  'APPROVED_FOR_FUTURE_CORPUS',
  'SUPERSEDED',
] as const
export type CorpusCandidateReviewState = (typeof CORPUS_CANDIDATE_REVIEW_STATES)[number]

export const FORBIDDEN_CANDIDATE_STATES = ['TRAINED', 'WR-CORPUS', 'WR_CORPUS', 'PRODUCTION'] as const

export const INTEGRATION_WORKFLOW_KINDS = [
  'KNOWLEDGE_PIPELINE',
  'WORLD_STATE_PIPELINE',
  'ENGINEERING_SAFETY_PIPELINE',
  'ASTRA_MULTI_AGENT_MISSION',
  'OFFLINE_LOCAL_WORKFLOW',
  'VALIDATOR_REVISION_LOOP',
] as const
export type IntegrationWorkflowKind = (typeof INTEGRATION_WORKFLOW_KINDS)[number]

export const HANDOFF_TASK_TYPES = [
  'RESEARCH_EVIDENCE',
  'WORLD_LEARNING_INTERPRETATION',
  'CORPUS_CANDIDATE',
  'TERRA_WORLD_STATE',
  'NAVIGATION_ROUTE',
  'NAVIGATION_COUNCIL_PACKET',
  'OPERATIONS_OBSERVATION',
  'SECURITY_EVALUATION',
  'ENGINEERING_RECOMMENDATION',
  'COUNCIL_SYNTHESIS',
  'VALIDATOR_RESULT',
  'ASTRA_MISSION_STEP',
] as const
export type HandoffTaskType = (typeof HANDOFF_TASK_TYPES)[number]

export type CanonicalHandoffEnvelope = {
  handoff_id: string
  mission_id: string | null
  source_actor: IntegrationActor
  target_actor: IntegrationActor
  owner_user_id: string
  session_id: string | null
  conversation_id: string | null
  task_type: HandoffTaskType
  input_reference: string | null
  evidence_ids: string[]
  provenance: {
    source_urls: string[]
    source_agents: IntegrationActor[]
    parent_handoff_id: string | null
  }
  runtime_truth: Record<string, string | boolean | number | null>
  authority_scope: {
    source_authority: PolicyAuthorityLevel
    target_authority: PolicyAuthorityLevel
    commander_authorized_scope: PolicyAuthorityLevel
    source_reach: TechnicalReachLevel
    target_reach: TechnicalReachLevel
  }
  approval_state: 'NOT_APPROVED' | 'ADVISORY' | 'COMMANDER_EXPLICIT'
  created_at: string
  expires_at: string | null
}

export type AuditRef = {
  kind: 'mission' | 'handoff' | 'agent_invocation' | 'result' | 'validation' | 'candidate_disposition'
  id: string | null
}

export type ProvenanceStage = {
  stage: string
  refs: string[]
}

export const VALIDATOR_OUTCOMES = [
  'VALIDATED',
  'REVISION_REQUIRED',
  'DISPUTED',
  'INSUFFICIENT_EVIDENCE',
] as const
export type ValidatorOutcome = (typeof VALIDATOR_OUTCOMES)[number]

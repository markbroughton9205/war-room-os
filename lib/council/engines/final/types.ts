/**
 * Council final-program contracts (05P–12).
 * Views and governors over existing engines. Not a second Council or EBC.
 */
import type { EngineReceipt } from '../types'

export type MeasurementState = 'MEASURED' | 'PARTIALLY_MEASURED' | 'UNMEASURED'

export type LiveEmpiricalObservation = {
  observation_id: string
  mission_id: string
  task_id: string
  task_class: string
  policy_version: string
  provider: string | null
  model: string | null
  started_at: string
  completed_at: string
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  context_tokens: number | null
  tool_calls: number
  retry_count: number
  cost_amount: number | null
  cost_currency: string | null
  cost_source: string | null
  completion_state: string
  verification_state: string
  calibration_state: string
  authority_compliant: boolean
  failure_state: string
  evidence_refs: string[]
  receipt_refs: string[]
  measurement_state: MeasurementState
  invented_cost: false
  invented_tokens: false
}

export type LiveTrialStatus = 'DRAFT' | 'WAITING_COMMANDER' | 'APPROVED' | 'RUNNING' | 'PAUSED' | 'COMPLETE' | 'FAILED' | 'CANCELLED'

export type LivePolicyTrial = {
  trial_id: string
  candidate_policy: string
  control_policy: string
  scope: 'SHADOW' | 'BOUNDED_LIVE_TRIAL'
  task_classes: string[]
  max_missions: number
  max_duration_ms: number
  authority_scope: string[]
  rollback_policy: string
  held_out_set: string[]
  development_set: string[]
  status: LiveTrialStatus
  grants_authority: false
  auto_promoted: false
  approval_fingerprint: string | null
  result: 'SUPPORTED' | 'INCONCLUSIVE' | 'REJECTED' | 'PENDING'
}

export type EntityType =
  | 'PERSON' | 'ORGANIZATION' | 'COMPANY' | 'GOVERNMENT_BODY' | 'LOCATION'
  | 'DEVICE' | 'SOFTWARE' | 'MODEL' | 'PROVIDER' | 'DOCUMENT' | 'POLICY'
  | 'LAW' | 'EVENT' | 'MISSION' | 'ASSET' | 'SYSTEM' | 'OTHER'

export type WorldEntity = {
  entity_id: string
  canonical_name: string
  entity_type: EntityType
  aliases: string[]
  identifiers: Record<string, string>
  source_refs: string[]
  first_seen: string
  last_seen: string
  current_state: string
  temporal_state: 'CURRENT' | 'HISTORICAL' | 'SUPERSEDED' | 'STALE' | 'TIME_UNKNOWN'
}

export type EntityResolution = 'SAME_ENTITY' | 'DISTINCT_ENTITY' | 'POSSIBLE_MATCH' | 'UNRESOLVED'

export type WorldRelationKind =
  | 'OWNS' | 'OPERATES' | 'LOCATED_AT' | 'DEPENDS_ON' | 'USES' | 'SUPPORTS'
  | 'CONTRADICTS' | 'SUPERSEDES' | 'PRODUCED_BY' | 'MEMBER_OF' | 'GOVERNS'
  | 'AFFECTS' | 'CAUSES' | 'CORRELATES_WITH' | 'PRECEDES' | 'FOLLOWS' | 'DERIVED_FROM'

export type WorldRelation = {
  relation_id: string
  kind: WorldRelationKind
  from_id: string
  to_id: string
  provenance: string[]
  temporal_state: WorldEntity['temporal_state']
}

export type WorldEvent = {
  event_id: string
  type: string
  entities: string[]
  location: string | null
  occurred_at: string | null
  observed_at: string
  source_refs: string[]
  evidence_refs: string[]
  truth_state: string
  temporal_state: WorldEntity['temporal_state']
}

export type CausalState = 'OBSERVED_ASSOCIATION' | 'PLAUSIBLE_CAUSAL' | 'SUPPORTED_CAUSAL' | 'CONTESTED' | 'INSUFFICIENT'

export type CausalClaim = {
  cause: string
  effect: string
  mechanism: string | null
  evidence_refs: string[]
  alternative_causes: string[]
  confounders: string[]
  temporal_order: boolean
  causal_state: CausalState
  historical_fact: false
}

export type WorldStateSnapshot = {
  snapshot_id: string
  at: string
  entities: WorldEntity[]
  relations: WorldRelation[]
  events: WorldEvent[]
  current_verified_facts: string[]
  historical_facts: string[]
  open_conflicts: string[]
  unknowns: string[]
  active_hypotheses: string[]
  ebc_canonical: true
}

export type ConflictKind =
  | 'FACT_CONFLICT'
  | 'INTERPRETATION_CONFLICT'
  | 'TEMPORAL_CONFLICT'
  | 'VALUE_TRADEOFF'
  | 'RISK_TRADEOFF'
  | 'MISSING_EVIDENCE'

export type CouncilPosition = {
  position_id: string
  role: string
  claim: string
  supporting_evidence_refs: string[]
  contradicting_evidence_refs: string[]
  assumptions: string[]
  uncertainties: string[]
  confidence_state: string
  hidden_cot: false
}

export type DeliberationCase = {
  question: string
  mission_id: string
  evidence_refs: string[]
  hypotheses: string[]
  decision_constraints: string[]
  authority_constraints: string[]
  required_roles: string[]
  budget: number
  stop_condition: string
}

export type DeliberationResult = {
  case: DeliberationCase
  positions: CouncilPosition[]
  conflict_kind: ConflictKind
  adjudication: string
  minority_evidence_wins: boolean
  majority_is_truth: false
  stop_reason: string
  aurora_synthesis: string
  invented_consensus: false
  decision_quality: {
    evidence_coverage: number
    conflict_resolution: string
    unknowns_surfaced: string[]
    risk_completeness: string
    scenario_coverage: string
    authority_compliance: boolean
    opaque_wisdom_score: false
  }
  grants_authority: false
  receipt: EngineReceipt
}

export type PortfolioStatus = 'active' | 'paused' | 'waiting_authority' | 'waiting_external' | 'scheduled' | 'completed' | 'cancelled'

export type PortfolioEntry = {
  mission_id: string
  status: PortfolioStatus
  commander_priority: number
  deadline: string | null
  resource_class: string
  depends_on: string[]
}

export type ProposedMission = {
  proposed_id: string
  reason: string
  grants_authority: false
  is_commander_goal: false
  requires_approval: true
}

export type WatchStatus = 'DRAFT' | 'WAITING_COMMANDER' | 'APPROVED' | 'ACTIVE' | 'DISABLED' | 'EXPIRED'

export type WatchCondition = {
  watch_id: string
  objective: string
  entities: string[]
  condition: string
  data_source: string
  frequency: string
  freshness_requirement: string
  severity_policy: string
  notification_policy: string
  authority_scope: string[]
  status: WatchStatus
  commander_approved: boolean
  secret: false
}

export type AlertMateriality = 'INFO' | 'NOTICE' | 'IMPORTANT' | 'URGENT'

export type ChangeAlert = {
  alert_id: string
  watch_id: string
  what_changed: string
  when: string
  evidence: string[]
  freshness: string
  why_it_matters: string
  uncertainty: string
  materiality: AlertMateriality
  duplicate_of: string | null
  authorizes_action: false
}

export type TrustClass =
  | 'COMMANDER_INSTRUCTION'
  | 'SYSTEM_POLICY'
  | 'INTERNAL_RECEIPT'
  | 'TOOL_RESULT'
  | 'PRIMARY_EXTERNAL'
  | 'SECONDARY_EXTERNAL'
  | 'UNTRUSTED_EXTERNAL'
  | 'MEMORY'
  | 'MODEL_OUTPUT'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED' | 'SUPERSEDED' | 'CANCELLED'

export type ApprovalRequest = {
  request_id: string
  mission_id: string
  task_id: string
  action: string
  action_fingerprint: string
  risk_class: string
  requested_authority: string
  expiration: string
  status: ApprovalStatus
  scope: 'ONE_ACTION' | 'ONE_TASK' | 'ONE_MISSION'
  text_claiming_approval: false
}

export type CapabilityManifestRow = {
  capability_id: string
  health: string
  approval_required: boolean
  unavailable: boolean
  read_only: boolean
  experimental: boolean
  claimed: boolean
  present_in_registry: true
}

export type GraduationCell = 'PROVEN' | 'PARTIAL' | 'UNAVAILABLE' | 'EXPERIMENTAL'

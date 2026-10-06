import type { StopConditionState } from '../types'
import type { EngineReceipt } from '../types'

export type ToolHealth = 'READY' | 'DEGRADED' | 'DEAD' | 'UNAUTHENTICATED' | 'RATE_LIMITED' | 'MISCONFIGURED' | 'UNKNOWN'
export type PrivacyClass = 'NONE' | 'LOCAL' | 'EXTERNAL_READ' | 'SECRET_ACCESS'
export type FailureClass = 'TRANSIENT' | 'DETERMINISTIC' | 'AUTHORITY' | 'NONE'
export type InformationGain = 'HIGH' | 'MED' | 'LOW' | 'NONE'

export type ToolCandidate = {
  tool_id: string
  capability: string
  provider: string
  availability: boolean
  health: ToolHealth
  authority_required: boolean
  expected_information_gain: InformationGain
  expected_latency: 'LOW' | 'MED' | 'HIGH'
  expected_cost: 'LOW' | 'MED' | 'HIGH'
  freshness_value: 'CURRENT' | 'STALE' | 'UNKNOWN'
  reliability: number
  privacy_class: PrivacyClass
  failure_history: string[]
  duplicate_information_risk: boolean
  selection_reason: string
  economics: {
    expected_information_gain: InformationGain
    latency: 'LOW' | 'MED' | 'HIGH'
    cost: 'LOW' | 'MED' | 'HIGH'
    reliability: number
    freshness: 'CURRENT' | 'STALE' | 'UNKNOWN'
    privacy: PrivacyClass
    authority: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY'
  }
}

export type ToolSelectionInput = {
  mission_id: string
  task_id?: string
  objective: string
  evidence_requirement?: string
  remaining_evidence_gap?: readonly string[]
  available_tools: readonly string[]
  tool_health?: Readonly<Record<string, ToolHealth>>
  tool_capabilities?: Readonly<Record<string, string>>
  authority_constraints?: { commit?: boolean; push?: boolean; production_deploy?: boolean; commander_override?: boolean }
  latency_budget?: 'LOW' | 'MED' | 'HIGH'
  cost_budget?: 'LOW' | 'MED' | 'HIGH' | 'EXHAUSTED'
  privacy_constraints?: PrivacyClass[]
  freshness_requirement?: boolean
  previous_attempts?: readonly { tool_id: string; failure_class: FailureClass; error?: string }[]
  known_failures?: readonly string[]
  expected_information_gain_hint?: 'high' | 'moderate' | 'low' | 'none'
  stop_condition_state?: StopConditionState
  ebc_satisfied?: boolean
  current_verified_memory?: boolean
  stale_freshness_gap?: boolean
}

export type ToolSelectionDecision = {
  selected_tool: string | null
  decision: 'SELECT' | 'NO_TOOL_REQUIRED' | 'TOOL_BLOCKED'
  alternate_tools: string[]
  reason: string
  evidence_gap_targeted: string[]
  expected_information_gain: InformationGain
  budget_allocation: { latency: string; cost: string }
  fallback_policy: string
  stop_after_success: boolean
  retry: { allowed: boolean; remaining: number; failure_class: FailureClass }
  avoid: Array<{ tool_id: string; avoid_reason: string }>
  candidates: ToolCandidate[]
  receipt: EngineReceipt
}

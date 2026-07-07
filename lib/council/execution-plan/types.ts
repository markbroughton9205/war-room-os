import type { BrainRecommendation } from '../brain-selection'
import type { RoutingNote } from '../routing'

export type ExecutionActionType =
  | 'classify'
  | 'gather_context'
  | 'reason'
  | 'draft'
  | 'critique'
  | 'synthesize'
  | 'ask_clarification'
  | 'propose_action'
  | 'await_approval'

export type ExecutionRiskLevel = 'low' | 'medium' | 'high'

export type ExecutionStepStatus = 'planned' | 'blocked' | 'not_executed'

export type ExpectedInputSource =
  | 'commander_message'
  | 'routing_note'
  | 'brain_recommendation'
  | 'future_context'
  | 'operator_approval'

export type SafetyCheckStatus = 'pass' | 'blocked' | 'requires_approval'

export type EstimatedCostClass = 'none' | 'low' | 'medium' | 'high'

export type EstimatedLatencyClass = 'instant' | 'fast' | 'normal' | 'slow'

export type FallbackStrategy =
  | 'ask_clarification'
  | 'await_approval'
  | 'static_template_only'
  | 'local_only'
  | 'defer_execution'
  | 'route_to_skeptic'
  | 'no_action'

export type ExecutionStep = {
  stepId: string
  label: string
  ownerEntityId: string | null
  skillId: string | null
  brainCandidateId: string | null
  actionType: ExecutionActionType
  description: string
  requiresApproval: boolean
  riskLevel: ExecutionRiskLevel
  status: ExecutionStepStatus
}

export type ExpectedInput = {
  inputId: string
  label: string
  required: boolean
  source: ExpectedInputSource
}

export type ExpectedOutput = {
  outputId: string
  label: string
  description: string
  producedByStepId: string | null
}

export type SafetyCheck = {
  checkId: string
  label: string
  status: SafetyCheckStatus
  reason: string
}

export type FallbackPlan = {
  fallbackPlanId: string
  reason: string
  strategy: FallbackStrategy
  steps: string[]
}

export type ExecutionPlan = {
  executionPlanId: string
  routingId: string
  recommendationId: string
  commanderMessage: string
  intent: string
  selectedSkillIds: string[]
  selectedEntityIds: string[]
  recommendedBrainCandidateIds: string[]
  selectedBrainCandidateId: string | null
  approvalRequired: boolean
  blockedReason: string | null
  executionAllowed: false
  executionMode: 'dry_run'
  executionSteps: ExecutionStep[]
  expectedInputs: ExpectedInput[]
  expectedOutputs: ExpectedOutput[]
  safetyChecks: SafetyCheck[]
  estimatedCostClass: EstimatedCostClass
  estimatedLatencyClass: EstimatedLatencyClass
  fallbackPlan: FallbackPlan
  decisionPath: string[]
  createdAt: string
}

export type CouncilExecutionPlanInput = {
  commanderMessage: string
  routingNote: RoutingNote
  brainRecommendation: BrainRecommendation
  createdAt?: string
  executionPlanId?: string
}

export type BehaviorValidationResult = {
  commanderInput: string
  expectedIntent?: string
  observedIntent?: string
  expectedEntities?: string[]
  observedEntities?: string[]
  expectedSkills?: string[]
  observedSkills?: string[]
  expectedApproval?: boolean
  observedApproval?: boolean
  expectedExecutionAllowed: false
  observedExecutionAllowed: false
  expectedBlocked?: boolean
  observedBlocked?: boolean
  result: 'PASS' | 'FAIL'
  notes: string[]
}

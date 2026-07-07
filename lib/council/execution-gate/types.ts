import type { ExecutionPlan } from '../execution-plan'

export type ApprovalState =
  | 'not_required'
  | 'required'
  | 'blocked'
  | 'approved_preview_only'

export type GateState =
  | 'preview_only'
  | 'approval_required'
  | 'blocked'
  | 'unsupported'

export type BlockedExecutionType =
  | 'provider_call'
  | 'tool_call'
  | 'database_mutation'
  | 'repo_mutation'
  | 'message_send'
  | 'payment_action'
  | 'deployment_action'
  | 'live_research'
  | 'memory_write'
  | 'external_side_effect'
  | 'auto_mode_action'

export type RequiredApproval =
  | 'commander_approval'
  | 'security_review'
  | 'cost_approval'
  | 'privacy_review'
  | 'execution_not_supported'

export type ExecutionMode =
  | 'manual'
  | 'preview_only'
  | 'approval_required'
  | 'auto_disabled'

export type AutoActionType =
  | 'provider_call'
  | 'tool_call'
  | 'database_mutation'
  | 'repo_mutation'
  | 'message_send'
  | 'payment_action'
  | 'deployment_action'
  | 'live_research'
  | 'memory_write'
  | 'external_side_effect'

export type AutoModePolicy = {
  autoModeSupported: true
  autoModeEnabled: false
  autoEligible: boolean
  autoEligibilityReason: string | null
  autoBlockedReason: string | null
  requiredApprovalBeforeAuto: boolean
  allowedAutoActionTypes: []
  blockedAutoActionTypes: AutoActionType[]
  decisionPath: string[]
}

export type ExecutionGateDecision = {
  gateDecisionId: string
  executionPlanId: string
  gateState: GateState
  executionAllowed: false
  liveExecutionEnabled: false
  blockedExecutionTypes: BlockedExecutionType[]
  requiredApprovals: RequiredApproval[]
  reason: string
  decisionPath: string[]
}

export type ApprovedNextAction = {
  actionId: string
  label: string
  actionType:
    | 'show_preview'
    | 'ask_clarification'
    | 'request_operator_approval'
    | 'copy_work_packet'
    | 'copy_validation_prompt'
    | 'queue_for_future_execution'
    | 'explain_blocked_action'
  description: string
  requiresHumanApproval: boolean
}

export type BlockedAction = {
  actionId: string
  label: string
  blockedExecutionType: BlockedExecutionType
  blockedReason: string
  requiredApprovalType: RequiredApproval
}

export type ApprovedExecutionPreview = {
  previewId: string
  executionPlanId: string
  routingId: string
  recommendationId: string
  commanderMessage: string
  approvalState: ApprovalState
  approvalRequired: boolean
  approvalReason: string | null
  executionGateDecision: ExecutionGateDecision
  autoModePolicy: AutoModePolicy
  allowedNextActions: ApprovedNextAction[]
  blockedActions: BlockedAction[]
  previewSummary: string
  operatorInstructions: string[]
  executionAllowed: false
  liveExecutionEnabled: false
  decisionPath: string[]
  createdAt: string
}

export type ExecutionGateInput = {
  executionPlan: ExecutionPlan
  createdAt?: string
  previewId?: string
}

export type GateBehaviorValidationResult = {
  commanderInput: string
  expectedBlockedTypes: BlockedExecutionType[]
  observedBlockedTypes: BlockedExecutionType[]
  expectedApprovalRequired?: boolean
  observedApprovalRequired: boolean
  expectedAutoModeEnabled: false
  observedAutoModeEnabled: false
  expectedExecutionAllowed: false
  observedExecutionAllowed: false
  expectedLiveExecutionEnabled: false
  observedLiveExecutionEnabled: false
  result: 'PASS' | 'FAIL'
  notes: string[]
}

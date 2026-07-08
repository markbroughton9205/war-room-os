import type { ExecutionPlan } from '../execution-plan'
import type { ApprovedExecutionPreview } from '../execution-gate'

export const EXPLICIT_EXECUTION_APPROVAL_TEXT =
  'I APPROVE THIS SINGLE PROVIDER CALL' as const

export const FAKE_PROVIDER_FAMILY = 'fake' as const
export const FAKE_PROVIDER_ID = 'fake-approved-provider' as const
export const FAKE_MODEL_ID = 'fake-contained-model' as const

export type ApprovedCallActionType = 'single_provider_call'
export type ApprovalScopeActionType = 'provider_call'
export type ApprovedBy = 'commander'
export type FakeProviderFamily = typeof FAKE_PROVIDER_FAMILY
export type FakeProviderId = typeof FAKE_PROVIDER_ID
export type FakeModelId = typeof FAKE_MODEL_ID

export type ProviderCallStatus =
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'timed_out'
  | 'invalid_output'

export type ApprovalVerificationFailureReason =
  | 'missing_approval'
  | 'wrong_approval_text'
  | 'wrong_approval_type'
  | 'wrong_approver'
  | 'expired_approval'
  | 'approval_already_consumed'
  | 'execution_plan_mismatch'
  | 'preview_mismatch'
  | 'provider_candidate_mismatch'
  | 'execution_step_mismatch'
  | 'action_type_mismatch'

export type ExplicitExecutionApprovalScope = {
  allowedProviderCandidateId: string
  allowedExecutionStepId: string
  allowedActionType: ApprovalScopeActionType
}

export type ExplicitExecutionApproval = {
  approvalId: string
  executionPlanId: string
  previewId: string
  approvalType: 'single_provider_call'
  approvalText: typeof EXPLICIT_EXECUTION_APPROVAL_TEXT
  approvedBy: ApprovedBy
  approvedAt: string
  expiresAt: string
  singleUse: true
  consumedAt: string | null
  approvalTokenHash: string
  approvalScope: ExplicitExecutionApprovalScope
}

export type ApprovalVerificationResult =
  | {
      valid: true
      approval: ExplicitExecutionApproval
      reason: null
      message: string
    }
  | {
      valid: false
      approval: ExplicitExecutionApproval | null
      reason: ApprovalVerificationFailureReason
      message: string
    }

export type ApprovedProviderCallInput = {
  prompt: string
  systemInstruction: string
}

export type ApprovedProviderCallOutput = {
  content: string
  simulated: true
}

export type ApprovedProviderCallRequest = {
  requestId: string
  executionPlanId: string
  previewId: string
  routingId: string
  recommendationId: string
  providerCandidateId: string
  executionStepId: string
  providerFamily: FakeProviderFamily
  providerId: FakeProviderId
  modelId: FakeModelId
  actionType: ApprovedCallActionType
  input: ApprovedProviderCallInput
  createdAt: string
}

export type FakeProviderCallResult = {
  requestId: string
  providerFamily: FakeProviderFamily
  providerId: FakeProviderId
  modelId: FakeModelId
  status: Exclude<ProviderCallStatus, 'blocked'>
  output: ApprovedProviderCallOutput | null
  error: string | null
  simulated: true
  adapterInvocationCount: number
  startedAt: string
  completedAt: string
}

export type ProviderCallResult = {
  resultId: string
  request: ApprovedProviderCallRequest | null
  status: ProviderCallStatus
  output: ApprovedProviderCallOutput | null
  blockedReason: ApprovalVerificationFailureReason | null
  error: string | null
  approvalConsumed: boolean
  safeSummary: string
  recommendedNextAction: string
  simulated: true
  createdAt: string
}

export type ProviderCallAuditRecord = {
  auditId: string
  requestId: string | null
  approvalId: string | null
  executionPlanId: string
  previewId: string
  providerCandidateId: string | null
  executionStepId: string | null
  status: ProviderCallStatus
  approvalConsumed: boolean
  adapterCalled: boolean
  adapterInvocationCountBefore: number
  adapterInvocationCountAfter: number
  blockedReason: ApprovalVerificationFailureReason | null
  notes: string[]
  createdAt: string
}

export type ApprovedCallOrchestratorInput = {
  executionPlan: ExecutionPlan
  preview: ApprovedExecutionPreview
  approval: ExplicitExecutionApproval | null
  prompt?: string
  systemInstruction?: string
  providerCandidateId?: string
  executionStepId?: string
  createdAt?: string
}

export type ApprovedCallOrchestratorResult = {
  request: ApprovedProviderCallRequest
  result: ProviderCallResult
  auditRecord: ProviderCallAuditRecord
  verification: ApprovalVerificationResult
  consumedApproval: ExplicitExecutionApproval | null
}

export type ApprovedProviderCallPlanInput = {
  executionPlan: ExecutionPlan
  preview: ApprovedExecutionPreview
  prompt?: string
  systemInstruction?: string
  providerCandidateId?: string
  executionStepId?: string
  createdAt?: string
}

export type ApprovedCallBehaviorValidationResult = {
  caseId: string
  description: string
  expectedStatus: ProviderCallStatus
  observedStatus: ProviderCallStatus
  expectedAdapterCalls: number
  observedAdapterCalls: number
  expectedApprovalConsumed: boolean
  observedApprovalConsumed: boolean
  expectedBlockedReason?: ApprovalVerificationFailureReason
  observedBlockedReason: ApprovalVerificationFailureReason | null
  auditRecordProduced: boolean
  result: 'PASS' | 'FAIL'
  notes: string[]
}

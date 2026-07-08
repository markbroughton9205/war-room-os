import {
  EXPLICIT_EXECUTION_APPROVAL_TEXT,
  type ApprovalVerificationResult,
  type ApprovedProviderCallRequest,
  type ExplicitExecutionApproval,
} from './types'

export class ApprovalVerifier {
  verify(
    approval: ExplicitExecutionApproval | null,
    request: ApprovedProviderCallRequest,
    now: string
  ): ApprovalVerificationResult {
    if (!approval) {
      return this.reject(approval, 'missing_approval', 'Explicit execution approval is missing.')
    }

    if (approval.approvalText !== EXPLICIT_EXECUTION_APPROVAL_TEXT) {
      return this.reject(
        approval,
        'wrong_approval_text',
        'Approval text does not exactly match the required phrase.'
      )
    }

    if (approval.approvalType !== 'single_provider_call') {
      return this.reject(
        approval,
        'wrong_approval_type',
        'Approval type is not scoped to a single provider call.'
      )
    }

    if (approval.approvedBy !== 'commander') {
      return this.reject(
        approval,
        'wrong_approver',
        'Only commander approval can authorize this fake provider call.'
      )
    }

    if (approval.consumedAt) {
      return this.reject(
        approval,
        'approval_already_consumed',
        'Approval is single-use and has already been consumed.'
      )
    }

    if (Date.parse(approval.expiresAt) <= Date.parse(now)) {
      return this.reject(approval, 'expired_approval', 'Approval has expired.')
    }

    if (approval.executionPlanId !== request.executionPlanId) {
      return this.reject(
        approval,
        'execution_plan_mismatch',
        'Approval executionPlanId does not match the planned call.'
      )
    }

    if (approval.previewId !== request.previewId) {
      return this.reject(
        approval,
        'preview_mismatch',
        'Approval previewId does not match the approved execution preview.'
      )
    }

    if (
      approval.approvalScope.allowedProviderCandidateId !==
      request.providerCandidateId
    ) {
      return this.reject(
        approval,
        'provider_candidate_mismatch',
        'Approval is scoped to a different provider candidate.'
      )
    }

    if (approval.approvalScope.allowedExecutionStepId !== request.executionStepId) {
      return this.reject(
        approval,
        'execution_step_mismatch',
        'Approval is scoped to a different execution step.'
      )
    }

    if (approval.approvalScope.allowedActionType !== 'provider_call') {
      return this.reject(
        approval,
        'action_type_mismatch',
        'Approval scope does not allow a provider call action.'
      )
    }

    return {
      valid: true,
      approval,
      reason: null,
      message: 'Explicit single-provider-call approval is valid and scope-matched.',
    }
  }

  private reject(
    approval: ExplicitExecutionApproval | null,
    reason: Exclude<ApprovalVerificationResult, { valid: true }>['reason'],
    message: string
  ): ApprovalVerificationResult {
    return {
      valid: false,
      approval,
      reason,
      message,
    }
  }
}

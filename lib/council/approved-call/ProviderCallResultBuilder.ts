import {
  type ApprovalVerificationResult,
  type ApprovedProviderCallRequest,
  type FakeProviderCallResult,
  type ProviderCallResult,
} from './types'

export class ProviderCallResultBuilder {
  buildBlockedResult(
    request: ApprovedProviderCallRequest,
    verification: ApprovalVerificationResult,
    createdAt: string
  ): ProviderCallResult {
    return {
      resultId: `result_${request.requestId}`,
      request,
      status: 'blocked',
      output: null,
      blockedReason: verification.valid ? null : verification.reason,
      error: verification.valid ? null : verification.message,
      approvalConsumed: false,
      safeSummary: 'The fake provider call was blocked before adapter invocation.',
      recommendedNextAction:
        'Create a fresh ExplicitExecutionApproval scoped to this exact preview, plan, provider candidate, and step.',
      simulated: true,
      createdAt,
    }
  }

  buildAdapterResult(
    request: ApprovedProviderCallRequest,
    adapterResult: FakeProviderCallResult,
    createdAt: string
  ): ProviderCallResult {
    return {
      resultId: `result_${request.requestId}`,
      request,
      status: adapterResult.status,
      output: adapterResult.output,
      blockedReason: null,
      error: adapterResult.error,
      approvalConsumed: true,
      safeSummary: this.createSafeSummary(adapterResult.status),
      recommendedNextAction: this.createRecommendedNextAction(adapterResult.status),
      simulated: true,
      createdAt,
    }
  }

  private createSafeSummary(status: FakeProviderCallResult['status']): string {
    if (status === 'succeeded') {
      return 'The contained fake provider call completed successfully.'
    }

    if (status === 'timed_out') {
      return 'The contained fake provider call timed out. No retry or fallback was attempted.'
    }

    if (status === 'invalid_output') {
      return 'The contained fake provider call returned invalid simulated output. No retry or fallback was attempted.'
    }

    return 'The contained fake provider call failed. No retry or fallback was attempted.'
  }

  private createRecommendedNextAction(status: FakeProviderCallResult['status']): string {
    if (status === 'succeeded') {
      return 'Review the simulated output and keep execution disabled until a later approved phase.'
    }

    return 'Review the audit record, then create a new explicit approval only if another fake call is still needed.'
  }
}

import {
  FAKE_MODEL_ID,
  FAKE_PROVIDER_FAMILY,
  FAKE_PROVIDER_ID,
  type ApprovedProviderCallPlanInput,
  type ApprovedProviderCallRequest,
} from './types'

export class ApprovedProviderCallPlanner {
  createRequest(input: ApprovedProviderCallPlanInput): ApprovedProviderCallRequest {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const executionStepId =
      input.executionStepId ??
      input.executionPlan.executionSteps.find((step) => step.actionType !== 'await_approval')
        ?.stepId ??
      input.executionPlan.executionSteps[0]?.stepId ??
      'step_unavailable'
    const providerCandidateId =
      input.providerCandidateId ??
      input.executionPlan.selectedBrainCandidateId ??
      input.executionPlan.recommendedBrainCandidateIds[0] ??
      FAKE_PROVIDER_ID

    return {
      requestId: this.createRequestId(
        input.executionPlan.executionPlanId,
        input.preview.previewId,
        executionStepId
      ),
      executionPlanId: input.executionPlan.executionPlanId,
      previewId: input.preview.previewId,
      routingId: input.preview.routingId,
      recommendationId: input.preview.recommendationId,
      providerCandidateId,
      executionStepId,
      providerFamily: FAKE_PROVIDER_FAMILY,
      providerId: FAKE_PROVIDER_ID,
      modelId: FAKE_MODEL_ID,
      actionType: 'single_provider_call',
      input: {
        prompt: input.prompt ?? input.executionPlan.commanderMessage,
        systemInstruction:
          input.systemInstruction ??
          'You are a contained fake provider adapter for War Room 46G validation. Return one safe simulated text response only.',
      },
      createdAt,
    }
  }

  private createRequestId(
    executionPlanId: string,
    previewId: string,
    executionStepId: string
  ): string {
    return `approved_call_${executionPlanId}_${previewId}_${executionStepId}`
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
  }
}

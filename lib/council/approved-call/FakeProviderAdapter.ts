import {
  FAKE_MODEL_ID,
  FAKE_PROVIDER_FAMILY,
  FAKE_PROVIDER_ID,
  type ApprovedProviderCallRequest,
  type FakeProviderCallResult,
} from './types'

export class FakeProviderAdapter {
  private invocationCount = 0

  getInvocationCount(): number {
    return this.invocationCount
  }

  call(request: ApprovedProviderCallRequest, now: string): FakeProviderCallResult {
    this.invocationCount += 1

    if (request.input.prompt.includes('[simulate_timeout]')) {
      return this.createResult(request, now, 'timed_out', null, 'Fake adapter simulated timeout.')
    }

    if (request.input.prompt.includes('[simulate_malformed]')) {
      return this.createResult(
        request,
        now,
        'invalid_output',
        null,
        'Fake adapter simulated malformed output.'
      )
    }

    if (!request.input.prompt.trim() || !request.input.systemInstruction.trim()) {
      return this.createResult(
        request,
        now,
        'failed',
        null,
        'Fake adapter received empty prompt or system instruction.'
      )
    }

    return this.createResult(
      request,
      now,
      'succeeded',
      {
        content: `Simulated contained response for request ${request.requestId}.`,
        simulated: true,
      },
      null
    )
  }

  private createResult(
    request: ApprovedProviderCallRequest,
    now: string,
    status: FakeProviderCallResult['status'],
    output: FakeProviderCallResult['output'],
    error: string | null
  ): FakeProviderCallResult {
    return {
      requestId: request.requestId,
      providerFamily: FAKE_PROVIDER_FAMILY,
      providerId: FAKE_PROVIDER_ID,
      modelId: FAKE_MODEL_ID,
      status,
      output,
      error,
      simulated: true,
      adapterInvocationCount: this.invocationCount,
      startedAt: now,
      completedAt: now,
    }
  }
}

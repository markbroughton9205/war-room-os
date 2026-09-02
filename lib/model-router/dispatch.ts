import { invokeDirectCouncilProvider, type DirectProviderFamily } from '@/lib/council/providerDirectCall'
import type { ModelRequest, ModelResponse } from './types'

/** Thin wrapper around the existing invokeDirectCouncilProvider — no new provider logic, just a
 * typed ModelRequest/ModelResponse shape so callers (today: only experience-record logging) don't
 * depend on DirectProviderCallResult's shape directly. Not called from any live chat path in
 * Wave 1 — existing Council call sites are untouched. */
export async function dispatchModelRequest(request: ModelRequest): Promise<ModelResponse> {
  const { target } = request
  if (!target.dispatchable) {
    return {
      target,
      content: '',
      latencyMs: 0,
      status: 'not_dispatchable',
      errorMessage: `${target.providerFamily} has a capability profile but no direct-call implementation.`,
    }
  }

  const startedAt = Date.now()
  const result = await invokeDirectCouncilProvider(target.providerFamily as DirectProviderFamily, request.message, {
    system: request.system,
    maxTokens: request.maxTokens,
    timeoutMs: request.timeoutMs,
  })
  const latencyMs = Date.now() - startedAt

  if (result.ok) {
    return { target, content: result.text, latencyMs, status: 'ok' }
  }
  return {
    target,
    content: '',
    latencyMs,
    status: result.transportStatus === 'timeout' ? 'timeout' : 'error',
    errorMessage: result.error,
  }
}

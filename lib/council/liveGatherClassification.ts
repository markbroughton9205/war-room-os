import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

/**
 * Minimal shape of `applyCouncilRenderGate`'s result needed for gather-time classification —
 * decoupled from `CouncilRenderGateResult` so this module has no dependency on `app/page.tsx`.
 */
export type LiveGatherRenderGateOutcome = {
  displayText: string
  degraded: boolean
  renderable: boolean
}

export type LiveGatherRuntimeOutcome = Extract<
  ProviderFamilyOutcomeStatus,
  'RESPONDED' | 'DEGRADED' | 'FAILED'
>

export type LiveGatherClassification = {
  textOut: string | null
  runtime: LiveGatherRuntimeOutcome
  runtimeDetail?: string
}

/**
 * Single source of truth for turning a provider's extracted text + render-gate verdict into a
 * runtime outcome. This is the fix for the metadata mismatch bug: previously the live gather loop
 * only checked whether post-gate text was non-empty, so fallback/degraded boilerplate (which the
 * gate substitutes but still returns as non-empty text) was misclassified as RESPONDED. A response
 * is only ever RESPONDED when the gate accepted it as non-degraded and renderable.
 */
export function classifyGatheredProviderText(
  extractedText: string,
  gated: LiveGatherRenderGateOutcome | null,
): LiveGatherClassification {
  if (!extractedText || !gated) {
    return { textOut: null, runtime: 'FAILED', runtimeDetail: 'empty_response' }
  }
  if (gated.degraded) {
    return { textOut: null, runtime: 'DEGRADED', runtimeDetail: 'degraded_response_quality' }
  }
  if (!gated.renderable || !gated.displayText.trim()) {
    return { textOut: null, runtime: 'FAILED', runtimeDetail: 'empty_response' }
  }
  return { textOut: gated.displayText, runtime: 'RESPONDED' }
}

/** Persisted `responseSuccessful` must agree with `providerRuntime` — true only for RESPONDED. */
export function responseSuccessfulForRuntime(runtime: ProviderFamilyOutcomeStatus | undefined): boolean {
  return runtime === 'RESPONDED'
}

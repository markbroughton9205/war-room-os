import 'server-only'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { familyIsStreamConfigured, streamCouncilFamily } from '../streamProvider'
import type { BackendMetadata, ModelBackendInvokeInput, ModelBackendInvokeResult } from './types'

const EXTERNAL_PROVIDER_BY_SEAT: Record<CouncilOrchestrationFamily, string> = {
  chatgpt: 'openai',
  baby: 'openai',
  claude: 'anthropic',
  red_team: 'anthropic',
  grok: 'xai',
  gemini: 'google',
  kimi: 'moonshot',
  bridge_architect: 'unknown',
}

function modelLabelForSeat(seat: CouncilOrchestrationFamily): string {
  if (seat === 'chatgpt' || seat === 'baby') return 'gpt-4o'
  if (seat === 'claude' || seat === 'red_team') return 'claude-sonnet-5'
  if (seat === 'grok') return 'grok (configured)'
  if (seat === 'gemini') return 'gemini (configured)'
  return 'unconfigured'
}

export function externalBackendConfigured(seat: CouncilOrchestrationFamily): boolean {
  return familyIsStreamConfigured(seat)
}

/**
 * External backend adapter. This is a thin pass-through over the existing, UNMODIFIED
 * lib/council/live-orchestration/streamProvider.ts — the per-provider request/streaming/retry
 * logic (adapters/anthropic.ts, openai.ts, gemini.ts, grok.ts, retryPolicy.ts, timeoutPolicy.ts)
 * is not touched or duplicated here. This function only adds BackendMetadata around the
 * existing StreamedCouncilCall result so it composes with the local backend's provenance shape.
 */
export async function invokeExternalBackend(input: ModelBackendInvokeInput): Promise<ModelBackendInvokeResult> {
  const provider = EXTERNAL_PROVIDER_BY_SEAT[input.seat] ?? input.seat
  if (!familyIsStreamConfigured(input.seat)) {
    const backend: BackendMetadata = {
      backendType: 'EXTERNAL',
      provider,
      model: 'unconfigured',
      host: 'cloud',
      latencyMs: 0,
      status: 'UNAVAILABLE',
      failureClass: 'AUTH',
      fallbackReason: `${provider} not configured/supported for seat "${input.seat}".`,
    }
    return { ok: false, text: '', partial: false, backend }
  }

  const started = Date.now()
  const streamed = await streamCouncilFamily({
    family: input.seat,
    system: input.systemPrompt,
    prompt: input.userPrompt,
    maxTokens: input.maxTokens,
    timeoutKind: input.timeoutKind,
    parentSignal: input.signal,
    onDelta: input.onDelta,
  })

  const backend: BackendMetadata = {
    backendType: 'EXTERNAL',
    provider,
    model: modelLabelForSeat(input.seat),
    host: 'cloud',
    latencyMs: Date.now() - started,
    status: streamed.status,
    failureClass: streamed.failureLayer,
    fallbackReason: streamed.error,
  }
  return { ok: streamed.ok, text: streamed.text, partial: streamed.partial, backend }
}

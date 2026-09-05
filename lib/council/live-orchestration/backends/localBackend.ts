import 'server-only'

import { probeOllama, requestOllamaCompletion } from '@/lib/native-builder/ollamaClient'
import type { CouncilFailureLayer } from '../types'
import { localRegistryEntryForSlot } from './localModelRegistry'
import { SEAT_LOCAL_ROLE_SLOT } from './seatRoleSlot'
import type { BackendMetadata, ModelBackendInvokeInput, ModelBackendInvokeResult } from './types'

function ollamaHost(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434').replace(/\/+$/, '')
}

function classifyLocalFailure(detail: string): CouncilFailureLayer {
  const msg = detail.toLowerCase()
  if (/abort|timed? ?out/.test(msg)) return 'TIMEOUT'
  return 'MODEL_LOAD_FAILED'
}

/**
 * Local backend adapter. Reuses lib/native-builder/ollamaClient.ts (the repo's one real Ollama
 * HTTP client) rather than duplicating a client — see that file's own header for why it exists.
 *
 * Known limitation: requestOllamaCompletion() is non-streaming and does not accept an external
 * AbortSignal (it owns a fixed internal 60s timeout). This adapter honestly reports the full
 * response as a single onDelta() call rather than faking token-by-token streaming. Wiring the
 * caller's `signal` through for true cancellation is a follow-up, not done in this phase since
 * ollamaClient.ts is shared with the unrelated native-builder feature.
 */
export async function invokeLocalBackend(input: ModelBackendInvokeInput): Promise<ModelBackendInvokeResult> {
  const started = Date.now()
  const host = ollamaHost()
  const slot = SEAT_LOCAL_ROLE_SLOT[input.seat]
  const entry = slot ? localRegistryEntryForSlot(slot) : null

  if (!entry) {
    const backend: BackendMetadata = {
      backendType: 'LOCAL',
      provider: 'ollama',
      model: 'unassigned',
      host,
      latencyMs: Date.now() - started,
      status: 'NO_LOCAL_BACKEND',
      failureClass: 'MODEL_NOT_INSTALLED',
      fallbackReason: `No enabled local registry slot for seat "${input.seat}".`,
    }
    return { ok: false, text: '', partial: false, backend }
  }

  const probe = await probeOllama()
  if (!probe.available) {
    const backend: BackendMetadata = {
      backendType: 'LOCAL',
      provider: 'ollama',
      model: entry.modelId,
      repo: entry.repo,
      quantization: entry.quant,
      host,
      latencyMs: Date.now() - started,
      status: 'NO_LOCAL_BACKEND',
      failureClass: 'LOCAL_UNAVAILABLE',
      fallbackReason: `Ollama unreachable at ${probe.baseUrl}: ${probe.detail}`,
    }
    return { ok: false, text: '', partial: false, backend }
  }

  const installed = probe.models.some(
    name => name === entry.modelId || name.startsWith(`${entry.modelId.split(':')[0]}:`),
  )
  if (!installed) {
    const backend: BackendMetadata = {
      backendType: 'LOCAL',
      provider: 'ollama',
      model: entry.modelId,
      repo: entry.repo,
      quantization: entry.quant,
      host,
      latencyMs: Date.now() - started,
      status: 'NO_LOCAL_BACKEND',
      failureClass: 'MODEL_NOT_INSTALLED',
      fallbackReason: `${entry.modelId} is not pulled in Ollama (${probe.models.length} model(s) currently installed).`,
    }
    return { ok: false, text: '', partial: false, backend }
  }

  const result = await requestOllamaCompletion({
    model: entry.modelId,
    prompt: input.userPrompt,
    system: input.systemPrompt,
  })
  const latencyMs = Date.now() - started

  if (!result.ok) {
    const backend: BackendMetadata = {
      backendType: 'LOCAL',
      provider: 'ollama',
      model: entry.modelId,
      repo: entry.repo,
      quantization: entry.quant,
      host,
      latencyMs,
      status: 'FAILED',
      failureClass: classifyLocalFailure(result.detail),
      fallbackReason: result.detail,
    }
    return { ok: false, text: '', partial: false, backend }
  }

  input.onDelta(result.text)
  const backend: BackendMetadata = {
    backendType: 'LOCAL',
    provider: 'ollama',
    model: entry.modelId,
    repo: entry.repo,
    quantization: entry.quant,
    host,
    latencyMs,
    status: 'OK',
  }
  return { ok: true, text: result.text, partial: false, backend }
}

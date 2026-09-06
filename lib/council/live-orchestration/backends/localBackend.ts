import 'server-only'

import { probeOllama, requestOllamaStreamingCompletion, type OllamaProbeResult } from '@/lib/native-builder/ollamaClient'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import { stripHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import type { CouncilFailureLayer } from '../types'
import { localRegistryEntryForSlot, type LocalModelRegistryEntry } from './localModelRegistry'
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
 * Streams Ollama NDJSON tokens through `onDelta`. Thinking is stripped and never concatenated
 * into the Commander-facing text. Request options include keep_alive=-1 and think=false; they
 * do not mutate host-wide Ollama daemon configuration.
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

  console.info(
    `[nebula-local] identity=${displayNameForSeat(input.seat, input.seat)} seat=${input.seat} backend=LOCAL runtime=ollama model=${entry.modelId}`,
  )
  const result = await requestOllamaStreamingCompletion({
    model: entry.modelId,
    prompt: input.userPrompt,
    system: input.systemPrompt,
    signal: input.signal,
    onDelta: delta => {
      if (delta) input.onDelta(delta)
    },
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

  const text = stripHiddenReasoning(result.text)
  const backend: BackendMetadata = {
    backendType: 'LOCAL',
    provider: 'ollama',
    model: entry.modelId,
    repo: entry.repo,
    quantization: entry.quant,
    host,
    latencyMs,
    ttftMs: result.metrics.ttftMs,
    tokensPerSecond: result.metrics.tokensPerSecond,
    status: 'OK',
  }
  return { ok: true, text, partial: false, backend }
}

export type LocalCandidateHealth = 'READY' | 'UNAVAILABLE' | 'MODEL_NOT_INSTALLED' | 'NOT_CONFIGURED'

/**
 * Pure, non-invoking health classification for status/UI display. Takes an already-fetched
 * probeOllama() result so a status endpoint can probe once and derive health for every seat/slot
 * from that single snapshot, rather than re-probing per row. Never runs a completion — this is
 * exactly the reachable+installed gate invokeLocalBackend() checks before it would generate,
 * stopped short of actually generating, so it never reports READY without a real, current probe.
 */
export function localCandidateHealthFromProbe(
  entry: LocalModelRegistryEntry | null,
  probe: OllamaProbeResult,
): LocalCandidateHealth {
  if (!entry) return 'NOT_CONFIGURED'
  if (!probe.available) return 'UNAVAILABLE'
  const installed = probe.models.some(
    name => name === entry.modelId || name.startsWith(`${entry.modelId.split(':')[0]}:`),
  )
  return installed ? 'READY' : 'MODEL_NOT_INSTALLED'
}

/**
 * Explicit safe serialization for a local runtime URL headed for an API response: parses the URL
 * and reconstructs it from only protocol+hostname+port, so any embedded userinfo (a credential-
 * bearing OLLAMA_BASE_URL, e.g. `http://user:secret@host:11434`) is structurally dropped rather
 * than pattern-matched-and-stripped. Falls back to a static label on an unparseable value so this
 * never throws.
 */
export function safeOllamaBaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return 'ollama'
  }
}

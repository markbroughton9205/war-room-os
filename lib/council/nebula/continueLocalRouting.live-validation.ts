import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from './modelProfile'

/**
 * Real local-Ollama proof for the Commander "Continue" path (audit follow-up on P0-2).
 *
 * Traced client -> server for this repair: a Commander clicking Allow/Summarize on a
 * continuation request (app/page.tsx's runPermissionedContinuation) calls submitDecree(directive,
 * 'continue'), which - for a single family - posts through postCouncilChatDecreeGather (the SAME
 * streaming client the initial Nebula round uses, hitting /api/chat/stream), NOT the
 * non-streaming postCouncilChat used elsewhere by the separate, automatic
 * runAutonomousOrchestration path. That request carries no councilDeliberationMode flag, so it
 * reaches execute.ts's `mode === 'continue' && councilSingleFamily` branch (the one P0-2 fixed) —
 * confirmed by reading both call sites, not assumed.
 *
 * That branch now calls callCouncilProvider(), whose internal emitDelta() unconditionally records
 * every real onDelta callback from invokeCouncilSeat() as a `TEXT_DELTA` diagnostic on
 * councilProgress - regardless of whether the caller passes its own onDelta - and
 * /api/chat/stream's progressEventObserver forwards every progress event as an SSE envelope in
 * real time. So the actual thing to prove is that invokeCouncilSeat (the primitive
 * callCouncilProvider wraps, same boundary the existing live-Group validation tests) really does
 * deliver multiple distinct real deltas from local Ollama before completing - not a
 * buffer-then-return call disguised as "LOCAL routing."
 *
 * Does not invoke the Next.js HTTP route handler itself (needs request/auth/env plumbing this
 * harness does not reproduce) or assert anything about SSE transport/DOM rendering (that needs a
 * real browser - see tests/council-browser-acceptance.spec.ts, which is why the false-green
 * streaming assertion there was fixed independently of this file). Fails honestly if Ollama or the
 * shared model is unavailable rather than fabricating a pass.
 */

export type ContinueLocalRoutingLiveResult = { name: string; pass: boolean; detail: string }

const THINK_TAG = /<think>|<\/think>/i
const SCHEMA_LEAK = /failureModes|evidencePackets|decisionOrSynthesis|evidenceIds/

const CLOUD_KEY_ENV_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'MOONSHOT_API_KEY']

async function withCloudKeysStripped<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const name of CLOUD_KEY_ENV_NAMES) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
  try {
    return await fn()
  } finally {
    for (const name of CLOUD_KEY_ENV_NAMES) {
      if (saved[name] !== undefined) process.env[name] = saved[name]
      else delete process.env[name]
    }
  }
}

export async function runContinueLocalRoutingLiveCheck(): Promise<ContinueLocalRoutingLiveResult[]> {
  const results: ContinueLocalRoutingLiveResult[] = []
  const probe = await probeOllama()
  const installed = probe.models.some(
    name => name === NEBULA_SHARED_LOCAL_MODEL_ID || name.startsWith('huihui_ai/qwen3-abliterated:'),
  )
  results.push({
    name: 'continue_local_routing_ollama_reachable',
    pass: probe.available && installed,
    detail: probe.available ? `installed=${probe.models.join(',')}` : `unreachable: ${probe.detail}`,
  })
  if (!probe.available || !installed) {
    results.push({
      name: 'continue_local_routing_real_deltas_before_completion',
      pass: false,
      detail: 'skipped - Ollama or shared model not available; not reported as production UI proof',
    })
    return results
  }

  const deltas: string[] = []
  const result = await withCloudKeysStripped(() =>
    invokeCouncilSeat({
      seat: 'claude', // ORION - the same seat identity used in this mission's proven browser round
      systemPrompt: "You are ORION in Ra'el's War Room. Give a one-sentence status read on War Room.",
      userPrompt: 'Council, give me a short status summary of War Room.',
      maxTokens: 160,
      signal: new AbortController().signal,
      onDelta: delta => {
        if (delta) deltas.push(delta)
      },
      timeoutKind: 'social',
      // Mirrors production's actual COUNCIL_ROUTING_MODE=LOCAL_FIRST - LOCAL_ONLY proves the
      // result cannot be a cloud fallback masquerading as local, with no cloud key present either
      // way (see withCloudKeysStripped above).
      routingModeOverride: 'LOCAL_ONLY',
    }),
  )

  const backendIsLocal = result.backend.backendType === 'LOCAL'
  const modelIsSharedNebulaModel = result.backend.model === NEBULA_SHARED_LOCAL_MODEL_ID
  const distinctDeltaCount = new Set(deltas).size
  const gotMultipleRealDeltas = result.ok && deltas.length >= 2 && distinctDeltaCount >= 2
  const finalTextClean = result.ok && !THINK_TAG.test(result.text) && !SCHEMA_LEAK.test(result.text)
  const noCloudKeyWasNeeded = result.ok && backendIsLocal // LOCAL_ONLY + stripped cloud keys + ok=true together prove this

  results.push({
    name: 'continue_local_routing_backend_is_local_qwen3',
    pass: result.ok && backendIsLocal && modelIsSharedNebulaModel,
    detail: `ok=${result.ok} backendType=${result.backend.backendType} model=${result.backend.model}`,
  })
  results.push({
    name: 'continue_local_routing_real_deltas_before_completion',
    pass: gotMultipleRealDeltas,
    detail: `deltaCount=${deltas.length} distinctDeltaCount=${distinctDeltaCount} deltas=${JSON.stringify(deltas.slice(0, 5))}`,
  })
  results.push({
    name: 'continue_local_routing_final_text_clean',
    pass: finalTextClean,
    detail: finalTextClean ? `len=${result.text.length}, no <think>/schema leak` : `raw=${result.text.slice(0, 200)}`,
  })
  results.push({
    name: 'continue_local_routing_no_cloud_key_required',
    pass: noCloudKeyWasNeeded,
    detail: `succeeded with all cloud API keys stripped from env, routingModeOverride=LOCAL_ONLY, backendType=${result.backend.backendType}`,
  })

  return results
}

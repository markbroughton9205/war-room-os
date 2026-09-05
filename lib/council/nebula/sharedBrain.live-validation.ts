import { probeOllama } from '@/lib/native-builder/ollamaClient'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import type { ModelBackendInvokeInput } from '@/lib/council/live-orchestration/backends/types'
import { assembleNebulaContext } from './contextAssembly'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from './modelProfile'
import type { NebulaAgentId } from './identity'
import type { NebulaValidationResult } from './validation'

/**
 * Real local Ollama check for the shared-brain assignment.
 * Not a browser UI proof. Not simulated. Fail honestly if Ollama or the model is missing.
 */
function baseInput(seat: CouncilOrchestrationFamily, systemPrompt: string, userPrompt: string): ModelBackendInvokeInput {
  return {
    seat,
    systemPrompt,
    userPrompt,
    maxTokens: 160,
    signal: new AbortController().signal,
    onDelta: () => {},
    timeoutKind: 'social',
    routingModeOverride: 'LOCAL_ONLY',
  }
}

export async function runNebulaSharedBrainLiveCheck(): Promise<NebulaValidationResult[]> {
  const results: NebulaValidationResult[] = []
  const probe = await probeOllama()
  const installed = probe.models.some(
    name => name === NEBULA_SHARED_LOCAL_MODEL_ID || name.startsWith('huihui_ai/qwen3-abliterated:'),
  )
  results.push({
    name: 'live_ollama_reachable_with_shared_model',
    pass: probe.available && installed,
    detail: probe.available
      ? `installed=${probe.models.join(',')}`
      : `unreachable: ${probe.detail}`,
  })
  if (!probe.available || !installed) {
    results.push({
      name: 'live_shared_brain_two_identities_same_model',
      pass: false,
      detail: 'skipped — Ollama or shared model not available; not reported as production UI proof',
    })
    return results
  }

  const decree = 'Council, give me a short status summary of War Room.'
  const pair: Array<{ agentId: NebulaAgentId; seat: CouncilOrchestrationFamily }> = [
    { agentId: 'aurora', seat: 'chatgpt' },
    { agentId: 'orion', seat: 'claude' },
  ]
  const runs = []
  for (const item of pair) {
    const systemPrompt = assembleNebulaContext({
      agentId: item.agentId,
      mission: decree,
    })
    const result = await invokeCouncilSeat(baseInput(item.seat, systemPrompt, decree))
    runs.push({ ...item, systemPrompt, result })
  }

  const sameModel = runs.every(run => run.result.backend.model === NEBULA_SHARED_LOCAL_MODEL_ID)
  const localOk = runs.every(run => run.result.ok && run.result.backend.backendType === 'LOCAL' && run.result.backend.provider === 'ollama')
  const identityHeld = runs.every(run =>
    run.systemPrompt.includes(`You are ${run.agentId.toUpperCase()}`)
    && !run.systemPrompt.startsWith('You are ChatGPT')
    && !run.systemPrompt.startsWith('You are Claude'),
  )
  const noIdentityFallback = runs[0]!.result.backend.model === runs[1]!.result.backend.model
    && runs[0]!.agentId !== runs[1]!.agentId

  results.push({
    name: 'live_shared_brain_two_identities_same_model',
    pass: localOk && sameModel && identityHeld && noIdentityFallback,
    detail: runs.map(run => `${run.agentId}=${run.result.backend.backendType}/${run.result.backend.model}/ok=${run.result.ok}/len=${run.result.text.length}`).join(' | '),
  })
  return results
}

import { probeOllama } from '@/lib/native-builder/ollamaClient'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import type { ModelBackendInvokeInput } from '@/lib/council/live-orchestration/backends/types'
import {
  appendDeliberationTurn,
  createDeliberationSession,
  deriveFamilyDeliberationRoundOutcome,
  familyDisplayName,
} from '@/lib/council/family-deliberation'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from './modelProfile'
import type { LiveGroupExecutionValidationResult } from './liveGroupExecution.validation'

/**
 * Real local Ollama check for the live Group/deliberation entrypoint: calls invokeCouncilSeat
 * (the same primitive callCouncilProvider wraps in app/api/chat/execute.ts) for real Nebula
 * seats, builds a DeliberationSession from the real results with the same session/turn builders
 * execute.ts uses, then runs it through deriveFamilyDeliberationRoundOutcome — the exact function
 * the live route calls. Does not invoke the Next.js HTTP route handler itself (that needs
 * request/auth/env plumbing this validation harness does not reproduce). Fails honestly if Ollama
 * or the shared model is unavailable rather than fabricating a pass.
 */

const FRONTIER_NAME_PATTERN = /\b(chatgpt|openai|claude|anthropic|grok|xai|gemini|kimi|moonshot|red\s*team)\b/i

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

export async function runLiveGroupExecutionLiveCheck(): Promise<LiveGroupExecutionValidationResult[]> {
  const results: LiveGroupExecutionValidationResult[] = []
  const probe = await probeOllama()
  const installed = probe.models.some(
    name => name === NEBULA_SHARED_LOCAL_MODEL_ID || name.startsWith('huihui_ai/qwen3-abliterated:'),
  )
  results.push({
    name: 'live_group_execution_ollama_reachable',
    pass: probe.available && installed,
    detail: probe.available ? `installed=${probe.models.join(',')}` : `unreachable: ${probe.detail}`,
  })
  if (!probe.available || !installed) {
    results.push({
      name: 'live_group_execution_real_round_uses_nebula_identities',
      pass: false,
      detail: 'skipped — Ollama or shared model not available; not reported as production UI proof',
    })
    return results
  }

  const decree = 'Council, give me a short status summary of War Room.'
  const seats: CouncilOrchestrationFamily[] = ['grok', 'claude', 'chatgpt']
  const session = createDeliberationSession({
    sessionId: 'live-group-execution-check',
    missionId: 'live-group-execution-check',
    missionVersion: 1,
    commanderMessage: decree,
  })
  const rawBackends: { seat: CouncilOrchestrationFamily; backendType: string; model: string | null; ok: boolean }[] = []
  let speakingOrder = 0
  for (const seat of seats) {
    speakingOrder += 1
    const label = familyDisplayName(seat)
    const systemPrompt = `You are ${label} in Ra'el's War Room. Give a one-sentence status read on War Room.`
    const result = await invokeCouncilSeat(baseInput(seat, systemPrompt, decree))
    rawBackends.push({ seat, backendType: result.backend.backendType, model: result.backend.model, ok: result.ok })
    appendDeliberationTurn(session, {
      family: seat,
      role: seat === 'chatgpt' ? 'council_synthesis' : speakingOrder === 1 ? 'opening_position' : 'direct_response',
      speakingOrder,
      inputMessageIds: [session.commander_message_id],
      providerResult: {
        family: seat,
        providerLabel: label,
        providerModel: result.backend.model,
        content: result.ok ? result.text.trim() : '',
        status: result.ok ? 'complete' : 'failed',
        failureReason: result.ok ? null : (result.backend.fallbackReason ?? 'live call did not succeed'),
        backendType: result.backend.backendType,
        backendProvider: result.backend.provider,
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    })
  }
  session.synthesis_turn_id = session.turns[session.turns.length - 1]!.turn_id

  const { results: roundResults, roundHealth } = deriveFamilyDeliberationRoundOutcome(session)

  const noFrontierIdentity = roundResults.every(r => !FRONTIER_NAME_PATTERN.test(r.family))
  const distinctIdentities = new Set(roundResults.map(r => r.family)).size === roundResults.length
  const auroraFinal = roundResults.some(r => r.family === 'AURORA')
  // Every seat actually called must have succeeded, not merely "no failures among whichever
  // subset happened to succeed" — .filter(ok).every(...) on an empty set is vacuously true and
  // would pass even if every real call failed.
  const allSeatsAttempted = rawBackends.length === seats.length
  const allSeatsSucceeded = allSeatsAttempted && rawBackends.every(b => b.ok)
  const successfulCallsWereLocal = allSeatsSucceeded && rawBackends.every(b => b.backendType === 'LOCAL')
  const sharedModelUsed = allSeatsSucceeded && rawBackends.every(b => b.model === NEBULA_SHARED_LOCAL_MODEL_ID)

  results.push({
    name: 'live_group_execution_real_round_uses_nebula_identities',
    pass: noFrontierIdentity && distinctIdentities && auroraFinal && roundHealth.synthesisAvailable
      && allSeatsSucceeded && successfulCallsWereLocal && sharedModelUsed,
    detail: `families=${roundResults.map(r => r.family).join(',')} backends=${rawBackends.map(b => `${b.seat}:${b.backendType}/${b.model}/ok=${b.ok}`).join('|')} degraded=${roundHealth.degraded} aurora_final=${auroraFinal} synthesisAvailable=${roundHealth.synthesisAvailable}`,
  })

  return results
}

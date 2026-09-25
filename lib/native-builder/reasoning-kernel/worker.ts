/**
 * Provider-neutral worker adapter.
 * The router stays the only model call. FRK does not execute tool mutations.
 */
import { FoundryModelRouter } from '../foundryModelRouter'
import type { FoundryMissionModel, FoundryModelProviderId } from '../foundryModelTypes'
import { shadowRouteOptions } from '../foundryWorkerRouting'
import type { FoundryModelContext, FoundryModelRequestKind } from '../foundryModelTypes'
import type { FoundryReasoningWorkerRequest, FoundryReasoningWorkerResponse, FrkWorkerTask } from './types'

export function buildWorkerRequest(input: {
  requestId: string
  missionId: string
  task: FrkWorkerTask
  problem: string
  constraints: string[]
  evidenceSummaries: string[]
}): FoundryReasoningWorkerRequest {
  return input
}

export function workerResponseFromRoute(task: FrkWorkerTask, summary: string, declaredDone: boolean): FoundryReasoningWorkerResponse {
  return { task, summary, declaredDone }
}

export async function dispatchReasoningWorker(input: {
  request: FoundryReasoningWorkerRequest
  context: FoundryModelContext
  kind?: FoundryModelRequestKind
  signal?: AbortSignal
  pin?: { provider: string; model: string } | null
  models?: FoundryMissionModel[]
}): Promise<{ ok: true; summary: string; rawText: string; hypotheses: string[]; provider: string; model: string; declaredDone: boolean; shadowApplied: false; fallbackUsed: false; workerDiagnostics?: import('../foundryModelTypes').FoundryWorkerDiagnostics } | { ok: false; error: string; shadowApplied: false; fallbackUsed: false; workerDiagnostics?: import('../foundryModelTypes').FoundryWorkerDiagnostics }> {
  const shadow = shadowRouteOptions(input.request.missionId, input.pin ?? null)
  const routed = await new FoundryModelRouter(input.models).route(input.kind ?? 'reasonMission', {
    kind: input.kind ?? 'reasonMission',
    context: input.context,
    abortSignal: input.signal,
  }, {
    missionId: shadow.missionId,
    pinProvider: (shadow.pinProvider ?? input.pin?.provider ?? null) as FoundryModelProviderId | null,
    pinModel: shadow.pinModel ?? input.pin?.model ?? null,
  })
  if (!routed.response.ok) {
    return { ok: false, error: routed.response.error, shadowApplied: false, fallbackUsed: false, workerDiagnostics: routed.response.workerDiagnostics }
  }
  if (input.pin && (routed.response.provider !== input.pin.provider || routed.response.model !== input.pin.model)) {
    return { ok: false, error: 'BLOCKED_PROVIDER', shadowApplied: false, fallbackUsed: false }
  }
  return {
    ok: true,
    summary: routed.response.decision.reasoningSummary,
    rawText: routed.response.rawText,
    hypotheses: (routed.response.decision.planChanges?.hypotheses ?? []).map(item => item.statement),
    provider: routed.response.provider,
    model: routed.response.model,
    declaredDone: routed.response.decision.decision === 'COMPLETE',
    shadowApplied: false,
    fallbackUsed: false,
    workerDiagnostics: routed.response.workerDiagnostics,
  }
}

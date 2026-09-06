import 'server-only'

import { invokeLocalBackend } from './localBackend'
import { invokeExternalBackend } from './externalBackend'
import { resolveCouncilRoutingMode, resolveSeatBackendPolicy } from './routingMode'
import type {
  BackendType,
  CouncilRoutingMode,
  ModelBackendInvokeInput,
  ModelBackendInvokeResult,
  SeatBackendPolicy,
} from './types'

function withFallbackTag(
  result: ModelBackendInvokeResult,
  fallbackFrom: BackendType,
  fallbackReason: string | undefined,
): ModelBackendInvokeResult {
  return {
    ...result,
    backend: { ...result.backend, fallbackFrom, fallbackReason: fallbackReason ?? result.backend.fallbackReason },
  }
}

async function invokeLocalThenExternal(input: ModelBackendInvokeInput): Promise<ModelBackendInvokeResult> {
  const local = await invokeLocalBackend(input)
  if (local.ok) return local
  const external = await invokeExternalBackend(input)
  return withFallbackTag(external, 'LOCAL', local.backend.fallbackReason ?? local.backend.failureClass)
}

async function invokeExternalThenLocal(input: ModelBackendInvokeInput): Promise<ModelBackendInvokeResult> {
  const external = await invokeExternalBackend(input)
  if (external.ok) return external
  const local = await invokeLocalBackend(input)
  return withFallbackTag(local, 'EXTERNAL', external.backend.fallbackReason ?? external.backend.failureClass)
}

async function invokeForPolicy(
  policy: SeatBackendPolicy,
  input: ModelBackendInvokeInput,
): Promise<ModelBackendInvokeResult> {
  if (policy === 'EXTERNAL_ONLY') return invokeExternalBackend(input)

  if (policy === 'LOCAL_ONLY') {
    const local = await invokeLocalBackend(input)
    // LOCAL_ONLY must never silently reach external, on any failure — including ones the local
    // adapter itself classified as plain FAILED rather than NO_LOCAL_BACKEND.
    if (local.ok) return local
    return local.backend.status === 'NO_LOCAL_BACKEND'
      ? local
      : { ...local, backend: { ...local.backend, status: 'NO_LOCAL_BACKEND' } }
  }

  if (policy === 'LOCAL_FIRST') return invokeLocalThenExternal(input)

  return invokeExternalThenLocal(input) // EXTERNAL_FIRST
}

function policyForMode(mode: CouncilRoutingMode, seat: ModelBackendInvokeInput['seat']): SeatBackendPolicy {
  if (mode === 'LOCAL_ONLY') return 'LOCAL_ONLY'
  if (mode === 'EXTERNAL_ONLY') return 'EXTERNAL_ONLY'
  if (mode === 'LOCAL_FIRST') return 'LOCAL_FIRST'
  return resolveSeatBackendPolicy(seat) // HYBRID
}

/**
 * Council Seat Router. Resolves which backend answers for a seat under the active routing mode,
 * invokes it, and returns the answer with full backend provenance (including fallback history).
 *
 * EXTERNAL_ONLY — the default, see routingMode.ts — resolves to invokeForPolicy('EXTERNAL_ONLY',
 * ...), which is `invokeExternalBackend` and nothing else: a pure pass-through to the existing,
 * unmodified streamProvider.ts path. Council behavior is unchanged unless an operator explicitly
 * sets COUNCIL_ROUTING_MODE.
 */
export async function invokeCouncilSeat(input: ModelBackendInvokeInput): Promise<ModelBackendInvokeResult> {
  const mode: CouncilRoutingMode = input.routingModeOverride ?? resolveCouncilRoutingMode()
  const policy = policyForMode(mode, input.seat)
  return invokeForPolicy(policy, input)
}

export { resolveCouncilRoutingMode, resolveSeatBackendPolicy, localRoutingBypassesCloudFloorGate } from './routingMode'

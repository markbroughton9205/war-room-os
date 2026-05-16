import { RUNTIME_STATE_KEYS } from '@/lib/runtime/runtimeContinuityConstants'
import type { EngineStatus } from '@/lib/engine-control/types'
import type { DiagnosticHistoryEvent } from '@/lib/runtime/runtimeContinuityTypes'
import type { RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'

export type RuntimeContinuityIndicatorMode = 'Live' | 'Recovered' | 'Historical' | 'Refreshing' | 'Unknown'

export type RuntimeRecoveryApiResponse = {
  persistenceConfigured: boolean
  bundle: {
    recoveredFromStorageAt: string
    integrityPartial: unknown
    providerSlots: unknown
    attendanceSummary: unknown
    diagnosticHistory: DiagnosticHistoryEvent[]
    diagnosticModeSummary: unknown
    redTeamHoldUnresolved: unknown
  } | null
  error?: string
  runtimeStateTableMissing?: boolean
  runtimeStateReadFailed?: boolean
  fallbackEngines?: EngineStatus[]
  fallbackProviderRegistryUsed?: boolean
}

export async function fetchRuntimeRecoveryBundle(): Promise<RuntimeRecoveryApiResponse> {
  try {
    const res = await fetch('/api/runtime/state', { cache: 'no-store' })
    const j = (await res.json()) as RuntimeRecoveryApiResponse
    if (!res.ok) return { persistenceConfigured: false, bundle: null, error: j.error ?? res.statusText }
    return j
  } catch (e) {
    return {
      persistenceConfigured: false,
      bundle: null,
      error: e instanceof Error ? e.message : 'Network error',
    }
  }
}

export async function postRuntimeStatePatch(body: {
  set?: Partial<Record<(typeof RUNTIME_STATE_KEYS)[keyof typeof RUNTIME_STATE_KEYS], unknown>>
  appendDiagnosticEvents?: DiagnosticHistoryEvent[]
}): Promise<boolean> {
  try {
    const res = await fetch('/api/runtime/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await res.json()) as { ok?: boolean }
    return res.ok && Boolean(j.ok)
  } catch {
    return false
  }
}

export function buildIntegrityPersistencePayload(obj: RuntimeIntegrityResponse): Record<string, unknown> {
  return {
    [RUNTIME_STATE_KEYS.integritySnapshot]: obj,
    [RUNTIME_STATE_KEYS.providerSlots]: obj.providers ?? [],
  }
}

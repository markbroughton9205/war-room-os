'use client'

import { useCallback, useEffect, useState } from 'react'

export type SeatActiveStatus = 'READY' | 'DEGRADED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'UNKNOWN'
export type LocalCandidateHealth = 'READY' | 'UNAVAILABLE' | 'MODEL_NOT_INSTALLED' | 'NOT_CONFIGURED'

export type SeatBackendStatus = {
  seat: string
  label: string
  active: {
    backendType: 'EXTERNAL'
    provider: string
    model: string
    status: SeatActiveStatus
    failureClass?: 'AUTH' | 'RATE_LIMIT'
    latencyMs: number | null
    /** null = unknown/not observed — this is a passive snapshot with no per-invocation telemetry, never a claim of "no fallback". */
    fallbackUsed: boolean | null
    fallbackReason: string | null
    note: string
  }
  localCandidate: {
    roleSlot: string | null
    repo: string | null
    modelId: string | null
    quantization: string | null
    enabled: boolean
    health: LocalCandidateHealth
  }
}

export type LocalRegistryRow = {
  slot: string
  repo: string
  modelId: string
  quantization: string
  runtime: string
  residentPolicy: string
  enabled: boolean
  health: LocalCandidateHealth
}

export type BackendStatusSnapshot = {
  generatedAt: string
  routingFoundation: string
  /** True: app/api/chat/execute.ts genuinely calls invokeCouncilSeat(). NOT a claim that local is active. */
  liveRoutingWired: boolean
  routingModeResolved: string
  localBackendAvailable: boolean
  /** Real readiness/eligibility (config + current health + mode permits local). NOT proof any live seat actually ran locally. */
  localReadyForLiveRouting: boolean
  /** Always 'UNKNOWN' — no per-invocation telemetry exists yet. Never infer this from localReadyForLiveRouting. */
  localServingLiveSeats: 'UNKNOWN'
  routingModeNote: string
  localModelPool: string
  ollama: { reachable: boolean; baseUrl: string; installedModelCount: number; probeLatencyMs: number }
  seats: SeatBackendStatus[]
  diversity: { uniqueModels: number; totalRespondingSeats: number; sharedModelGroups: { model: string; seats: string[] }[] }
  localRegistry: LocalRegistryRow[]
  guardrails: Record<string, boolean | string>
}

/**
 * Fetch/loading/error logic for GET /api/council/backend-status, extracted out of
 * CouncilBackendStatusPanel.tsx so the panel stays presentational. Same endpoint, same one-shot
 * fetch-on-mount + manual `load()` refresh (no polling, matching the panel's prior behavior
 * exactly), same error semantics — no new network requests introduced.
 */
export function useCouncilBackendStatus() {
  const [snapshot, setSnapshot] = useState<BackendStatusSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/council/backend-status', { cache: 'no-store' })
      const body = (await res.json()) as BackendStatusSnapshot & { error?: string }
      if (!res.ok) throw new Error((body as { error?: string }).error || 'Council backend status failed')
      setSnapshot(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Council backend status failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  return { snapshot, loading, error, load }
}

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
    fallbackUsed: boolean
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
  liveRouting: string
  routingModeResolved: string
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

import type { ProviderRuntimeId } from '@/lib/providers/health'
import type { ResponseIntegrityStatus } from '@/lib/providers/responseIntegrity'

export type ProviderTransportStatus = 'reachable' | 'unreachable' | 'unknown'
export type ProviderAuthStatus = 'authenticated' | 'missing_key' | 'invalid_key' | 'unknown'
export type ProviderLatencyStatus = 'ok' | 'slow' | 'timeout' | 'unknown'

export type ProviderIntegrityRuntimeSnapshot = {
  transport_status: ProviderTransportStatus
  auth_status: ProviderAuthStatus
  latency_status: ProviderLatencyStatus
  response_integrity_status: ResponseIntegrityStatus | 'UNKNOWN'
  last_complete_response_at: string | null
  last_incomplete_response_at: string | null
  consecutive_integrity_failures: number
  degraded_reason: string | null
  retry_count: number
  fallback_used: boolean
  last_fallback_provider: ProviderRuntimeId | null
}

const snapshots: Partial<Record<ProviderRuntimeId, ProviderIntegrityRuntimeSnapshot>> = {}

function defaultSnapshot(): ProviderIntegrityRuntimeSnapshot {
  return {
    transport_status: 'unknown',
    auth_status: 'unknown',
    latency_status: 'unknown',
    response_integrity_status: 'UNKNOWN',
    last_complete_response_at: null,
    last_incomplete_response_at: null,
    consecutive_integrity_failures: 0,
    degraded_reason: null,
    retry_count: 0,
    fallback_used: false,
    last_fallback_provider: null,
  }
}

export function getProviderIntegritySnapshot(providerId: ProviderRuntimeId): ProviderIntegrityRuntimeSnapshot {
  return { ...(snapshots[providerId] ?? defaultSnapshot()) }
}

export function getAllProviderIntegritySnapshots(): Record<ProviderRuntimeId, ProviderIntegrityRuntimeSnapshot> {
  const ids: ProviderRuntimeId[] = ['openai', 'anthropic', 'google', 'xai', 'tavily', 'firecrawl']
  return Object.fromEntries(ids.map(id => [id, getProviderIntegritySnapshot(id)])) as Record<
    ProviderRuntimeId,
    ProviderIntegrityRuntimeSnapshot
  >
}

export function recordProviderIntegrityOutcome(args: {
  providerId: ProviderRuntimeId
  integrityStatus: ResponseIntegrityStatus
  reason: string
  transportStatus?: ProviderTransportStatus
  authStatus?: ProviderAuthStatus
  latencyMs?: number | null
  retryIncrement?: number
  fallbackProvider?: ProviderRuntimeId | null
}): ProviderIntegrityRuntimeSnapshot {
  const prev = snapshots[args.providerId] ?? defaultSnapshot()
  const now = new Date().toISOString()
  const complete = args.integrityStatus === 'COMPLETE'
  const failures = complete ? 0 : prev.consecutive_integrity_failures + 1
  const latencyStatus: ProviderLatencyStatus =
    args.latencyMs == null
      ? prev.latency_status
      : args.latencyMs > 12_000
        ? 'slow'
        : 'ok'

  const next: ProviderIntegrityRuntimeSnapshot = {
    transport_status: args.transportStatus ?? prev.transport_status,
    auth_status: args.authStatus ?? prev.auth_status,
    latency_status: latencyStatus,
    response_integrity_status: args.integrityStatus,
    last_complete_response_at: complete ? now : prev.last_complete_response_at,
    last_incomplete_response_at: complete ? prev.last_incomplete_response_at : now,
    consecutive_integrity_failures: failures,
    degraded_reason: complete
      ? failures > 0
        ? prev.degraded_reason
        : null
      : failures >= 2
        ? `DEGRADED_RESPONSE_INTEGRITY: ${args.reason}`
        : args.reason,
    retry_count: prev.retry_count + (args.retryIncrement ?? 0),
    fallback_used: Boolean(args.fallbackProvider) || prev.fallback_used,
    last_fallback_provider: args.fallbackProvider ?? prev.last_fallback_provider,
  }

  if (!complete && failures >= 2) {
    next.degraded_reason = `DEGRADED_RESPONSE_INTEGRITY: ${args.reason}`
  }

  snapshots[args.providerId] = next
  return { ...next }
}

export function resetProviderIntegrityRetryCount(providerId: ProviderRuntimeId): void {
  const prev = snapshots[providerId]
  if (!prev) return
  snapshots[providerId] = { ...prev, retry_count: 0 }
}

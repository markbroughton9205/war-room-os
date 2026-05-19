import type { ProviderRuntimeId } from '@/lib/providers/health'
import type { ResponseIntegrityStatus } from '@/lib/providers/responseIntegrity'

export type ProviderTransportStatus = 'reachable' | 'unreachable' | 'unknown'
export type ProviderAuthStatus = 'authenticated' | 'missing_key' | 'invalid_key' | 'unknown'
export type ProviderLatencyStatus = 'ok' | 'slow' | 'timeout' | 'unknown'

export type ProviderCallDiagnostics = {
  prompt_chars: number | null
  completion_chars: number | null
  truncation_detected: boolean
  retry_attempts: number
  integrity_failures: number
  fallback_used: boolean
  last_retry_strategy: string | null
  finish_reason: string | null
}

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
  diagnostics: ProviderCallDiagnostics
}

const snapshots: Partial<Record<ProviderRuntimeId, ProviderIntegrityRuntimeSnapshot>> = {}

function defaultDiagnostics(): ProviderCallDiagnostics {
  return {
    prompt_chars: null,
    completion_chars: null,
    truncation_detected: false,
    retry_attempts: 0,
    integrity_failures: 0,
    fallback_used: false,
    last_retry_strategy: null,
    finish_reason: null,
  }
}

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
    diagnostics: defaultDiagnostics(),
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
  diagnostics?: Partial<ProviderCallDiagnostics>
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

  const diagIn = args.diagnostics ?? {}
  const truncationDetected =
    diagIn.truncation_detected
    ?? (args.integrityStatus === 'TRUNCATED' || /truncat|max_tokens|length/i.test(args.reason))

  const nextDiagnostics: ProviderCallDiagnostics = {
    prompt_chars: diagIn.prompt_chars ?? prev.diagnostics.prompt_chars,
    completion_chars: diagIn.completion_chars ?? prev.diagnostics.completion_chars,
    truncation_detected: truncationDetected,
    retry_attempts:
      diagIn.retry_attempts ?? prev.diagnostics.retry_attempts + (args.retryIncrement ?? 0),
    integrity_failures:
      complete
        ? prev.diagnostics.integrity_failures
        : (diagIn.integrity_failures ?? prev.diagnostics.integrity_failures + 1),
    fallback_used: Boolean(args.fallbackProvider) || diagIn.fallback_used === true || prev.diagnostics.fallback_used,
    last_retry_strategy: diagIn.last_retry_strategy ?? prev.diagnostics.last_retry_strategy,
    finish_reason: diagIn.finish_reason ?? prev.diagnostics.finish_reason,
  }

  const degradedQuality = args.integrityStatus === 'DEGRADED_RESPONSE_QUALITY'
  const degradedPrefix = degradedQuality ? 'DEGRADED_RESPONSE_QUALITY' : 'DEGRADED_RESPONSE_INTEGRITY'

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
      : failures >= 1
        ? `${degradedPrefix}: ${args.reason}`
        : args.reason,
    retry_count: prev.retry_count + (args.retryIncrement ?? 0),
    fallback_used: Boolean(args.fallbackProvider) || prev.fallback_used,
    last_fallback_provider: args.fallbackProvider ?? prev.last_fallback_provider,
    diagnostics: nextDiagnostics,
  }

  if (!complete && failures >= 2) {
    next.degraded_reason = `${degradedPrefix}: ${args.reason}`
  }

  snapshots[args.providerId] = next
  return { ...next }
}

export function resetProviderIntegrityRetryCount(providerId: ProviderRuntimeId): void {
  const prev = snapshots[providerId]
  if (!prev) return
  snapshots[providerId] = {
    ...prev,
    retry_count: 0,
    diagnostics: { ...prev.diagnostics, retry_attempts: 0, last_retry_strategy: null },
  }
}

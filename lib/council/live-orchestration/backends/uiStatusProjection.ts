import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { BackendMetadata, BackendType, CouncilRoutingMode, LocalRoleSlot } from './types'

/** Live chat execute.ts is not wired to invokeCouncilSeat() in this mission. */
export const LIVE_COUNCIL_ROUTING_WIRED = false

/** The committed local-backend foundation is present; this is not a live-routing claim. */
export const LOCAL_BACKEND_FOUNDATION_READY = true

export type SeatBackendUiStatus =
  | 'READY'
  | 'UNAVAILABLE'
  | 'MODEL_NOT_INSTALLED'
  | 'RATE_LIMITED'
  | 'UNKNOWN'

export type DiversityClassification = 'CONFIGURED' | 'LIVE'

export type SeatBackendStatusRow = {
  seat: CouncilOrchestrationFamily
  backendType: BackendMetadata['backendType']
  provider: string
  runtime: string | null
  model: string
  quantization: string | null
  status: SeatBackendUiStatus
  /** Compressed 3-state view retained for the local-backend foundation suite. */
  ready: 'READY' | 'UNAVAILABLE' | 'RATE_LIMITED'
  fallbackUsed: boolean
  fallbackFrom: BackendType | null
  fallbackReason: string | null
  latencyMs: number | null
  failureClass: string | null
  localRoleSlot: LocalRoleSlot | null
}

export type LocalModelPoolRow = {
  slot: LocalRoleSlot
  candidateModel: string
  repo: string
  enabled: boolean
  runtime: string
  health: SeatBackendUiStatus | 'NOT_CONFIGURED'
  residentPolicy: string
  quantization: string
  reuseNote: string | null
}

export type CouncilBackendStatusSnapshot = {
  generatedAt: string
  routingMode: CouncilRoutingMode
  liveRoutingWired: boolean
  foundationReady: boolean
  seats: SeatBackendStatusRow[]
  localModelPool: LocalModelPoolRow[]
  diversity: {
    classification: DiversityClassification
    uniqueModels: number
    totalRespondingSeats: number
    sharedModelGroups: { model: string; seats: CouncilOrchestrationFamily[] }[]
  }
}

export function projectUiStatus(backend: BackendMetadata): SeatBackendUiStatus {
  if (backend.status === 'OK') return 'READY'
  if (backend.failureClass === 'RATE_LIMIT') return 'RATE_LIMITED'
  if (backend.failureClass === 'MODEL_NOT_INSTALLED') return 'MODEL_NOT_INSTALLED'
  if (backend.failureClass === 'LOCAL_UNAVAILABLE') return 'UNAVAILABLE'
  if (backend.failureClass === 'UNKNOWN') return 'UNKNOWN'
  if (
    backend.status === 'UNAVAILABLE'
    || backend.status === 'NO_LOCAL_BACKEND'
    || backend.status === 'FAILED'
    || backend.status === 'TIMED_OUT'
  ) {
    return 'UNAVAILABLE'
  }
  return 'UNKNOWN'
}

function compressedReady(status: SeatBackendUiStatus): SeatBackendStatusRow['ready'] {
  if (status === 'READY') return 'READY'
  if (status === 'RATE_LIMITED') return 'RATE_LIMITED'
  return 'UNAVAILABLE'
}

export function runtimeLabelForBackend(backend: BackendMetadata): string | null {
  if (backend.backendType !== 'LOCAL') return null
  if (backend.provider === 'ollama') return 'Ollama'
  return backend.provider || null
}

export function measuredLatencyMs(backend: BackendMetadata): number | null {
  if (typeof backend.latencyMs !== 'number' || !Number.isFinite(backend.latencyMs) || backend.latencyMs < 0) {
    return null
  }
  return backend.latencyMs
}

/**
 * Pure projection from seat invocation results to the Commander status-row shape
 * (seat / backend / provider-or-runtime / model / status / fallback / latency).
 * Seat identity is never overwritten by backend identity.
 */
export function projectSeatBackendStatusRows(
  results: { seat: CouncilOrchestrationFamily; backend: BackendMetadata; localRoleSlot?: LocalRoleSlot | null }[],
): SeatBackendStatusRow[] {
  return results.map(({ seat, backend, localRoleSlot }) => {
    const status = projectUiStatus(backend)
    return {
      seat,
      backendType: backend.backendType,
      provider: backend.provider,
      runtime: runtimeLabelForBackend(backend),
      model: backend.model,
      quantization: backend.quantization ?? null,
      status,
      ready: compressedReady(status),
      fallbackUsed: Boolean(backend.fallbackFrom),
      fallbackFrom: backend.fallbackFrom ?? null,
      fallbackReason: backend.fallbackReason ?? null,
      latencyMs: measuredLatencyMs(backend),
      failureClass: backend.failureClass ?? null,
      localRoleSlot: localRoleSlot ?? null,
    }
  })
}

export function formatBackendLatency(latencyMs: number | null | undefined): string {
  if (latencyMs == null || !Number.isFinite(latencyMs) || latencyMs < 0) return '—'
  if (latencyMs >= 1000) {
    const seconds = latencyMs / 1000
    const digits = seconds >= 10 ? 0 : 1
    return `${seconds.toFixed(digits)} s`
  }
  return `${Math.round(latencyMs)} ms`
}

export function formatFallbackVisibility(row: Pick<SeatBackendStatusRow, 'fallbackUsed' | 'fallbackFrom' | 'backendType'>): string {
  if (!row.fallbackUsed) return 'NO'
  if (row.fallbackFrom && row.backendType) return `${row.fallbackFrom} → ${row.backendType}`
  return 'YES'
}

export function formatLiveRoutingWired(wired: boolean): 'YES' | 'NO' {
  return wired ? 'YES' : 'NO'
}

export function unknownCouncilBackendStatusSnapshot(
  routingMode: CouncilRoutingMode = 'EXTERNAL_ONLY',
): CouncilBackendStatusSnapshot {
  return {
    generatedAt: '',
    routingMode,
    liveRoutingWired: LIVE_COUNCIL_ROUTING_WIRED,
    foundationReady: LOCAL_BACKEND_FOUNDATION_READY,
    seats: [],
    localModelPool: [],
    diversity: {
      classification: 'CONFIGURED',
      uniqueModels: 0,
      totalRespondingSeats: 0,
      sharedModelGroups: [],
    },
  }
}

const SECRET_KEY_PATTERN = /^(authorization|x-api-key|api[_-]?key|secret|token|password|cookie|authheader|auth_header)$/i
const SECRET_VALUE_PATTERN = /(bearer\s+\S+|sk-[a-zA-Z0-9_-]{8,}|xai-[a-zA-Z0-9_-]{8,}|AIza[a-zA-Z0-9_-]{8,})/i

export function redactSecretText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/xai-[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/AIza[a-zA-Z0-9_-]{8,}/g, '[redacted]')
}

export function stripSecretBearingValue<T>(value: T): T {
  if (typeof value === 'string') return redactSecretText(value) as T
  if (Array.isArray(value)) return value.map(item => stripSecretBearingValue(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) continue
      out[key] = stripSecretBearingValue(nested)
    }
    return out as T
  }
  return value
}

export function statusPayloadContainsForbiddenSecrets(serialized: string, extraForbiddenValues: string[] = []): boolean {
  if (SECRET_VALUE_PATTERN.test(serialized)) return true
  if (/authorization/i.test(serialized) || /x-api-key/i.test(serialized) || /bearer /i.test(serialized)) return true
  return extraForbiddenValues.some(value => value.length > 0 && serialized.includes(value))
}

export function safeHostLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.username || parsed.password) return parsed.hostname || 'ollama'
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return 'ollama'
  }
}

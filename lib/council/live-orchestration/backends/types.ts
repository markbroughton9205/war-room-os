import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilFailureLayer } from '../types'
import type { StreamDeltaHandler } from '../streamContract'

/**
 * Seat/backend decoupling. `CouncilOrchestrationFamily` (chatgpt, claude, grok, gemini,
 * nova, red_team, baby, bridge_architect) is the Council seat identity. Historical persisted
 * `kimi` rows may still be read via migrateLegacyPersistedSeat; that is not a live provider.
 */

export type BackendType = 'LOCAL' | 'EXTERNAL'

export type CouncilRoutingMode = 'LOCAL_ONLY' | 'LOCAL_FIRST' | 'HYBRID' | 'EXTERNAL_ONLY'

export const COUNCIL_ROUTING_MODES: CouncilRoutingMode[] = ['LOCAL_ONLY', 'LOCAL_FIRST', 'HYBRID', 'EXTERNAL_ONLY']

/** AUTO is a configured preference that resolves to one of COUNCIL_ROUTING_MODES. */

/** Per-seat override consulted only when the active mode is HYBRID. */
export type SeatBackendPolicy = 'LOCAL_ONLY' | 'LOCAL_FIRST' | 'EXTERNAL_FIRST' | 'EXTERNAL_ONLY'

/** Functional role slots in the local model pool — independent of any specific seat. */
export type LocalRoleSlot = 'GENERAL' | 'CODING' | 'RED_TEAM' | 'SYNTHESIS' | 'RESEARCH'

export type SeatInvokeStatus = 'OK' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE' | 'NO_LOCAL_BACKEND'

export type BackendMetadata = {
  backendType: BackendType
  /** e.g. 'ollama' | 'anthropic' | 'openai' | 'google' | 'xai' */
  provider: string
  /** Exact model id/tag actually invoked (or the best-known label when nothing was invoked). */
  model: string
  /** Local only: the upstream repo this tag was built from, when known. */
  repo?: string
  quantization?: string
  revision?: string
  /** Local host identifier (e.g. 'http://localhost:11434') or 'cloud' for external providers. */
  host: string
  latencyMs: number
  ttftMs?: number | null
  tokensPerSecond?: number | null
  status: SeatInvokeStatus
  failureClass?: CouncilFailureLayer
  /** Set only when routing policy actually fell back from one backend type to the other. */
  fallbackFrom?: BackendType
  fallbackReason?: string
  /** Normalized provider completion reason (e.g. Gemini's 'STOP'/'MAX_TOKENS'), propagated as-is
   * from NormalizedProviderStreamResult/StreamedCouncilCall when the underlying adapter's API
   * exposes one. Never fabricated — providers that don't supply one leave this undefined. */
  finishReason?: string | null
}

export type ModelBackendInvokeInput = {
  seat: CouncilOrchestrationFamily
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  signal: AbortSignal
  onDelta: StreamDeltaHandler
  timeoutKind: 'social' | 'council' | 'research'
  /** Testing/validation hook only — never used to bypass Commander-configured routing policy. */
  routingModeOverride?: CouncilRoutingMode
}

export type ModelBackendInvokeResult = {
  ok: boolean
  text: string
  partial: boolean
  backend: BackendMetadata
}

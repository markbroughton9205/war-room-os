import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilRoutingMode } from '@/lib/council/live-orchestration/backends/types'

/**
 * Council continuity: the Council is the synthesis layer, not a synonym for
 * OpenAI/Anthropic/xAI/Gemini key presence. Missing optional cloud credentials
 * must not collapse into COUNCIL UNAVAILABLE when sovereign local inference is ready.
 *
 * Qwen / Ollama is a local partner brain (currently backing NOVA and, when routing
 * allows, other seats). It is not WRIM, not Ra'el, and must never be labeled as a
 * frontier vendor.
 */

export const COUNCIL_OPERATIONAL_STATES = [
  'READY_MULTI_MODEL',
  'READY_HYBRID',
  'READY_LOCAL',
  'DEGRADED_PARTIAL',
  'UNAVAILABLE',
] as const

export type CouncilOperationalState = (typeof COUNCIL_OPERATIONAL_STATES)[number]

export const EXTERNAL_PROVIDER_STATES = [
  'AVAILABLE',
  'NOT_CONFIGURED',
  'AUTH_FAILED',
  'BILLING_BLOCKED',
  'NETWORK_ERROR',
  'PROVIDER_ERROR',
  'DISABLED',
  'UNKNOWN',
] as const

export type ExternalProviderState = (typeof EXTERNAL_PROVIDER_STATES)[number]

export type NetworkEgressState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'
export type ResearchProviderState = 'LIVE' | 'PARTIAL' | 'CONFIG_NEEDED' | 'UNWIRED'
export type LocalContinuityState = 'AVAILABLE' | 'UNAVAILABLE'

/** Configured routing preference, including AUTO. Effective invoke modes stay the four backends. */
export type CouncilRoutingPreference = CouncilRoutingMode | 'AUTO'

export const COUNCIL_ROUTING_PREFERENCES: CouncilRoutingPreference[] = [
  'AUTO',
  'LOCAL_ONLY',
  'LOCAL_FIRST',
  'HYBRID',
  'EXTERNAL_ONLY',
]

export const EXTERNAL_COUNCIL_PROVIDER_TOTAL = 4

export const CLOUD_PROVIDER_LABEL: Record<'chatgpt' | 'claude' | 'grok' | 'gemini', string> = {
  chatgpt: 'OpenAI',
  claude: 'Anthropic',
  grok: 'xAI',
  gemini: 'Gemini',
}

export function parseCouncilRoutingPreference(raw: string | undefined | null): CouncilRoutingPreference | null {
  if (!raw) return null
  const normalized = raw.trim().toUpperCase()
  if ((COUNCIL_ROUTING_PREFERENCES as string[]).includes(normalized)) {
    return normalized as CouncilRoutingPreference
  }
  return null
}

export function countConfiguredExternalProviders(configured: {
  chatgpt?: boolean
  claude?: boolean
  grok?: boolean
  gemini?: boolean
}): number {
  return [configured.chatgpt, configured.claude, configured.grok, configured.gemini].filter(Boolean).length
}

/**
 * AUTO effective mode: any configured cloud provider keeps hybrid/configured policy;
 * otherwise local continuity (LOCAL_FIRST). Never fabricates cloud availability.
 */
export function resolveAutoEffectiveMode(externalConfiguredCount: number): CouncilRoutingMode {
  return externalConfiguredCount > 0 ? 'HYBRID' : 'LOCAL_FIRST'
}

export function classifyCloudProviderState(input: {
  configured: boolean
  override?: string | null
}): ExternalProviderState {
  if (!input.configured) return 'NOT_CONFIGURED'
  const override = input.override?.trim().toUpperCase().replace(/\s+/g, '_') || null
  if (override === 'UNAVAILABLE_AUTH' || override === 'AUTH_FAILED') return 'AUTH_FAILED'
  if (override === 'UNAVAILABLE_BILLING' || override === 'BILLING_BLOCKED') return 'BILLING_BLOCKED'
  if (override === 'NETWORK_ERROR') return 'NETWORK_ERROR'
  if (override === 'PROVIDER_ERROR') return 'PROVIDER_ERROR'
  if (override === 'SKIPPED_BY_POLICY' || override === 'DISABLED') return 'DISABLED'
  if (override === 'UNAVAILABLE') return 'UNKNOWN'
  return 'AVAILABLE'
}

export function classifyCloudProviderStateFromHealth(health: string | undefined, configured: boolean): ExternalProviderState {
  if (!configured || health === 'MISSING_KEY') return 'NOT_CONFIGURED'
  if (health === 'INVALID_KEY') return 'AUTH_FAILED'
  if (health === 'RATE_LIMITED') return 'BILLING_BLOCKED'
  if (health === 'CONNECTED') return 'AVAILABLE'
  if (health === 'DEGRADED') return 'PROVIDER_ERROR'
  return 'UNKNOWN'
}

export function classifyCouncilOperationalState(input: {
  externalConfiguredCount: number
  externalAvailableCount?: number
  localReady: boolean
  configuredProviderFailed?: boolean
}): CouncilOperationalState {
  const available = input.externalAvailableCount ?? input.externalConfiguredCount
  const failed = Boolean(input.configuredProviderFailed) || available < input.externalConfiguredCount
  if (available <= 0 && !input.localReady) return 'UNAVAILABLE'
  if (failed && (available > 0 || input.localReady)) return 'DEGRADED_PARTIAL'
  if (input.localReady && available > 0) return 'READY_HYBRID'
  if (input.localReady) return 'READY_LOCAL'
  if (available >= 1) return 'READY_MULTI_MODEL'
  return 'UNAVAILABLE'
}

export function councilOperationalLabel(state: CouncilOperationalState): string {
  if (state === 'READY_LOCAL') return 'COUNCIL READY · LOCAL'
  if (state === 'READY_HYBRID') return 'COUNCIL READY · HYBRID'
  if (state === 'READY_MULTI_MODEL') return 'COUNCIL READY · MULTI-MODEL'
  if (state === 'DEGRADED_PARTIAL') return 'COUNCIL DEGRADED · PARTIAL'
  return 'COUNCIL UNAVAILABLE'
}

export function councilRoutingDisplay(
  effectiveMode: CouncilRoutingMode,
  state: CouncilOperationalState,
): 'LOCAL' | 'HYBRID' | 'EXTERNAL' | 'UNAVAILABLE' {
  if (state === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (effectiveMode === 'EXTERNAL_ONLY') return 'EXTERNAL'
  if (effectiveMode === 'HYBRID') return 'HYBRID'
  return 'LOCAL'
}

export function cloudStatusLine(family: 'chatgpt' | 'claude' | 'grok' | 'gemini', state: ExternalProviderState): string {
  const label = CLOUD_PROVIDER_LABEL[family]
  if (state === 'NOT_CONFIGURED') return `${label} · NOT CONFIGURED`
  if (state === 'AUTH_FAILED') return `${label} · AUTH FAILED`
  if (state === 'BILLING_BLOCKED') return `${label} · BILLING BLOCKED`
  if (state === 'NETWORK_ERROR') return `${label} · NETWORK ERROR`
  if (state === 'PROVIDER_ERROR') return `${label} · PROVIDER ERROR`
  if (state === 'DISABLED') return `${label} · DISABLED`
  if (state === 'AVAILABLE') return `${label} · AVAILABLE`
  return `${label} · UNKNOWN`
}

export function classifyNetworkEgress(directFetchStatus: string | undefined | null): NetworkEgressState {
  if (!directFetchStatus) return 'UNKNOWN'
  if (directFetchStatus === 'reachable') return 'AVAILABLE'
  if (directFetchStatus === 'error') return 'UNAVAILABLE'
  return 'UNKNOWN'
}

export function classifyResearchProviders(input: {
  tavilyConfigured?: boolean
  firecrawlConfigured?: boolean
  xaiConfigured?: boolean
  unwired?: boolean
}): ResearchProviderState {
  if (input.unwired) return 'UNWIRED'
  const n = [input.tavilyConfigured, input.firecrawlConfigured, input.xaiConfigured].filter(Boolean).length
  if (n === 0) return 'CONFIG_NEEDED'
  if (n < 3) return 'PARTIAL'
  return 'LIVE'
}

export function modelDiversityLabel(input: { externalAvailableCount: number; localReady: boolean }): string {
  if (input.externalAvailableCount >= 2 && input.localReady) return 'HYBRID'
  if (input.externalAvailableCount >= 2) return 'MULTI-MODEL'
  if (input.externalAvailableCount === 1 && input.localReady) return 'HYBRID'
  if (input.localReady) return 'LOCAL ONLY'
  if (input.externalAvailableCount === 1) return 'SINGLE EXTERNAL'
  return 'NONE'
}

export function novaContinuityRole(): {
  identity: 'NOVA'
  role: 'EXPLICIT_LOCAL_COUNCIL_SEAT'
  alsoServesAs: 'LOCAL_BACKING_IS_SHARED_GENERAL_BRAIN_NOT_NOVA_IDENTITY'
} {
  return {
    identity: 'NOVA',
    role: 'EXPLICIT_LOCAL_COUNCIL_SEAT',
    alsoServesAs: 'LOCAL_BACKING_IS_SHARED_GENERAL_BRAIN_NOT_NOVA_IDENTITY',
  }
}

export function cloudFamilyId(family: CouncilOrchestrationFamily): 'chatgpt' | 'claude' | 'grok' | 'gemini' | null {
  if (family === 'chatgpt' || family === 'claude' || family === 'grok' || family === 'gemini') return family
  return null
}

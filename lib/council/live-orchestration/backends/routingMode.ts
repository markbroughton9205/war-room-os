import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import {
  countConfiguredExternalProviders,
  parseCouncilRoutingPreference,
  resolveAutoEffectiveMode,
  type CouncilRoutingPreference,
} from '@/lib/council/live-orchestration/councilContinuity'
import { readPackagedCouncilRoutingPreference } from './packagedRoutingConfig'
import { COUNCIL_ROUTING_MODES, type CouncilRoutingMode, type SeatBackendPolicy } from './types'

const CANONICAL_DEFAULT_PREFERENCE: CouncilRoutingPreference = 'AUTO'

export const EXTERNAL_PROVIDER_ENV: Record<'chatgpt' | 'claude' | 'grok' | 'gemini', string> = {
  chatgpt: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  grok: 'XAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

export function configuredExternalCouncilProviders(env: NodeJS.ProcessEnv = process.env): {
  chatgpt: boolean
  claude: boolean
  grok: boolean
  gemini: boolean
} {
  return {
    chatgpt: envHasUsableProviderSecret(EXTERNAL_PROVIDER_ENV.chatgpt, env),
    claude: envHasUsableProviderSecret(EXTERNAL_PROVIDER_ENV.claude, env),
    grok: envHasUsableProviderSecret(EXTERNAL_PROVIDER_ENV.grok, env),
    gemini: envHasUsableProviderSecret(EXTERNAL_PROVIDER_ENV.gemini, env),
  }
}

export function externalCouncilProviderConfiguredCount(env: NodeJS.ProcessEnv = process.env): number {
  return countConfiguredExternalProviders(configuredExternalCouncilProviders(env))
}

/**
 * Configured routing preference (including AUTO).
 *
 * Order:
 * 1. explicit secure packaged configuration (`council-runtime.json` in AppData)
 * 2. Windows USER / process environment (`COUNCIL_ROUTING_MODE`)
 * 3. safe application setting (same env channel after spawn / Next load)
 * 4. canonical default AUTO
 *
 * Checkout `.env.local` is never read by packaged Electron; this resolver does not
 * open that file. Packaged children inherit env the desktop shell overlays.
 */
export function resolveCouncilRoutingPreference(env: NodeJS.ProcessEnv = process.env): CouncilRoutingPreference {
  const packaged = env === process.env ? readPackagedCouncilRoutingPreference() : null
  if (packaged) return packaged
  const fromEnv = parseCouncilRoutingPreference(env.COUNCIL_ROUTING_MODE)
  if (fromEnv) return fromEnv
  return CANONICAL_DEFAULT_PREFERENCE
}

/**
 * Effective invoke mode for seatRouter. AUTO expands from live cloud-key presence:
 * any configured external provider → HYBRID; otherwise LOCAL_FIRST.
 * Never reports a cloud provider as available without a usable key.
 */
export function resolveCouncilRoutingMode(env: NodeJS.ProcessEnv = process.env): CouncilRoutingMode {
  const preference = resolveCouncilRoutingPreference(env)
  if (preference !== 'AUTO' && (COUNCIL_ROUTING_MODES as string[]).includes(preference)) {
    return preference
  }
  return resolveAutoEffectiveMode(externalCouncilProviderConfiguredCount(env))
}

/**
 * Cloud API-key presence is backend availability, not Nebula agent eligibility.
 * LOCAL_FIRST / LOCAL_ONLY / HYBRID (including AUTO that resolves to those) must keep
 * ASTRA-selected seats on the floor so invokeCouncilSeat can route them to Ollama.
 */
export function localRoutingBypassesCloudFloorGate(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveCouncilRoutingMode(env) !== 'EXTERNAL_ONLY'
}

/**
 * Default per-seat policy consulted only under HYBRID. grok/gemini favor EXTERNAL_FIRST because
 * their Council role depends on live grounding/current signal that local weights don't have;
 * red_team is pinned LOCAL_ONLY for maximum candor with no external logging; the rest default
 * to LOCAL_FIRST. Commander-editable via COUNCIL_SEAT_BACKEND_POLICY (JSON, e.g.
 * {"red_team":"LOCAL_ONLY","grok":"EXTERNAL_FIRST"}) — unrecognized/invalid entries are ignored.
 */
const DEFAULT_HYBRID_SEAT_POLICY: Record<CouncilOrchestrationFamily, SeatBackendPolicy> = {
  claude: 'LOCAL_FIRST',
  chatgpt: 'LOCAL_FIRST',
  baby: 'LOCAL_FIRST',
  nova: 'LOCAL_FIRST',
  bridge_architect: 'LOCAL_FIRST',
  red_team: 'LOCAL_ONLY',
  grok: 'EXTERNAL_FIRST',
  gemini: 'EXTERNAL_FIRST',
}

const SEAT_BACKEND_POLICIES: SeatBackendPolicy[] = ['LOCAL_ONLY', 'LOCAL_FIRST', 'EXTERNAL_FIRST', 'EXTERNAL_ONLY']

function parseSeatPolicyOverrides(env: NodeJS.ProcessEnv = process.env): Partial<Record<CouncilOrchestrationFamily, SeatBackendPolicy>> {
  const raw = env.COUNCIL_SEAT_BACKEND_POLICY?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    const overrides: Partial<Record<CouncilOrchestrationFamily, SeatBackendPolicy>> = {}
    for (const [seat, policy] of Object.entries(parsed)) {
      if ((SEAT_BACKEND_POLICIES as string[]).includes(policy)) {
        overrides[seat as CouncilOrchestrationFamily] = policy as SeatBackendPolicy
      }
    }
    return overrides
  } catch {
    return {}
  }
}

export function resolveSeatBackendPolicy(seat: CouncilOrchestrationFamily, env: NodeJS.ProcessEnv = process.env): SeatBackendPolicy {
  const overrides = parseSeatPolicyOverrides(env)
  return overrides[seat] ?? DEFAULT_HYBRID_SEAT_POLICY[seat] ?? 'LOCAL_FIRST'
}

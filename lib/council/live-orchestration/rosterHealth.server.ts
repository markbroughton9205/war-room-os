import 'server-only'

import { envHasUsableProviderSecret } from '@/lib/providers/secretPresence'
import {
  buildCouncilRosterSnapshot,
  withNebulaLocalDisplayOverride,
  type CouncilRosterSnapshot,
  type RosterContinuityInput,
  type RosterPolicyOverride,
} from './rosterHealth'
import { classifyNetworkEgress, classifyResearchProviders } from './councilContinuity'
import { localRoutingBypassesCloudFloorGate, resolveCouncilRoutingMode, resolveCouncilRoutingPreference } from './backends/routingMode'
import { SEAT_LOCAL_ROLE_SLOT } from './backends/seatRoleSlot'
import { type OllamaProbeResult } from '@/lib/native-builder/ollamaClient'
import { localCandidateHealthFromProbe } from './backends/localBackend'
import { localRegistryEntryForSlot } from './backends/localModelRegistry'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  backendExecutionLabel,
  snapshotLocalModelArbiter,
  type LocalModelArbiterSnapshot,
} from '@/lib/native-builder/localModelArbiter'

export function readRosterPolicyOverrides(env: NodeJS.ProcessEnv = process.env): RosterPolicyOverride {
  return {
    chatgpt: env.WR_COUNCIL_ROSTER_CHATGPT,
    claude: env.WR_COUNCIL_ROSTER_CLAUDE,
    grok: env.WR_COUNCIL_ROSTER_GROK,
    gemini: env.WR_COUNCIL_ROSTER_GEMINI,
    red_team: env.WR_COUNCIL_ROSTER_RED_TEAM,
  }
}

function cloudConfigured(env: NodeJS.ProcessEnv) {
  return {
    chatgpt: envHasUsableProviderSecret('OPENAI_API_KEY', env),
    claude: envHasUsableProviderSecret('ANTHROPIC_API_KEY', env),
    grok: envHasUsableProviderSecret('XAI_API_KEY', env),
    gemini: envHasUsableProviderSecret('GEMINI_API_KEY', env),
    red_team: envHasUsableProviderSecret('ANTHROPIC_API_KEY', env),
  }
}

function researchFromEnv(env: NodeJS.ProcessEnv): RosterContinuityInput['researchProviders'] {
  return classifyResearchProviders({
    tavilyConfigured: envHasUsableProviderSecret('TAVILY_API_KEY', env),
    firecrawlConfigured: envHasUsableProviderSecret('FIRECRAWL_API_KEY', env),
    xaiConfigured: envHasUsableProviderSecret('XAI_API_KEY', env),
  })
}

export function resolveLiveCouncilRoster(env: NodeJS.ProcessEnv = process.env): CouncilRosterSnapshot {
  return buildCouncilRosterSnapshot({
    configured: cloudConfigured(env),
    overrides: readRosterPolicyOverrides(env),
    continuity: {
      localReady: false,
      routingPreference: resolveCouncilRoutingPreference(env),
      routingModeResolved: resolveCouncilRoutingMode(env),
      terraConnection: 'UNKNOWN',
      networkEgress: 'UNKNOWN',
      researchProviders: researchFromEnv(env),
    },
  })
}

export function localCouncilModelReadyFromProbe(probe: Pick<OllamaProbeResult, 'available' | 'models'>): boolean {
  const entry = localRegistryEntryForSlot('GENERAL')
  return localCandidateHealthFromProbe(entry, probe as OllamaProbeResult) === 'READY'
}

export function localCouncilModelIdFromProbe(probe: Pick<OllamaProbeResult, 'available' | 'models'>): string | null {
  const entry = localRegistryEntryForSlot('GENERAL')
  if (!entry || !localCouncilModelReadyFromProbe(probe)) return null
  return entry.modelId
}

export async function probeTerraConnection(): Promise<CouncilRosterSnapshot['terraConnection']> {
  const origin = (process.env.WAR_ROOM_LOCAL_CORE_ORIGIN?.trim() || 'http://127.0.0.1:3847').replace(/\/+$/, '')
  try {
    const res = await fetch(`${origin}/api/local/health`, { signal: AbortSignal.timeout(1500), cache: 'no-store' })
    return res.ok ? 'CONNECTED' : 'DISCONNECTED'
  } catch {
    return 'DISCONNECTED'
  }
}

export async function probeNetworkEgress(): Promise<CouncilRosterSnapshot['networkEgress']> {
  try {
    const res = await fetch('https://example.com', { method: 'GET', signal: AbortSignal.timeout(1500), cache: 'no-store' })
    return classifyNetworkEgress(res.ok ? 'reachable' : 'error')
  } catch {
    return 'UNAVAILABLE'
  }
}

export function familyIsFloorEligible(family: CouncilOrchestrationFamily, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveLiveCouncilRoster(env).families[family]?.floorEligible === true
}

function locallyEnabledSeats(): Partial<Record<CouncilOrchestrationFamily, boolean>> {
  const locallyEnabled: Partial<Record<CouncilOrchestrationFamily, boolean>> = {}
  for (const family of ['chatgpt', 'claude', 'grok', 'gemini', 'red_team', 'nova'] as CouncilOrchestrationFamily[]) {
    const slot = SEAT_LOCAL_ROLE_SLOT[family]
    locallyEnabled[family] = Boolean(slot && localRegistryEntryForSlot(slot))
  }
  return locallyEnabled
}

/**
 * Commander-facing display variant. Cloud-key floor used for real external-routing decisions
 * (app/api/chat/execute.ts liveCouncilFloor) is unaffected. When routing permits local and the
 * local model is ready, seats keep honest cloud vendor lines and expose local continuity separately.
 */
export function resolveDisplayCouncilRoster(
  env: NodeJS.ProcessEnv = process.env,
  continuity?: Pick<RosterContinuityInput, 'localReady' | 'localModel' | 'terraConnection' | 'networkEgress' | 'researchProviders'>,
): CouncilRosterSnapshot {
  const base = resolveLiveCouncilRoster(env)
  const routingPreference = resolveCouncilRoutingPreference(env)
  const routingModeResolved = resolveCouncilRoutingMode(env)
  const localRouting = localRoutingBypassesCloudFloorGate(env)
  const registryLocal = Object.values(locallyEnabledSeats()).some(Boolean)
  const localReady = localRouting && Boolean(continuity?.localReady ?? registryLocal)
  const merged: RosterContinuityInput = {
    localReady,
    localModel: continuity?.localModel ?? null,
    routingPreference,
    routingModeResolved,
    terraConnection: continuity?.terraConnection ?? base.terraConnection,
    networkEgress: continuity?.networkEgress ?? base.networkEgress,
    researchProviders: continuity?.researchProviders ?? researchFromEnv(env),
  }
  if (!localRouting && !localReady) {
    return attachDisplayContinuity(base, merged)
  }
  return withNebulaLocalDisplayOverride(base, locallyEnabledSeats(), merged)
}

function attachDisplayContinuity(
  snapshot: CouncilRosterSnapshot,
  continuity: RosterContinuityInput,
): CouncilRosterSnapshot {
  return withNebulaLocalDisplayOverride(snapshot, {}, continuity)
}

export function attachLocalModelArbiterToRoster(
  snapshot: CouncilRosterSnapshot,
  arbiter: LocalModelArbiterSnapshot,
): CouncilRosterSnapshot {
  return {
    ...snapshot,
    backendExecutionState: arbiter.councilBackendExecutionState,
    backendExecutionLabel: backendExecutionLabel(arbiter.councilBackendExecutionState),
    gpuOwner: arbiter.gpuOwner,
  }
}

export async function overlayLiveLocalModelArbiter(
  snapshot: CouncilRosterSnapshot,
): Promise<CouncilRosterSnapshot> {
  try {
    return attachLocalModelArbiterToRoster(snapshot, await snapshotLocalModelArbiter())
  } catch {
    return snapshot
  }
}

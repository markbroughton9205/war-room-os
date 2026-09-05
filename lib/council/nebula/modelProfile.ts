import { NEBULA_AGENT_IDS, NEBULA_AGENTS_BY_ID, NEBULA_IDENTITY_BY_SEAT, type NebulaAgentId } from './identity'
import { SEAT_LOCAL_ROLE_SLOT } from '@/lib/council/live-orchestration/backends/seatRoleSlot'
import { localRegistryEntryForSlot } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import type { LocalRoleSlot } from '@/lib/council/live-orchestration/backends/types'

/**
 * Current backend assignment for permanent Nebula agents.
 *
 * IDENTITY != MODEL. These profiles describe the brain/runtime in use today, not who the agent is.
 * Phase 1C Commander decision: all eight permanent agents share one Genesis GENERAL weight.
 * Do not invent per-agent billion-parameter uniqueness.
 */

export const NEBULA_SHARED_LOCAL_MODEL_ID = 'huihui_ai/qwen3-abliterated:14b' as const
export const NEBULA_SHARED_PARAMETER_CLASS = '14B' as const
export const NEBULA_SHARED_RUNTIME = 'ollama' as const
export const NEBULA_SHARED_ROLE_SLOT: LocalRoleSlot = 'GENERAL'

export type NebulaModelProfile = {
  agentId: NebulaAgentId
  preferredRoleSlot: LocalRoleSlot
  preferredModel: typeof NEBULA_SHARED_LOCAL_MODEL_ID
  parameterClass: typeof NEBULA_SHARED_PARAMETER_CLASS
  runtime: typeof NEBULA_SHARED_RUNTIME
  sharedBacking: true
  residentPolicy: 'ALWAYS_RESIDENT'
  fallbackPolicy: string
  capabilities: readonly string[]
  backendPerformance: Readonly<Record<string, number>>
}

const SHARED_FALLBACK_POLICY =
  'Local GENERAL first when the routing mode permits local; then the seat\'s configured frontier provider. Identity never falls back to another Nebula agent.'

function profileFor(agentId: NebulaAgentId): NebulaModelProfile {
  return {
    agentId,
    preferredRoleSlot: NEBULA_SHARED_ROLE_SLOT,
    preferredModel: NEBULA_SHARED_LOCAL_MODEL_ID,
    parameterClass: NEBULA_SHARED_PARAMETER_CLASS,
    runtime: NEBULA_SHARED_RUNTIME,
    sharedBacking: true,
    residentPolicy: 'ALWAYS_RESIDENT',
    fallbackPolicy: SHARED_FALLBACK_POLICY,
    capabilities: NEBULA_AGENTS_BY_ID[agentId].capabilities,
    backendPerformance: Object.freeze({}),
  }
}

export const NEBULA_MODEL_PROFILES: Readonly<Record<NebulaAgentId, NebulaModelProfile>> = Object.freeze(
  Object.fromEntries(NEBULA_AGENT_IDS.map(id => [id, profileFor(id)])) as Record<NebulaAgentId, NebulaModelProfile>,
)

export function nebulaModelProfile(agentId: NebulaAgentId): NebulaModelProfile {
  return NEBULA_MODEL_PROFILES[agentId]
}

export function allPermanentAgentsShareGenesisGeneral(): boolean {
  const general = localRegistryEntryForSlot('GENERAL')
  if (!general || general.modelId !== NEBULA_SHARED_LOCAL_MODEL_ID || general.runtime !== 'ollama') return false
  return NEBULA_AGENT_IDS.every(id => {
    const profile = NEBULA_MODEL_PROFILES[id]
    const identitySlot = NEBULA_AGENTS_BY_ID[id].backendPreference.roleSlot
    return (
      profile.preferredModel === NEBULA_SHARED_LOCAL_MODEL_ID
      && profile.preferredRoleSlot === 'GENERAL'
      && profile.sharedBacking === true
      && profile.parameterClass === '14B'
      && profile.runtime === 'ollama'
      && identitySlot === 'GENERAL'
    )
  })
}

export function noPermanentAgentRequiresSeparateModel(): boolean {
  const models = new Set(NEBULA_AGENT_IDS.map(id => NEBULA_MODEL_PROFILES[id].preferredModel))
  return models.size === 1 && models.has(NEBULA_SHARED_LOCAL_MODEL_ID)
}

export function noPermanentAgentRequiresDolphin(): boolean {
  return NEBULA_AGENT_IDS.every(id => {
    const profile = NEBULA_MODEL_PROFILES[id]
    const seat = NEBULA_AGENTS_BY_ID[id].backendPreference.seatId
    const resolved = seat ? localRegistryEntryForSlot(SEAT_LOCAL_ROLE_SLOT[seat]) : localRegistryEntryForSlot('GENERAL')
    return (profile.preferredModel as string) !== 'dolphin-mistral-venice:24b' && resolved?.modelId !== 'dolphin-mistral-venice:24b'
  })
}

export function mappedNebulaSeatsUseGeneralSlot(): boolean {
  const seats = Object.keys(NEBULA_IDENTITY_BY_SEAT) as Array<keyof typeof NEBULA_IDENTITY_BY_SEAT>
  return seats.length > 0 && seats.every(seat => SEAT_LOCAL_ROLE_SLOT[seat] === 'GENERAL')
}

export const NEBULA_SHARED_BRAIN_SUMMARY = Object.freeze({
  modelId: NEBULA_SHARED_LOCAL_MODEL_ID,
  parameterClass: NEBULA_SHARED_PARAMETER_CLASS,
  runtime: NEBULA_SHARED_RUNTIME,
  roleSlot: NEBULA_SHARED_ROLE_SLOT,
  sharedBacking: true as const,
  agentIdentities: NEBULA_AGENT_IDS.map(id => NEBULA_AGENTS_BY_ID[id].name),
  note: 'All eight permanent Nebula agents currently share one Genesis GENERAL weight. This is not eight separate models.',
})

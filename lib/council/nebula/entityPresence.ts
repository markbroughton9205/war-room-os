import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ExternalProviderState } from '@/lib/council/live-orchestration/councilContinuity'
import { CLOUD_PROVIDER_LABEL, cloudStatusLine } from '@/lib/council/live-orchestration/councilContinuity'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from './modelProfile'
import {
  CANONICAL_COUNCIL_MEMBER_IDS,
  NEBULA_AGENTS_BY_ID,
  PRIMARY_COUNCIL_ENTITY_IDS,
  type NebulaAgentId,
  type PrimaryCouncilEntityId,
} from './identity'
import { NEBULA_ROLE_CONTRACTS } from './roleContracts'

/**
 * Entity presence projection over the canonical Nebula registry.
 * Does not create a second identity registry. Identities persist when backends change or vanish.
 */

export type CouncilEntityRuntimeStatus = 'READY'
export type CouncilEntityBackendStatus = 'READY' | 'UNAVAILABLE'
export type CouncilCurrentBrain = 'LOCAL_SHARED_GENERAL' | 'EXTERNAL' | 'NONE'

export type OptionalExternalBrain = {
  family: 'chatgpt' | 'claude' | 'grok' | 'gemini'
  name: string
  state: ExternalProviderState
  line: string
}

export type CouncilEntityView = {
  id: NebulaAgentId
  displayName: string
  role: string
  historicalSeatId: CouncilOrchestrationFamily | null
  entityStatus: CouncilEntityRuntimeStatus
  backendStatus: CouncilEntityBackendStatus
  currentBrain: CouncilCurrentBrain
  currentModel: string | null
  currentProvider: string | null
  brainLine: string
  optionalExternal: OptionalExternalBrain | null
}

const OPTIONAL_EXTERNAL_BY_SEAT: Partial<Record<CouncilOrchestrationFamily, OptionalExternalBrain['family']>> = {
  chatgpt: 'chatgpt',
  claude: 'claude',
  grok: 'grok',
  gemini: 'gemini',
  red_team: 'claude',
}

export function optionalExternalFamilyForSeat(
  seat: CouncilOrchestrationFamily | null,
): OptionalExternalBrain['family'] | null {
  if (!seat) return null
  return OPTIONAL_EXTERNAL_BY_SEAT[seat] ?? null
}

export function brainLineFor(brain: CouncilCurrentBrain, model: string | null): string {
  if (brain === 'LOCAL_SHARED_GENERAL') return 'Brain: Local Shared General'
  if (brain === 'EXTERNAL') return model ? `Brain: External · ${model}` : 'Brain: External'
  return 'Brain: none'
}

export function projectCouncilEntityView(input: {
  agentId: NebulaAgentId
  backendReady: boolean
  backing: 'LOCAL' | 'EXTERNAL' | 'NONE'
  localModel?: string | null
  externalModel?: string | null
  optionalExternalState?: ExternalProviderState | null
}): CouncilEntityView {
  const agent = NEBULA_AGENTS_BY_ID[input.agentId]
  const contract = NEBULA_ROLE_CONTRACTS[input.agentId]
  const seat = agent.backendPreference.seatId
  const optionalFamily = optionalExternalFamilyForSeat(seat)
  const currentBrain: CouncilCurrentBrain = !input.backendReady
    ? 'NONE'
    : input.backing === 'EXTERNAL'
      ? 'EXTERNAL'
      : input.backing === 'LOCAL'
        ? 'LOCAL_SHARED_GENERAL'
        : 'NONE'
  const currentModel = currentBrain === 'LOCAL_SHARED_GENERAL'
    ? (input.localModel ?? NEBULA_SHARED_LOCAL_MODEL_ID)
    : currentBrain === 'EXTERNAL'
      ? (input.externalModel ?? null)
      : null
  const currentProvider = currentBrain === 'LOCAL_SHARED_GENERAL'
    ? 'ollama'
    : currentBrain === 'EXTERNAL' && optionalFamily
      ? CLOUD_PROVIDER_LABEL[optionalFamily]
      : null
  const optionalExternal: OptionalExternalBrain | null = optionalFamily
    ? {
        family: optionalFamily,
        name: CLOUD_PROVIDER_LABEL[optionalFamily],
        state: input.optionalExternalState ?? 'NOT_CONFIGURED',
        line: cloudStatusLine(optionalFamily, input.optionalExternalState ?? 'NOT_CONFIGURED'),
      }
    : null
  return {
    id: agent.id,
    displayName: agent.name,
    role: contract.optimizationTarget,
    historicalSeatId: seat,
    entityStatus: 'READY',
    backendStatus: input.backendReady ? 'READY' : 'UNAVAILABLE',
    currentBrain,
    currentModel,
    currentProvider,
    brainLine: brainLineFor(currentBrain, currentModel),
    optionalExternal,
  }
}

export function primaryCouncilEntityViews(input: {
  backendReadyBySeat: Partial<Record<CouncilOrchestrationFamily, boolean>>
  backingBySeat: Partial<Record<CouncilOrchestrationFamily, 'LOCAL' | 'EXTERNAL' | 'NONE'>>
  optionalExternalStateBySeat?: Partial<Record<CouncilOrchestrationFamily, ExternalProviderState | null>>
  localModel?: string | null
}): CouncilEntityView[] {
  return PRIMARY_COUNCIL_ENTITY_IDS.map(id => {
    const seat = NEBULA_AGENTS_BY_ID[id].backendPreference.seatId
    const backing = (seat && input.backingBySeat[seat]) || (input.backendReadyBySeat[seat ?? 'chatgpt'] ? 'LOCAL' : 'NONE')
    return projectCouncilEntityView({
      agentId: id,
      backendReady: Boolean(seat && input.backendReadyBySeat[seat]),
      backing,
      localModel: input.localModel,
      optionalExternalState: seat ? input.optionalExternalStateBySeat?.[seat] ?? null : null,
    })
  })
}

export function councilEntityHeadline(backendAvailable: boolean): string {
  return backendAvailable ? 'COUNCIL READY · LIVE' : 'COUNCIL PRESENT · BACKEND UNAVAILABLE'
}

export function modelDiversityTruth(input: { uniqueBackendModels: number; entityCount: number }): {
  activeModelBackends: number
  modelDiversity: 'SHARED_MODEL' | 'MULTI_MODEL' | 'NONE'
  perspectiveDiversity: 'ROLE_DIVERSE' | 'NONE'
} {
  const activeModelBackends = Math.max(0, input.uniqueBackendModels)
  const modelDiversity = activeModelBackends <= 0 ? 'NONE' : activeModelBackends === 1 ? 'SHARED_MODEL' : 'MULTI_MODEL'
  const perspectiveDiversity = input.entityCount >= 2 ? 'ROLE_DIVERSE' : 'NONE'
  return { activeModelBackends, modelDiversity, perspectiveDiversity }
}

export function identitiesAreNotProviders(): boolean {
  return PRIMARY_COUNCIL_ENTITY_IDS.every(id => {
    const name = NEBULA_AGENTS_BY_ID[id].name
    return name !== 'OpenAI' && name !== 'Anthropic' && name !== 'xAI' && name !== 'Gemini'
  })
}

export { PRIMARY_COUNCIL_ENTITY_IDS, CANONICAL_COUNCIL_MEMBER_IDS }
export type { PrimaryCouncilEntityId }

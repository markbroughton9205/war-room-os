import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { COUNCIL_ROSTER, type FamilyRosterEntry } from '@/lib/council/familyRoster'
import type { DeliberationTurn, DeliberationTurnRole } from '@/lib/council/family-deliberation/types'
import { providerModelForFamily } from '@/lib/council/family-deliberation/runtime'
import { NEBULA_IDENTITY_BY_SEAT, nebulaAgentForSeat, type NebulaAgentId } from '@/lib/council/nebula/identity'
import { canonicalizeCouncilSeat, migrateLegacyPersistedSeat } from '@/lib/council/seatCanonical'
import { NEBULA_SHARED_PARAMETER_CLASS, nebulaModelProfile } from '@/lib/council/nebula/modelProfile'
import { isFinalCouncilSynthesizer, isOrchestrationOnly, NEBULA_ROLE_CONTRACTS, type NebulaRoleContract } from '@/lib/council/nebula/roleContracts'

export type ReasoningRoleKind =
  | 'synthesis'
  | 'engineering'
  | 'evidence'
  | 'verification'
  | 'strategy'
  | 'adversarial'
  | 'human_impact'
  | 'orchestration'
  | 'observation'
  | 'systems_bridge'

export type ServingBackendTruth = {
  configuredProvider: string
  configuredModelDefault: string | null
  actualBackendType: 'LOCAL' | 'EXTERNAL' | null
  actualProvider: string | null
  actualRuntime: string | null
  actualModel: string | null
  fallbackFrom: 'LOCAL' | 'EXTERNAL' | null
  sharedLocalBacking: boolean
  sharedLocalParameterClass: typeof NEBULA_SHARED_PARAMETER_CLASS
  providerIndependenceHonest: boolean
}

export type CouncilReasoningProfile = {
  seat: CouncilOrchestrationFamily
  nebulaAgentId: NebulaAgentId | null
  displayName: string
  reasoningRole: string
  reasoningRoleKind: ReasoningRoleKind
  configuredProvider: string
  optional: boolean
  liveSeatMapped: boolean
  contract: NebulaRoleContract | null
  notes: string
  legacyAlias: string | null
}

const ROLE_KIND_BY_AGENT: Record<NebulaAgentId, ReasoningRoleKind> = {
  aurora: 'synthesis',
  orion: 'engineering',
  pulsar: 'evidence',
  lumen: 'verification',
  nova: 'strategy',
  phoenix: 'adversarial',
  solara: 'human_impact',
  astra: 'orchestration',
}

function rosterEntry(seat: CouncilOrchestrationFamily): FamilyRosterEntry {
  const canonical = canonicalizeCouncilSeat(seat) ?? seat
  const entry = COUNCIL_ROSTER.find(item => item.id === canonical)
  if (!entry) {
    throw new Error(`Unknown Council seat: ${seat}`)
  }
  return entry
}

export function reasoningRoleKindForSeat(seat: CouncilOrchestrationFamily): ReasoningRoleKind {
  const agent = nebulaAgentForSeat(seat)
  if (agent) return ROLE_KIND_BY_AGENT[agent.id]
  if (seat === 'baby') return 'observation'
  if (seat === 'bridge_architect') return 'systems_bridge'
  return 'observation'
}

export function councilReasoningProfile(seat: CouncilOrchestrationFamily): CouncilReasoningProfile {
  const canonical = canonicalizeCouncilSeat(seat) ?? seat
  const entry = rosterEntry(canonical)
  const agent = nebulaAgentForSeat(canonical)
  const liveSeatMapped = Boolean(NEBULA_IDENTITY_BY_SEAT[canonical])
  return {
    seat: canonical,
    nebulaAgentId: agent?.id ?? null,
    displayName: agent?.name ?? entry.label,
    reasoningRole: agent ? NEBULA_ROLE_CONTRACTS[agent.id].optimizationTarget : entry.role,
    reasoningRoleKind: reasoningRoleKindForSeat(canonical),
    configuredProvider: entry.provider,
    optional: entry.optional,
    liveSeatMapped,
    contract: agent ? NEBULA_ROLE_CONTRACTS[agent.id] : null,
    notes: agent
      ? agent.backendPreference.notes
      : canonical === 'baby'
        ? 'Session-scoped observer. Not a permanent Nebula identity and not a substantive Council synthesizer.'
        : 'Unmapped optional seat. Provider identity is not a Nebula reasoning role.',
    legacyAlias: null,
  }
}

export function activeDeliberationProfiles(): CouncilReasoningProfile[] {
  return (Object.keys(NEBULA_IDENTITY_BY_SEAT) as CouncilOrchestrationFamily[])
    .map(councilReasoningProfile)
}

export function babyObserverProfile(): CouncilReasoningProfile {
  return councilReasoningProfile('baby')
}

export function astraOrchestrationProfile(): CouncilReasoningProfile {
  const contract = NEBULA_ROLE_CONTRACTS.astra
  return {
    seat: 'chatgpt',
    nebulaAgentId: 'astra',
    displayName: 'ASTRA',
    reasoningRole: contract.optimizationTarget,
    reasoningRoleKind: 'orchestration',
    configuredProvider: 'none — orchestration only',
    optional: false,
    liveSeatMapped: false,
    contract,
    notes: 'ASTRA has no live Council seat. It may plan/orchestrate but must not provide a substantive Council answer.',
    legacyAlias: null,
  }
}

export function servingBackendTruth(turn: Pick<
  DeliberationTurn,
  'provider_family' | 'provider_model' | 'backend_type' | 'backend_provider' | 'backend_runtime' | 'fallback_from'
>): ServingBackendTruth {
  const canonicalSeat = canonicalizeCouncilSeat(turn.provider_family)
    ?? migrateLegacyPersistedSeat(turn.provider_family)
    ?? turn.provider_family
  const configured = rosterEntry(canonicalSeat)
  const actualModel = turn.provider_model ?? null
  const configuredDefault = providerModelForFamily(canonicalSeat)
  const claimedConfiguredAsActual =
    Boolean(actualModel && configuredDefault && actualModel === configuredDefault)
    && turn.backend_type === 'LOCAL'
  return {
    configuredProvider: configured.provider,
    configuredModelDefault: configuredDefault,
    actualBackendType: turn.backend_type ?? null,
    actualProvider: turn.backend_provider ?? null,
    actualRuntime: turn.backend_runtime ?? null,
    actualModel,
    fallbackFrom: turn.fallback_from ?? null,
    sharedLocalBacking: turn.backend_type === 'LOCAL',
    sharedLocalParameterClass: NEBULA_SHARED_PARAMETER_CLASS,
    providerIndependenceHonest: !claimedConfiguredAsActual,
  }
}

export function providerIsDistinctFromRole(profile: CouncilReasoningProfile): boolean {
  if (profile.nebulaAgentId && isOrchestrationOnly(profile.nebulaAgentId)) return true
  if (!profile.contract) return profile.seat === 'baby' || profile.seat === 'bridge_architect'
  const provider = profile.configuredProvider.toLowerCase()
  const role = `${profile.displayName} ${profile.reasoningRole}`.toLowerCase()
  return !role.includes(provider.split(' ')[0] ?? provider) && profile.displayName !== profile.configuredProvider
}

export function synthesizerSeat(): CouncilOrchestrationFamily {
  const mapped = activeDeliberationProfiles().find(profile => profile.nebulaAgentId && isFinalCouncilSynthesizer(profile.nebulaAgentId))
  return mapped?.seat ?? 'chatgpt'
}

export function expectedStageForSeat(seat: CouncilOrchestrationFamily, synthesizer: CouncilOrchestrationFamily): DeliberationTurnRole {
  if (seat === 'red_team') return 'red_team_challenge'
  if (seat === synthesizer) return 'council_synthesis'
  return 'direct_response'
}

export function localSharedBrainClass(): typeof NEBULA_SHARED_PARAMETER_CLASS {
  return nebulaModelProfile('aurora').parameterClass
}

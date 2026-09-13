import {
  CANONICAL_COUNCIL_MEMBER_IDS,
  NEBULA_AGENTS_BY_ID,
  NEBULA_IDENTITY_BY_SEAT,
  PRIMARY_COUNCIL_ENTITY_IDS,
  type NebulaAgentId,
} from './identity'
import { NEBULA_ROLE_CONTRACTS } from './roleContracts'

/**
 * Classification overlay on the existing Nebula registry.
 * Not a second identity registry. Does not expand the Commander-defined core four.
 */
export const COUNCIL_ROSTER_CLASS = [
  'FULL_COUNCIL_MEMBER',
  'AUXILIARY_COUNCIL_MEMBER',
  'SPECIALIST_AGENT',
  'RED_TEAM_ADVERSARIAL_REVIEW_ROLE',
  'RUNTIME_IDENTITY',
  'LEGACY_DUPLICATE',
] as const

export type CouncilRosterClass = (typeof COUNCIL_ROSTER_CLASS)[number]

export const CORE_COUNCIL_ENTITY_IDS = PRIMARY_COUNCIL_ENTITY_IDS

export const COUNCIL_ROSTER_CLASSIFICATION: Record<
  'aurora' | 'orion' | 'pulsar' | 'lumen' | 'nova' | 'phoenix',
  CouncilRosterClass
> = {
  aurora: 'FULL_COUNCIL_MEMBER',
  orion: 'FULL_COUNCIL_MEMBER',
  pulsar: 'FULL_COUNCIL_MEMBER',
  lumen: 'FULL_COUNCIL_MEMBER',
  /** Durable strategy identity with a live seat. Not one of the Commander-defined core four. */
  nova: 'AUXILIARY_COUNCIL_MEMBER',
  /** Durable Nebula identity occupying the red_team seat. Adversarial review, not a core synthesizer. */
  phoenix: 'RED_TEAM_ADVERSARIAL_REVIEW_ROLE',
}

export function classifyCouncilEntity(id: NebulaAgentId): CouncilRosterClass | 'FOUNDATION_OR_ORCHESTRATION' {
  if (id in COUNCIL_ROSTER_CLASSIFICATION) {
    return COUNCIL_ROSTER_CLASSIFICATION[id as keyof typeof COUNCIL_ROSTER_CLASSIFICATION]
  }
  return 'FOUNDATION_OR_ORCHESTRATION'
}

export function coreCouncilIsExactlyFour(): boolean {
  return CORE_COUNCIL_ENTITY_IDS.join(',') === 'aurora,orion,pulsar,lumen'
    && CORE_COUNCIL_ENTITY_IDS.every(id => COUNCIL_ROSTER_CLASSIFICATION[id] === 'FULL_COUNCIL_MEMBER')
    && NEBULA_IDENTITY_BY_SEAT.chatgpt === 'aurora'
    && NEBULA_IDENTITY_BY_SEAT.claude === 'orion'
    && NEBULA_IDENTITY_BY_SEAT.grok === 'pulsar'
    && NEBULA_IDENTITY_BY_SEAT.gemini === 'lumen'
}

export function novaIsAuxiliaryNotCoreSubstitute(): boolean {
  return CANONICAL_COUNCIL_MEMBER_IDS.includes('nova')
    && !CORE_COUNCIL_ENTITY_IDS.includes('nova')
    && COUNCIL_ROSTER_CLASSIFICATION.nova === 'AUXILIARY_COUNCIL_MEMBER'
    && NEBULA_AGENTS_BY_ID.nova.name === 'NOVA'
    && NEBULA_IDENTITY_BY_SEAT.nova === 'nova'
    && NEBULA_ROLE_CONTRACTS.nova.optimizationTarget.toLowerCase().includes('option')
}

export function phoenixIsRedTeamAdversarialRole(): boolean {
  return !CORE_COUNCIL_ENTITY_IDS.includes('phoenix')
    && COUNCIL_ROSTER_CLASSIFICATION.phoenix === 'RED_TEAM_ADVERSARIAL_REVIEW_ROLE'
    && NEBULA_AGENTS_BY_ID.phoenix.name === 'PHOENIX'
    && NEBULA_IDENTITY_BY_SEAT.red_team === 'phoenix'
    && NEBULA_ROLE_CONTRACTS.phoenix.evidencePosture === 'failure_discovery'
}

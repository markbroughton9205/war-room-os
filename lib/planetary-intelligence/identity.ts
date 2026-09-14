/**
 * P0 identity law: do not rebuild the Council. Names are permanent.
 * Functional diversity comes from tasks, evidence, retrieval contracts, geography,
 * source class, language, and specialist memory — not from extra identities or extra GPUs.
 */

export const CANONICAL_COUNCIL_SEATS = ['AURORA', 'ORION', 'PULSAR', 'LUMEN'] as const
export type CanonicalCouncilSeat = (typeof CANONICAL_COUNCIL_SEATS)[number]

export const AUXILIARY_COUNCIL_MEMBER = 'NOVA' as const
export const ADVERSARIAL_REVIEW_ROLE = 'PHOENIX' as const

export const DIVERGENT_PROTOCOL_SEATS = [
  'PULSAR',
  'ORION',
  'NOVA',
  'LUMEN',
  'PHOENIX',
  'AURORA',
] as const
export type DivergentProtocolSeat = (typeof DIVERGENT_PROTOCOL_SEATS)[number]

export const FIRST_PASS_DISCOVERY_SEATS = ['PULSAR', 'ORION', 'NOVA'] as const
export type FirstPassDiscoverySeat = (typeof FIRST_PASS_DISCOVERY_SEATS)[number]

export const FORBIDDEN_COUNCIL_IDENTITIES = [
  'Council2',
  'Aurora2',
  'Orion2',
  'Pulsar2',
  'Lumen2',
  'Search2',
  'Terra2',
] as const

export const SHARED_LOCAL_COUNCIL_BACKEND = 'huihui_ai/qwen3-abliterated:14b'

export const SEAT_ROLES = {
  AURORA: { mission: 'SYNTHESIS', firstPassRetrieval: false, mayRevisit: true, timing: 'ROUND_8' },
  ORION: { mission: 'SYSTEMS_OPERATIONS', firstPassRetrieval: true, mayRevisit: false, timing: 'ROUND_2' },
  PULSAR: { mission: 'DISCOVERY_SIGNALS', firstPassRetrieval: true, mayRevisit: false, timing: 'ROUND_2' },
  LUMEN: { mission: 'VERIFICATION', firstPassRetrieval: false, mayRevisit: true, timing: 'ROUND_6' },
  NOVA: { mission: 'EXPLORATION_LONG_TAIL', firstPassRetrieval: true, mayRevisit: false, timing: 'ROUND_2' },
  PHOENIX: { mission: 'ADVERSARIAL_REVIEW', firstPassRetrieval: false, mayRevisit: true, timing: 'ROUND_5' },
} as const

export function isForbiddenCouncilIdentity(name: string): boolean {
  return (FORBIDDEN_COUNCIL_IDENTITIES as readonly string[]).includes(name)
}

export function isCanonicalCouncilSeat(name: string): name is CanonicalCouncilSeat {
  return (CANONICAL_COUNCIL_SEATS as readonly string[]).includes(name)
}

export function firstPassSeatsDoNotIncludeSynthesisOrAdversary(): boolean {
  return !FIRST_PASS_DISCOVERY_SEATS.includes('AURORA' as never)
    && !FIRST_PASS_DISCOVERY_SEATS.includes('PHOENIX' as never)
    && !FIRST_PASS_DISCOVERY_SEATS.includes('LUMEN' as never)
}

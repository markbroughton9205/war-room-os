/**
 * Roadmap #15 — original "B-Parameter" contract.
 *
 * The repository never defined a type or flag named `bParameter`. The original
 * War Room contract, found in Build #5 / Nebula Council sources, is:
 *
 * 1. Distinct Council reasoning comes from War Room role-contract parameters
 *    (responsibilities, evidence posture, uncertainty behavior, failure bias,
 *    output contracts, stage instructions) — not from giving each seat its own
 *    billion-parameter model.
 * 2. `NEBULA_SHARED_PARAMETER_CLASS = '14B'` in modelProfile.ts is the shared
 *    local Genesis GENERAL brain class. Comments explicitly forbid inventing
 *    per-agent billion-parameter uniqueness.
 * 3. Build #5 scout-swarm "profiles" (LIGHT / STANDARD / DEEP / GLOBAL) are
 *    swarm *scale* governors, not member reasoning roles.
 *
 * IDENTITY != MODEL. A provider change must not silently erase the Council role.
 */

export const B_PARAMETER_MEANING = 'war_room_reasoning_role_contract' as const

export const B_PARAMETER_IS_NOT = [
  'per-agent billion-parameter model uniqueness',
  'literal 7B/13B/70B/405B size as the source of Council distinctness',
  'Build #5 scout-swarm scale profile (LIGHT/STANDARD/DEEP/GLOBAL)',
] as const

export const B_PARAMETER_PARAMETERS = [
  'optimizationTarget',
  'responsibilities',
  'nonResponsibilities',
  'evidencePosture',
  'uncertaintyBehavior',
  'failureBias',
  'preferredMethods',
  'requiredOutputContract',
  'escalationRules',
  'authorityLimits',
] as const

export type BParameterMeaning = typeof B_PARAMETER_MEANING

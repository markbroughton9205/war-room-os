import { routeFor } from './routing'
import type { BenchmarkRecord, ModelEntry } from './types'

/**
 * Local Specialist Pool: which local model plays which role in a build, and how long it stays resident.
 * Role assignment is evidence/policy only (never by size or name):
 *   BUILDER         the evidence route for `complete_feature` (routeFor); NO_EVIDENCE means no builder is assigned and nothing is assumed.
 *   TEST_REVIEWER   an ACTIVE, eligible model with the `review` role that is not the builder (judges tests before they run; never writes code).
 *   TEST_WRITER     optional: an eligible model with the `structured_output` or `light_implementation` role that is not the builder.
 *   TEST_CANDIDATE  a model allowed to offer a competing test file: BASELINE models qualify (they are historical baselines, never routed for builds).
 *   ESCALATION      FUTURE_HEAVY models are listed as UNAVAILABLE: they never run implicitly.
 * Residency policy learned from the gold rounds: ONE builder stays resident (a 24B model on a 16 GB GPU is expensive to reload and a second resident
 * model made the swap stall); every helper is TRANSIENT (keep_alive 0: it unloads the moment it answers).
 */
export type SpecialistRole = 'BUILDER' | 'TEST_REVIEWER' | 'TEST_WRITER' | 'TEST_CANDIDATE' | 'ESCALATION'
export type Residency = 'RESIDENT' | 'TRANSIENT' | 'NEVER_IMPLICIT'
export type PoolMember = {
  role: SpecialistRole
  modelRef: string | null
  modelId: string | null
  residency: Residency
  /** the Ollama keep_alive this role is called with */
  keepAlive: string
  basis: 'EVIDENCE' | 'POLICY' | 'NONE'
  reason: string
}
export type PoolPolicy = { builderKeepAlive: string; helperKeepAlive: string; allowBaselineAsCandidate: boolean }
export const DEFAULT_POOL_POLICY: PoolPolicy = { builderKeepAlive: '10m', helperKeepAlive: '0', allowBaselineAsCandidate: true }

export type PoolAssignment = { members: PoolMember[]; residentRefs: string[]; notes: string[] }

const hasRole = (m: ModelEntry, ...roles: string[]) => m.roles.some((r) => roles.includes(r))

export function assignPool(models: ModelEntry[], benchmarks: BenchmarkRecord[], policy: PoolPolicy = DEFAULT_POOL_POLICY): PoolAssignment {
  const members: PoolMember[] = []
  const notes: string[] = []
  const route = routeFor('complete_feature', models, benchmarks)
  const builder = route.model ? models.find((m) => m.ref === route.model) ?? null : null
  members.push(builder
    ? { role: 'BUILDER', modelRef: builder.ref, modelId: builder.id, residency: 'RESIDENT', keepAlive: policy.builderKeepAlive, basis: 'EVIDENCE', reason: route.reason }
    : { role: 'BUILDER', modelRef: null, modelId: null, residency: 'RESIDENT', keepAlive: policy.builderKeepAlive, basis: 'NONE', reason: route.reason })
  if (!builder) notes.push('no builder: the evidence route has no eligible model with a completed full-score run; nothing is defaulted')

  const eligibleActive = models.filter((m) => m.status === 'ACTIVE' && m.routing.eligible && m.ref !== builder?.ref)
  const reviewer = eligibleActive.find((m) => hasRole(m, 'review')) ?? null
  members.push(reviewer
    ? { role: 'TEST_REVIEWER', modelRef: reviewer.ref, modelId: reviewer.id, residency: 'TRANSIENT', keepAlive: policy.helperKeepAlive, basis: 'POLICY', reason: `ACTIVE eligible model with the review role, not the builder; unloads after each answer` }
    : { role: 'TEST_REVIEWER', modelRef: null, modelId: null, residency: 'TRANSIENT', keepAlive: policy.helperKeepAlive, basis: 'NONE', reason: 'no ACTIVE eligible review model besides the builder' })

  const writer = eligibleActive.find((m) => m.ref !== reviewer?.ref && hasRole(m, 'structured_output', 'light_implementation')) ?? null
  members.push(writer
    ? { role: 'TEST_WRITER', modelRef: writer.ref, modelId: writer.id, residency: 'TRANSIENT', keepAlive: policy.helperKeepAlive, basis: 'POLICY', reason: 'ACTIVE eligible light/structured model, not the builder or the reviewer' }
    : { role: 'TEST_WRITER', modelRef: null, modelId: null, residency: 'TRANSIENT', keepAlive: policy.helperKeepAlive, basis: 'NONE', reason: 'optional: the builder writes the tests when no separate writer is assigned' })

  const candidate = models.find((m) => m.status === 'BASELINE' && policy.allowBaselineAsCandidate) ?? eligibleActive.find((m) => m.ref !== reviewer?.ref && m.ref !== writer?.ref) ?? null
  members.push(candidate
    ? { role: 'TEST_CANDIDATE', modelRef: candidate.ref, modelId: candidate.id, residency: 'TRANSIENT', keepAlive: policy.helperKeepAlive, basis: 'POLICY', reason: candidate.status === 'BASELINE' ? 'a BASELINE model may offer a competing test file; it is never routed for builds' : 'ACTIVE eligible model not otherwise assigned' }
    : { role: 'TEST_CANDIDATE', modelRef: null, modelId: null, residency: 'TRANSIENT', keepAlive: policy.helperKeepAlive, basis: 'NONE', reason: 'no model available for a competing test file' })

  const heavy = models.filter((m) => m.status === 'FUTURE_HEAVY')
  members.push({ role: 'ESCALATION', modelRef: null, modelId: null, residency: 'NEVER_IMPLICIT', keepAlive: '0', basis: 'NONE', reason: heavy.length ? `UNAVAILABLE: ${heavy.map((m) => m.id).join(', ')} is FUTURE_HEAVY and is never routed implicitly (load management and a measured residency come first)` : 'no heavy model registered' })

  const residentRefs = members.filter((m) => m.residency === 'RESIDENT' && m.modelRef).map((m) => m.modelRef as string)
  if (new Set(members.filter((m) => m.modelRef).map((m) => m.modelRef)).size < members.filter((m) => m.modelRef).length) notes.push('a model fills more than one role (allowed; it is loaded once and the strictest keep-alive of its roles is not applied: the first role wins)')
  return { members, residentRefs, notes }
}

/** The keep_alive a call to `ref` must use: the builder's when it is a resident, else 0. A model with several roles keeps the resident setting. */
export function keepAliveFor(assignment: PoolAssignment, ref: string, fallback = '0'): string {
  const mine = assignment.members.filter((m) => m.modelRef === ref)
  const resident = mine.find((m) => m.residency === 'RESIDENT')
  return resident?.keepAlive ?? mine[0]?.keepAlive ?? fallback
}

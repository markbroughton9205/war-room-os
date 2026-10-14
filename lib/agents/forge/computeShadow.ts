import type { NodeRecord } from './nodeRecord'
import { assignPool } from './pool'
import { schedule, type Placement } from './scheduler'
import type { ModelResourceProfile } from './resourceProfile'
import type { ModelRole } from './roles'
import type { BenchmarkRecord, ModelEntry } from './types'

/**
 * Shadow scheduling (FOUNDRY_COMPUTE=1): the scheduler decides what it WOULD place for each role the harness uses, and the decision is logged beside
 * what the harness actually ran. It changes nothing: the harness still names its own models. This is how the scheduler is compared with the proven
 * Phase 10 behaviour before it is ever allowed to choose.
 */
export type ShadowDecision = { role: ModelRole; harnessModel: string | null; placement: Placement; agrees: boolean | null; note: string }

export function shadowDecisions(a: { node: NodeRecord; models: ModelEntry[]; benchmarks: BenchmarkRecord[]; profiles: ModelResourceProfile[]; harness: { role: ModelRole; modelRef: string | null }[]; now?: Date; keep?: string[] }): ShadowDecision[] {
  const now = a.now ?? new Date()
  return a.harness.map((h, i) => {
    // legacy parity: one clean run is enough for the builder here (routeFor's rule), so the shadow allows provisional evidence and says so
    const placement = schedule({ jobId: `shadow-${i}-${h.role}`, role: h.role }, { nodes: [a.node], models: a.models, benchmarks: a.benchmarks, profiles: a.profiles, now, allowProvisional: true, designatedBuilder: assignPool(a.models, a.benchmarks).members[0].modelRef ?? undefined, keep: a.keep ?? (h.role === 'PRIMARY_BUILDER' && h.modelRef ? [h.modelRef] : []) })
    const agrees = placement.ok && h.modelRef ? placement.modelRef === h.modelRef : null
    const note = !placement.ok ? `scheduler would not place this role: ${placement.reason}` : agrees === null ? 'harness named no model for this role' : agrees ? 'scheduler agrees with the harness' : `scheduler prefers ${placement.modelRef}, harness ran ${h.modelRef}`
    return { role: h.role, harnessModel: h.modelRef, placement, agrees, note }
  })
}

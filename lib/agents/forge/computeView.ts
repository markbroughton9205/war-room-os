import { FIRST_POOL } from './registry'
import { ForgeStore } from './store'
import { MODEL_ROLES, type ModelRole } from './roles'
import { rankForRole, type RoleRanking } from './rank'
import { nodeHealth, type NodeHealth, type NodeRecord } from './nodeRecord'
import { probeLocalNode, type LocalProbeDeps } from './localNode'
import { schedule, type Placement } from './scheduler'
import { assignPool } from './pool'
import { routingTable, type RouteOutcome } from './roleRouting'
import type { ModelResourceProfile } from './resourceProfile'

/**
 * Read-only compute view: the local node as measured now, enrolled nodes from the store (simulated ones are labelled), the stored resource profiles,
 * the ranking of models per role, and what the scheduler WOULD place for each role. It never loads, unloads, enrolls or calls a model.
 */
export type ComputeView = {
  generatedAt: string
  nodes: { record: NodeRecord; health: NodeHealth; runtimeVersion?: string }[]
  profiles: ModelResourceProfile[]
  roles: { role: ModelRole; ranking: RoleRanking; placement: Placement }[]
  /** what each kind of work would be routed to now, with the explicit fallback when a role has no qualified model */
  routing: RouteOutcome[]
  notes: string[]
}

export async function buildComputeView(opts: { store?: ForgeStore; base?: string; deps?: LocalProbeDeps; now?: Date } = {}): Promise<ComputeView> {
  const store = opts.store ?? new ForgeStore()
  const now = opts.now ?? new Date()
  const registered = store.models()
  const models = registered.length ? registered : FIRST_POOL
  const benchmarks = store.benchmarks()
  const profiles = store.resourceProfiles()
  // the designated builder is the legacy evidence route (unchanged Phase 10 policy); undefined when the history proves none
  const designatedBuilder = assignPool(models, benchmarks).members[0].modelRef ?? undefined
  const local = await probeLocalNode({ base: opts.base, deps: { ...opts.deps, now: () => now } })
  const stored = store.nodes().filter((n) => n.nodeId !== local.record.nodeId && n.kind === 'RACK')
  const all = [local.record, ...stored]
  const notes: string[] = []
  if (!local.reachable) notes.push('the local model runtime did not answer on loopback: the node is UNREACHABLE and nothing can be placed on it')
  if (!registered.length) notes.push('no models are registered in the Forge store: the declared first pool is shown')
  if (stored.length) notes.push('enrolled rack nodes are listed for planning; rack scheduling is not enabled in this version, so none receives work')
  if (!profiles.length) notes.push('no resource profiles are stored yet: placements rely on artifact-size estimates (ESTIMATED), never on measurements')
  return {
    generatedAt: now.toISOString(),
    nodes: all.map((record) => ({ record, health: nodeHealth(record, now), ...(record.kind === 'LOCAL' ? { runtimeVersion: String(local.runtimeVersion) } : {}) })),
    profiles,
    roles: MODEL_ROLES.map((role) => ({ role, ranking: rankForRole(role, models, benchmarks), placement: schedule({ jobId: `view-${role}`, role }, { nodes: all, models, benchmarks, profiles, now, designatedBuilder }) })),
    routing: routingTable({ nodes: all, models, benchmarks, profiles, now, designatedBuilder }),
    notes,
  }
}

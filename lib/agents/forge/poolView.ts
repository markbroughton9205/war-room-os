import { FIRST_POOL } from './registry'
import { ForgeStore } from './store'
import { assignPool, type PoolAssignment } from './pool'
import { ResidencyGovernor, type GovernorDecision, type NodeState } from './governor'
import { NodeRegistry, type NodeDescriptor } from './node'

/**
 * Read-only view of the Local Specialist Pool for the Foundry operations panel: who plays which role, where it would run, what is resident right now, and
 * which nodes exist. Nothing here loads, unloads or calls a model: it asks the loopback runtime what it already holds (/api/ps) and says UNKNOWN otherwise.
 */
export type PoolView = {
  generatedAt: string
  modelsSource: 'REGISTERED' | 'DECLARED_FIRST_POOL'
  assignment: PoolAssignment
  node: { id: string; kind: string; endpoint: string; capabilities: NodeDescriptor['capabilities'] }
  state: NodeState
  nodes: { id: string; kind: string; callable: boolean }[]
  /** residency decisions are recorded by the process that runs missions (the harness); this process only reads */
  decisions: GovernorDecision[]
  notes: string[]
}

export async function buildPoolView(opts: { store?: ForgeStore; base?: string; fetchImpl?: typeof fetch } = {}): Promise<PoolView> {
  const store = opts.store ?? new ForgeStore()
  const registered = store.models()
  const models = registered.length ? registered : FIRST_POOL
  const assignment = assignPool(models, store.benchmarks())
  const registry = new NodeRegistry()
  const reg = registry.registerLocal('local', {}, opts.base)
  const node = reg.ok ? reg.node : { id: 'local', kind: 'LOCAL' as const, endpoint: 'UNAVAILABLE', capabilities: { vramMiB: 'UNKNOWN' as const, ramMiB: 'UNKNOWN' as const, concurrency: 1 } }
  const governor = new ResidencyGovernor(node, { fetchImpl: opts.fetchImpl })
  const state = await governor.snapshot()
  const notes = [...assignment.notes]
  if (!state.reachable) notes.push('the local model runtime did not answer on loopback: residency is UNKNOWN')
  if (!registered.length) notes.push('no models are registered in the Forge store: the declared first pool is shown')
  return {
    generatedAt: new Date().toISOString(), modelsSource: registered.length ? 'REGISTERED' : 'DECLARED_FIRST_POOL', assignment,
    node: { id: node.id, kind: node.kind, endpoint: node.endpoint, capabilities: node.capabilities }, state,
    nodes: registry.list().map((n) => ({ id: n.id, kind: n.kind, callable: n.kind === 'LOCAL' })), decisions: governor.decisions(), notes,
  }
}

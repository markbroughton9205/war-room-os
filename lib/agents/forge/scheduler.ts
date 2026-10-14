import { planAdmission, type NodeState } from './governor'
import type { DispatchResult } from './nodeClient'
import { canonicalize, sha256 } from './nodeProtocol'
import { nodeHealth, type NodeRecord } from './nodeRecord'
import { rankForRole, type RoleRanking } from './rank'
import { requirementFor, type ModelResourceProfile } from './resourceProfile'
import type { ModelRole } from './roles'
import type { BenchmarkRecord, ModelEntry } from './types'

/**
 * Compute scheduler: a PURE function from (job, world snapshot) to a placement. Same snapshot, same placement. It never loads, unloads or calls
 * anything; it decides, and the decision (with every rejection and a snapshot hash) is what gets logged. Foundry owns the mission; this only picks workers.
 *
 * Order of rules (lexicographic, no weighted sums):
 *  1. role evidence is a hard floor (qualified models only; provisional/unqualified only when the world explicitly allows it);
 *  2. evidence tier (5% buckets of the role success rate; qualified outranks provisional);
 *  3. do not evict a kept resident (the builder) for a helper when another option exists;
 *  4. healthy before degraded;
 *  5. model already resident on the node (no reload, no model movement);
 *  6. shortest predicted wait (queue x measured speed + transfer + load);
 *  7. faster measured tokens/s; 8. node id, model ref (determinism).
 * UNKNOWN requirement is never "fits". Rack nodes are used only when the world enables them AND they hold a pinned identity.
 */
export type Job = { jobId: string; role: ModelRole; estTokens?: number }
export type World = {
  nodes: NodeRecord[]
  models: ModelEntry[]
  benchmarks: BenchmarkRecord[]
  profiles: ModelResourceProfile[]
  now: Date
  rackEnabled?: boolean
  allowProvisional?: boolean
  allowPrepare?: boolean
  allowUnknownRequirement?: boolean
  /** benchmark mode: model refs allowed without role qualification (never FUTURE_HEAVY / RETIRED) */
  allowUnqualified?: string[]
  /** the designated primary builder (policy + proven history, e.g. the legacy evidence route). When set, PRIMARY_BUILDER jobs are placed ONLY on this model; replacing it is a decision, not something the scheduler does from a leaderboard. */
  designatedBuilder?: string
  /** refs to keep resident when possible (the builder) */
  keep?: string[]
  excluded?: { nodeId: string; modelRef?: string }[]
}
export type RejectCode = 'NOT_QUALIFIED' | 'EXCLUDED' | 'NODE_UNHEALTHY' | 'RACK_DISABLED' | 'NO_IDENTITY' | 'ROLE_NOT_SERVED' | 'NOT_INSTALLED' | 'DIGEST_MISMATCH' | 'UNKNOWN_REQUIREMENT' | 'INSUFFICIENT_RAM' | 'ADMISSION_REFUSED' | 'TRANSFER_UNKNOWN'
export type Rejection = { nodeId: string; modelRef: string; code: RejectCode; detail: string }
export type PlacementOk = {
  ok: true; jobId: string; role: ModelRole; nodeId: string; modelRef: string; digest?: string
  action: 'ADMIT' | 'EVICT_THEN_ADMIT'; evict: string[]; basis: 'MEASURED' | 'ESTIMATED' | 'UNKNOWN'; needsPrepare: boolean
  simulated: boolean; reason: string; rejected: Rejection[]; snapshot: string
}
export type PlacementFail = { ok: false; jobId: string; role: ModelRole; code: 'NO_QUALIFIED_MODEL' | 'NO_NODE_FITS'; reason: string; rejected: Rejection[]; snapshot: string }
export type Placement = PlacementOk | PlacementFail

const MiB = 1048576
const RAM_MARGIN_MIB = 1024
type Key = (number | string)[]
const cmp = (a: Key, b: Key) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1 } return 0 }

export function nodeStateOf(n: NodeRecord, now: Date): NodeState {
  const h = nodeHealth(n, now)
  return { reachable: h === 'HEALTHY' || h === 'DEGRADED', residents: n.resident, vramTotalMiB: n.gpu.length ? Math.max(...n.gpu.map((g) => g.vramMiB)) : 0, ramTotalMiB: n.ramMiB, gpuUsedMiB: n.load.vramUsedMiB, ramUsedMiB: n.load.ramUsedMiB, at: n.load.at }
}

function snapshotOf(job: Job, w: World, ranking: RoleRanking): string {
  return sha256(canonicalize({
    job: { role: job.role, estTokens: job.estTokens ?? null },
    flags: { rack: !!w.rackEnabled, prov: !!w.allowProvisional, prep: !!w.allowPrepare, unk: !!w.allowUnknownRequirement, unq: w.allowUnqualified ?? [], keep: w.keep ?? [], ex: w.excluded ?? [] },
    ranking: ranking.ranked.map((r) => [r.ref, r.qualified, r.provisional, r.evidence.ok, r.evidence.n]),
    nodes: w.nodes.map((n) => ({ id: n.nodeId, h: nodeHealth(n, w.now), load: n.load, res: n.resident, inst: n.installedModels.map((m) => [m.ref, m.digest, m.sizeBytes]), roles: n.capabilities.roles, net: n.networkMbps, conc: n.capabilities.concurrency })),
    profiles: w.profiles.map((p) => [p.modelRef, p.nodeId, p.vramRequiredMiB, p.ramRequiredMiB, p.latency.tokensPerSecond, p.loadMs]),
  }))
}

export function schedule(job: Job, w: World): Placement {
  const ranking = rankForRole(job.role, w.models, w.benchmarks)
  const snapshot = snapshotOf(job, w, ranking)
  const rejected: Rejection[] = []
  const allow = new Set(w.allowUnqualified ?? [])
  const keep = w.keep ?? []

  type Cand = { model: ModelEntry; tier: number }
  const cands: Cand[] = []
  const designated = job.role === 'PRIMARY_BUILDER' && w.designatedBuilder ? w.models.find((m) => m.ref === w.designatedBuilder && m.status !== 'FUTURE_HEAVY' && m.status !== 'RETIRED') : undefined
  if (designated) cands.push({ model: designated, tier: 100 })
  for (const r of designated ? [] : ranking.ranked) {
    const model = w.models.find((m) => m.ref === r.ref)!
    if (r.qualified) cands.push({ model, tier: 100 + Math.floor(r.evidence.rate * 20) })
    else if (r.provisional && w.allowProvisional) cands.push({ model, tier: Math.floor(r.evidence.rate * 20) })
    else if (allow.has(r.ref)) cands.push({ model, tier: 0 })
    else rejected.push({ nodeId: '*', modelRef: r.ref, code: 'NOT_QUALIFIED', detail: r.reason })
  }
  for (const ref of designated ? [] : allow) {
    const model = w.models.find((m) => m.ref === ref)
    if (model && model.status !== 'FUTURE_HEAVY' && model.status !== 'RETIRED' && !cands.some((c) => c.model.ref === ref)) cands.push({ model, tier: 0 })
  }
  for (const ref of designated ? [] : ranking.noEvidence) if (!allow.has(ref)) rejected.push({ nodeId: '*', modelRef: ref, code: 'NOT_QUALIFIED', detail: `no benchmark evidence for ${job.role}` })
  if (!cands.length) return { ok: false, jobId: job.jobId, role: job.role, code: 'NO_QUALIFIED_MODEL', reason: `no model is qualified for ${job.role}; nothing is defaulted`, rejected, snapshot }

  type Opt = { key: Key; node: NodeRecord; model: ModelEntry; digest?: string; adm: ReturnType<typeof planAdmission>; needsPrepare: boolean; evictsKeep: boolean; resident: boolean }
  const opts: Opt[] = []
  const nodes = [...w.nodes].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1))
  for (const node of nodes) {
    for (const { model, tier } of cands) {
      const rej = (code: RejectCode, detail: string) => rejected.push({ nodeId: node.nodeId, modelRef: model.ref, code, detail })
      if (w.excluded?.some((x) => x.nodeId === node.nodeId && (!x.modelRef || x.modelRef === model.ref))) { rej('EXCLUDED', 'excluded by an earlier failed attempt'); continue }
      const health = nodeHealth(node, w.now)
      if (health === 'UNREACHABLE' || health === 'QUARANTINED') { rej('NODE_UNHEALTHY', `node is ${health}`); continue }
      if (node.kind === 'RACK') {
        if (!w.rackEnabled) { rej('RACK_DISABLED', 'rack scheduling is not enabled'); continue }
        if (!node.identity) { rej('NO_IDENTITY', 'rack node has no pinned identity'); continue }
      }
      if (!node.capabilities.roles.includes(job.role)) { rej('ROLE_NOT_SERVED', `node does not serve ${job.role}`); continue }
      const inst = node.installedModels.find((m) => m.ref === model.ref)
      let needsPrepare = false
      if (!inst) {
        if (w.allowPrepare && node.availableModels.includes(model.ref)) needsPrepare = true
        else { rej('NOT_INSTALLED', node.availableModels.includes(model.ref) ? 'available but not installed; prepare is not allowed now (no model movement mid-mission)' : 'not installed'); continue }
      } else if (model.digest && inst.digest !== model.digest) { rej('DIGEST_MISMATCH', 'installed digest differs from the pinned digest'); continue }
      const artifactBytes = inst?.sizeBytes ?? model.artifactBytes
      const profile = [...w.profiles].filter((p) => p.modelRef === model.ref && p.nodeId === node.nodeId).sort((a, b) => (a.at < b.at ? -1 : 1)).pop()
      const gpuMax = node.gpu.length ? Math.max(...node.gpu.map((g) => g.vramMiB)) : 0
      const req = requirementFor(profile, artifactBytes, gpuMax)
      if (req.basis === 'UNKNOWN' && !w.allowUnknownRequirement) { rej('UNKNOWN_REQUIREMENT', 'memory requirement is unmeasured and the artifact size is unknown: not treated as fitting'); continue }
      const resident = node.resident.some((r) => r.ref === model.ref)
      if (req.basis !== 'UNKNOWN' && !resident && req.ramMiB + RAM_MARGIN_MIB > node.ramMiB - node.load.ramUsedMiB) { rej('INSUFFICIENT_RAM', `needs ${req.ramMiB} MiB RAM (+${RAM_MARGIN_MIB} margin), ${Math.max(0, node.ramMiB - node.load.ramUsedMiB)} MiB available`); continue }
      const need = artifactBytes && artifactBytes > 0 ? artifactBytes : req.basis === 'UNKNOWN' ? undefined : (req.vramMiB + req.ramMiB) * MiB
      const adm = planAdmission(nodeStateOf(node, w.now), { ref: model.ref, role: job.role, residency: 'TRANSIENT', status: model.status, artifactBytes: need }, keep)
      if (adm.action === 'REFUSE') { rej('ADMISSION_REFUSED', adm.reason); continue }
      let transferMs = 0
      if (needsPrepare) {
        if (typeof node.networkMbps !== 'number' || !(node.networkMbps > 0) || artifactBytes === undefined) { rej('TRANSFER_UNKNOWN', 'transfer cost cannot be computed'); continue }
        transferMs = (artifactBytes * 8) / (node.networkMbps * 1e6) * 1000
      }
      const tps = profile && typeof profile.latency.tokensPerSecond === 'number' ? profile.latency.tokensPerSecond : 0
      const perJobMs = tps > 0 ? ((job.estTokens ?? 1000) / tps) * 1000 : 1e9
      const loadMs = !resident && profile && typeof profile.loadMs === 'number' ? profile.loadMs : 0
      const waitMs = (node.load.queued / Math.max(1, node.capabilities.concurrency)) * (node.load.queued ? perJobMs : 0) + transferMs + loadMs
      const evictsKeep = job.role !== 'PRIMARY_BUILDER' && adm.evict.some((r) => keep.includes(r))
      opts.push({ node, model, digest: inst?.digest ?? model.digest, adm, needsPrepare, evictsKeep, resident, key: [-tier, evictsKeep ? 1 : 0, health === 'DEGRADED' ? 1 : 0, resident ? 0 : 1, waitMs, -tps, node.nodeId, model.ref] })
    }
  }
  if (!opts.length) return { ok: false, jobId: job.jobId, role: job.role, code: 'NO_NODE_FITS', reason: `no node can run a qualified ${job.role} model right now`, rejected, snapshot }
  opts.sort((a, b) => cmp(a.key, b.key))
  const best = opts[0]
  const why = [`${best.model.ref} on ${best.node.nodeId}`, designated && best.model.ref === designated.ref ? 'designated primary builder' : '', best.resident ? 'already resident' : 'not resident', best.adm.reason, best.evictsKeep ? 'evicts a kept resident (no alternative)' : '', best.node.simulated ? 'SIMULATED node' : ''].filter(Boolean).join('; ')
  for (const o of opts.slice(1)) rejected.push({ nodeId: o.node.nodeId, modelRef: o.model.ref, code: 'NOT_QUALIFIED', detail: 'ranked below the chosen placement' })
  return { ok: true, jobId: job.jobId, role: job.role, nodeId: best.node.nodeId, modelRef: best.model.ref, digest: best.digest, action: best.adm.action === 'REFUSE' ? 'ADMIT' : best.adm.action, evict: best.adm.evict, basis: best.adm.basis, needsPrepare: best.needsPrepare, simulated: !!best.node.simulated, reason: why, rejected, snapshot }
}

export type AttemptLog = { attempt: number; placement: Placement; outcome: DispatchResult | null; integrityFailure: boolean }
export type FailoverResult = { ok: true; result: Extract<DispatchResult, { ok: true }>; attempts: AttemptLog[] } | { ok: false; reason: string; attempts: AttemptLog[]; suspects: string[] }
const INTEGRITY = new Set(['BAD_RECEIPT', 'JOB_MISMATCH', 'MODEL_MISMATCH', 'DIGEST_MISMATCH', 'OUTPUT_HASH_MISMATCH', 'TOKEN_LIMIT'])

/**
 * Place, dispatch, and on failure re-place once on another node (same job id, new attempt). The failed attempt's output is already discarded by
 * dispatchJob. Integrity failures (forged/tampered receipts) are reported as suspects for quarantine; availability failures (timeout, reset) are not.
 * When no node is left the job is BLOCKED with the reason; the standard is not lowered.
 */
export async function runWithFailover(job: Job, deps: { world: () => World; dispatch: (p: PlacementOk, attempt: number) => Promise<DispatchResult>; maxAttempts?: number }): Promise<FailoverResult> {
  const attempts: AttemptLog[] = []
  const excluded: NonNullable<World['excluded']> = []
  const suspects: string[] = []
  const max = deps.maxAttempts ?? 2
  for (let attempt = 1; attempt <= max; attempt++) {
    const w = deps.world()
    const placement = schedule(job, { ...w, excluded: [...(w.excluded ?? []), ...excluded] })
    if (!placement.ok) { attempts.push({ attempt, placement, outcome: null, integrityFailure: false }); return { ok: false, reason: placement.reason, attempts, suspects } }
    const outcome = await deps.dispatch(placement, attempt)
    const integrityFailure = !outcome.ok && INTEGRITY.has(outcome.code)
    attempts.push({ attempt, placement, outcome, integrityFailure })
    if (outcome.ok) return { ok: true, result: outcome, attempts }
    excluded.push({ nodeId: placement.nodeId })
    if (integrityFailure) suspects.push(placement.nodeId)
  }
  return { ok: false, reason: `all ${max} attempts failed`, attempts, suspects }
}

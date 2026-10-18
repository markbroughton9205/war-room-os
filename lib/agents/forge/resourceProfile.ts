import { qualification, roleEvidence } from './rank'
import { MODEL_ROLES, type ModelRole } from './roles'
import type { Basis, BenchmarkRecord, ModelEntry, Residency, ResourceProfile } from './types'

const MiB = 1048576

export type ResidencyState = 'RESIDENT' | 'TRANSIENT' | 'COLD' | 'UNKNOWN'
/** Per (model, node, context). The same model measures differently on each GPU, so a profile is never shared across nodes. */
export type ModelResourceProfile = {
  modelRef: string
  digest?: string
  quantization: string | 'UNKNOWN'
  vramRequiredMiB: number | 'UNKNOWN'
  ramRequiredMiB: number | 'UNKNOWN'
  diskRequiredBytes: number | 'UNKNOWN'
  loadMs: number | 'UNKNOWN'
  activeMemoryMiB: number | 'UNKNOWN'
  contextTokens: number
  /** roles the model is QUALIFIED for by evidence (rank.ts gates); never assigned by name or size */
  taskRoles: ModelRole[]
  successRate: Partial<Record<ModelRole, { ok: number; n: number }>>
  latency: { firstTokenMs: number | 'UNKNOWN'; tokensPerSecond: number | 'UNKNOWN' }
  nodeId: string
  residency: ResidencyState
  residencyClass: Residency
  basis: Basis
  at: string
}

export type ProfileInput = {
  profile: ResourceProfile
  nodeId: string
  model?: ModelEntry
  quantization?: string
  residency?: ResidencyState
  benchmarks?: BenchmarkRecord[]
}

/** Build the compute-stage profile from a measured ResourceProfile. Requirements are only stated where the runtime measured them; the rest stay UNKNOWN. */
export function buildModelResourceProfile(i: ProfileInput): ModelResourceProfile {
  const p = i.profile
  const vramMiB = typeof p.vramBytesLoaded === 'number' ? Math.round(p.vramBytesLoaded / MiB) : 'UNKNOWN'
  const offloaded = typeof p.artifactBytes === 'number' && typeof p.vramBytesLoaded === 'number' && p.residency !== 'FULL_GPU' ? Math.max(0, Math.round((p.artifactBytes - p.vramBytesLoaded) / MiB)) : 'UNKNOWN'
  const successRate: ModelResourceProfile['successRate'] = {}
  const taskRoles: ModelRole[] = []
  for (const role of MODEL_ROLES) {
    const ev = roleEvidence(p.modelRef, role, i.benchmarks ?? [])
    if (!ev.n) continue
    successRate[role] = { ok: ev.ok, n: ev.n }
    if (qualification(p.modelRef, role, i.benchmarks ?? []).qualified) taskRoles.push(role)
  }
  return {
    modelRef: p.modelRef, digest: i.model?.digest, quantization: i.quantization ?? 'UNKNOWN',
    vramRequiredMiB: p.basis === 'MEASURED' ? vramMiB : 'UNKNOWN',
    ramRequiredMiB: p.basis === 'MEASURED' ? offloaded : 'UNKNOWN',
    diskRequiredBytes: p.artifactBytes,
    loadMs: p.loadMs, activeMemoryMiB: p.basis === 'MEASURED' ? vramMiB : 'UNKNOWN',
    contextTokens: p.contextTokens, taskRoles, successRate,
    latency: { firstTokenMs: p.firstTokenMs, tokensPerSecond: p.tokensPerSecond },
    nodeId: i.nodeId, residency: i.residency ?? 'UNKNOWN', residencyClass: p.residency, basis: p.basis, at: p.at,
  }
}

/** Requirement used for placement. MEASURED beats ESTIMATED beats UNKNOWN; UNKNOWN is never "fits". */
export type Requirement = { vramMiB: number; ramMiB: number; basis: 'MEASURED' | 'ESTIMATED' } | { basis: 'UNKNOWN' }

/** Estimate from artifact size only: weights plus ~8% overhead for an 8K context; whatever exceeds 90% of VRAM spills to RAM. Always ESTIMATED. */
export function estimateRequirement(artifactBytes: number | undefined, gpuVramMiB: number): Requirement {
  if (artifactBytes === undefined || !(artifactBytes > 0)) return { basis: 'UNKNOWN' }
  const total = (artifactBytes / MiB) * 1.08
  const vram = Math.min(total, gpuVramMiB * 0.9)
  return { vramMiB: Math.round(vram), ramMiB: Math.round(Math.max(0, total - vram)), basis: 'ESTIMATED' }
}

export function requirementFor(profile: ModelResourceProfile | undefined, artifactBytes: number | undefined, gpuVramMiB: number): Requirement {
  if (profile && profile.basis === 'MEASURED' && typeof profile.vramRequiredMiB === 'number') {
    return { vramMiB: profile.vramRequiredMiB, ramMiB: typeof profile.ramRequiredMiB === 'number' ? profile.ramRequiredMiB : 0, basis: 'MEASURED' }
  }
  return estimateRequirement(artifactBytes ?? (typeof profile?.diskRequiredBytes === 'number' ? profile.diskRequiredBytes : undefined), gpuVramMiB)
}

/**
 * Residency recommendation derived ONLY from measured numbers (never from a model's name or reputation).
 *   RESIDENT       the designated builder: stays loaded (keep-alive 10m) while it is building.
 *   TRANSIENT      everything else on a one-GPU node: loaded for its call, unloaded right after (keep-alive 0), calls batched to limit swaps.
 *   COEXIST_OK     only when builder + model + the desktop's idle GPU use fit in 95% of VRAM, i.e. a measured reason to keep both.
 *   ON_DEMAND_ONLY the model needs CPU offload (slow, RAM-hungry) or its load time is long: never loaded implicitly for small work.
 * On Nebula the measurement (coexist.json) matched the arithmetic: even the 0.6B embedder evicted the 24B builder.
 */
export type ResidencyRecommendation = { recommendation: 'RESIDENT' | 'TRANSIENT' | 'COEXIST_OK' | 'ON_DEMAND_ONLY' | 'UNKNOWN'; keepAlive: string; reason: string }
export function recommendResidency(p: { isBuilder: boolean; vramMiB: number | 'UNKNOWN'; cpuOffloadMiB: number | 'UNKNOWN'; loadMs: number | 'UNKNOWN' }, ctx: { builderVramMiB: number | 'UNKNOWN'; gpuTotalMiB: number; desktopIdleMiB: number }): ResidencyRecommendation {
  if (p.isBuilder) return { recommendation: 'RESIDENT', keepAlive: '10m', reason: 'designated builder: reloading it costs 6-18 s every time a helper evicts it, so it stays loaded while building' }
  if (p.vramMiB === 'UNKNOWN') return { recommendation: 'UNKNOWN', keepAlive: '0', reason: 'VRAM use is unmeasured: treated as transient until profiled' }
  if (typeof p.cpuOffloadMiB === 'number' && p.cpuOffloadMiB > 512) return { recommendation: 'ON_DEMAND_ONLY', keepAlive: '0', reason: `${p.cpuOffloadMiB} MiB runs on the CPU (partial offload): slower and RAM-hungry, loaded only for work that needs it` }
  if (typeof ctx.builderVramMiB === 'number' && ctx.builderVramMiB + p.vramMiB + ctx.desktopIdleMiB <= ctx.gpuTotalMiB * 0.95) return { recommendation: 'COEXIST_OK', keepAlive: '5m', reason: `builder ${ctx.builderVramMiB} + model ${p.vramMiB} + desktop ${ctx.desktopIdleMiB} MiB fits ${Math.round(ctx.gpuTotalMiB * 0.95)} MiB` }
  const need = typeof ctx.builderVramMiB === 'number' ? ctx.builderVramMiB + p.vramMiB + ctx.desktopIdleMiB : 'UNKNOWN'
  return { recommendation: 'TRANSIENT', keepAlive: '0', reason: `does not fit next to the builder (${need === 'UNKNOWN' ? 'builder unmeasured' : need + ' MiB needed'} of ${Math.round(ctx.gpuTotalMiB * 0.95)} MiB usable): unloaded right after use; batch calls to limit builder reloads` }
}

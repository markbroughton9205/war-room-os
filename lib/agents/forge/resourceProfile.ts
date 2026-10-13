import { roleEvidence } from './rank'
import { MODEL_ROLES, ROLE_GATES, type ModelRole } from './roles'
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
    const g = ROLE_GATES[role]
    if (ev.n >= g.minRuns && ev.rate >= g.minRate) taskRoles.push(role)
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

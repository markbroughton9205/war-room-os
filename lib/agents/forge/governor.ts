import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { NodeDescriptor } from './node'
import type { ModelStatus } from './types'
import { estimateFeasibility, gpuUsedMiB, ramUsedMiB } from './profile'
import type { Residency } from './pool'

/**
 * Residency Governor: admission, eviction and serialization of local models on ONE node (hardware, not money: the mission budget governor lives in
 * lib/native-builder/foundryResourceGovernor.ts and is unrelated). Evidence behind the rules (gold rounds): a 24B builder is slow to reload on a 16 GB GPU,
 * a second resident helper made the next builder call stall, and two generations at once only slow each other down.
 *   - ONE generation at a time per node (concurrency from the node, default 1): callers queue in order.
 *   - A model that is already resident is admitted as is.
 *   - A model that does not fit next to the residents causes the residents to be unloaded first (keep_alive 0 over loopback), transient ones before the builder.
 *   - A model that cannot fit even alone (VRAM + RAM) is REFUSED, a FUTURE_HEAVY / NEVER_IMPLICIT model is always REFUSED, an unreachable node REFUSES.
 *   - Unmeasured sizes are never treated as "fits": the decision is conservative and says so (basis UNKNOWN).
 */
export type ResidentModel = { ref: string; sizeBytes: number | 'UNKNOWN'; vramBytes: number | 'UNKNOWN' }
export type NodeState = { reachable: boolean; residents: ResidentModel[]; vramTotalMiB: number | 'UNKNOWN'; ramTotalMiB: number | 'UNKNOWN'; gpuUsedMiB: number | 'UNKNOWN'; ramUsedMiB: number | 'UNKNOWN'; at: string }
export type AdmissionRequest = { ref: string; role: string; residency: Residency; status?: ModelStatus; artifactBytes?: number; allowHeavy?: boolean }
export type Admission = { action: 'ADMIT' | 'EVICT_THEN_ADMIT' | 'REFUSE'; evict: string[]; basis: 'MEASURED' | 'ESTIMATED' | 'UNKNOWN'; reason: string }
export type GovernorDecision = Admission & { at: string; ref: string; role: string }

const MiB = 1048576

/** Pure planning: no I/O. `keep` lists refs that must stay resident when possible (the builder). */
export function planAdmission(state: NodeState, req: AdmissionRequest, keep: string[] = []): Admission {
  if (req.status === 'FUTURE_HEAVY' || req.residency === 'NEVER_IMPLICIT') {
    if (!req.allowHeavy) return { action: 'REFUSE', evict: [], basis: 'ESTIMATED', reason: `${req.ref} is FUTURE_HEAVY / never implicit: it is not loaded without an explicit Commander decision and a measured residency` }
  }
  if (!state.reachable) return { action: 'REFUSE', evict: [], basis: 'UNKNOWN', reason: 'the node is unreachable; nothing is loaded blind' }
  if (state.residents.some((r) => r.ref === req.ref)) return { action: 'ADMIT', evict: [], basis: 'MEASURED', reason: `${req.ref} is already resident` }
  const others = state.residents
  const vram = state.vramTotalMiB, ram = state.ramTotalMiB
  const need = req.artifactBytes
  // can it ever run here? (artifact vs VRAM + RAM)
  if (typeof vram === 'number' && typeof ram === 'number' && need !== undefined) {
    const f = estimateFeasibility(need, vram * MiB, ram * MiB)
    if (f.residency === 'REQUIRES_OFFLOAD') return { action: 'REFUSE', evict: [], basis: 'ESTIMATED', reason: `${req.ref} cannot be resident here: ${f.note}` }
  }
  if (!others.length) return { action: 'ADMIT', evict: [], basis: need === undefined || typeof vram !== 'number' ? 'UNKNOWN' : 'ESTIMATED', reason: 'the node holds no other model' }
  const knownVram = others.every((r) => typeof r.vramBytes === 'number')
  if (typeof vram === 'number' && need !== undefined && knownVram) {
    const used = others.reduce((a, r) => a + (r.vramBytes as number), 0) / MiB
    if (used + need / MiB <= vram * 0.9) return { action: 'ADMIT', evict: [], basis: 'MEASURED', reason: `${Math.round(used)} MiB resident + ${Math.round(need / MiB)} MiB fits ${vram} MiB of VRAM` }
  }
  // does not fit (or is not known to fit): unload the residents, transient ones first, the kept builder last, and only as many as needed when sizes are known
  const order = [...others].sort((a, b) => Number(keep.includes(a.ref)) - Number(keep.includes(b.ref)))
  const evict: string[] = []
  if (typeof vram === 'number' && need !== undefined && knownVram) {
    let used = others.reduce((a, r) => a + (r.vramBytes as number), 0) / MiB
    for (const r of order) { if (used + need / MiB <= vram * 0.9) break; evict.push(r.ref); used -= (r.vramBytes as number) / MiB }
    return { action: evict.length ? 'EVICT_THEN_ADMIT' : 'ADMIT', evict, basis: 'MEASURED', reason: `resident VRAM leaves no room for ${req.ref}; unloading ${evict.join(', ')}` }
  }
  return { action: 'EVICT_THEN_ADMIT', evict: order.map((r) => r.ref), basis: 'UNKNOWN', reason: 'sizes are unmeasured, so the residents are unloaded first (conservative: a swap next to a resident stalled the builder before)' }
}

export type GovernorDeps = {
  fetchImpl?: typeof fetch
  now?: () => Date
  vramTotalMiB?: () => number | 'UNKNOWN'
  ramTotalMiB?: () => number | 'UNKNOWN'
  gpuUsedMiB?: () => number | 'UNKNOWN'
  ramUsedMiB?: () => number | 'UNKNOWN'
}
const smiTotal = (): number | 'UNKNOWN' => { try { const n = Number(execFileSync('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeout: 5000 }).toString().trim().split('\n')[0]); return Number.isFinite(n) ? n : 'UNKNOWN' } catch { return 'UNKNOWN' } }
const memTotal = (): number | 'UNKNOWN' => { try { const m = /MemTotal:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8')); return m ? Math.round(Number(m[1]) / 1024) : 'UNKNOWN' } catch { return 'UNKNOWN' } }

export class ResidencyGovernor {
  private active = 0
  private waiters: (() => void)[] = []
  private log: GovernorDecision[] = []
  private readonly fetchImpl: typeof fetch
  constructor(readonly node: NodeDescriptor, private readonly deps: GovernorDeps = {}) { this.fetchImpl = deps.fetchImpl ?? fetch }
  private now() { return (this.deps.now ?? (() => new Date()))() }

  async snapshot(): Promise<NodeState> {
    const at = this.now().toISOString()
    const vramNode = this.node.capabilities.vramMiB, ramNode = this.node.capabilities.ramMiB
    const vramTotalMiB = typeof vramNode === 'number' ? vramNode : (this.deps.vramTotalMiB ?? smiTotal)()
    const ramTotalMiB = typeof ramNode === 'number' ? ramNode : (this.deps.ramTotalMiB ?? memTotal)()
    const gpu = (this.deps.gpuUsedMiB ?? gpuUsedMiB)(), ram = (this.deps.ramUsedMiB ?? ramUsedMiB)()
    try {
      const res = await this.fetchImpl(`${this.node.endpoint}/api/ps`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return { reachable: false, residents: [], vramTotalMiB, ramTotalMiB, gpuUsedMiB: gpu, ramUsedMiB: ram, at }
      const j = (await res.json()) as { models?: { name?: string; model?: string; size?: number; size_vram?: number }[] }
      const residents = (j.models ?? []).map((m) => ({ ref: String(m.name ?? m.model ?? ''), sizeBytes: typeof m.size === 'number' ? m.size : ('UNKNOWN' as const), vramBytes: typeof m.size_vram === 'number' ? m.size_vram : ('UNKNOWN' as const) })).filter((m) => m.ref)
      return { reachable: true, residents, vramTotalMiB, ramTotalMiB, gpuUsedMiB: gpu, ramUsedMiB: ram, at }
    } catch { return { reachable: false, residents: [], vramTotalMiB, ramTotalMiB, gpuUsedMiB: gpu, ramUsedMiB: ram, at } }
  }

  /** Unload a model now (keep_alive 0 over loopback). Returns whether the runtime accepted it. */
  async unload(ref: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.node.endpoint}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: ref, keep_alive: 0 }), signal: AbortSignal.timeout(15000) })
      return res.ok
    } catch { return false }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.node.capabilities.concurrency) { this.active += 1; return }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active += 1
  }
  private release(): void { this.active -= 1; const next = this.waiters.shift(); if (next) next() }

  /** Serialized, governed execution: queue for the node, plan, unload what must go, run `fn`, release. A REFUSE throws a GovernorRefusal and runs nothing. */
  async lease<T>(req: AdmissionRequest, keep: string[], fn: (admission: Admission) => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      const state = await this.snapshot()
      const adm = planAdmission(state, req, keep)
      this.record({ ...adm, at: this.now().toISOString(), ref: req.ref, role: req.role })
      if (adm.action === 'REFUSE') throw new GovernorRefusal(adm.reason)
      for (const ref of adm.evict) await this.unload(ref)
      return await fn(adm)
    } finally { this.release() }
  }
  private record(d: GovernorDecision) { this.log.push(d); if (this.log.length > 50) this.log.shift() }
  decisions(): GovernorDecision[] { return [...this.log] }
  queued(): number { return this.waiters.length }
  busy(): number { return this.active }
}
export class GovernorRefusal extends Error { constructor(msg: string) { super(msg); this.name = 'GovernorRefusal' } }

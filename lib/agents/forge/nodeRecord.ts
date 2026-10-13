import type { ResidentModel } from './governor'
import type { NodeKind } from './node'
import type { ModelRole } from './roles'

export type NodeHealth = 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE' | 'QUARANTINED'
export type NodeLoad = { cpuPct: number; gpuPct: number; vramUsedMiB: number; ramUsedMiB: number; queued: number; at: string }
export type InstalledModel = { ref: string; digest: string; sizeBytes: number }
export type NodeIdentity = { publicKeyPem: string; pubkeyFingerprint: string; enrolledAt: string; approvalNote: string }

/** Full node registration record. LOCAL nodes have no identity (loopback, same trust domain); RACK nodes need a pinned identity to be scheduled. */
export type NodeRecord = {
  nodeId: string
  hostname: string
  kind: NodeKind
  endpoint: string
  cpu: { model: string; cores: number; threads: number }
  ramMiB: number
  gpu: { model: string; vramMiB: number }[]
  storage: { totalBytes: number; freeBytes: number }
  networkMbps: number | 'UNKNOWN'
  load: NodeLoad
  resident: ResidentModel[]
  installedModels: InstalledModel[]
  availableModels: string[]
  /** last health the node reported about itself; the effective health is nodeHealth() */
  health: NodeHealth
  lastHeartbeat: string
  capabilities: { concurrency: number; runtimes: string[]; roles: ModelRole[] }
  identity: NodeIdentity | null
  /** true for in-process test nodes: every decision that touches one is labelled SIMULATED and none may become benchmark evidence */
  simulated?: boolean
  revokedAt?: string
  quarantineReason?: string
}

export type HardwareProbe = { cpu: NodeRecord['cpu']; ramMiB: number; gpu: NodeRecord['gpu']; storage: NodeRecord['storage']; installedModels: InstalledModel[] }
export type HeartbeatBody = {
  nodeId: string
  challenge: string
  load: NodeLoad
  resident: ResidentModel[]
  installedModels: InstalledModel[]
  selfHealth: 'HEALTHY' | 'DEGRADED'
  nonce: string
  issuedAt: string
}

export const HEARTBEAT_INTERVAL_MS = 10_000
export const MISSED_BEATS_UNREACHABLE = 3

/** Effective health: revoked/quarantined is sticky; stale heartbeats degrade then lose the node; overload or a self-report degrades. */
export function nodeHealth(rec: NodeRecord, now: Date): NodeHealth {
  if (rec.revokedAt || rec.quarantineReason) return 'QUARANTINED'
  const age = now.getTime() - Date.parse(rec.lastHeartbeat)
  if (!Number.isFinite(age)) return 'UNREACHABLE'
  if (age > HEARTBEAT_INTERVAL_MS * MISSED_BEATS_UNREACHABLE) return 'UNREACHABLE'
  if (age > HEARTBEAT_INTERVAL_MS * 1.5) return 'DEGRADED'
  if (rec.health === 'DEGRADED') return 'DEGRADED'
  if (rec.load.queued > 4 * Math.max(1, rec.capabilities.concurrency)) return 'DEGRADED'
  return 'HEALTHY'
}

const inPct = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
const nonNeg = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
export function validLoad(l: NodeLoad): boolean {
  return !!l && inPct(l.cpuPct) && inPct(l.gpuPct) && nonNeg(l.vramUsedMiB) && nonNeg(l.ramUsedMiB) && nonNeg(l.queued) && typeof l.at === 'string'
}

/** Apply a heartbeat that has ALREADY passed signature, challenge and replay checks. Receive time (not the node's clock) becomes lastHeartbeat. A revoked or quarantined node stays so. */
export function applyHeartbeat(rec: NodeRecord, hb: HeartbeatBody, now: Date): { ok: true; node: NodeRecord } | { ok: false; detail: string } {
  if (hb.nodeId !== rec.nodeId) return { ok: false, detail: 'heartbeat is for another node' }
  if (!validLoad(hb.load)) return { ok: false, detail: 'heartbeat load is out of range' }
  if (!Array.isArray(hb.resident) || !Array.isArray(hb.installedModels)) return { ok: false, detail: 'heartbeat lists are malformed' }
  const lying = hb.resident.filter((r) => !hb.installedModels.some((m) => m.ref === r.ref)).map((r) => r.ref)
  if (lying.length) return { ok: false, detail: `heartbeat reports resident models that are not installed: ${lying.join(', ')}` }
  return { ok: true, node: { ...rec, load: hb.load, resident: hb.resident, installedModels: hb.installedModels, health: hb.selfHealth, lastHeartbeat: now.toISOString() } }
}

export const quarantine = (rec: NodeRecord, reason: string): NodeRecord => ({ ...rec, health: 'QUARANTINED', quarantineReason: reason })
export const revoke = (rec: NodeRecord, now: Date): NodeRecord => ({ ...rec, health: 'QUARANTINED', revokedAt: now.toISOString() })

/** Hardware and model claims are verified against a fresh probe, never trusted. */
export function verifyProbe(claimed: Pick<NodeRecord, 'cpu' | 'ramMiB' | 'gpu' | 'installedModels'>, probe: HardwareProbe): { ok: boolean; mismatches: string[] } {
  const bad: string[] = []
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(a, b) * tol
  if (claimed.gpu.length !== probe.gpu.length) bad.push(`gpu count ${claimed.gpu.length} vs ${probe.gpu.length}`)
  else claimed.gpu.forEach((g, i) => { if (!near(g.vramMiB, probe.gpu[i].vramMiB, 0.02)) bad.push(`gpu ${i} vram ${g.vramMiB} vs ${probe.gpu[i].vramMiB}`) })
  if (!near(claimed.ramMiB, probe.ramMiB, 0.05)) bad.push(`ram ${claimed.ramMiB} vs ${probe.ramMiB}`)
  if (claimed.cpu.threads !== probe.cpu.threads) bad.push(`cpu threads ${claimed.cpu.threads} vs ${probe.cpu.threads}`)
  for (const m of claimed.installedModels) {
    const p = probe.installedModels.find((x) => x.ref === m.ref)
    if (!p) bad.push(`model ${m.ref} claimed but not installed`)
    else if (p.digest !== m.digest) bad.push(`model ${m.ref} digest ${m.digest} vs ${p.digest}`)
  }
  return { ok: bad.length === 0, mismatches: bad }
}

const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/
const PRIVATE = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/
export const isLoopbackHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
/** Rack endpoints: RFC1918, tailnet CGNAT, .lan/.local, or loopback (loopback only for the SIMULATED-REMOTE proof). Never a public/hosted host. */
export const isAllowedRackHost = (h: string) => PRIVATE.test(h) || CGNAT.test(h) || h.endsWith('.lan') || h.endsWith('.local') || isLoopbackHost(h)

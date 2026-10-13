import { createPublicKey, randomBytes } from 'node:crypto'
import { isAllowedRackHost, isLoopbackHost, verifyProbe, type HardwareProbe, type NodeRecord } from './nodeRecord'
import { fingerprintOf, sha256 } from './nodeProtocol'
import type { ModelRole } from './roles'

/**
 * Enrollment is a Commander act. Minting a token requires an explicit approval note; the token is shown once, entered on the rack machine by the
 * Commander, and works once. Foundry never reaches out to an unknown host. Tokens are held as hashes. Any redeem attempt that presents a live token
 * burns it, whether it succeeds or not, so a token cannot be probed.
 */
type Pending = { note: string; expiresAt: number }
export type EnrollmentCode = 'BAD_TOKEN' | 'EXPIRED' | 'INVALID_ID' | 'INVALID_ENDPOINT' | 'NOT_PRIVATE_NETWORK' | 'INSECURE_TRANSPORT' | 'BAD_KEY' | 'PROBE_MISMATCH' | 'DUPLICATE' | 'NO_COMMANDER_APPROVAL'
export type EnrollRequest = {
  token: string
  nodeId: string
  hostname: string
  endpoint: string
  publicKeyPem: string
  probe: HardwareProbe
  networkMbps?: number | 'UNKNOWN'
  runtimes: string[]
  roles: ModelRole[]
  concurrency: number
  availableModels?: string[]
  simulated?: boolean
}

export class EnrollmentBook {
  private pending = new Map<string, Pending>()
  private enrolled = new Set<string>()
  constructor(existingIds: string[] = ['local']) { existingIds.forEach((i) => this.enrolled.add(i)) }

  mint(a: { approvedByCommander: boolean; approvalNote: string; now: Date; ttlMs?: number }): { ok: true; token: string; expiresAt: string } | { ok: false; code: 'NO_COMMANDER_APPROVAL'; detail: string } {
    if (a.approvedByCommander !== true || !a.approvalNote?.trim()) return { ok: false, code: 'NO_COMMANDER_APPROVAL', detail: 'enrollment needs an explicit Commander approval with a note' }
    const token = randomBytes(32).toString('hex')
    const expiresAt = a.now.getTime() + (a.ttlMs ?? 15 * 60_000)
    this.pending.set(sha256(token), { note: a.approvalNote.trim(), expiresAt })
    return { ok: true, token, expiresAt: new Date(expiresAt).toISOString() }
  }

  redeem(r: EnrollRequest, now: Date): { ok: true; node: NodeRecord } | { ok: false; code: EnrollmentCode; detail: string } {
    const h = sha256(String(r.token ?? ''))
    const p = this.pending.get(h)
    if (!p) return { ok: false, code: 'BAD_TOKEN', detail: 'unknown or already used enrollment token' }
    this.pending.delete(h)
    if (p.expiresAt < now.getTime()) return { ok: false, code: 'EXPIRED', detail: 'enrollment token expired' }
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(r.nodeId) || r.nodeId === 'local') return { ok: false, code: 'INVALID_ID', detail: 'node id must be 2-41 chars of a-z 0-9 -, and not "local"' }
    if (this.enrolled.has(r.nodeId)) return { ok: false, code: 'DUPLICATE', detail: `node ${r.nodeId} is already enrolled` }
    let url: URL
    try { url = new URL(r.endpoint) } catch { return { ok: false, code: 'INVALID_ENDPOINT', detail: 'endpoint is not a URL' } }
    if (url.username || url.password) return { ok: false, code: 'INVALID_ENDPOINT', detail: 'credentials in the endpoint URL are refused' }
    if (!isAllowedRackHost(url.hostname)) return { ok: false, code: 'NOT_PRIVATE_NETWORK', detail: `host ${url.hostname} is not a private-network address; hosted/public endpoints are never enrolled` }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) return { ok: false, code: 'INSECURE_TRANSPORT', detail: 'rack endpoints need https (plain http only on loopback)' }
    let fp: string
    try {
      const k = createPublicKey(r.publicKeyPem)
      if (k.asymmetricKeyType !== 'ed25519') return { ok: false, code: 'BAD_KEY', detail: 'node key must be Ed25519' }
      fp = fingerprintOf(r.publicKeyPem)
    } catch { return { ok: false, code: 'BAD_KEY', detail: 'node public key is not valid PEM' } }
    // the node's own claim and the probe are the same data at enrollment; verify internal consistency (resident/installed) and sane hardware
    const claimed = { cpu: r.probe.cpu, ramMiB: r.probe.ramMiB, gpu: r.probe.gpu, installedModels: r.probe.installedModels }
    const v = verifyProbe(claimed, r.probe)
    if (!v.ok || !(r.probe.ramMiB > 0) || r.probe.cpu.threads < 1) return { ok: false, code: 'PROBE_MISMATCH', detail: v.mismatches.join('; ') || 'hardware probe is not plausible' }
    this.enrolled.add(r.nodeId)
    const t = now.toISOString()
    return {
      ok: true,
      node: {
        nodeId: r.nodeId, hostname: r.hostname, kind: 'RACK', endpoint: url.origin,
        cpu: r.probe.cpu, ramMiB: r.probe.ramMiB, gpu: r.probe.gpu, storage: r.probe.storage, networkMbps: r.networkMbps ?? 'UNKNOWN',
        load: { cpuPct: 0, gpuPct: 0, vramUsedMiB: 0, ramUsedMiB: 0, queued: 0, at: t }, resident: [],
        installedModels: r.probe.installedModels, availableModels: r.availableModels ?? [],
        health: 'HEALTHY', lastHeartbeat: t,
        capabilities: { concurrency: Math.max(1, r.concurrency), runtimes: r.runtimes, roles: r.roles },
        identity: { publicKeyPem: r.publicKeyPem, pubkeyFingerprint: fp, enrolledAt: t, approvalNote: p.note },
        ...(r.simulated ? { simulated: true } : {}),
      },
    }
  }
}

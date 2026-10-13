import { newNonce, sha256, signEnvelope, verifyEnvelope, ReplayGuard, type Envelope, type JobReceipt, type JobRequest, type NodeKey, type Pinned } from './nodeProtocol'
import type { NodeClient } from './nodeClient'
import type { HardwareProbe, HeartbeatBody, NodeLoad, NodeRecord } from './nodeRecord'

/**
 * In-process SIMULATED node. It exercises the protocol, trust and failover logic only: it runs no model, its executor name matches the
 * scripted/simulated pattern so rank.ts never counts it as evidence, and every NodeRecord built from it carries simulated:true.
 */
export type SimFault = 'NONE' | 'DIE_MID_STREAM' | 'BAD_SIGNATURE' | 'TAMPER_OUTPUT' | 'WRONG_MODEL' | 'WRONG_DIGEST' | 'REPLAY_RECEIPT' | 'HANG' | 'WRONG_SIGNER' | 'LIE_HARDWARE'
export const SIM_EXECUTOR = 'scripted-sim-node'

export class SimNode implements NodeClient {
  fault: SimFault = 'NONE'
  load: NodeLoad
  calls = 0
  private lastReceipt: Envelope<'receipt', JobReceipt> | null = null
  private readonly guard = new ReplayGuard()
  constructor(
    readonly nodeId: string,
    readonly key: NodeKey,
    private readonly hardware: HardwareProbe,
    private readonly foundry: Pinned,
    private readonly responder: (job: JobRequest) => string = (j) => `sim:${j.role}:${j.jobId}`,
    private readonly now: () => Date = () => new Date(),
  ) { this.load = { cpuPct: 5, gpuPct: 0, vramUsedMiB: 0, ramUsedMiB: 0, queued: 0, at: now().toISOString() } }

  async probe(): Promise<HardwareProbe> {
    if (this.fault === 'LIE_HARDWARE') return { ...this.hardware, gpu: this.hardware.gpu.map((g) => ({ ...g, vramMiB: Math.round(g.vramMiB / 2) })) }
    return this.hardware
  }
  async heartbeat(challenge: string): Promise<Envelope<'heartbeat', HeartbeatBody>> {
    const body: HeartbeatBody = { nodeId: this.nodeId, challenge, load: { ...this.load, at: this.now().toISOString() }, resident: [], installedModels: this.hardware.installedModels, selfHealth: 'HEALTHY', nonce: newNonce(), issuedAt: this.now().toISOString() }
    return signEnvelope(this.key, 'heartbeat', body)
  }
  async execute(env: Envelope<'job', JobRequest>, onDelta?: (s: string) => void): Promise<{ output: string; receipt: Envelope<'receipt', JobReceipt> }> {
    this.calls++
    const v = verifyEnvelope<'job', JobRequest>(env, this.foundry, 'job', this.now(), this.guard)
    if (!v.ok) throw new Error(`job refused by node: ${v.code}`)
    const job = v.body
    if (job.nodeId !== this.nodeId) throw new Error('job is addressed to another node')
    const installed = this.hardware.installedModels.find((m) => m.ref === job.modelRef)
    if (!installed) throw new Error(`model ${job.modelRef} is not installed on ${this.nodeId}`)
    if (this.fault === 'HANG') return new Promise(() => { /* never resolves */ })
    const output = this.responder(job)
    const half = Math.ceil(output.length / 2)
    onDelta?.(output.slice(0, half))
    if (this.fault === 'DIE_MID_STREAM') throw new Error('connection reset by peer')
    onDelta?.(output.slice(half))
    const body: JobReceipt = {
      jobId: job.jobId, attempt: job.attempt, nodeId: this.nodeId,
      modelRef: this.fault === 'WRONG_MODEL' ? 'some/other:model' : job.modelRef,
      digest: this.fault === 'WRONG_DIGEST' ? 'sha256:deadbeef' : installed.digest,
      tokens: Math.max(1, Math.ceil(output.length / 4)), elapsedMs: 1, outputSha256: sha256(output), runtimeVersion: 'sim-0', nonce: newNonce(), issuedAt: this.now().toISOString(),
    }
    let receipt = signEnvelope(this.key, 'receipt', body)
    if (this.fault === 'BAD_SIGNATURE') receipt = { ...receipt, sig: Buffer.from('forged').toString('base64') }
    if (this.fault === 'WRONG_SIGNER') receipt = { ...receipt, signer: 'f'.repeat(64) }
    if (this.fault === 'REPLAY_RECEIPT' && this.lastReceipt) receipt = this.lastReceipt
    else this.lastReceipt = receipt
    return { output: this.fault === 'TAMPER_OUTPUT' ? output + ' // injected' : output, receipt }
  }
}

export const SIM_LOAD = (at: Date): NodeLoad => ({ cpuPct: 5, gpuPct: 0, vramUsedMiB: 0, ramUsedMiB: 0, queued: 0, at: at.toISOString() })
/** A NodeRecord for a sim node that was enrolled through EnrollmentBook (identity pinned there); helper for tests that skip enrollment. */
export function simRecord(nodeId: string, key: NodeKey, hw: HardwareProbe, now: Date, extra: Partial<NodeRecord> = {}): NodeRecord {
  return {
    nodeId, hostname: `${nodeId}.lan`, kind: 'RACK', endpoint: `https://${nodeId}.lan:8443`, cpu: hw.cpu, ramMiB: hw.ramMiB, gpu: hw.gpu, storage: hw.storage, networkMbps: 1000,
    load: SIM_LOAD(now), resident: [], installedModels: hw.installedModels, availableModels: [], health: 'HEALTHY', lastHeartbeat: now.toISOString(),
    capabilities: { concurrency: 1, runtimes: ['ollama'], roles: ['PRIMARY_BUILDER', 'ARCHITECT_REVIEWER', 'DEBUGGER_TEST_SPECIALIST', 'FAST_REPAIR_WORKER', 'RESEARCH_GENERALIST', 'CODE_RETRIEVAL', 'RERANKER', 'SECURITY_REVIEWER'] },
    identity: { publicKeyPem: key.publicKeyPem, pubkeyFingerprint: key.fingerprint, enrolledAt: now.toISOString(), approvalNote: 'sim' }, simulated: true, ...extra,
  }
}

import { newNonce, signEnvelope, verifyEnvelope, sha256, type Envelope, type JobReceipt, type JobRequest, type NodeKey, type ReplayGuard } from './nodeProtocol'
import type { HardwareProbe, HeartbeatBody, NodeRecord } from './nodeRecord'
import type { ModelRole } from './roles'

/** The one interface Foundry uses for every node. LOCAL (stage 2) and RACK (stage 4) implement it; the SimNode in simNode.ts implements it for tests only. */
export interface NodeClient {
  readonly nodeId: string
  probe(): Promise<HardwareProbe>
  /** Foundry challenges, the node answers with a signed heartbeat that echoes the challenge (proves freshness, not just a replayable old beat). */
  heartbeat(challenge: string): Promise<Envelope<'heartbeat', HeartbeatBody>>
  execute(job: Envelope<'job', JobRequest>, onDelta?: (s: string) => void): Promise<{ output: string; receipt: Envelope<'receipt', JobReceipt> }>
}

export type DispatchCode = 'NODE_NOT_ENROLLED' | 'NODE_ERROR' | 'TIMEOUT' | 'BAD_RECEIPT' | 'JOB_MISMATCH' | 'MODEL_MISMATCH' | 'DIGEST_MISMATCH' | 'OUTPUT_HASH_MISMATCH' | 'TOKEN_LIMIT'
export type DispatchResult =
  | { ok: true; output: string; receipt: JobReceipt; nodeId: string; keyFingerprint: string }
  | { ok: false; code: DispatchCode; detail: string; nodeId: string; retryable: boolean }

export type DispatchArgs = {
  client: NodeClient
  node: NodeRecord
  foundryKey: NodeKey
  jobId: string
  attempt: number
  role: ModelRole
  modelRef: string
  digest?: string
  messages: JobRequest['messages']
  limits: JobRequest['limits']
  guard: ReplayGuard
  now: () => Date
  onDelta?: (s: string) => void
}

/**
 * Foundry-side dispatch. The node is a worker: its output is accepted as TEXT only after the receipt verifies (pinned signer, fresh, not replayed,
 * same job/attempt/model/digest, output hash equals what was received). A failed attempt returns no output at all.
 */
export async function dispatchJob(a: DispatchArgs): Promise<DispatchResult> {
  const nodeId = a.node.nodeId
  const fail = (code: DispatchCode, detail: string, retryable: boolean): DispatchResult => ({ ok: false, code, detail, nodeId, retryable })
  if (a.node.kind === 'RACK' && !a.node.identity) return fail('NODE_NOT_ENROLLED', 'a rack node without a pinned identity is never called', false)
  const job = signEnvelope(a.foundryKey, 'job', { jobId: a.jobId, attempt: a.attempt, nodeId, role: a.role, modelRef: a.modelRef, digest: a.digest, messages: a.messages, limits: a.limits, nonce: newNonce(), issuedAt: a.now().toISOString() } as JobRequest)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deltas: string[] = []
  let res: Awaited<ReturnType<NodeClient['execute']>>
  try {
    res = await Promise.race([
      a.client.execute(job, (s) => { deltas.push(s); a.onDelta?.(s) }),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('__timeout__')), a.limits.timeoutMs) }),
    ])
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    return m === '__timeout__' ? fail('TIMEOUT', `no receipt within ${a.limits.timeoutMs} ms; partial output discarded`, true) : fail('NODE_ERROR', `${m}; partial output discarded`, true)
  } finally { if (timer) clearTimeout(timer) }
  const pinned = a.node.identity ? { publicKeyPem: a.node.identity.publicKeyPem, fingerprint: a.node.identity.pubkeyFingerprint } : null
  if (!pinned) return fail('NODE_NOT_ENROLLED', 'local nodes dispatch through LocalNodeClient, not a signed channel', false)
  const v = verifyEnvelope<'receipt', JobReceipt>(res.receipt, pinned, 'receipt', a.now(), a.guard)
  if (!v.ok) return fail('BAD_RECEIPT', `${v.code}: ${v.detail}`, true)
  const r = v.body
  if (r.jobId !== a.jobId || r.attempt !== a.attempt || r.nodeId !== nodeId) return fail('JOB_MISMATCH', 'receipt is for a different job, attempt or node', true)
  if (r.modelRef !== a.modelRef) return fail('MODEL_MISMATCH', `asked for ${a.modelRef}, receipt says ${r.modelRef}`, true)
  if (a.digest && r.digest !== a.digest) return fail('DIGEST_MISMATCH', 'receipt digest is not the pinned model digest', true)
  if (r.outputSha256 !== sha256(res.output)) return fail('OUTPUT_HASH_MISMATCH', 'received output does not match the signed hash', true)
  if (r.tokens > a.limits.maxTokens * 1.1) return fail('TOKEN_LIMIT', 'node exceeded the job token limit', true)
  return { ok: true, output: res.output, receipt: r, nodeId, keyFingerprint: pinned.fingerprint }
}

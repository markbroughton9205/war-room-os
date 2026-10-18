import { loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'

/**
 * Model nodes: where a specialist model can run. TODAY only the local Ollama node on this machine exists, reached over loopback.
 * A rack node (another machine in the Commander's rack) is a typed seam, not a capability: registering one is REFUSED unless a Commander approval
 * is recorded AND the endpoint is on a private network address, and even then this slice does not call it (no remote model call exists yet).
 * Nothing here ever reaches a hosted/frontier provider.
 */
export type NodeKind = 'LOCAL' | 'RACK'
export type NodeCapabilities = { vramMiB: number | 'UNKNOWN'; ramMiB: number | 'UNKNOWN'; concurrency: number }
export type NodeDescriptor = { id: string; kind: NodeKind; endpoint: string; capabilities: NodeCapabilities; approvedByCommander?: boolean; approvalNote?: string }
export type NodeRegistration = { ok: true; node: NodeDescriptor; callable: boolean } | { ok: false; code: 'NOT_LOOPBACK' | 'NO_COMMANDER_APPROVAL' | 'NOT_PRIVATE_NETWORK' | 'DUPLICATE' | 'INVALID'; detail: string }

const PRIVATE_V4 = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

export function isPrivateHost(host: string): boolean {
  return PRIVATE_V4.test(host) || host.endsWith('.local') || host.endsWith('.lan')
}

export class NodeRegistry {
  private nodes = new Map<string, NodeDescriptor>()

  /** The one callable node: local Ollama over loopback. Capabilities are UNKNOWN until measured. */
  registerLocal(id = 'local', capabilities: Partial<NodeCapabilities> = {}, base?: string): NodeRegistration {
    if (this.nodes.has(id)) return { ok: false, code: 'DUPLICATE', detail: `node ${id} already registered` }
    let endpoint: string
    try { endpoint = loopbackBaseUrl(base) } catch (e) { return { ok: false, code: 'NOT_LOOPBACK', detail: String(e instanceof Error ? e.message : e) } }
    const node: NodeDescriptor = { id, kind: 'LOCAL', endpoint, capabilities: { vramMiB: capabilities.vramMiB ?? 'UNKNOWN', ramMiB: capabilities.ramMiB ?? 'UNKNOWN', concurrency: Math.max(1, capabilities.concurrency ?? 1) } }
    this.nodes.set(id, node)
    return { ok: true, node, callable: true }
  }

  /** A rack node is recorded only with an explicit Commander approval and a private-network endpoint; it is never callable in this slice. */
  registerRack(d: { id: string; endpoint: string; capabilities?: Partial<NodeCapabilities>; approvedByCommander?: boolean; approvalNote?: string }): NodeRegistration {
    if (!d.id || !d.endpoint) return { ok: false, code: 'INVALID', detail: 'id and endpoint are required' }
    if (this.nodes.has(d.id)) return { ok: false, code: 'DUPLICATE', detail: `node ${d.id} already registered` }
    if (d.approvedByCommander !== true || !d.approvalNote?.trim()) return { ok: false, code: 'NO_COMMANDER_APPROVAL', detail: 'a rack node needs an explicit Commander approval with a note' }
    let url: URL
    try { url = new URL(d.endpoint) } catch { return { ok: false, code: 'INVALID', detail: 'endpoint is not a URL' } }
    if (url.username || url.password) return { ok: false, code: 'INVALID', detail: 'credentials in the endpoint URL are refused' }
    if (!isPrivateHost(url.hostname)) return { ok: false, code: 'NOT_PRIVATE_NETWORK', detail: `host ${url.hostname} is not a private-network address; hosted/public endpoints are never registered` }
    const node: NodeDescriptor = { id: d.id, kind: 'RACK', endpoint: url.origin, capabilities: { vramMiB: d.capabilities?.vramMiB ?? 'UNKNOWN', ramMiB: d.capabilities?.ramMiB ?? 'UNKNOWN', concurrency: Math.max(1, d.capabilities?.concurrency ?? 1) }, approvedByCommander: true, approvalNote: d.approvalNote.trim() }
    this.nodes.set(d.id, node)
    return { ok: true, node, callable: false }
  }

  list(): NodeDescriptor[] { return [...this.nodes.values()] }
  get(id: string): NodeDescriptor | undefined { return this.nodes.get(id) }
  /** Only LOCAL nodes can run a model today. */
  callable(): NodeDescriptor[] { return this.list().filter((n) => n.kind === 'LOCAL') }
}

/** Placement: the first callable node that can hold the model. UNKNOWN capacity is not "fits": the node is chosen only when nothing contradicts it, and the decision says so. */
export function placeOnNode(nodes: NodeRegistry, artifactBytes: number | undefined): { node: NodeDescriptor | null; basis: 'FITS' | 'UNKNOWN_CAPACITY' | 'NO_NODE' | 'TOO_LARGE'; detail: string } {
  const cands = nodes.callable()
  if (!cands.length) return { node: null, basis: 'NO_NODE', detail: 'no callable node is registered' }
  for (const n of cands) {
    const total = (typeof n.capabilities.vramMiB === 'number' ? n.capabilities.vramMiB : 0) + (typeof n.capabilities.ramMiB === 'number' ? n.capabilities.ramMiB : 0)
    if (typeof n.capabilities.vramMiB !== 'number' || typeof n.capabilities.ramMiB !== 'number' || artifactBytes === undefined) return { node: n, basis: 'UNKNOWN_CAPACITY', detail: `node ${n.id} capacity or model size is unmeasured` }
    if (artifactBytes / 1048576 <= total * 0.85) return { node: n, basis: 'FITS', detail: `${Math.round(artifactBytes / 1048576)} MiB fits ${total} MiB of VRAM+RAM on ${n.id}` }
  }
  return { node: null, basis: 'TOO_LARGE', detail: 'the model exceeds the VRAM+RAM of every callable node' }
}

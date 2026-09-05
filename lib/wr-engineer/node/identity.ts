/**
 * WR-Engineer node identity — authentication, heartbeat, revocation.
 *
 * A node authenticates every request (including heartbeats) with its long-lived device credential
 * (issued once at pairing time — see pairing.ts's authorizePairing). Only the credential's sha256
 * hash is ever stored (WrEngineerNode.credential.credentialHash); a revoked node's credential hash
 * stays on record for audit but authenticateNode() always rejects it once revokedAt is set.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { NodeStore } from './store'
import { deriveNodeConnectionStatus, type NodeCapability, type WrEngineerNode } from './types'

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex')
}

export type NodeAuthResult =
  | { ok: true; node: WrEngineerNode }
  | { ok: false; reason: 'not_found' | 'revoked' | 'bad_credential' }

export async function authenticateNode(store: NodeStore, nodeId: string, credential: string): Promise<NodeAuthResult> {
  const node = await store.getNode(nodeId)
  if (!node) return { ok: false, reason: 'not_found' }
  if (node.revokedAt) return { ok: false, reason: 'revoked' }
  if (node.credential.credentialHash !== hashCredential(credential)) {
    return { ok: false, reason: 'bad_credential' }
  }
  return { ok: true, node }
}

export type HeartbeatInput = {
  nodeId: string
  credential: string
  agentVersion?: string
  capabilities?: NodeCapability[]
}

export type HeartbeatResult =
  | { ok: true; node: WrEngineerNode }
  | { ok: false; reason: Extract<NodeAuthResult, { ok: false }>['reason'] }

/** Every heartbeat re-authenticates (never a session token that outlives revocation) and updates
 * lastSeenAt to now — the sole input to deriveNodeConnectionStatus(). A revoked node's heartbeat is
 * rejected outright and never updates lastSeenAt, so a revoked-but-still-running node cannot keep
 * appearing ONLINE. */
export async function recordHeartbeat(store: NodeStore, input: HeartbeatInput, now: Date = new Date()): Promise<HeartbeatResult> {
  const auth = await authenticateNode(store, input.nodeId, input.credential)
  if (!auth.ok) return auth

  const updated: WrEngineerNode = {
    ...auth.node,
    lastSeenAt: now.toISOString(),
    agentVersion: input.agentVersion ?? auth.node.agentVersion,
    capabilities: input.capabilities ?? auth.node.capabilities,
  }
  await store.saveNode(updated)
  return { ok: true, node: updated }
}

export function getNodeConnectionStatus(node: WrEngineerNode, now: Date = new Date()) {
  return deriveNodeConnectionStatus(node.lastSeenAt, now)
}

export async function revokeNode(store: NodeStore, nodeId: string, now: Date = new Date()): Promise<WrEngineerNode> {
  const node = await store.getNode(nodeId)
  if (!node) throw new Error(`Cannot revoke unknown node: ${nodeId}`)
  const revoked: WrEngineerNode = { ...node, revokedAt: now.toISOString() }
  await store.saveNode(revoked)
  return revoked
}

/** Rotates a node's device credential without re-pairing (e.g. suspected compromise short of
 * revocation) — returns the new plaintext exactly once, same discipline as authorizePairing. */
export async function rotateNodeCredential(store: NodeStore, nodeId: string, now: Date = new Date()): Promise<{ node: WrEngineerNode; credential: string }> {
  const node = await store.getNode(nodeId)
  if (!node) throw new Error(`Cannot rotate credential for unknown node: ${nodeId}`)
  const credential = randomUUID() + randomUUID()
  const updated: WrEngineerNode = {
    ...node,
    credential: { credentialId: randomUUID(), credentialHash: hashCredential(credential), issuedAt: now.toISOString() },
  }
  await store.saveNode(updated)
  return { node: updated, credential }
}

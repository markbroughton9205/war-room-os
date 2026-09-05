/**
 * WR-Engineer node pairing.
 *
 * War Room -> WR-Engineer -> Add Computer -> generate pairing code -> `wr-engineer-node pair
 * <CODE>` on the target machine -> node presents pairing request -> Commander authorizes ->
 * persistent node identity issued -> node appears in the node selector.
 *
 * Security properties (mission brief):
 *   - random/unpredictable: 160 bits from node:crypto's CSPRNG, base32-ish human-typeable encoding.
 *   - short-lived: DEFAULT_PAIRING_TTL_MS (10 minutes).
 *   - one-time use: consuming a code (a pairing attempt, whether later authorized or rejected)
 *     immediately flips it out of 'WAITING' — a second attempt with the same code is rejected
 *     regardless of the first attempt's outcome.
 *   - cannot remain stored as reusable plaintext after successful pairing: only sha256(code) is
 *     ever persisted (see PairingToken.codeHash in node/types.ts) — the plaintext is returned to
 *     the caller exactly once, at generation, and never written to the store.
 *
 * Framework-free — no Next.js/Supabase imports — so this logic is testable in isolation and the
 * same hashing/expiry rules can be reasoned about independent of storage backend.
 */
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import type { NodeStore } from './store'
import type { NodeCapability, NodePlatform, PairingToken, WrEngineerNode } from './types'

export const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000

function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

/** Human-typeable, high-entropy code: 20 random bytes -> base64url, grouped for readability isn't
 * required (this is typed once into a CLI, not read aloud), but base64url keeps it short. */
function generateRandomCode(): string {
  return randomBytes(20).toString('base64url')
}

export type GeneratePairingResult = {
  /** Plaintext code — shown to the Commander/UI exactly once. Never retrievable again; only its
   * hash is stored. */
  code: string
  token: PairingToken
}

export async function generatePairingCode(
  store: NodeStore,
  ttlMs: number = DEFAULT_PAIRING_TTL_MS,
): Promise<GeneratePairingResult> {
  const code = generateRandomCode()
  const now = new Date()
  const token: PairingToken = {
    tokenId: randomUUID(),
    codeHash: hashCode(code),
    state: 'WAITING',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  }
  await store.savePairingToken(token)
  return { code, token }
}

export class PairingError extends Error {
  constructor(
    message: string,
    public readonly reason: 'not_found' | 'expired' | 'already_used' | 'wrong_state',
  ) {
    super(message)
    this.name = 'PairingError'
  }
}

function isExpired(token: PairingToken, now: Date): boolean {
  return new Date(token.expiresAt).getTime() <= now.getTime()
}

/** Sweeps every non-terminal token past its expiry into 'EXPIRED'. Pure state transition, no side
 * effects beyond the store write — call this before any read that needs an honest current state
 * (e.g. the pairing-state UI) so an expired-but-not-yet-swept token is never shown as WAITING. */
export async function sweepExpiredPairingTokens(store: NodeStore, now: Date = new Date()): Promise<number> {
  const tokens = await store.listPairingTokens()
  let expiredCount = 0
  for (const token of tokens) {
    if ((token.state === 'WAITING' || token.state === 'PAIRING') && isExpired(token, now)) {
      await store.savePairingToken({ ...token, state: 'EXPIRED' })
      expiredCount += 1
    }
  }
  return expiredCount
}

export type PairingCandidate = {
  nodeName: string
  platform: NodePlatform
  architecture: string
  hostname: string
  osVersion: string
  agentVersion: string
  capabilities: NodeCapability[]
}

/**
 * A node submits its plaintext code + self-reported machine facts. This is the ONE-TIME-USE
 * boundary: on any call with a code matching a token still in 'WAITING' and not expired, the token
 * is immediately flipped to 'PAIRING' (consumed) before this function returns — a second call with
 * the same code, whatever the first call's eventual outcome, always fails with 'already_used'.
 */
export async function requestPairing(
  store: NodeStore,
  code: string,
  candidate: PairingCandidate,
  now: Date = new Date(),
): Promise<PairingToken> {
  const hash = hashCode(code)
  const token = await store.findPairingTokenByHash(hash)
  if (!token) throw new PairingError('No pairing token matches this code.', 'not_found')

  if (token.state !== 'WAITING') {
    throw new PairingError(`Pairing code already used (state=${token.state}).`, 'already_used')
  }
  if (isExpired(token, now)) {
    await store.savePairingToken({ ...token, state: 'EXPIRED' })
    throw new PairingError('Pairing code has expired.', 'expired')
  }

  const consumed: PairingToken = { ...token, state: 'PAIRING', candidate, consumedAt: now.toISOString() }
  await store.savePairingToken(consumed)
  return consumed
}

export type AuthorizePairingResult = {
  token: PairingToken
  node: WrEngineerNode
  /** Plaintext device credential — returned to the caller (who relays it to the node) exactly
   * once. Only its hash is stored on WrEngineerNode.credential.credentialHash. */
  credential: string
}

/** Commander authorizes a PAIRING-state request, issuing a persistent node identity + a new
 * device credential (separate secret from the now-dead pairing code). */
export async function authorizePairing(
  store: NodeStore,
  tokenId: string,
  now: Date = new Date(),
): Promise<AuthorizePairingResult> {
  const token = await store.getPairingToken(tokenId)
  if (!token) throw new PairingError('Pairing token not found.', 'not_found')
  if (token.state !== 'PAIRING' || !token.candidate) {
    throw new PairingError(`Cannot authorize a token in state=${token.state}.`, 'wrong_state')
  }
  if (isExpired(token, now)) {
    await store.savePairingToken({ ...token, state: 'EXPIRED' })
    throw new PairingError('Pairing code expired before authorization.', 'expired')
  }

  const credential = randomBytes(32).toString('base64url')
  const node: WrEngineerNode = {
    nodeId: randomUUID(),
    nodeName: token.candidate.nodeName,
    platform: token.candidate.platform,
    architecture: token.candidate.architecture,
    hostname: token.candidate.hostname,
    osVersion: token.candidate.osVersion,
    agentVersion: token.candidate.agentVersion,
    capabilities: token.candidate.capabilities,
    credential: {
      credentialId: randomUUID(),
      credentialHash: hashCode(credential),
      issuedAt: now.toISOString(),
    },
    lastSeenAt: null,
    createdAt: now.toISOString(),
    pairedAt: now.toISOString(),
    revokedAt: null,
  }
  await store.saveNode(node)

  const authorized: PairingToken = { ...token, state: 'AUTHORIZED', authorizedNodeId: node.nodeId }
  await store.savePairingToken(authorized)

  return { token: authorized, node, credential }
}

export async function rejectPairing(store: NodeStore, tokenId: string): Promise<PairingToken> {
  const token = await store.getPairingToken(tokenId)
  if (!token) throw new PairingError('Pairing token not found.', 'not_found')
  if (token.state !== 'PAIRING' && token.state !== 'WAITING') {
    throw new PairingError(`Cannot reject a token in state=${token.state}.`, 'wrong_state')
  }
  const rejected: PairingToken = { ...token, state: 'REJECTED' }
  await store.savePairingToken(rejected)
  return rejected
}

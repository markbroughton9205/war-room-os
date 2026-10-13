import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto'
import type { ModelRole } from './roles'

/**
 * Signed message envelopes between Foundry and a rack node. Ed25519; canonical JSON; every body carries a nonce and issuedAt
 * so a captured message cannot be replayed (nonce seen once per signer, issuedAt inside a +-60 s window).
 */
export type NodeKey = { publicKeyPem: string; privateKeyPem: string; fingerprint: string }
export type Envelope<K extends string = string, B = unknown> = { kind: K; body: B; signer: string; sig: string }
export type Pinned = { publicKeyPem: string; fingerprint: string }

export const REPLAY_WINDOW_MS = 60_000

export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(',')}}`
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const newNonce = () => randomBytes(16).toString('hex')

export function fingerprintOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex')
}
export function generateNodeKey(): NodeKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { publicKeyPem, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fingerprint: fingerprintOf(publicKeyPem) }
}

export function signEnvelope<K extends string, B extends { nonce: string; issuedAt: string }>(key: NodeKey, kind: K, body: B): Envelope<K, B> {
  const payload = canonicalize({ kind, body, signer: key.fingerprint })
  return { kind, body, signer: key.fingerprint, sig: edSign(null, Buffer.from(payload), createPrivateKey(key.privateKeyPem)).toString('base64') }
}

export class ReplayGuard {
  private seen = new Map<string, number>()
  constructor(private readonly cap = 10_000) {}
  /** false when the nonce was already used by this signer, or when the guard is full of live entries (fails closed). */
  take(signer: string, nonce: string, expiresAtMs: number, nowMs: number): boolean {
    for (const [k, exp] of this.seen) if (exp <= nowMs) this.seen.delete(k)
    const k = `${signer}:${nonce}`
    if (this.seen.has(k) || this.seen.size >= this.cap) return false
    this.seen.set(k, expiresAtMs)
    return true
  }
  size() { return this.seen.size }
}

export type VerifyCode = 'MALFORMED' | 'WRONG_KIND' | 'WRONG_SIGNER' | 'BAD_SIGNATURE' | 'STALE' | 'REPLAY'
export type Verified<B> = { ok: true; body: B } | { ok: false; code: VerifyCode; detail: string }

export function verifyEnvelope<K extends string, B extends { nonce: string; issuedAt: string }>(env: unknown, pinned: Pinned, kind: K, now: Date, guard: ReplayGuard, windowMs = REPLAY_WINDOW_MS): Verified<B> {
  const e = env as Envelope<K, B> | null
  if (!e || typeof e !== 'object' || typeof e.sig !== 'string' || typeof e.signer !== 'string' || !e.body || typeof e.body.nonce !== 'string' || typeof e.body.issuedAt !== 'string') return { ok: false, code: 'MALFORMED', detail: 'envelope is malformed' }
  if (e.kind !== kind) return { ok: false, code: 'WRONG_KIND', detail: `expected ${kind}, got ${String(e.kind)}` }
  if (e.signer !== pinned.fingerprint) return { ok: false, code: 'WRONG_SIGNER', detail: 'signer is not the pinned identity' }
  let valid = false
  try {
    if (fingerprintOf(pinned.publicKeyPem) !== pinned.fingerprint) return { ok: false, code: 'WRONG_SIGNER', detail: 'pinned key does not match its fingerprint' }
    valid = edVerify(null, Buffer.from(canonicalize({ kind: e.kind, body: e.body, signer: e.signer })), createPublicKey(pinned.publicKeyPem), Buffer.from(e.sig, 'base64'))
  } catch { return { ok: false, code: 'BAD_SIGNATURE', detail: 'signature could not be verified' } }
  if (!valid) return { ok: false, code: 'BAD_SIGNATURE', detail: 'signature does not match the body' }
  const issued = Date.parse(e.body.issuedAt)
  if (!Number.isFinite(issued) || Math.abs(now.getTime() - issued) > windowMs) return { ok: false, code: 'STALE', detail: 'issuedAt is outside the replay window' }
  if (!guard.take(e.signer, e.body.nonce, issued + 2 * windowMs, now.getTime())) return { ok: false, code: 'REPLAY', detail: 'nonce already used (or the replay guard is full)' }
  return { ok: true, body: e.body }
}

export type JobMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type JobRequest = {
  jobId: string
  attempt: number
  nodeId: string
  role: ModelRole
  modelRef: string
  digest?: string
  messages: JobMessage[]
  limits: { maxTokens: number; timeoutMs: number }
  nonce: string
  issuedAt: string
}
export type JobReceipt = {
  jobId: string
  attempt: number
  nodeId: string
  modelRef: string
  digest: string
  tokens: number
  elapsedMs: number
  outputSha256: string
  runtimeVersion: string
  nonce: string
  issuedAt: string
}

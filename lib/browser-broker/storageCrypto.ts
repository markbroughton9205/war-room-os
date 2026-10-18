/**
 * Authenticated encryption for trusted-profile Playwright storageState.
 * AES-256-GCM via Node's crypto (not a homemade primitive).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const STORAGE_CRYPTO_VERSION = 1
export const STORAGE_ALGORITHM = 'aes-256-gcm'
export const STORAGE_NONCE_BYTES = 12
export const STORAGE_TAG_BYTES = 16

export type StorageEnvelopeV1 = {
  version: typeof STORAGE_CRYPTO_VERSION
  algorithm: typeof STORAGE_ALGORITHM
  key_id: string
  nonce: string
  ciphertext: string
  auth_tag: string
  created_at: string
}

export type DecryptFailure = 'PROFILE_CORRUPT' | 'PROFILE_KEY_UNAVAILABLE'

function isEnvelope(value: unknown): value is StorageEnvelopeV1 {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.version === STORAGE_CRYPTO_VERSION
    && item.algorithm === STORAGE_ALGORITHM
    && typeof item.key_id === 'string'
    && typeof item.nonce === 'string'
    && typeof item.ciphertext === 'string'
    && typeof item.auth_tag === 'string'
    && typeof item.created_at === 'string'
}

export function parseStorageEnvelope(raw: string): StorageEnvelopeV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return isEnvelope(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function encryptStorageState(plaintext: string, key: Buffer, keyId: string): StorageEnvelopeV1 {
  const nonce = randomBytes(STORAGE_NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  if (authTag.length !== STORAGE_TAG_BYTES) {
    throw new Error('PROFILE_CORRUPT')
  }
  return {
    version: STORAGE_CRYPTO_VERSION,
    algorithm: STORAGE_ALGORITHM,
    key_id: keyId,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    auth_tag: authTag.toString('base64'),
    created_at: new Date().toISOString(),
  }
}

export function decryptStorageState(envelope: StorageEnvelopeV1, key: Buffer): { ok: true; plaintext: string } | { ok: false; error: DecryptFailure } {
  try {
    const nonce = Buffer.from(envelope.nonce, 'base64')
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
    const authTag = Buffer.from(envelope.auth_tag, 'base64')
    if (nonce.length !== STORAGE_NONCE_BYTES || authTag.length !== STORAGE_TAG_BYTES || ciphertext.length < 1) {
      return { ok: false, error: 'PROFILE_CORRUPT' }
    }
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return { ok: true, plaintext }
  } catch {
    return { ok: false, error: 'PROFILE_CORRUPT' }
  }
}

export function envelopeToDisk(envelope: StorageEnvelopeV1): string {
  return `${JSON.stringify({
    version: envelope.version,
    algorithm: envelope.algorithm,
    key_id: envelope.key_id,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    auth_tag: envelope.auth_tag,
    created_at: envelope.created_at,
  })}\n`
}

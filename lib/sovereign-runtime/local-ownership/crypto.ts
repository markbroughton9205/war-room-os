/**
 * #22 Phase 11C — Credential KDF (node:crypto scrypt). No custom crypto.
 * Never stores plaintext passwords.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
})

export type ScryptCredentialRecord = {
  kdf: 'scrypt'
  salt_b64: string
  hash_b64: string
  params: typeof SCRYPT_PARAMS
}

export function hashPasswordScrypt(password: string): ScryptCredentialRecord {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  })
  return {
    kdf: 'scrypt',
    salt_b64: salt.toString('base64'),
    hash_b64: hash.toString('base64'),
    params: SCRYPT_PARAMS,
  }
}

export function verifyPasswordScrypt(password: string, record: ScryptCredentialRecord): boolean {
  if (record.kdf !== 'scrypt') return false
  const salt = Buffer.from(record.salt_b64, 'base64')
  const expected = Buffer.from(record.hash_b64, 'base64')
  const actual = scryptSync(password, salt, expected.length, {
    N: record.params?.N ?? SCRYPT_PARAMS.N,
    r: record.params?.r ?? SCRYPT_PARAMS.r,
    p: record.params?.p ?? SCRYPT_PARAMS.p,
    maxmem: record.params?.maxmem ?? SCRYPT_PARAMS.maxmem,
  })
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function newHighEntropyToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function newPrefixedId(prefix: string, bytes = 16): string {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`
}

/**
 * Trusted installed desktop proof — Node only (SQLite session mint + secret verify).
 * Electron injects DESKTOP_TRUST_HEADER; Next compares it to the machine-scoped secret.
 * Loopback Host alone is never sufficient.
 */
import { timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  DESKTOP_TRUST_ENV,
  DESKTOP_TRUST_FILE,
  DESKTOP_TRUST_HEADER,
  DESKTOP_TRUST_MIN_LENGTH,
} from './desktopTrustShared'
import { newHighEntropyToken } from './crypto'
import { ensureLocalAppDataDirs, resolveLocalAppDataPaths, tightenFileMode } from './paths'

function secretsEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || a.length < DESKTOP_TRUST_MIN_LENGTH) return false
  return timingSafeEqual(a, b)
}

export function desktopTrustFilePath(dataDirOverride?: string | null): string {
  const paths = resolveLocalAppDataPaths(dataDirOverride)
  ensureLocalAppDataDirs(paths)
  return path.join(paths.runtime, DESKTOP_TRUST_FILE)
}

export function loadOrCreateDesktopTrustSecret(dataDirOverride?: string | null): string {
  const fromEnv = typeof process.env[DESKTOP_TRUST_ENV] === 'string' ? process.env[DESKTOP_TRUST_ENV].trim() : ''
  const filePath = desktopTrustFilePath(dataDirOverride)
  if (fromEnv.length >= DESKTOP_TRUST_MIN_LENGTH) {
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, fromEnv, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        tightenFileMode(filePath)
      }
    } catch {
      /* reuse existing file if another process created it */
    }
    return fromEnv
  }
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim()
    if (existing.length >= DESKTOP_TRUST_MIN_LENGTH) {
      process.env[DESKTOP_TRUST_ENV] = existing
      return existing
    }
  } catch {
    /* create below */
  }
  const created = newHighEntropyToken(32)
  try {
    fs.writeFileSync(filePath, created, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    tightenFileMode(filePath)
    process.env[DESKTOP_TRUST_ENV] = created
    return created
  } catch {
    const raced = fs.readFileSync(filePath, 'utf8').trim()
    if (raced.length >= DESKTOP_TRUST_MIN_LENGTH) {
      process.env[DESKTOP_TRUST_ENV] = raced
      return raced
    }
    throw new Error('Trusted desktop secret file is unreadable.')
  }
}

export function readExpectedDesktopTrustSecret(dataDirOverride?: string | null): string | null {
  const fromEnv = typeof process.env[DESKTOP_TRUST_ENV] === 'string' ? process.env[DESKTOP_TRUST_ENV].trim() : ''
  if (fromEnv.length >= DESKTOP_TRUST_MIN_LENGTH) return fromEnv
  try {
    const existing = fs.readFileSync(desktopTrustFilePath(dataDirOverride), 'utf8').trim()
    if (existing.length >= DESKTOP_TRUST_MIN_LENGTH) return existing
  } catch {
    return null
  }
  return null
}

export function extractDesktopTrustHeader(header: string | null | undefined): string {
  return typeof header === 'string' ? header.trim() : ''
}

/**
 * Node verification: presented header must match the machine-scoped secret.
 * Does not trust Host, user-agent, or query flags by themselves.
 */
export function verifyDesktopTrustProof(input: {
  presentedHeader: string | null | undefined
  dataDirOverride?: string | null
}): { ok: true } | { ok: false; reason: string; code: string } {
  const presented = extractDesktopTrustHeader(input.presentedHeader)
  if (presented.length < DESKTOP_TRUST_MIN_LENGTH) {
    return { ok: false, reason: 'Trusted desktop proof missing.', code: 'DESKTOP_TRUST_MISSING' }
  }
  const expected = readExpectedDesktopTrustSecret(input.dataDirOverride)
  if (!expected) {
    return { ok: false, reason: 'Trusted desktop secret is not configured on this runtime.', code: 'DESKTOP_TRUST_UNCONFIGURED' }
  }
  if (!secretsEqual(presented, expected)) {
    return { ok: false, reason: 'Trusted desktop proof rejected.', code: 'DESKTOP_TRUST_DENIED' }
  }
  return { ok: true }
}

export function desktopTrustHeaderName(): typeof DESKTOP_TRUST_HEADER {
  return DESKTOP_TRUST_HEADER
}

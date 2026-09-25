/**
 * Trusted browser profile metadata + encrypted Playwright storageState.
 * Sensitive auth state is ciphertext-only on disk. Wrapping key lives in Secret Service.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { tightenFileMode } from '@/lib/sovereign-runtime/local-ownership/paths'
import { browserBrokerDataDirs } from './paths'
import {
  commitActiveKeyId,
  createRotatedMasterKey,
  getOrCreateMasterKey,
  INITIAL_KEY_ID,
  probeSecretService,
  readWrappingKey,
  retireWrappingKey,
  secretServiceStatus,
} from './secretService'
import {
  decryptStorageState,
  encryptStorageState,
  envelopeToDisk,
  parseStorageEnvelope,
  STORAGE_CRYPTO_VERSION,
} from './storageCrypto'
import type {
  ProfileActionPolicy,
  ProfileAuthState,
  ProfileCreateInput,
  ProfileEncryption,
  ProfilePublicView,
  StorageSecurityState,
  TrustedBrowserProfileV1,
  TrustedProfileState,
} from './profileTypes'

const PROFILE_DIR_MODE = 0o700
const FILE_MODE = 0o600
export const STORAGE_MIGRATION_VERSION = 1
const SYNTHETIC_SECRET = /wr-auth=ok|synth-pass-not-logged|SYNTH_COOKIE_MARKER|sid['"]?\s*:\s*['"]synthetic/i

let failNextEncrypt = false
const migrating = new Set<string>()

export function __failNextEncryptForTests(value = true): void {
  failNextEncrypt = value
}

export function trustedProfilesRoot(): string {
  const root = path.join(browserBrokerDataDirs().root, 'profiles')
  mkdirSync(root, { recursive: true })
  try { chmodSync(root, PROFILE_DIR_MODE) } catch { /* best-effort */ }
  return root
}

export function profileDir(profileId: string): string {
  return path.join(trustedProfilesRoot(), sanitizeId(profileId))
}

export function encryptedStorageStatePath(profileId: string): string {
  return path.join(profileDir(profileId), 'storage-state.enc')
}

export function legacyPlaintextStorageStatePath(profileId: string): string {
  return path.join(profileDir(profileId), 'storage-state.json')
}

/** Encrypted blob path. Legacy plaintext is not a valid persist target. */
export function storageStatePath(profileId: string): string {
  return encryptedStorageStatePath(profileId)
}

export function metadataPath(profileId: string): string {
  return path.join(profileDir(profileId), 'profile.json')
}

export function auditLogPath(): string {
  return path.join(trustedProfilesRoot(), 'audit.jsonl')
}

export function tombstonePath(): string {
  return path.join(trustedProfilesRoot(), 'deleted.jsonl')
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '')
  return cleaned.slice(0, 80) || `p-${randomUUID().slice(0, 8)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export function currentEncryptionBlock(overrides?: Partial<ProfileEncryption>): ProfileEncryption {
  const status = secretServiceStatus()
  const available = status.available && status.key_state === 'AVAILABLE'
  const base: ProfileEncryption = {
    enabled: available,
    scheme: available ? 'aes-256-gcm' : 'none',
    key_reference: available ? (status.key_id || INITIAL_KEY_ID) : 'none',
    last_verified_at: nowIso(),
    blocker: available ? null : (status.errorClass === 'PROFILE_KEY_UNAVAILABLE' ? 'KEY_UNAVAILABLE' : 'SECRET_SERVICE_UNAVAILABLE'),
    storage_security: available ? 'SECURE_STORAGE_READY' : 'SECURE_STORAGE_UNAVAILABLE',
    key_backend: available ? 'SECRET_SERVICE' : 'NONE',
    key_state: status.key_state,
    migration_version: null,
  }
  return { ...base, ...overrides, last_verified_at: overrides?.last_verified_at || base.last_verified_at }
}

function writeRestricted(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const fd = openSync(filePath, 'w', FILE_MODE)
  try {
    writeSync(fd, body, undefined, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  tightenFileMode(filePath)
}

function atomicWriteCiphertext(dest: string, body: string): void {
  const dir = path.dirname(dest)
  mkdirSync(dir, { recursive: true })
  try { chmodSync(dir, PROFILE_DIR_MODE) } catch { /* best-effort */ }
  const tmp = path.join(dir, `.storage-state.enc.${randomUUID()}.tmp`)
  const fd = openSync(tmp, 'wx', FILE_MODE)
  try {
    writeSync(fd, body, undefined, 'utf8')
    fsyncSync(fd)
  } catch (error) {
    closeSync(fd)
    try { unlinkSync(tmp) } catch { /* best-effort */ }
    throw error
  }
  closeSync(fd)
  try { chmodSync(tmp, FILE_MODE) } catch { /* best-effort */ }
  renameSync(tmp, dest)
  tightenFileMode(dest)
}

function publicView(profile: TrustedBrowserProfileV1): ProfilePublicView {
  const { persistent_storage_path: _hidden, ...rest } = profile
  return {
    ...rest,
    storage_present: storageStateExists(profile.profile_id),
  }
}

function applyStorageSecurity(profile: TrustedBrowserProfileV1): TrustedBrowserProfileV1 {
  const encrypted = existsSync(encryptedStorageStatePath(profile.profile_id))
  const legacy = existsSync(legacyPlaintextStorageStatePath(profile.profile_id))
  const status = secretServiceStatus()
  const ready = status.available && status.key_state === 'AVAILABLE'
  let storage_security: StorageSecurityState = ready ? 'SECURE_STORAGE_READY' : 'SECURE_STORAGE_UNAVAILABLE'
  let blocker: ProfileEncryption['blocker'] = ready ? null : (status.errorClass === 'PROFILE_KEY_UNAVAILABLE' ? 'KEY_UNAVAILABLE' : 'SECRET_SERVICE_UNAVAILABLE')
  let enabled = ready
  if (legacy && !encrypted) {
    storage_security = ready ? 'MIGRATION_REQUIRED' : 'MIGRATION_REQUIRED'
    blocker = 'MIGRATION_REQUIRED'
  }
  if (encrypted) {
    storage_security = ready ? 'ENCRYPTED_AT_REST' : 'KEY_UNAVAILABLE'
    enabled = ready
    blocker = ready ? null : 'KEY_UNAVAILABLE'
  }
  if (profile.state === 'CORRUPT' || profile.auth_state === 'CORRUPT') {
    storage_security = 'CORRUPT'
    blocker = 'PROFILE_CORRUPT'
  }
  return {
    ...profile,
    encryption: {
      ...currentEncryptionBlock({
        enabled,
        storage_security,
        blocker,
        migration_version: profile.encryption?.migration_version ?? (encrypted ? STORAGE_MIGRATION_VERSION : null),
        last_verified_at: profile.encryption?.last_verified_at || nowIso(),
      }),
    },
  }
}

export function createTrustedProfile(input: ProfileCreateInput): TrustedBrowserProfileV1 {
  const profile_id = `prf-${randomUUID()}`
  const dir = profileDir(profile_id)
  mkdirSync(dir, { recursive: true })
  try { chmodSync(dir, PROFILE_DIR_MODE) } catch { /* best-effort */ }
  const created = nowIso()
  const profile: TrustedBrowserProfileV1 = {
    profile_id,
    display_name: String(input.display_name || 'Unnamed profile').slice(0, 80),
    created_at: created,
    updated_at: created,
    owner: 'COMMANDER',
    state: 'ACTIVE',
    allowed_origins: (input.allowed_origins ?? []).map(item => item.trim()).filter(Boolean).slice(0, 32),
    denied_origins: (input.denied_origins ?? []).map(item => item.trim()).filter(Boolean).slice(0, 32),
    allow_council: input.allow_council === true,
    allow_foundry: input.allow_foundry === true,
    default_action_policy: (input.default_action_policy ?? 'RESEARCH') as ProfileActionPolicy,
    persistent_storage_path: encryptedStorageStatePath(profile_id),
    encryption: currentEncryptionBlock(),
    last_used_at: null,
    last_auth_refresh_at: null,
    auth_state: 'UNKNOWN_AUTH',
    metadata: {},
  }
  saveProfile(profile)
  appendProfileAudit('PROFILE_CREATED', { profile_id, display_name: profile.display_name })
  return applyStorageSecurity(profile)
}

export function saveProfile(profile: TrustedBrowserProfileV1): void {
  const secured = applyStorageSecurity({
    ...profile,
    updated_at: nowIso(),
    metadata: {},
  })
  writeRestricted(metadataPath(profile.profile_id), `${JSON.stringify(secured, null, 2)}\n`)
  try { chmodSync(profileDir(profile.profile_id), PROFILE_DIR_MODE) } catch { /* best-effort */ }
}

export function loadProfile(profileId: string): TrustedBrowserProfileV1 | null {
  const file = metadataPath(profileId)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as TrustedBrowserProfileV1
    if (!parsed?.profile_id || parsed.owner !== 'COMMANDER') {
      return applyStorageSecurity({ ...parsed, state: 'CORRUPT', auth_state: 'CORRUPT' })
    }
    return applyStorageSecurity(parsed)
  } catch {
    return applyStorageSecurity({
      profile_id: profileId,
      display_name: 'corrupt',
      created_at: nowIso(),
      updated_at: nowIso(),
      owner: 'COMMANDER',
      state: 'CORRUPT',
      allowed_origins: [],
      denied_origins: [],
      allow_council: false,
      allow_foundry: false,
      default_action_policy: 'READ_ONLY',
      persistent_storage_path: encryptedStorageStatePath(profileId),
      encryption: currentEncryptionBlock({ storage_security: 'CORRUPT', blocker: 'PROFILE_CORRUPT', enabled: false, scheme: 'none' }),
      last_used_at: null,
      last_auth_refresh_at: null,
      auth_state: 'CORRUPT',
      metadata: {},
    })
  }
}

export function listProfiles(): ProfilePublicView[] {
  const root = trustedProfilesRoot()
  const names = existsSync(root) ? readdirSync(root).filter(name => name.startsWith('prf-')) : []
  return names
    .map(name => {
      migrateLegacyProfileIfNeeded(name)
      return loadProfile(name)
    })
    .filter((item): item is TrustedBrowserProfileV1 => Boolean(item))
    .map(publicView)
}

export function setProfileState(profileId: string, state: TrustedProfileState): TrustedBrowserProfileV1 | null {
  const profile = loadProfile(profileId)
  if (!profile) return null
  profile.state = state
  if (state === 'LOCKED') profile.auth_state = 'LOCKED'
  if (state === 'DISABLED') profile.auth_state = profile.auth_state === 'AUTHENTICATED' ? 'UNKNOWN_AUTH' : profile.auth_state
  saveProfile(profile)
  appendProfileAudit(`PROFILE_${state}`, { profile_id: profileId })
  return loadProfile(profileId)
}

export function markProfileUsed(profileId: string, authState?: ProfileAuthState): void {
  const profile = loadProfile(profileId)
  if (!profile) return
  profile.last_used_at = nowIso()
  if (authState) {
    profile.auth_state = authState
    if (authState === 'AUTHENTICATED') profile.last_auth_refresh_at = nowIso()
  }
  saveProfile(profile)
}

export function deleteTrustedProfile(profileId: string): { ok: true; profile_id: string } | { ok: false; error: string } {
  const profile = loadProfile(profileId)
  if (!profile) return { ok: false, error: 'PROFILE_NOT_FOUND' }
  const dir = profileDir(profileId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  const line = JSON.stringify({
    profile_id: profileId,
    deleted_at: nowIso(),
    actor: 'COMMANDER',
  })
  const tomb = tombstonePath()
  mkdirSync(path.dirname(tomb), { recursive: true })
  appendFileSync(tomb, `${line}\n`, { encoding: 'utf8', mode: FILE_MODE })
  tightenFileMode(tomb)
  appendProfileAudit('PROFILE_DELETED', { profile_id: profileId })
  return { ok: true, profile_id: profileId }
}

export function storageStateExists(profileId: string): boolean {
  return existsSync(encryptedStorageStatePath(profileId)) || existsSync(legacyPlaintextStorageStatePath(profileId))
}

export function encryptedStorageStateExists(profileId: string): boolean {
  return existsSync(encryptedStorageStatePath(profileId))
}

export function legacyPlaintextExists(profileId: string): boolean {
  return existsSync(legacyPlaintextStorageStatePath(profileId))
}

export type PersistStorageResult =
  | { ok: true; key_id: string }
  | { ok: false; error: 'SECURE_STORAGE_UNAVAILABLE' | 'PROFILE_KEY_UNAVAILABLE' | 'PROFILE_CORRUPT' }

export type LoadStorageResult =
  | { ok: true; state: Record<string, unknown> | null }
  | { ok: false; error: 'SECURE_STORAGE_UNAVAILABLE' | 'PROFILE_KEY_UNAVAILABLE' | 'PROFILE_CORRUPT' | 'PROFILE_NEEDS_REAUTH' }

function persistPlaintextInMemory(profileId: string, json: string, key: Buffer, keyId: string): PersistStorageResult {
  if (failNextEncrypt) {
    failNextEncrypt = false
    return { ok: false, error: 'PROFILE_CORRUPT' }
  }
  const envelope = encryptStorageState(json, key, keyId)
  const roundTrip = decryptStorageState(envelope, key)
  if (!roundTrip.ok || roundTrip.plaintext !== json) return { ok: false, error: 'PROFILE_CORRUPT' }
  atomicWriteCiphertext(encryptedStorageStatePath(profileId), envelopeToDisk(envelope))
  const profile = loadProfile(profileId)
  if (profile) {
    profile.encryption = currentEncryptionBlock({
      enabled: true,
      scheme: 'aes-256-gcm',
      key_reference: keyId,
      storage_security: 'ENCRYPTED_AT_REST',
      blocker: null,
      migration_version: STORAGE_MIGRATION_VERSION,
    })
    saveProfile(profile)
  }
  return { ok: true, key_id: keyId }
}

export function writeEncryptedStorageState(profileId: string, json: string): PersistStorageResult {
  const master = getOrCreateMasterKey()
  if (!master.ok) return { ok: false, error: master.error }
  return persistPlaintextInMemory(profileId, json, master.key, master.keyId)
}

/** @deprecated plaintext persist is forbidden. Encrypts or fails closed. */
export function writeStorageStateFile(profileId: string, json: string): void {
  const written = writeEncryptedStorageState(profileId, json)
  if (!written.ok) {
    const error = new Error(written.error)
    error.name = written.error
    throw error
  }
}

function decryptEncryptedBlob(profileId: string): LoadStorageResult {
  const enc = encryptedStorageStatePath(profileId)
  const legacy = legacyPlaintextStorageStatePath(profileId)
  if (!existsSync(enc)) {
    if (existsSync(legacy)) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
    return { ok: true, state: null }
  }
  const raw = readFileSync(enc, 'utf8')
  const envelope = parseStorageEnvelope(raw)
  if (!envelope) return { ok: false, error: 'PROFILE_CORRUPT' }
  const key = readWrappingKey(envelope.key_id)
  if (!key.ok) return { ok: false, error: key.error }
  const decrypted = decryptStorageState(envelope, key.key)
  if (!decrypted.ok) return { ok: false, error: 'PROFILE_CORRUPT' }
  try {
    const parsed = JSON.parse(decrypted.plaintext) as Record<string, unknown>
    return { ok: true, state: parsed }
  } catch {
    return { ok: false, error: 'PROFILE_CORRUPT' }
  }
}

export function loadStorageStateObject(profileId: string): LoadStorageResult {
  migrateLegacyProfileIfNeeded(profileId)
  return decryptEncryptedBlob(profileId)
}

export function readStorageStateForReuse(profileId: string): LoadStorageResult {
  return loadStorageStateObject(profileId)
}

export type MigrationResult = {
  profile_id: string
  result: 'MIGRATED' | 'ALREADY_ENCRYPTED' | 'NO_STORAGE' | 'MIGRATION_REQUIRED' | 'FAILED'
  version: number | null
  errorClass: string | null
}

export function migrateLegacyProfileIfNeeded(profileId: string): MigrationResult {
  if (migrating.has(profileId)) {
    return { profile_id: profileId, result: 'NO_STORAGE', version: null, errorClass: null }
  }
  const enc = encryptedStorageStatePath(profileId)
  const legacy = legacyPlaintextStorageStatePath(profileId)
  if (existsSync(enc) && !existsSync(legacy)) {
    return { profile_id: profileId, result: 'ALREADY_ENCRYPTED', version: STORAGE_MIGRATION_VERSION, errorClass: null }
  }
  if (!existsSync(legacy)) {
    return { profile_id: profileId, result: 'NO_STORAGE', version: existsSync(enc) ? STORAGE_MIGRATION_VERSION : null, errorClass: null }
  }
  const probe = probeSecretService()
  if (!probe.available) {
    appendProfileAudit('PROFILE_MIGRATION', { profile_id: profileId, result: 'MIGRATION_REQUIRED', version: STORAGE_MIGRATION_VERSION, errorClass: 'SECRET_SERVICE_UNAVAILABLE' })
    const profile = loadProfile(profileId)
    if (profile) {
      profile.encryption = currentEncryptionBlock({ storage_security: 'MIGRATION_REQUIRED', blocker: 'MIGRATION_REQUIRED', enabled: false })
      saveProfile(profile)
    }
    return { profile_id: profileId, result: 'MIGRATION_REQUIRED', version: null, errorClass: 'SECRET_SERVICE_UNAVAILABLE' }
  }
  const master = getOrCreateMasterKey()
  if (!master.ok) {
    appendProfileAudit('PROFILE_MIGRATION', { profile_id: profileId, result: 'MIGRATION_REQUIRED', version: STORAGE_MIGRATION_VERSION, errorClass: master.error })
    return { profile_id: profileId, result: 'MIGRATION_REQUIRED', version: null, errorClass: master.error }
  }
  migrating.add(profileId)
  let plaintext = ''
  try {
    plaintext = readFileSync(legacy, 'utf8')
    const written = persistPlaintextInMemory(profileId, plaintext, master.key, master.keyId)
    if (!written.ok) {
      appendProfileAudit('PROFILE_MIGRATION', { profile_id: profileId, result: 'FAILED', version: STORAGE_MIGRATION_VERSION, errorClass: written.error })
      return { profile_id: profileId, result: 'FAILED', version: null, errorClass: written.error }
    }
    const verify = decryptEncryptedBlob(profileId)
    if (!verify.ok) {
      appendProfileAudit('PROFILE_MIGRATION', { profile_id: profileId, result: 'FAILED', version: STORAGE_MIGRATION_VERSION, errorClass: verify.error })
      return { profile_id: profileId, result: 'FAILED', version: null, errorClass: verify.error }
    }
    try { unlinkSync(legacy) } catch { /* still report failure if leftover */ }
    if (existsSync(legacy)) {
      appendProfileAudit('PROFILE_MIGRATION', { profile_id: profileId, result: 'FAILED', version: STORAGE_MIGRATION_VERSION, errorClass: 'PLAINTEXT_REMOVAL_FAILED' })
      return { profile_id: profileId, result: 'FAILED', version: STORAGE_MIGRATION_VERSION, errorClass: 'PLAINTEXT_REMOVAL_FAILED' }
    }
    appendProfileAudit('PROFILE_MIGRATION', { profile_id: profileId, result: 'MIGRATED', version: STORAGE_MIGRATION_VERSION, errorClass: null })
    return { profile_id: profileId, result: 'MIGRATED', version: STORAGE_MIGRATION_VERSION, errorClass: null }
  } catch {
    appendProfileAudit('PROFILE_MIGRATION', { profile_id: profileId, result: 'FAILED', version: STORAGE_MIGRATION_VERSION, errorClass: 'PROFILE_CORRUPT' })
    return { profile_id: profileId, result: 'FAILED', version: null, errorClass: 'PROFILE_CORRUPT' }
  } finally {
    migrating.delete(profileId)
  }
}

export function migrateAllLegacyProfiles(): MigrationResult[] {
  const root = trustedProfilesRoot()
  const names = existsSync(root) ? readdirSync(root).filter(name => name.startsWith('prf-')) : []
  return names.map(name => migrateLegacyProfileIfNeeded(name))
}

export type RotationResult =
  | { ok: true; from: string; to: string; profiles: number }
  | { ok: false; error: string; from: string | null; to: string | null; completed: number; remaining: number }

export function rotateAllProfileKeys(): RotationResult {
  const master = getOrCreateMasterKey()
  if (!master.ok) return { ok: false, error: master.error, from: null, to: null, completed: 0, remaining: 0 }
  const rotated = createRotatedMasterKey(master.keyId)
  if (!rotated.ok) return { ok: false, error: rotated.error, from: master.keyId, to: null, completed: 0, remaining: 0 }
  const root = trustedProfilesRoot()
  const names = existsSync(root) ? readdirSync(root).filter(name => name.startsWith('prf-') && existsSync(encryptedStorageStatePath(name))) : []
  let completed = 0
  for (const profileId of names) {
    const loaded = loadStorageStateObject(profileId)
    if (!loaded.ok || !loaded.state) {
      return { ok: false, error: loaded.ok ? 'PROFILE_CORRUPT' : loaded.error, from: master.keyId, to: rotated.keyId, completed, remaining: names.length - completed }
    }
    const written = persistPlaintextInMemory(profileId, JSON.stringify(loaded.state), rotated.key, rotated.keyId)
    if (!written.ok) {
      return { ok: false, error: written.error, from: master.keyId, to: rotated.keyId, completed, remaining: names.length - completed }
    }
    completed += 1
  }
  if (!commitActiveKeyId(rotated.keyId)) {
    return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE', from: master.keyId, to: rotated.keyId, completed, remaining: names.length - completed }
  }
  retireWrappingKey(master.keyId)
  appendProfileAudit('PROFILE_KEY_ROTATED', { from: master.keyId, to: rotated.keyId, profiles: completed, result: 'ok' })
  return { ok: true, from: master.keyId, to: rotated.keyId, profiles: completed }
}

export function storageStateContainsSecretsInMetadata(profile: TrustedBrowserProfileV1): boolean {
  const blob = JSON.stringify(profile)
  return /cookie|authorization|password|set-cookie|bearer /i.test(blob)
}

export function profileDirContainsPlaintextAuth(profileId: string, marker = SYNTHETIC_SECRET): boolean {
  const dir = profileDir(profileId)
  if (!existsSync(dir)) return false
  const names = readdirSync(dir)
  for (const name of names) {
    if (name.endsWith('.tmp') || name.endsWith('.json') || name.endsWith('.enc') || name === 'profile.json') {
      const body = readFileSync(path.join(dir, name), 'utf8')
      if (marker.test(body)) return true
    }
  }
  return false
}

export function hashProfileId(profileId: string): string {
  return createHash('sha256').update(profileId).digest('hex').slice(0, 16)
}

export function appendProfileAudit(action: string, extra: Record<string, unknown>): void {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (/cookie|token|password|authorization|secret|storageState/i.test(key)) continue
    if (typeof value === 'string' && /cookie=|Bearer |password=/i.test(value)) continue
    safe[key] = value
  }
  const line = JSON.stringify({ timestamp: nowIso(), action_type: action, actor: 'COMMANDER', ...safe })
  const file = auditLogPath()
  mkdirSync(path.dirname(file), { recursive: true })
  appendFileSync(file, `${line}\n`, { encoding: 'utf8', mode: FILE_MODE })
  tightenFileMode(file)
}

export async function readProfileAuditTail(limit = 50): Promise<unknown[]> {
  const file = auditLogPath()
  if (!existsSync(file)) return []
  const raw = readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split('\n').slice(-limit).map(line => {
    try { return JSON.parse(line) } catch { return { corrupt: true } }
  })
}

export async function listProfileDirNames(): Promise<string[]> {
  const root = trustedProfilesRoot()
  if (!existsSync(root)) return []
  const names = await readdir(root)
  return names.filter(name => name.startsWith('prf-'))
}

export function profileStoreDiagnostics(): {
  profileCount: number
  encryption: 'aes-256-gcm' | 'blocked'
  keyring: 'SECRET_SERVICE' | 'SECRET_SERVICE_UNAVAILABLE' | 'NONE'
  storage_security: StorageSecurityState
  key_state: 'AVAILABLE' | 'UNAVAILABLE'
  key_id: string | null
} {
  migrateAllLegacyProfiles()
  const status = secretServiceStatus()
  const available = status.available && status.key_state === 'AVAILABLE'
  return {
    profileCount: listProfiles().length,
    encryption: available ? 'aes-256-gcm' : 'blocked',
    keyring: available ? 'SECRET_SERVICE' : (status.backend === 'SECRET_SERVICE' ? 'SECRET_SERVICE_UNAVAILABLE' : 'NONE'),
    storage_security: available ? 'SECURE_STORAGE_READY' : 'SECURE_STORAGE_UNAVAILABLE',
    key_state: status.key_state,
    key_id: available ? status.key_id : null,
  }
}

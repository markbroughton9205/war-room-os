/**
 * Linux Secret Service backend for the trusted-browser wrapping key.
 *
 * Uses libsecret (GI Secret-1) against org.freedesktop.secrets.
 * The wrapping key never enters the repo, profile directory, logs, or envelope metadata.
 * Fail closed when the session bus / keyring is unavailable.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

export const SECRET_SERVICE_NAME = 'war-room-os'
export const MASTER_KEY_ACCOUNT_PREFIX = 'browser-profile-master-'
export const ACTIVE_KEY_ID_ACCOUNT = 'browser-profile-active-key-id'
export const INITIAL_KEY_ID = 'browser-profile-master-v1'
export const KEY_BYTES = 32

export type SecretServiceBackendName = 'SECRET_SERVICE' | 'NONE'
export type SecretKeyState = 'AVAILABLE' | 'UNAVAILABLE'

export type SecretServiceProbe = {
  available: boolean
  backend: SecretServiceBackendName
  provider: 'libsecret' | 'none'
  errorClass: string | null
}

export type SecretServiceStatus = {
  available: boolean
  backend: SecretServiceBackendName
  key_state: SecretKeyState
  key_id: string | null
  errorClass: string | null
}

type HelperResponse = {
  ok?: boolean
  found?: boolean
  value?: string | null
  backend?: string
  provider?: string
  error?: string
  cleared?: boolean
}

type HelperOp = 'probe' | 'get' | 'set' | 'delete'

type InjectedBackend = {
  probe: () => SecretServiceProbe
  get: (account: string) => string | null
  set: (account: string, secret: string) => boolean
  delete: (account: string) => boolean
}

let injected: InjectedBackend | 'UNAVAILABLE' | null = null
const keyCache = new Map<string, Buffer>()
let probeCache: { at: number; value: SecretServiceProbe } | null = null
let statusCache: { at: number; value: SecretServiceStatus } | null = null
const STATUS_TTL_MS = 15_000

const LIBSECRET_HELPER = `
import json, os, sys
runtime = os.environ.get("XDG_RUNTIME_DIR")
if runtime and not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
    bus = os.path.join(runtime, "bus")
    if os.path.exists(bus):
        os.environ["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=" + bus
try:
    import gi
    gi.require_version("Secret", "1")
    from gi.repository import Secret
except Exception:
    json.dump({"ok": False, "error": "SECRET_SERVICE_UNAVAILABLE"}, sys.stdout)
    raise SystemExit(0)
SCHEMA = Secret.Schema.new(
    "org.war-room-os.browser-profile",
    Secret.SchemaFlags.NONE,
    {"service": Secret.SchemaAttributeType.STRING, "account": Secret.SchemaAttributeType.STRING},
)
req = json.load(sys.stdin)
op = req.get("op")
service = req.get("service") or ""
account = req.get("account") or ""
attrs = {"service": service, "account": account}
try:
    if op == "probe":
        Secret.password_lookup_sync(SCHEMA, {"service": service, "account": "__probe__"}, None)
        json.dump({"ok": True, "backend": "SECRET_SERVICE", "provider": "libsecret"}, sys.stdout)
    elif op == "get":
        value = Secret.password_lookup_sync(SCHEMA, attrs, None)
        json.dump({"ok": True, "found": value is not None, "value": value}, sys.stdout)
    elif op == "set":
        secret = req.get("secret") or ""
        label = req.get("label") or "War Room OS"
        stored = Secret.password_store_sync(SCHEMA, attrs, Secret.COLLECTION_DEFAULT, label, secret, None)
        json.dump({"ok": bool(stored)}, sys.stdout)
    elif op == "delete":
        cleared = Secret.password_clear_sync(SCHEMA, attrs, None)
        json.dump({"ok": True, "cleared": bool(cleared)}, sys.stdout)
    else:
        json.dump({"ok": False, "error": "SECRET_SERVICE_UNAVAILABLE"}, sys.stdout)
except Exception:
    json.dump({"ok": False, "error": "SECRET_SERVICE_UNAVAILABLE"}, sys.stdout)
`

export function __setSecretServiceBackendForTests(backend: InjectedBackend | 'UNAVAILABLE' | null): void {
  injected = backend
  keyCache.clear()
  probeCache = null
  statusCache = null
}

export function __clearSecretKeyCacheForTests(): void {
  keyCache.clear()
  probeCache = null
  statusCache = null
}

function parseHelper(stdout: string): HelperResponse | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as HelperResponse
  } catch {
    return null
  }
}

function runHelper(op: HelperOp, extra: Record<string, string> = {}): HelperResponse | null {
  const payload = JSON.stringify({
    op,
    service: SECRET_SERVICE_NAME,
    ...extra,
  })
  const env = { ...process.env }
  if (!env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`
  }
  const spawned = spawnSync('python3', ['-c', LIBSECRET_HELPER], {
    input: payload,
    encoding: 'utf8',
    timeout: 8_000,
    env,
    maxBuffer: 64 * 1024,
  })
  if (spawned.error || spawned.status !== 0) return parseHelper(spawned.stdout || '')
  return parseHelper(spawned.stdout || '')
}

function liveProbe(): SecretServiceProbe {
  const result = runHelper('probe')
  if (result?.ok === true) {
    return { available: true, backend: 'SECRET_SERVICE', provider: 'libsecret', errorClass: null }
  }
  return {
    available: false,
    backend: 'NONE',
    provider: 'none',
    errorClass: result?.error || 'SECRET_SERVICE_UNAVAILABLE',
  }
}

function liveGet(account: string): string | null {
  const result = runHelper('get', { account })
  if (!result?.ok || !result.found || typeof result.value !== 'string' || !result.value) return null
  return result.value
}

function invalidateCaches(): void {
  probeCache = null
  statusCache = null
}

function liveSet(account: string, secret: string, label: string): boolean {
  const result = runHelper('set', { account, secret, label })
  return result?.ok === true
}

function liveDelete(account: string): boolean {
  const result = runHelper('delete', { account })
  return result?.ok === true
}

export function probeSecretService(): SecretServiceProbe {
  if (injected === 'UNAVAILABLE') {
    return { available: false, backend: 'NONE', provider: 'none', errorClass: 'SECRET_SERVICE_UNAVAILABLE' }
  }
  if (injected) return injected.probe()
  const now = Date.now()
  if (probeCache && now - probeCache.at < STATUS_TTL_MS) return probeCache.value
  const value = liveProbe()
  probeCache = { at: now, value }
  return value
}

function backendGet(account: string): string | null {
  if (injected === 'UNAVAILABLE') return null
  if (injected) return injected.get(account)
  return liveGet(account)
}

function backendSet(account: string, secret: string, label: string): boolean {
  if (injected === 'UNAVAILABLE') return false
  invalidateCaches()
  if (injected) return injected.set(account, secret)
  return liveSet(account, secret, label)
}

function backendDelete(account: string): boolean {
  if (injected === 'UNAVAILABLE') return false
  invalidateCaches()
  keyCache.delete(account)
  if (injected) return injected.delete(account)
  return liveDelete(account)
}

export function isValidKeyId(keyId: string): boolean {
  return /^browser-profile-master-v\d+$/.test(keyId)
}

export function nextKeyId(current: string): string {
  const match = /^browser-profile-master-v(\d+)$/.exec(current)
  const version = match ? Number(match[1]) + 1 : 2
  return `browser-profile-master-v${version}`
}

function hexToKey(hex: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null
  const key = Buffer.from(hex, 'hex')
  return key.length === KEY_BYTES ? key : null
}

export function readActiveKeyId(): string | null {
  const probe = probeSecretService()
  if (!probe.available) return null
  const stored = backendGet(ACTIVE_KEY_ID_ACCOUNT)
  if (stored && isValidKeyId(stored)) return stored
  return null
}

export function readWrappingKey(keyId: string): { ok: true; key: Buffer } | { ok: false; error: 'PROFILE_KEY_UNAVAILABLE' | 'SECURE_STORAGE_UNAVAILABLE' } {
  if (!isValidKeyId(keyId)) return { ok: false, error: 'PROFILE_KEY_UNAVAILABLE' }
  const cached = keyCache.get(keyId)
  if (cached) return { ok: true, key: cached }
  const probe = probeSecretService()
  if (!probe.available) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
  const hex = backendGet(keyId)
  if (!hex) return { ok: false, error: 'PROFILE_KEY_UNAVAILABLE' }
  const key = hexToKey(hex)
  if (!key) return { ok: false, error: 'PROFILE_KEY_UNAVAILABLE' }
  keyCache.set(keyId, key)
  return { ok: true, key }
}

export function getOrCreateMasterKey():
  | { ok: true; key: Buffer; keyId: string; created: boolean }
  | { ok: false; error: 'SECURE_STORAGE_UNAVAILABLE' | 'PROFILE_KEY_UNAVAILABLE' } {
  const probe = probeSecretService()
  if (!probe.available) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
  let keyId = readActiveKeyId()
  let created = false
  if (!keyId) {
    keyId = INITIAL_KEY_ID
    const existing = backendGet(keyId)
    if (!existing) {
      const hex = randomBytes(KEY_BYTES).toString('hex')
      const stored = backendSet(keyId, hex, 'War Room OS browser-profile master v1')
      if (!stored) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
      const roundTrip = backendGet(keyId)
      if (roundTrip !== hex) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
      created = true
    }
    const marked = backendSet(ACTIVE_KEY_ID_ACCOUNT, keyId, 'War Room OS browser-profile active key id')
    if (!marked) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
  }
  const loaded = readWrappingKey(keyId)
  if (!loaded.ok) return loaded
  return { ok: true, key: loaded.key, keyId, created }
}

export function createRotatedMasterKey(currentKeyId: string):
  | { ok: true; key: Buffer; keyId: string }
  | { ok: false; error: 'SECURE_STORAGE_UNAVAILABLE' | 'PROFILE_KEY_UNAVAILABLE' } {
  const probe = probeSecretService()
  if (!probe.available) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
  const next = nextKeyId(currentKeyId)
  if (backendGet(next)) {
    const loaded = readWrappingKey(next)
    if (!loaded.ok) return loaded
    return { ok: true, key: loaded.key, keyId: next }
  }
  const hex = randomBytes(KEY_BYTES).toString('hex')
  if (!backendSet(next, hex, `War Room OS browser-profile master ${next}`)) {
    return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
  }
  if (backendGet(next) !== hex) return { ok: false, error: 'SECURE_STORAGE_UNAVAILABLE' }
  const loaded = readWrappingKey(next)
  if (!loaded.ok) return loaded
  return { ok: true, key: loaded.key, keyId: next }
}

export function commitActiveKeyId(keyId: string): boolean {
  if (!isValidKeyId(keyId)) return false
  return backendSet(ACTIVE_KEY_ID_ACCOUNT, keyId, 'War Room OS browser-profile active key id')
}

export function retireWrappingKey(keyId: string): boolean {
  if (!isValidKeyId(keyId)) return false
  keyCache.delete(keyId)
  return backendDelete(keyId)
}

export function secretServiceStatus(): SecretServiceStatus {
  const now = Date.now()
  if (!injected && statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.value
  const probe = probeSecretService()
  if (!probe.available) {
    const value: SecretServiceStatus = { available: false, backend: 'NONE', key_state: 'UNAVAILABLE', key_id: null, errorClass: probe.errorClass }
    statusCache = { at: now, value }
    return value
  }
  const keyId = readActiveKeyId()
  const value: SecretServiceStatus = {
    available: true,
    backend: 'SECRET_SERVICE',
    key_state: 'AVAILABLE',
    key_id: keyId,
    errorClass: null,
  }
  statusCache = { at: now, value }
  return value
}

export function keyringStoreSecret(account: string, secret: string, label: string): boolean {
  const probe = probeSecretService()
  if (!probe.available) return false
  return backendSet(account, secret, label)
}

export function keyringReadSecret(account: string): string | null {
  const probe = probeSecretService()
  if (!probe.available) return null
  return backendGet(account)
}

export function keyringDeleteSecret(account: string): boolean {
  return backendDelete(account)
}

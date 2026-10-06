/**
 * Browser Broker Phase 2.1 — Secret Service wrapping key + AES-256-GCM at rest.
 * Does not print cookies, tokens, or wrapping-key material.
 */
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyBrowserAction } from './actionClassifier'
import { capabilityFor } from './capabilityTable'
import {
  __failNextEncryptForTests,
  createTrustedProfile,
  deleteTrustedProfile,
  encryptedStorageStateExists,
  encryptedStorageStatePath,
  legacyPlaintextExists,
  legacyPlaintextStorageStatePath,
  loadProfile,
  loadStorageStateObject,
  migrateLegacyProfileIfNeeded,
  profileDir,
  profileDirContainsPlaintextAuth,
  readProfileAuditTail,
  rotateAllProfileKeys,
  storageStateContainsSecretsInMetadata,
  writeEncryptedStorageState,
  writeStorageStateFile,
} from './profileStore'
import {
  __clearSecretKeyCacheForTests,
  __setSecretServiceBackendForTests,
  INITIAL_KEY_ID,
  keyringDeleteSecret,
  keyringReadSecret,
  keyringStoreSecret,
  probeSecretService,
  secretServiceStatus,
} from './secretService'
import { decryptStorageState, encryptStorageState, parseStorageEnvelope } from './storageCrypto'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const SYNTH = {
  cookie: 'SYNTH_COOKIE_MARKER',
  token: 'synth-pass-not-logged',
  storage: JSON.stringify({
    cookies: [{ name: 'sid', value: 'SYNTH_COOKIE_MARKER', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
    origins: [{ origin: 'http://127.0.0.1', localStorage: [{ name: 'token', value: 'synth-pass-not-logged' }] }],
  }),
}

function memoryBackend() {
  const mem = new Map<string, string>()
  return {
    probe: () => ({ available: true as const, backend: 'SECRET_SERVICE' as const, provider: 'libsecret' as const, errorClass: null }),
    get: (account: string) => mem.get(account) ?? null,
    set: (account: string, secret: string) => {
      mem.set(account, secret)
      return true
    },
    delete: (account: string) => mem.delete(account),
  }
}

async function run() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-bb-p21-'))
  process.env.WAR_ROOM_LOCAL_DATA_DIR = tmp
  const results: CaseResult[] = []
  const add = (item: CaseResult) => {
    results.push(item)
  }

  try {
    const probe = probeSecretService()
    add(check('KEYRING-1', probe.available && probe.backend === 'SECRET_SERVICE' && probe.provider === 'libsecret', JSON.stringify({ available: probe.available, backend: probe.backend, provider: probe.provider, errorClass: probe.errorClass })))

    const probeAccount = 'browser-profile-keyring-probe'
    const probeSecret = randomBytes(32).toString('hex')
    const stored = keyringStoreSecret(probeAccount, probeSecret, 'War Room OS keyring probe')
    const readBack = keyringReadSecret(probeAccount)
    add(check('KEYRING-2', stored && readBack === probeSecret, `stored=${stored} match=${readBack === probeSecret}`))

    __clearSecretKeyCacheForTests()
    const helper = `
import json, os, sys, hashlib
runtime = os.environ.get("XDG_RUNTIME_DIR")
if runtime and not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
    bus = os.path.join(runtime, "bus")
    if os.path.exists(bus):
        os.environ["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=" + bus
import gi
gi.require_version("Secret", "1")
from gi.repository import Secret
SCHEMA = Secret.Schema.new("org.war-room-os.browser-profile", Secret.SchemaFlags.NONE, {"service": Secret.SchemaAttributeType.STRING, "account": Secret.SchemaAttributeType.STRING})
req = json.load(sys.stdin)
value = Secret.password_lookup_sync(SCHEMA, {"service": req["service"], "account": req["account"]}, None)
json.dump({"ok": True, "found": value is not None, "digest": hashlib.sha256((value or "").encode()).hexdigest() if value else None}, sys.stdout)
`
    const child = spawnSync('python3', ['-c', helper], {
      input: JSON.stringify({ service: 'war-room-os', account: probeAccount }),
      encoding: 'utf8',
      timeout: 8_000,
      env: process.env,
    })
    let childDigest: string | null = null
    try {
      const parsed = JSON.parse((child.stdout || '').trim()) as { digest?: string }
      childDigest = parsed.digest ?? null
    } catch {
      childDigest = null
    }
    const expectedDigest = createHash('sha256').update(probeSecret).digest('hex')
    add(check('KEYRING-3', childDigest === expectedDigest && child.status === 0, `restart_match=${childDigest === expectedDigest}`))
    keyringDeleteSecret(probeAccount)
    add(check('KEYRING-4', !JSON.stringify({ tmp, results: results.map(item => item.name) }).includes(probeSecret), 'probe secret absent from test names/paths'))

    const profile = createTrustedProfile({ display_name: 'Phase21 Encrypt', allow_foundry: true, allowed_origins: ['127.0.0.1'] })
    add(check('SECURE_STORAGE_READY', profile.encryption.key_backend === 'SECRET_SERVICE' && profile.encryption.scheme === 'aes-256-gcm' && profile.encryption.storage_security === 'SECURE_STORAGE_READY', JSON.stringify(profile.encryption)))

    const written = writeEncryptedStorageState(profile.profile_id, SYNTH.storage)
    add(check('ENCRYPT-1', written.ok === true && encryptedStorageStateExists(profile.profile_id) && !legacyPlaintextExists(profile.profile_id), JSON.stringify({ ok: written.ok, enc: encryptedStorageStateExists(profile.profile_id), legacy: legacyPlaintextExists(profile.profile_id) })))

    const encBody = readFileSync(encryptedStorageStatePath(profile.profile_id), 'utf8')
    const envelope = parseStorageEnvelope(encBody)
    add(check('ENCRYPT-2', Boolean(envelope) && !encBody.includes(SYNTH.cookie) && !encBody.includes(SYNTH.token) && !profileDirContainsPlaintextAuth(profile.profile_id), `plaintext_on_disk=${profileDirContainsPlaintextAuth(profile.profile_id)}`))

    const loaded = loadStorageStateObject(profile.profile_id)
    add(check('ENCRYPT-3', loaded.ok === true && JSON.stringify(loaded.ok ? loaded.state : null).includes(SYNTH.cookie), `ok=${loaded.ok}`))

    const tamperedPath = encryptedStorageStatePath(profile.profile_id)
    const tampered = parseStorageEnvelope(readFileSync(tamperedPath, 'utf8'))
    if (tampered) {
      const buf = Buffer.from(tampered.ciphertext, 'base64')
      buf[0] = buf[0] ^ 0xff
      tampered.ciphertext = buf.toString('base64')
      writeFileSync(tamperedPath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 })
    }
    const corrupt = loadStorageStateObject(profile.profile_id)
    add(check('ENCRYPT-4', !corrupt.ok && corrupt.error === 'PROFILE_CORRUPT', JSON.stringify(corrupt)))
    writeEncryptedStorageState(profile.profile_id, SYNTH.storage)

    const wrongKey = randomBytes(32)
    const again = parseStorageEnvelope(readFileSync(encryptedStorageStatePath(profile.profile_id), 'utf8'))
    const wrong = again ? decryptStorageState(again, wrongKey) : { ok: false as const, error: 'PROFILE_CORRUPT' as const }
    add(check('ENCRYPT-5', wrong.ok === false, `wrong_key_rejected=${wrong.ok === false}`))

    const keyMaterial = randomBytes(32)
    const first = encryptStorageState(SYNTH.storage, keyMaterial, INITIAL_KEY_ID)
    const second = encryptStorageState(SYNTH.storage, keyMaterial, INITIAL_KEY_ID)
    add(check('ENCRYPT-6', first.nonce !== second.nonce && first.ciphertext !== second.ciphertext, 'nonce unique per write'))
    add(check('ROTATE-1', first.key_id === INITIAL_KEY_ID && envelope?.key_id === INITIAL_KEY_ID, first.key_id))

    const leftovers = readdirSync(profileDir(profile.profile_id)).filter(name => name.includes('.tmp') || name === 'storage-state.json' || name === 'cookies.json' || name === 'tokens.json')
    add(check('ENCRYPT-7', leftovers.length === 0 && !legacyPlaintextExists(profile.profile_id), leftovers.join(',') || 'no plaintext temp'))

    const reloaded = loadProfile(profile.profile_id)
    add(check('PROFILE-meta-security', Boolean(reloaded && reloaded.encryption.storage_security === 'ENCRYPTED_AT_REST' && !storageStateContainsSecretsInMetadata(reloaded)), JSON.stringify(reloaded?.encryption)))

    const legacy = createTrustedProfile({ display_name: 'legacy', allow_foundry: true })
    mkdirSync(profileDir(legacy.profile_id), { recursive: true })
    writeFileSync(legacyPlaintextStorageStatePath(legacy.profile_id), SYNTH.storage, { mode: 0o600 })
    add(check('MIGRATE-1', legacyPlaintextExists(legacy.profile_id) && !encryptedStorageStateExists(legacy.profile_id), 'legacy plaintext detected'))
    const migrated = migrateLegacyProfileIfNeeded(legacy.profile_id)
    add(check('MIGRATE-2', migrated.result === 'MIGRATED', JSON.stringify(migrated)))
    add(check('MIGRATE-3', encryptedStorageStateExists(legacy.profile_id) && loadStorageStateObject(legacy.profile_id).ok === true, 'round-trip before removal'))
    add(check('MIGRATE-4', !legacyPlaintextExists(legacy.profile_id), 'plaintext removed'))

    const failed = createTrustedProfile({ display_name: 'fail-migrate', allow_foundry: true })
    writeFileSync(legacyPlaintextStorageStatePath(failed.profile_id), SYNTH.storage, { mode: 0o600 })
    __failNextEncryptForTests(true)
    const failedMig = migrateLegacyProfileIfNeeded(failed.profile_id)
    add(check('MIGRATE-5', failedMig.result === 'FAILED' && legacyPlaintextExists(failed.profile_id) && readFileSync(legacyPlaintextStorageStatePath(failed.profile_id), 'utf8').includes(SYNTH.cookie), JSON.stringify({ result: failedMig.result, leftover: legacyPlaintextExists(failed.profile_id) })))

    const audit = await readProfileAuditTail(80)
    const auditBlob = JSON.stringify(audit)
    add(check('MIGRATE-6', !auditBlob.includes(SYNTH.cookie) && !auditBlob.includes(SYNTH.token) && !/password=|cookie=/i.test(auditBlob), 'migration audit redacted'))

    __setSecretServiceBackendForTests('UNAVAILABLE')
    const blocked = createTrustedProfile({ display_name: 'blocked', allow_foundry: true })
    const persistBlocked = writeEncryptedStorageState(blocked.profile_id, SYNTH.storage)
    add(check('FAILCLOSED-1', persistBlocked.ok === false && persistBlocked.error === 'SECURE_STORAGE_UNAVAILABLE' && !legacyPlaintextExists(blocked.profile_id) && !encryptedStorageStateExists(blocked.profile_id), JSON.stringify(persistBlocked)))
    add(check('FAILCLOSED-2', persistBlocked.ok === false && persistBlocked.error === 'SECURE_STORAGE_UNAVAILABLE' && blocked.encryption.storage_security === 'SECURE_STORAGE_UNAVAILABLE', blocked.encryption.storage_security))
    __setSecretServiceBackendForTests(null)

    deleteTrustedProfile(profile.profile_id)
    deleteTrustedProfile(legacy.profile_id)
    deleteTrustedProfile(failed.profile_id)
    deleteTrustedProfile(blocked.profile_id)

    __setSecretServiceBackendForTests(memoryBackend())
    const rotateProfile = createTrustedProfile({ display_name: 'rotate', allow_foundry: true })
    const rotateWrite = writeEncryptedStorageState(rotateProfile.profile_id, SYNTH.storage)
    const before = parseStorageEnvelope(readFileSync(encryptedStorageStatePath(rotateProfile.profile_id), 'utf8'))
    const rotated = rotateAllProfileKeys()
    const after = parseStorageEnvelope(readFileSync(encryptedStorageStatePath(rotateProfile.profile_id), 'utf8'))
    const afterLoad = loadStorageStateObject(rotateProfile.profile_id)
    add(check('ROTATE-2', rotateWrite.ok && rotated.ok === true && before?.key_id !== after?.key_id && afterLoad.ok === true && JSON.stringify(afterLoad.ok ? afterLoad.state : {}).includes(SYNTH.cookie), JSON.stringify({ rotate: rotated, from: before?.key_id, to: after?.key_id })))
    __setSecretServiceBackendForTests(null)

    add(check('COMMANDER-rotate-denied-council', classifyBrowserAction({ kind: 'secureStorage.rotate', owner: 'council' }).verdict === 'DENIED', classifyBrowserAction({ kind: 'secureStorage.rotate', owner: 'council' }).reasonCode))
    add(check('COMMANDER-rotate-allowed', classifyBrowserAction({ kind: 'secureStorage.rotate', owner: 'commander' }).verdict === 'ALLOW_RESEARCH', 'commander rotate'))
    add(check('CAP-rotate-foundry', capabilityFor('foundry', 'secureStorage.rotate') === 'NO', 'foundry cannot rotate'))
    add(check('status-public', secretServiceStatus().backend === 'SECRET_SERVICE' && !JSON.stringify(secretServiceStatus()).includes(probeSecret), JSON.stringify({ backend: secretServiceStatus().backend, key_state: secretServiceStatus().key_state })))

    deleteTrustedProfile(rotateProfile.profile_id)
  } finally {
    __setSecretServiceBackendForTests(null)
    __failNextEncryptForTests(false)
    rmSync(tmp, { recursive: true, force: true })
  }

  console.log(results.map(item => `${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`).join('\n'))
  const failed = results.filter(item => !item.pass)
  console.log(`browser broker phase-2.1 validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})

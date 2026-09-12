/**
 * #22 Phase 11C — Durable local ownership SQLite store (node:sqlite).
 * Every owned row has owner_local_identity_id — never null.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ensureLocalAppDataDirs, resolveLocalAppDataPaths, tightenFileMode, type LocalAppDataPaths } from './paths'
import { hashPasswordScrypt, newHighEntropyToken, newPrefixedId, verifyPasswordScrypt, type ScryptCredentialRecord } from './crypto'
import {
  LOCAL_IDENTITY_ROLE,
  LOCAL_LOGIN_LOCK_MS,
  LOCAL_LOGIN_MAX_FAILURES,
  LOCAL_LOGIN_WINDOW_MS,
  LOCAL_OWNERSHIP_SCHEMA_VERSION,
  LOCAL_SESSION_TTL_MS,
  type LocalAuditRecord,
  type LocalCommanderIdentity,
  type LocalConversationRecord,
  type LocalDataMode,
  type LocalMessageRecord,
  type LocalRemoteAuthState,
  type LocalResourceOrigin,
  type LocalSessionRecord,
} from './types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS local_identity (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash_b64 TEXT NOT NULL,
  password_salt_b64 TEXT NOT NULL,
  kdf TEXT NOT NULL,
  kdf_params_json TEXT NOT NULL,
  remote_link_state TEXT NOT NULL,
  linked_remote_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_session (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_local_identity_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (owner_local_identity_id) REFERENCES local_identity(id)
);

CREATE TABLE IF NOT EXISTS local_conversation (
  id TEXT PRIMARY KEY,
  owner_local_identity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  origin TEXT NOT NULL,
  data_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (owner_local_identity_id) REFERENCES local_identity(id)
);

CREATE TABLE IF NOT EXISTS local_message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_local_identity_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actual_provider TEXT,
  actual_model TEXT,
  local_or_remote TEXT,
  fallback_used INTEGER,
  intelligence_class TEXT,
  FOREIGN KEY (conversation_id) REFERENCES local_conversation(id),
  FOREIGN KEY (owner_local_identity_id) REFERENCES local_identity(id)
);

CREATE TABLE IF NOT EXISTS local_audit (
  id TEXT PRIMARY KEY,
  actor_local_identity_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  result TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_login_throttle (
  throttle_key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS local_identity_link (
  local_identity_id TEXT PRIMARY KEY,
  remote_supabase_user_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  link_state TEXT NOT NULL,
  FOREIGN KEY (local_identity_id) REFERENCES local_identity(id)
);

CREATE TABLE IF NOT EXISTS local_installation (
  installation_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_conv_owner ON local_conversation(owner_local_identity_id);
CREATE INDEX IF NOT EXISTS idx_local_msg_conv ON local_message(conversation_id);
CREATE INDEX IF NOT EXISTS idx_local_session_owner ON local_session(owner_local_identity_id);
`

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function nowIso(): string {
  return new Date().toISOString()
}

export type LocalAuthSession = {
  token: string
  session: LocalSessionRecord
  identity: LocalCommanderIdentity
}

export class LocalOwnershipStore {
  readonly paths: LocalAppDataPaths
  private readonly db: DatabaseSync

  constructor(dataDirOverride?: string | null) {
    this.paths = resolveLocalAppDataPaths(dataDirOverride)
    ensureLocalAppDataDirs(this.paths)
    this.db = new DatabaseSync(this.paths.dbPath)
    this.db.exec(SCHEMA)
    tightenFileMode(this.paths.dbPath)
    this.ensureInstallation()
  }

  close(): void {
    this.db.close()
  }

  getInstallationId(): string {
    const row = this.db.prepare('SELECT installation_id FROM local_installation LIMIT 1').get() as
      | { installation_id: string }
      | undefined
    if (!row) throw new Error('Installation missing')
    return row.installation_id
  }

  private ensureInstallation(): void {
    const existing = this.db.prepare('SELECT installation_id FROM local_installation LIMIT 1').get()
    if (existing) return
    const id = newPrefixedId('linst', 12)
    this.db.prepare('INSERT INTO local_installation (installation_id, created_at) VALUES (?, ?)').run(id, nowIso())
  }

  hasLocalCommander(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM local_identity WHERE role = ?').get(LOCAL_IDENTITY_ROLE) as {
      c: number
    }
    return Number(row.c) > 0
  }

  getCommanderPublic(): LocalCommanderIdentity | null {
    const row = this.db
      .prepare(
        `SELECT id, installation_id, role, display_name, remote_link_state, linked_remote_user_id,
                created_at, updated_at, schema_version FROM local_identity WHERE role = ? LIMIT 1`,
      )
      .get(LOCAL_IDENTITY_ROLE) as
      | {
          id: string
          installation_id: string
          role: string
          display_name: string
          remote_link_state: string
          linked_remote_user_id: string | null
          created_at: string
          updated_at: string
          schema_version: number
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      installation_id: row.installation_id,
      role: LOCAL_IDENTITY_ROLE,
      display_name: row.display_name,
      remote_link_state: row.remote_link_state as LocalRemoteAuthState,
      linked_remote_user_id: row.linked_remote_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      schema_version: row.schema_version,
      credential_meta: { kdf: 'scrypt', has_password: true },
    }
  }

  /**
   * Explicit first-run bootstrap — never implicit from localhost/Windows user/Electron.
   */
  bootstrapCommander(input: {
    password: string
    displayName?: string
  }): { ok: true; identity: LocalCommanderIdentity } | { ok: false; reason: string; code: string } {
    if (this.hasLocalCommander()) {
      return { ok: false, reason: 'Local Commander already exists. Login required.', code: 'ALREADY_EXISTS' }
    }
    const password = String(input.password || '')
    if (password.length < 10) {
      return { ok: false, reason: 'Password must be at least 10 characters.', code: 'WEAK_PASSWORD' }
    }
    const cred = hashPasswordScrypt(password)
    const id = newPrefixedId('lcmd', 16)
    const installation_id = this.getInstallationId()
    const ts = nowIso()
    const display_name = (input.displayName?.trim() || 'Local Commander').slice(0, 80)
    this.db
      .prepare(
        `INSERT INTO local_identity
        (id, installation_id, role, display_name, password_hash_b64, password_salt_b64, kdf, kdf_params_json,
         remote_link_state, linked_remote_user_id, created_at, updated_at, schema_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        installation_id,
        LOCAL_IDENTITY_ROLE,
        display_name,
        cred.hash_b64,
        cred.salt_b64,
        cred.kdf,
        JSON.stringify(cred.params),
        'LOCAL_ONLY',
        ts,
        ts,
        LOCAL_OWNERSHIP_SCHEMA_VERSION,
      )
    this.audit(id, 'LOCAL_COMMANDER_BOOTSTRAP', id, 'OK')
    return { ok: true, identity: this.getCommanderPublic()! }
  }

  private throttleKey(identityHint: string): string {
    return `login:${identityHint}`
  }

  private checkThrottle(key: string): { ok: true } | { ok: false; reason: string; code: string } {
    const row = this.db
      .prepare('SELECT failures, window_started_at, locked_until FROM local_login_throttle WHERE throttle_key = ?')
      .get(key) as { failures: number; window_started_at: string; locked_until: string | null } | undefined
    if (!row) return { ok: true }
    const now = Date.now()
    if (row.locked_until && new Date(row.locked_until).getTime() > now) {
      return { ok: false, reason: 'Too many failed attempts. Try again later.', code: 'THROTTLED' }
    }
    const windowStart = new Date(row.window_started_at).getTime()
    if (now - windowStart > LOCAL_LOGIN_WINDOW_MS) {
      this.db.prepare('DELETE FROM local_login_throttle WHERE throttle_key = ?').run(key)
      return { ok: true }
    }
    if (row.failures >= LOCAL_LOGIN_MAX_FAILURES) {
      const lockedUntil = new Date(now + LOCAL_LOGIN_LOCK_MS).toISOString()
      this.db.prepare('UPDATE local_login_throttle SET locked_until = ? WHERE throttle_key = ?').run(lockedUntil, key)
      return { ok: false, reason: 'Too many failed attempts. Try again later.', code: 'THROTTLED' }
    }
    return { ok: true }
  }

  private recordLoginFailure(key: string): void {
    const row = this.db
      .prepare('SELECT failures, window_started_at FROM local_login_throttle WHERE throttle_key = ?')
      .get(key) as { failures: number; window_started_at: string } | undefined
    const now = nowIso()
    if (!row) {
      this.db
        .prepare(
          'INSERT INTO local_login_throttle (throttle_key, failures, window_started_at, locked_until) VALUES (?, 1, ?, NULL)',
        )
        .run(key, now)
      return
    }
    const windowStart = new Date(row.window_started_at).getTime()
    if (Date.now() - windowStart > LOCAL_LOGIN_WINDOW_MS) {
      this.db
        .prepare(
          'UPDATE local_login_throttle SET failures = 1, window_started_at = ?, locked_until = NULL WHERE throttle_key = ?',
        )
        .run(now, key)
      return
    }
    const failures = row.failures + 1
    let locked: string | null = null
    if (failures >= LOCAL_LOGIN_MAX_FAILURES) {
      locked = new Date(Date.now() + LOCAL_LOGIN_LOCK_MS).toISOString()
    }
    this.db
      .prepare('UPDATE local_login_throttle SET failures = ?, locked_until = ? WHERE throttle_key = ?')
      .run(failures, locked, key)
  }

  private clearThrottle(key: string): void {
    this.db.prepare('DELETE FROM local_login_throttle WHERE throttle_key = ?').run(key)
  }

  /**
   * Authenticate and issue a NEW session (session fixation prevention).
   * Does not require Supabase or internet.
   */
  login(password: string): { ok: true; auth: LocalAuthSession } | { ok: false; reason: string; code: string } {
    const key = this.throttleKey('commander')
    const throttle = this.checkThrottle(key)
    if (!throttle.ok) return throttle

    const row = this.db
      .prepare(
        `SELECT id, installation_id, password_hash_b64, password_salt_b64, kdf, kdf_params_json
         FROM local_identity WHERE role = ? LIMIT 1`,
      )
      .get(LOCAL_IDENTITY_ROLE) as
      | {
          id: string
          installation_id: string
          password_hash_b64: string
          password_salt_b64: string
          kdf: string
          kdf_params_json: string
        }
      | undefined

    if (!row) {
      return { ok: false, reason: 'No local Commander. Explicit first-run setup required.', code: 'NOT_BOOTSTRAPPED' }
    }

    const record: ScryptCredentialRecord = {
      kdf: 'scrypt',
      salt_b64: row.password_salt_b64,
      hash_b64: row.password_hash_b64,
      params: JSON.parse(row.kdf_params_json),
    }
    if (!verifyPasswordScrypt(String(password || ''), record)) {
      this.recordLoginFailure(key)
      this.audit(null, 'LOCAL_LOGIN_FAILED', row.id, 'DENIED')
      return { ok: false, reason: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' }
    }

    this.clearThrottle(key)
    const auth = this.issueSession(row.id, row.installation_id)
    this.audit(row.id, 'LOCAL_LOGIN', row.id, 'OK')
    return { ok: true, auth }
  }

  /** Always mints a fresh session id + token — never accepts client-supplied session ids. */
  issueSession(ownerId: string, installationId: string): LocalAuthSession {
    const token = newHighEntropyToken(32)
    const session_id = newPrefixedId('lses', 16)
    const created = nowIso()
    const expires = new Date(Date.now() + LOCAL_SESSION_TTL_MS).toISOString()
    this.db
      .prepare(
        `INSERT INTO local_session
        (session_id, token_hash, owner_local_identity_id, installation_id, created_at, expires_at, revoked_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(session_id, hashToken(token), ownerId, installationId, created, expires, created)
    const identity = this.getCommanderPublic()!
    return {
      token,
      identity,
      session: {
        session_id,
        owner_local_identity_id: ownerId,
        installation_id: installationId,
        created_at: created,
        expires_at: expires,
        revoked_at: null,
        last_seen_at: created,
      },
    }
  }

  verifySessionToken(token: string | null | undefined): LocalAuthSession | null {
    if (!token || typeof token !== 'string' || token.length < 20) return null
    const th = hashToken(token)
    const row = this.db
      .prepare(
        `SELECT session_id, owner_local_identity_id, installation_id, created_at, expires_at, revoked_at, last_seen_at
         FROM local_session WHERE token_hash = ?`,
      )
      .get(th) as
      | {
          session_id: string
          owner_local_identity_id: string
          installation_id: string
          created_at: string
          expires_at: string
          revoked_at: string | null
          last_seen_at: string
        }
      | undefined
    if (!row) return null
    if (row.revoked_at) return null
    if (new Date(row.expires_at).getTime() <= Date.now()) return null
    if (row.installation_id !== this.getInstallationId()) return null
    const seen = nowIso()
    this.db.prepare('UPDATE local_session SET last_seen_at = ? WHERE session_id = ?').run(seen, row.session_id)
    const identity = this.getCommanderPublic()
    if (!identity || identity.id !== row.owner_local_identity_id) return null
    return {
      token,
      identity,
      session: {
        session_id: row.session_id,
        owner_local_identity_id: row.owner_local_identity_id,
        installation_id: row.installation_id,
        created_at: row.created_at,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        last_seen_at: seen,
      },
    }
  }

  logout(token: string | null | undefined): boolean {
    if (!token) return false
    const auth = this.verifySessionToken(token)
    if (!auth) {
      // Still revoke by hash if expired but present
      const th = hashToken(token)
      const r = this.db.prepare('UPDATE local_session SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(nowIso(), th)
      return Number(r.changes) > 0
    }
    this.db
      .prepare('UPDATE local_session SET revoked_at = ? WHERE session_id = ?')
      .run(nowIso(), auth.session.session_id)
    this.audit(auth.identity.id, 'LOCAL_LOGOUT', auth.session.session_id, 'OK')
    return true
  }

  assertOwner(
    sessionOwner: string,
    resourceOwner: string | null | undefined,
  ): { ok: true } | { ok: false; reason: string } {
    if (!resourceOwner) return { ok: false, reason: 'Owner missing — fail closed.' }
    if (sessionOwner !== resourceOwner) return { ok: false, reason: 'Cross-user access denied.' }
    return { ok: true }
  }

  createConversation(ownerId: string, title?: string): LocalConversationRecord {
    const id = newPrefixedId('lcnv', 16)
    const ts = nowIso()
    const record: LocalConversationRecord = {
      id,
      owner_local_identity_id: ownerId,
      title: (title?.trim() || 'Local conversation').slice(0, 200),
      origin: 'LOCAL',
      data_mode: 'LOCAL_ONLY',
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    }
    this.db
      .prepare(
        `INSERT INTO local_conversation
        (id, owner_local_identity_id, title, origin, data_mode, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(record.id, record.owner_local_identity_id, record.title, record.origin, record.data_mode, record.created_at, record.updated_at)
    this.audit(ownerId, 'LOCAL_CONVERSATION_CREATE', id, 'OK')
    return record
  }

  listConversations(ownerId: string): LocalConversationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, owner_local_identity_id, title, origin, data_mode, created_at, updated_at, deleted_at
         FROM local_conversation
         WHERE owner_local_identity_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
      )
      .all(ownerId) as LocalConversationRecord[]
    return rows
  }

  getConversation(ownerId: string, conversationId: string): LocalConversationRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, owner_local_identity_id, title, origin, data_mode, created_at, updated_at, deleted_at
         FROM local_conversation WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(conversationId) as LocalConversationRecord | undefined
    if (!row) return null
    const own = this.assertOwner(ownerId, row.owner_local_identity_id)
    if (!own.ok) return null
    return row
  }

  renameConversation(ownerId: string, conversationId: string, title: string): LocalConversationRecord | null {
    const existing = this.getConversation(ownerId, conversationId)
    if (!existing) return null
    const ts = nowIso()
    const nextTitle = title.trim().slice(0, 200) || existing.title
    this.db
      .prepare('UPDATE local_conversation SET title = ?, updated_at = ? WHERE id = ? AND owner_local_identity_id = ?')
      .run(nextTitle, ts, conversationId, ownerId)
    return this.getConversation(ownerId, conversationId)
  }

  addMessage(
    ownerId: string,
    conversationId: string,
    input: {
      role: 'user' | 'assistant' | 'system'
      content: string
      actual_provider?: string | null
      actual_model?: string | null
      local_or_remote?: 'LOCAL' | 'REMOTE' | null
      fallback_used?: boolean | null
      intelligence_class?: string | null
    },
  ): LocalMessageRecord | null {
    const conv = this.getConversation(ownerId, conversationId)
    if (!conv) return null
    const id = newPrefixedId('lmsg', 16)
    const ts = nowIso()
    const record: LocalMessageRecord = {
      id,
      conversation_id: conversationId,
      owner_local_identity_id: ownerId,
      role: input.role,
      content: String(input.content || ''),
      created_at: ts,
      actual_provider: input.actual_provider ?? null,
      actual_model: input.actual_model ?? null,
      local_or_remote: input.local_or_remote ?? null,
      fallback_used: input.fallback_used ?? null,
      intelligence_class: input.intelligence_class ?? null,
    }
    this.db
      .prepare(
        `INSERT INTO local_message
        (id, conversation_id, owner_local_identity_id, role, content, created_at,
         actual_provider, actual_model, local_or_remote, fallback_used, intelligence_class)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.conversation_id,
        record.owner_local_identity_id,
        record.role,
        record.content,
        record.created_at,
        record.actual_provider,
        record.actual_model,
        record.local_or_remote,
        record.fallback_used === null ? null : record.fallback_used ? 1 : 0,
        record.intelligence_class,
      )
    this.db
      .prepare('UPDATE local_conversation SET updated_at = ? WHERE id = ? AND owner_local_identity_id = ?')
      .run(ts, conversationId, ownerId)
    return record
  }

  listMessages(ownerId: string, conversationId: string): LocalMessageRecord[] | null {
    const conv = this.getConversation(ownerId, conversationId)
    if (!conv) return null
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, owner_local_identity_id, role, content, created_at,
                actual_provider, actual_model, local_or_remote, fallback_used, intelligence_class
         FROM local_message WHERE conversation_id = ? AND owner_local_identity_id = ?
         ORDER BY created_at ASC`,
      )
      .all(conversationId, ownerId) as Array<Omit<LocalMessageRecord, 'fallback_used'> & { fallback_used: number | null }>
    return rows.map(r => ({
      ...r,
      fallback_used: r.fallback_used === null ? null : Boolean(r.fallback_used),
    }))
  }

  /**
   * Link foundation: requires both authenticated local Commander and authenticated remote user id.
   * Never auto-links by email/Windows user/hostname.
   */
  linkRemoteIdentity(input: {
    localOwnerId: string
    remoteSupabaseUserId: string
    remoteSessionAuthenticated: boolean
    localSessionAuthenticated: boolean
  }): { ok: true; state: 'LINKED_REMOTE' } | { ok: false; reason: string; code: string } {
    if (!input.localSessionAuthenticated || !input.remoteSessionAuthenticated) {
      return { ok: false, reason: 'Both local and remote authenticated sessions required.', code: 'BOTH_SESSIONS_REQUIRED' }
    }
    if (!input.remoteSupabaseUserId || input.remoteSupabaseUserId.startsWith('lcmd_')) {
      return { ok: false, reason: 'Remote identity must be a Supabase user id.', code: 'INVALID_REMOTE' }
    }
    if (input.localOwnerId !== this.getCommanderPublic()?.id) {
      return { ok: false, reason: 'Local owner mismatch.', code: 'OWNER_MISMATCH' }
    }
    const ts = nowIso()
    this.db
      .prepare(
        `INSERT INTO local_identity_link (local_identity_id, remote_supabase_user_id, linked_at, link_state)
         VALUES (?, ?, ?, 'LINKED_REMOTE')
         ON CONFLICT(local_identity_id) DO UPDATE SET
           remote_supabase_user_id = excluded.remote_supabase_user_id,
           linked_at = excluded.linked_at,
           link_state = 'LINKED_REMOTE'`,
      )
      .run(input.localOwnerId, input.remoteSupabaseUserId, ts)
    this.db
      .prepare(
        `UPDATE local_identity SET remote_link_state = 'LINKED_REMOTE', linked_remote_user_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.remoteSupabaseUserId, ts, input.localOwnerId)
    this.audit(input.localOwnerId, 'LOCAL_REMOTE_LINK', input.remoteSupabaseUserId, 'OK')
    return { ok: true, state: 'LINKED_REMOTE' }
  }

  attemptAutoLinkByEmail(_email: string): { ok: false; reason: string; code: string } {
    return { ok: false, reason: 'Email match does not auto-link identities.', code: 'AUTO_LINK_DENIED' }
  }

  audit(actor: string | null, action: string, resource: string | null, result: string): void {
    this.db
      .prepare(
        `INSERT INTO local_audit (id, actor_local_identity_id, action, resource, result, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
      )
      .run(newPrefixedId('laud', 12), actor, action, resource, result, nowIso())
  }

  listAudit(limit = 50): LocalAuditRecord[] {
    return this.db
      .prepare(
        `SELECT id, actor_local_identity_id, action, resource, result, source, created_at
         FROM local_audit ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as LocalAuditRecord[]
  }

  exportOwnedData(ownerId: string): {
    ok: true
    export: {
      version: 1
      exported_at: string
      owner_local_identity_id: string
      conversations: LocalConversationRecord[]
      messages: LocalMessageRecord[]
      audit: LocalAuditRecord[]
      excluded: string[]
    }
  } | { ok: false; reason: string } {
    const identity = this.getCommanderPublic()
    if (!identity || identity.id !== ownerId) return { ok: false, reason: 'Owner denied.' }
    const conversations = this.listConversations(ownerId)
    const messages: LocalMessageRecord[] = []
    for (const c of conversations) {
      const m = this.listMessages(ownerId, c.id)
      if (m) messages.push(...m)
    }
    return {
      ok: true,
      export: {
        version: 1,
        exported_at: nowIso(),
        owner_local_identity_id: ownerId,
        conversations,
        messages,
        audit: this.listAudit(100).filter(a => a.actor_local_identity_id === ownerId),
        excluded: [
          'password_hash',
          'password_salt',
          'session_tokens',
          'provider_api_keys',
          'service_role_keys',
          'environment_secrets',
        ],
      },
    }
  }

  changePassword(ownerId: string, currentPassword: string, nextPassword: string): { ok: true } | { ok: false; reason: string; code: string } {
    const row = this.db
      .prepare(
        `SELECT id, password_hash_b64, password_salt_b64, kdf_params_json FROM local_identity WHERE id = ? AND role = ?`,
      )
      .get(ownerId, LOCAL_IDENTITY_ROLE) as
      | { id: string; password_hash_b64: string; password_salt_b64: string; kdf_params_json: string }
      | undefined
    if (!row) return { ok: false, reason: 'Identity not found.', code: 'NOT_FOUND' }
    const record: ScryptCredentialRecord = {
      kdf: 'scrypt',
      salt_b64: row.password_salt_b64,
      hash_b64: row.password_hash_b64,
      params: JSON.parse(row.kdf_params_json),
    }
    if (!verifyPasswordScrypt(String(currentPassword || ''), record)) {
      return { ok: false, reason: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' }
    }
    if (nextPassword.length < 10) return { ok: false, reason: 'Password must be at least 10 characters.', code: 'WEAK_PASSWORD' }
    const cred = hashPasswordScrypt(nextPassword)
    this.db
      .prepare(
        `UPDATE local_identity SET password_hash_b64 = ?, password_salt_b64 = ?, kdf = ?, kdf_params_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(cred.hash_b64, cred.salt_b64, cred.kdf, JSON.stringify(cred.params), nowIso(), ownerId)
    this.db.prepare('UPDATE local_session SET revoked_at = ? WHERE owner_local_identity_id = ? AND revoked_at IS NULL').run(nowIso(), ownerId)
    this.audit(ownerId, 'LOCAL_PASSWORD_CHANGE', ownerId, 'OK')
    return { ok: true }
  }

  getDataMode(supabaseReachable: boolean | null): LocalDataMode {
    if (supabaseReachable === false) return 'OFFLINE_LOCAL'
    const id = this.getCommanderPublic()
    if (id?.remote_link_state === 'LINKED_REMOTE') return 'HYBRID_LINKED'
    return 'LOCAL_ONLY'
  }
}

const storesByDir = new Map<string, LocalOwnershipStore>()

export function getLocalOwnershipStore(dataDirOverride?: string | null): LocalOwnershipStore {
  const key = path.resolve(resolveLocalAppDataPaths(dataDirOverride).root)
  const existing = storesByDir.get(key)
  if (existing) return existing
  const store = new LocalOwnershipStore(dataDirOverride)
  storesByDir.set(key, store)
  return store
}

export function resetLocalOwnershipStoreSingleton(): void {
  for (const store of storesByDir.values()) {
    try {
      store.close()
    } catch {
      /* ignore */
    }
  }
  storesByDir.clear()
}
/** Host-adapter contracts for the isolated blueprint broker. These are the seams War Room will later fill with its real
 * session/auth, resource-lock, workspace-identity and quality-check subsystems. NOTHING here is wired to live War Room.
 *
 *  - actor/session:   host.sessions.resolve(token) -> actor | null     (validateActor enforces a strict, credential-free shape)
 *  - resource lock:   createLeaseAdapter({backing})                    (isolated backing = the tested durable file lease)
 *  - base identity:   createBaseIdentityAdapter({get, stableAcrossAdapterWrites})
 *  - check registry:  createCheckRegistry(defs)                        (immutable; id/version/role/digest/scope/timeout)
 *  - build stage:     validateSource | build | package | verifyArtifact (only validateSource is ever invoked in this slice)
 */
import { BlueprintError, checkBindingOf, hash, refuse } from './base.mjs'

// ------------------------------------------------------------------ authenticated actor
export const ROLES = Object.freeze(['commander', 'operator', 'viewer'])
const ACTOR_KEYS = ['actorId', 'role', 'sessionId', 'authenticatedAt', 'authenticationSource']
/** Strict: any extra key (token, cookie, password, authorization...) is rejected so credentials can never ride along into stores. */
export function validateActor(a, { now = Date.now(), maxAuthAgeMs = 12 * 3600_000, skewMs = 60_000 } = {}) {
  const bad = why => refuse('ACTOR_INVALID', 'auth', `Invalid authenticated actor (${why})`)
  if (!a || typeof a !== 'object' || Array.isArray(a)) bad('shape')
  for (const k of Object.keys(a)) if (!ACTOR_KEYS.includes(k)) bad('unexpected field')
  if (typeof a.actorId !== 'string' || !/^[\w@.+-]{1,120}$/.test(a.actorId)) bad('actorId')
  if (!ROLES.includes(a.role)) bad('role')
  if (typeof a.sessionId !== 'string' || !/^[\w.-]{8,128}$/.test(a.sessionId)) bad('sessionId')
  if (typeof a.authenticationSource !== 'string' || !/^[\w.:-]{1,64}$/.test(a.authenticationSource)) bad('authenticationSource')
  if (!Number.isFinite(a.authenticatedAt) || a.authenticatedAt > now + skewMs || now - a.authenticatedAt > maxAuthAgeMs) bad('authentication age')
  return Object.freeze({ actorId: a.actorId, role: a.role, sessionId: a.sessionId, authenticatedAt: a.authenticatedAt, authenticationSource: a.authenticationSource })
}

// ------------------------------------------------------------------ resource-lock adapter
/** Semantics War Room's resource locks must provide: acquire never steals; only an expired lease is replaced (recorded);
 * heartbeat/verify are sticky-lost per handle; recovery under a still-valid lease needs an explicit HOLDER-DEATH assertion
 * and the same holder identity; release is explicit. Swap `backing` for War Room locks without touching the core. */
export function createLeaseAdapter({ backing, holderId, defaultTtlMs = 60_000 }) {
  if (!backing || typeof backing.acquire !== 'function' || typeof backing.reattach !== 'function' || typeof backing.inspect !== 'function') throw new Error('lease backing must implement acquire/reattach/inspect')
  if (typeof holderId !== 'string' || !holderId) throw new Error('holderId required')
  return {
    holderId,
    /** `holder` (per-execution identity, see reslock.holderIdFor) and `meta` ({missionId}) override the broker-wide default; backings that don't need them ignore `meta`. */
    acquire: ({ workspaceId, ttlMs = defaultTtlMs, holder = holderId, meta }) => backing.acquire({ workspaceId, holder, ttlMs, meta }),
    verify: handle => { try { return handle?.verify() === true } catch { return false } },
    heartbeat: handle => { try { return handle?.heartbeat() === true } catch { return false } },
    release: handle => { try { return handle?.release() === true } catch { return false } },
    info: handle => handle?.info?.() ?? null,
    inspect: workspaceId => backing.inspect(workspaceId),
    /** Lease for recovery of `previous` ({leaseId, holder}) work. */
    acquireForRecovery({ workspaceId, previous = null, holderDead = null, ttlMs = defaultTtlMs, holder = holderId, meta }) {
      const cur = backing.inspect(workspaceId)
      if (cur?.valid) {
        if (previous && cur.leaseId === previous.leaseId && holderDead?.leaseId === cur.leaseId) {
          if (cur.holder !== holder) refuse('LEASE_HELD', 'lease', 'A valid lease is held by a different holder identity; wait for expiry', { observed: { holder: cur.holder } })
          return backing.reattach({ workspaceId, holder, leaseId: cur.leaseId }) // restart of the same broker identity, holder death attested
        }
        refuse('HOLDER_DEATH_REQUIRED', 'lease', 'A valid lease exists (possibly the crashed run\'s own); wait for expiry or assert the holder is dead', { observed: { holder: cur.holder, leaseId: cur.leaseId, expiresAt: cur.expiresAt } })
      }
      return backing.acquire({ workspaceId, holder, ttlMs, meta }) // free or EXPIRED (stale takeover is recorded by the backing store)
    },
    /** The object the core consumes: delegates to whichever handle the broker currently holds; false when none. */
    bindCore() {
      let cur = null
      return { set: h => { cur = h }, clear: () => { cur = null }, verify: () => cur ? this.verify(cur) : false, heartbeat: () => cur ? this.heartbeat(cur) : false, info: () => cur ? this.info(cur) : null }
    },
  }
}

// ------------------------------------------------------------------ base identity adapter
const BASE_KINDS = ['commit', 'snapshot', 'host-token']
/** Host attests the identity is STABLE ACROSS THE ADAPTER'S OWN WRITES and not derived from mutable dirty-tree content
 * (e.g. a commit/snapshot id of the baseline). `get` may return a string or {kind, value, dirty?}. */
export function createBaseIdentityAdapter({ get, stableAcrossAdapterWrites }) {
  if (typeof get !== 'function') throw new Error('get required')
  if (stableAcrossAdapterWrites !== true) throw new Error('Host must attest the base identity is stable across the adapter\'s own writes')
  return {
    resolve(workspaceId) {
      let v; try { v = get(workspaceId) } catch { refuse('BASE_REVISION_MISMATCH', 'preflight', 'Base identity unavailable from host') }
      const rec = typeof v === 'string' ? { kind: 'host-token', value: v } : v
      if (!rec || typeof rec.value !== 'string' || !/^[A-Za-z0-9:._/-]{1,200}$/.test(rec.value)) refuse('BASE_REVISION_MISMATCH', 'preflight', 'Base identity is not a valid opaque identifier')
      if (rec.dirty === true || !BASE_KINDS.includes(rec.kind)) refuse('BASE_REVISION_MISMATCH', 'preflight', 'Base identity must not be derived from mutable dirty-tree content')
      return rec.value
    },
  }
}

// ------------------------------------------------------------------ immutable check registry
export const CHECK_SCOPES = Object.freeze(['workspace-read', 'package-files-read'])
/** Roles a HOST check may have. `build` and `artifact-verification` are stage roles: a PACKAGE can never reference them (core refuses), so imported content cannot create build/verification checks. */
export const CHECK_ROLES = Object.freeze(['dependency-audit', 'syntax', 'typecheck', 'focused-test', 'source-policy', 'behavior', 'build', 'artifact-verification'])
/** defs: [{id, version, role, run, implementationDigest? | source?, scope?, timeoutMs?}]. Digest preference: host-supplied > source text >
 * function text (function text is only a best-effort identity for in-process closures). Entries and the registry are frozen. */
export function createCheckRegistry(defs) {
  const map = new Map()
  for (const d of defs) {
    if (typeof d?.id !== 'string' || !/^[\w.-]{1,100}$/.test(d.id) || typeof d.version !== 'string' || !d.version || typeof d.run !== 'function') throw new Error('Invalid check definition')
    if (map.has(d.id)) throw new Error(`Duplicate check ${d.id}`)
    const scope = d.scope ?? 'workspace-read'; if (!CHECK_SCOPES.includes(scope)) throw new Error(`Invalid scope for ${d.id}`)
    if (!CHECK_ROLES.includes(d.role)) throw new Error(`Invalid or missing role for ${d.id}`)
    const timeoutMs = d.timeoutMs ?? 30_000; if (!(timeoutMs > 0 && timeoutMs <= 600_000)) throw new Error(`Invalid timeout for ${d.id}`)
    const digestKind = d.implementationDigest ? 'host-supplied' : d.source ? 'source' : 'function-text'
    const digest = d.implementationDigest ?? hash(d.source ?? d.run.toString())
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid implementation digest for ${d.id}`)
    map.set(d.id, Object.freeze({ id: d.id, version: d.version, role: d.role, scope, timeoutMs, cancellable: d.cancellable === true, digest, digestKind, run: d.run }))
  }
  const publicView = e => ({ id: e.id, version: e.version, role: e.role, scope: e.scope, timeoutMs: e.timeoutMs, cancellable: e.cancellable, digest: e.digest, digestKind: e.digestKind })
  return Object.freeze({
    has: id => map.has(id), get: id => map.get(id) ?? null, list: () => [...map.values()].map(publicView),
    bindingFor: checks => checkBindingOf(id => map.get(id) ?? null, checks),
    toCoreChecks: () => Object.freeze(Object.fromEntries([...map.values()].map(e => [e.id, Object.freeze({ version: e.version, role: e.role, run: e.run, digest: e.digest, scope: e.scope, timeoutMs: e.timeoutMs, cancellable: e.cancellable })]))),
  })
}

// ------------------------------------------------------------------ build-stage boundary (interface only)
export const BUILD_STAGE_METHODS = Object.freeze(['validateSource', 'build', 'package', 'verifyArtifact'])
export function assertBuildStage(stage) { for (const m of BUILD_STAGE_METHODS) if (typeof stage?.[m] !== 'function') throw new Error(`Build stage must implement ${m}()`) ; return stage }
/** Default: only source validation is attested; the rest report NOT_IMPLEMENTED. The broker invokes ONLY validateSource in this slice. */
export function createSourceOnlyBuildStage() {
  const notImplemented = name => async () => ({ status: 'NOT_IMPLEMENTED', evidence: `${name} stage is not implemented in this slice` })
  return {
    validateSource: async ({ receipt }) => ({ status: receipt?.claims?.sourceValidated === true ? 'PASS' : 'FAIL', evidence: 'core receipt carries registered-check source validation', artifact: receipt?.artifact ?? null }),
    build: notImplemented('build'), package: notImplemented('package'), verifyArtifact: notImplemented('verifyArtifact'),
  }
}
export { BlueprintError }

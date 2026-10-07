/** War Room resource-lock seam (isolated, READ-ONLY toward live). Nothing here imports or calls live War Room.
 *
 * Live reference (read only): lib/native-builder/foundryResourceLocks.ts (acquireResource/heartbeatResourceClaim/releaseResource/listResourceClaims),
 * foundryRepoWriteLocks.ts (REPO_WRITE registry: JSON file + `.guard` dir transaction), foundryRepoWriteScope.ts (physical scope = realpath root + fileIds dev:ino).
 * Live claim = {resource, missionId, callId, pid, acquiredAt, heartbeatAt, exclusive, operation, paths?, repoWriteScope?{workspaceRoot,targets,fileIds}}.
 * Live liveness = `process.kill(pid,0)` (dead pid ⇒ stale; REPO_WRITE is NEVER evicted for a late heartbeat). Live locks are keyed by RESOURCE
 * (+ realpath root overlap), not by workspaceId; holder = missionId + callId (generation token) + pid; no TTL for REPO_WRITE; no host/boot/start-time recorded.
 *
 * This module provides: holder identity, strict claim normalization, holder-liveness classification, a hermetic MODEL of the live REPO_WRITE
 * semantics (so the broker can be exercised against live-shaped behaviour), a lease backing over that model, and a read-only inspection bridge. */
import fs from 'node:fs'
import { BlueprintError, atomicWrite, canonical, hash, refuse } from './base.mjs'

// ------------------------------------------------------------------ holder identity
const ID = /^[\w.:@/-]{1,200}$/
/** Stable + auditable. EXCLUDES pid/session/time (they change across restarts) so a restarted broker for the SAME broker/mission/assignment/workspace
 * has the same holderId, and any other mission/assignment/workspace/broker has a different one. PID alone is never authority. */
export const holderIdFor = ({ brokerId, missionId, assignmentId, workspaceId }) => {
  for (const [k, v] of Object.entries({ brokerId, missionId, assignmentId, workspaceId })) if (typeof v !== 'string' || !ID.test(v)) throw new BlueprintError('BINDING_MISMATCH', 'lease', `Invalid holder field ${k}`)
  return `bp-${hash(canonical({ brokerId, missionId, assignmentId, workspaceId })).slice(0, 32)}`
}
const HOLDER_KEYS = ['holderId', 'processId', 'sessionId', 'missionId', 'assignmentId', 'brokerInstanceId', 'acquiredAt']
/** Audit record only (never authority, never secrets): who held the lease and from which process/session. */
export function describeHolder(f) {
  if (!f || typeof f !== 'object' || Object.keys(f).some(k => !HOLDER_KEYS.includes(k))) throw new BlueprintError('BINDING_MISMATCH', 'lease', 'Invalid holder record')
  return Object.freeze({ holderId: f.holderId, processId: Number.isInteger(f.processId) ? f.processId : null, sessionId: f.sessionId ?? null, missionId: f.missionId, assignmentId: f.assignmentId, brokerInstanceId: f.brokerInstanceId ?? null, acquiredAt: f.acquiredAt })
}
/** The lease must not be reusable for another workspace / mission / assignment / base identity / holder. */
export const leaseBindingOf = ({ workspaceId, baseIdentity, missionId, assignmentId, holder }) => hash(canonical({ workspaceId, baseIdentity, missionId, assignmentId, holder }))
export const OPERATION_PREFIX = 'blueprint-adapter:'
export const operationFor = holder => `${OPERATION_PREFIX}${holder}` // the only free-text field of a live claim; carries the holder id (documented mismatch)

// ------------------------------------------------------------------ claim normalization + holder liveness
const CLAIM_KEYS = ['resource', 'missionId', 'callId', 'pid', 'acquiredAt', 'heartbeatAt', 'exclusive', 'paths', 'operation', 'repoWriteScope']
const SCOPE_KEYS = ['version', 'workspaceRoot', 'targets', 'fileIds']
/** Strict: unknown keys / non-REPO_WRITE / unscoped (legacy) claims are NOT normalizable (=> UNKNOWN downstream, never "free"). Returns null when unusable. */
export function normalizeLockClaim(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !CLAIM_KEYS.includes(k))) return null
    const s = raw.repoWriteScope
    if (raw.resource !== 'REPO_WRITE' || !s || typeof s !== 'object' || Object.keys(s).some(k => !SCOPE_KEYS.includes(k)) || s.version !== 1) return null
    if (typeof raw.missionId !== 'string' || !raw.missionId || typeof raw.callId !== 'string' || !raw.callId || !Number.isInteger(raw.pid) || raw.pid <= 0) return null
    if (typeof s.workspaceRoot !== 'string' || !s.workspaceRoot.startsWith('/') || !Array.isArray(s.fileIds) || !s.fileIds.every(i => typeof i === 'string' && /^\d+:\d+$/.test(i)) || !Array.isArray(s.targets)) return null
    const acquiredAt = Date.parse(raw.acquiredAt), heartbeatAt = Date.parse(raw.heartbeatAt ?? raw.acquiredAt); if (!Number.isFinite(acquiredAt) || !Number.isFinite(heartbeatAt)) return null
    const op = typeof raw.operation === 'string' && raw.operation.startsWith(OPERATION_PREFIX) ? raw.operation.slice(OPERATION_PREFIX.length) : null
    return Object.freeze({ resource: 'REPO_WRITE', leaseId: raw.callId, missionId: raw.missionId, pid: raw.pid, acquiredAt, heartbeatAt, workspaceRoot: s.workspaceRoot, fileIds: Object.freeze([...s.fileIds]), targetCount: s.targets.length, holder: op && ID.test(op) ? op : null, foreign: op === null, expiresAt: null })
  } catch { return null }
}
export const HOLDER_STATES = Object.freeze(['PROVEN_DEAD', 'PROVEN_ALIVE', 'LEASE_EXPIRED', 'UNKNOWN'])
/** What War Room can actually prove. Rules (never infer death from a late heartbeat or an invisible process):
 *  - unusable/unreadable claim, or no probe                      -> UNKNOWN
 *  - pid alive (kill(pid,0) ok or EPERM)                         -> PROVEN_ALIVE   (live never evicts a live REPO_WRITE holder, however old its heartbeat)
 *  - pid dead AND probe is on the SAME HOST as the lock files    -> PROVEN_DEAD    (live isStale() treats a dead pid as authoritative)
 *  - pid dead but probe host not attested / pid unknown (null)   -> UNKNOWN        (cross-host/container/pid-namespace: absence proves nothing)
 *  - claim carries a TTL expiry (isolated durable file lease)    -> LEASE_EXPIRED once now >= expiresAt (REPO_WRITE has none)
 * Only PROVEN_DEAD / LEASE_EXPIRED can ever permit takeover; UNKNOWN and PROVEN_ALIVE never. */
export function classifyHolder(lease, { pidAlive = null, localHost = false, now = Date.now() } = {}) {
  if (!lease) return 'UNKNOWN'
  if (Number.isFinite(lease.expiresAt)) return now >= lease.expiresAt ? 'LEASE_EXPIRED' : 'PROVEN_ALIVE' // TTL leases: validity is the holder's proof
  if (pidAlive === true) return 'PROVEN_ALIVE'
  if (pidAlive === false && localHost === true) return 'PROVEN_DEAD'
  return 'UNKNOWN'
}

// ------------------------------------------------------------------ hermetic MODEL of live REPO_WRITE semantics
const inside = (a, b) => a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`)
const overlaps = (a, b) => a.fileIds.some(i => b.fileIds.includes(i)) || inside(a.workspaceRoot, b.workspaceRoot) || inside(b.workspaceRoot, a.workspaceRoot)
/** Mirrors foundryRepoWriteLocks.acquireRepoWrite: stale (dead-pid) scoped claims are dropped on acquire; overlap by root nesting or shared fileId => BUSY;
 * same mission + same pid + same root ADOPTS the existing claim (live behaviour!). `adopt:false` is the extra guard the real lease adapter must add (docs: option C).
 * heartbeat/release select by missionId+callId and are SILENT NO-OPS when the claim is gone (live returns void / empty list). pid liveness is a pure probe. */
export function createLiveLockModel({ now = Date.now, localHost = true, persistFile = null } = {}) {
  const st = { claims: [], pids: new Map(), log: [], gen: new Map() }
  // With `persistFile` the registry is a JSON file shared across processes (like live) and pid liveness is the REAL kill(pid,0) probe (ESRCH => dead, EPERM => alive).
  const realAlive = pid => { try { process.kill(pid, 0); return true } catch (x) { return x?.code === 'EPERM' } }
  const alive = pid => (st.pids.has(pid) ? st.pids.get(pid) : persistFile ? realAlive(pid) : true) // true | false | null(unknown)
  const load = () => { if (persistFile) { try { const j = JSON.parse(fs.readFileSync(persistFile, 'utf8')); st.claims = j.claims; st.gen = new Map(Object.entries(j.gen ?? {})) } catch { st.claims = [] } } }
  const save = () => { if (persistFile) atomicWrite(persistFile, JSON.stringify({ claims: st.claims, gen: Object.fromEntries(st.gen) }), 0o600) }
  const stale = c => alive(c.pid) === false
  const iso = () => new Date(now()).toISOString()
  let n = 0
  return {
    state: st, localHost,
    setPid: (pid, v) => st.pids.set(pid, v), pidAlive: alive,
    list: () => { load(); return st.claims.map(c => structuredClone(c)) },
    acquire({ missionId, operation, workspaceRoot, fileIds = [], targets = [], pid, adopt = true }) {
      load()
      const scope = { version: 1, workspaceRoot, targets, fileIds }
      const dropped = st.claims.filter(c => stale(c)); st.claims = st.claims.filter(c => !stale(c))
      for (const d of dropped) st.log.push({ event: 'STALE_RECLAIMED', callId: d.callId, pid: d.pid })
      if (st.claims.some(c => c.missionId === missionId && c.repoWriteScope.workspaceRoot !== workspaceRoot)) { save(); return { state: 'DEADLOCK_REFUSED', error: 'REPO_WRITE_SCOPE_CHANGED' } }
      const holder = st.claims.find(c => overlaps(scope, c.repoWriteScope) && (c.missionId !== missionId || c.pid !== pid || c.repoWriteScope.workspaceRoot !== workspaceRoot || !adopt))
      if (holder) { save(); return { state: 'BUSY', holder: structuredClone(holder) } }
      let own = st.claims.find(c => c.missionId === missionId && c.repoWriteScope.workspaceRoot === workspaceRoot)
      if (!own) { own = { resource: 'REPO_WRITE', missionId, callId: `call-${pid}-${++n}-${Math.abs(now()) % 100000}`, pid, acquiredAt: iso(), heartbeatAt: iso(), exclusive: true, operation, paths: [], repoWriteScope: scope }; st.claims.push(own); st.log.push({ event: 'ACQUIRED', callId: own.callId, pid }) }
      else own.heartbeatAt = iso()
      save()
      return { state: 'ACQUIRED', claim: structuredClone(own), dropped: dropped.map(d => ({ callId: d.callId, pid: d.pid, missionId: d.missionId })) }
    },
    heartbeat(missionId, callId) { load(); for (const c of st.claims) if (c.missionId === missionId && c.callId === callId) c.heartbeatAt = iso(); save() }, // void; no loss signal
    release(missionId, callId) { load(); const k = st.claims.length; st.claims = st.claims.filter(c => !(c.missionId === missionId && c.callId === callId)); save(); return st.claims.length < k },
    /** Generation counter per physical root. Live has none (callId is the only token); this models the broker-owned durable journal that must supply epochs. */
    nextEpoch(root) { load(); const n = (Number(st.gen.get(root)) || 0) + 1; st.gen.set(root, n); save(); return n },
    forceDrop(callId) { load(); st.claims = st.claims.filter(c => c.callId !== callId); save() }, // test lever: simulates another actor's reclaim
  }
}

// ------------------------------------------------------------------ lease backing over the live-shaped model (isolated; NOT a live acquire)
/** `rootOf(workspaceId) -> {root (realpath), fileIds?}` is the host's workspace binding. Locks are keyed by physical root, so two workspaceIds that
 * alias one root contend (cross-workspace aliasing is refused). Epoch is synthesised from a broker-owned journal (live has none); callId is the generation token. */
export function createLiveShapedBacking({ model, rootOf, pid = process.pid }) {
  const scopeOf = ws => { const r = rootOf(ws); if (!r?.root) refuse('WORKSPACE_MISMATCH', 'lease', 'Workspace has no physical root'); return r }
  const mine = (claim, callId, holder) => !!claim && claim.callId === callId && claim.pid === pid && claim.operation === operationFor(holder)
  const find = (r, callId) => model.list().find(c => c.callId === callId)
  function handleFor(ws, claim, holder, epoch) {
    let lost = false
    const ok = () => { if (lost) return false; const c = model.list().find(x => x.callId === claim.callId); if (!mine(c, claim.callId, holder) || model.pidAlive(pid) === false) { lost = true; return false } return true }
    return {
      leaseId: claim.callId, epoch, holder, workspaceId: ws, acquiredAt: Date.parse(claim.acquiredAt), takeoverOf: null,
      verify: ok, heartbeat() { if (!ok()) return false; model.heartbeat(claim.missionId, claim.callId); return ok() }, // live heartbeat is void: re-read to detect loss
      release() { if (!ok()) return false; const r = model.release(claim.missionId, claim.callId); lost = true; return r },
      info: () => ({ leaseId: claim.callId, epoch, holder, workspaceId: ws, acquiredAt: Date.parse(claim.acquiredAt), expiresAt: null }),
    }
  }
  return {
    acquire({ workspaceId, holder, meta }) {
      if (typeof meta?.missionId !== 'string' || !meta.missionId) refuse('LEASE_HELD', 'lease', 'missionId is required to acquire a live-shaped lock')
      const r = scopeOf(workspaceId), cur = this.inspect(workspaceId)
      // The model (like live) reclaims ANY dead-pid claim; the adapter is stricter: only a holder PROVEN dead on the attested local host may be replaced. UNKNOWN/ALIVE/foreign-host => held.
      if (cur && cur.classification !== 'PROVEN_DEAD') refuse('LEASE_HELD', 'lease', 'An existing repository write lock is not provably dead', { observed: { missionId: cur.missionId, classification: cur.classification } })
      const res = model.acquire({ missionId: meta.missionId, operation: operationFor(holder), workspaceRoot: r.root, fileIds: r.fileIds ?? [], pid, adopt: false })
      if (res.state !== 'ACQUIRED') refuse('LEASE_HELD', 'lease', res.state === 'BUSY' ? 'Another owner holds an overlapping repository write lock' : 'Lock scope refused', { observed: { missionId: res.holder?.missionId ?? null } })
      const epoch = model.nextEpoch(r.root)
      return handleFor(workspaceId, res.claim, holder, epoch)
    },
    /** Reattach exists only inside the SAME process (same pid): a new process can never adopt a live claim it did not create (live acquire would be BUSY). */
    reattach({ workspaceId, holder, leaseId }) {
      const c = find(scopeOf(workspaceId).root, leaseId)
      if (!mine(c, leaseId, holder)) refuse('LEASE_LOST', 'lease', 'No matching lease to reattach from this process')
      return handleFor(workspaceId, c, holder, Number(model.state.gen.get(scopeOf(workspaceId).root)) || 1)
    },
    inspect(workspaceId) {
      const r = scopeOf(workspaceId), scope = { workspaceRoot: r.root, fileIds: r.fileIds ?? [] }
      const c = model.list().find(x => x.repoWriteScope && overlaps(scope, x.repoWriteScope)); if (!c) return null
      const lease = normalizeLockClaim(c), cls = classifyHolder(lease, { pidAlive: model.pidAlive(c.pid), localHost: model.localHost, now: Date.now() })
      const valid = cls !== 'PROVEN_DEAD' // dead pid is stale (reclaimable); alive/unknown stays a valid hold (UNKNOWN never permits takeover)
      return { leaseId: c.callId, holder: lease?.holder ?? `foreign:${c.missionId}`, epoch: Number(model.state.gen.get(r.root)) || 0, expiresAt: null, valid, classification: cls, missionId: c.missionId, pid: c.pid, workspaceId }
    },
  }
}

// ------------------------------------------------------------------ read-only inspection bridge
/** Reads lock facts only. `listClaims` is host supplied (live: `listResourceClaims()`); `probe(pid)` -> {alive: true|false|null, localHost}. No acquire/steal/release/write. */
export function createReadOnlyLockBridge({ listClaims, probe, now = Date.now }) {
  if (typeof listClaims !== 'function' || typeof probe !== 'function') throw new Error('listClaims and probe are required')
  return Object.freeze({
    async inspectRoot(workspaceRoot) {
      let raw; try { raw = await listClaims() } catch { return { state: 'UNKNOWN', reason: 'LOCK_SOURCE_UNAVAILABLE', holders: [] } }
      if (!Array.isArray(raw)) return { state: 'UNKNOWN', reason: 'LOCK_SOURCE_UNAVAILABLE', holders: [] }
      const repo = raw.filter(c => c?.resource === 'REPO_WRITE'), holders = []
      for (const c of repo) {
        const lease = normalizeLockClaim(c)
        if (!lease) { holders.push({ leaseId: null, classification: 'UNKNOWN', reason: 'UNNORMALIZABLE_CLAIM' }); continue } // legacy/unscoped/malformed claims keep machine-wide exclusion
        if (!inside(workspaceRoot, lease.workspaceRoot) && !inside(lease.workspaceRoot, workspaceRoot)) continue
        let p = { alive: null, localHost: false }; try { p = probe(lease.pid) ?? p } catch { /* UNKNOWN */ }
        holders.push({ leaseId: lease.leaseId, missionId: lease.missionId, holder: lease.holder, foreign: lease.foreign, pid: lease.pid, heartbeatAgeMs: Math.max(0, now() - lease.heartbeatAt), classification: classifyHolder(lease, { pidAlive: p.alive, localHost: p.localHost === true, now: now() }) })
      }
      return { state: holders.length ? 'HELD' : 'FREE', holders, takeoverPermitted: holders.length > 0 && holders.every(h => h.classification === 'PROVEN_DEAD' || h.classification === 'LEASE_EXPIRED') }
    },
  })
}

/** SYNCHRONOUS model of War Room's REPO_WRITE resource-lock registry, speaking the SAME file protocol as
 * lib/native-builder/foundryRepoWriteLocks.ts (same registry file, same `<file>.guard` directory transaction, same claim/scope schema) so live Foundry
 * missions and blueprint executions genuinely exclude each other. It is used as the `model` of reslock.mjs `createLiveShapedBacking`, which keeps the
 * isolated lease contract intact (no adoption of own claims, honest verify/heartbeat/loss, per-execution holder, epochs, UNKNOWN never permits takeover).
 *
 * Differences from live behavior that are deliberate (stricter):
 *  - acquire NEVER adopts an existing own claim (live acquireRepoWrite adopts same mission + same pid);
 *  - claims carry missionId `blueprint:<missionId>` so a Foundry mission runtime can neither adopt nor release a blueprint lease;
 *  - epochs come from a blueprint-owned sidecar journal (live has none);
 *  - a held/orphaned guard directory fails closed (live: REPO_WRITE_REGISTRY_BUSY, never auto-removed).
 * The registry guard is a short critical section (<< 1 s); we spin up to `guardWaitMs`. */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BlueprintError, atomicWrite } from './base.mjs'

const inside = (a, b) => a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`)
const sleepSync = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { const t = Date.now(); while (Date.now() - t < ms) { /* spin */ } } }
const validScope = s => !!s && typeof s === 'object' && s.version === 1 && typeof s.workspaceRoot === 'string' && path.isAbsolute(s.workspaceRoot) && path.normalize(s.workspaceRoot) === s.workspaceRoot
  && !s.workspaceRoot.split(/[\\/]+/).includes('..') && Array.isArray(s.fileIds) && s.fileIds.every(i => typeof i === 'string' && /^\d+:\d+$/.test(i)) && Array.isArray(s.targets) && s.targets.every(t => typeof t === 'string' && path.normalize(t) === t && inside(t, s.workspaceRoot))
const validClaim = c => !!c && typeof c === 'object' && c.resource === 'REPO_WRITE' && typeof c.missionId === 'string' && !!c.missionId && typeof c.callId === 'string' && !!c.callId && Number.isInteger(c.pid) && c.pid > 0
  && typeof c.acquiredAt === 'string' && Number.isFinite(Date.parse(c.acquiredAt)) && (c.repoWriteScope === undefined || validScope(c.repoWriteScope))
/** Mirrors live repoWriteScopesOverlap: shared fileId, root nesting either way, physical (realpath) nesting; malformed/unscoped claims keep machine-wide exclusion. */
function overlaps(a, b) {
  if (!validScope(a) || !validScope(b)) return true
  if (a.fileIds.some(i => b.fileIds.includes(i))) return true
  if (inside(a.workspaceRoot, b.workspaceRoot) || inside(b.workspaceRoot, a.workspaceRoot)) return true
  try { const ar = fs.realpathSync(a.workspaceRoot), br = fs.realpathSync(b.workspaceRoot); return inside(ar, br) || inside(br, ar) } catch { return true }
}
const realAlive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } } // ESRCH => dead, EPERM => alive (as live isProcessAlive)

export function createRegistryLockModel({ file, epochFile, now = Date.now, localHost = true, guardWaitMs = 5000 }) {
  if (!path.isAbsolute(file) || !path.isAbsolute(epochFile)) throw new Error('absolute registry and epoch paths required')
  const guard = `${file}.guard`, fail = (msg, code = 'LEASE_HELD') => { throw new BlueprintError(code, 'lease', msg) }
  function readRegistry() {
    let raw; try { raw = fs.readFileSync(file, 'utf8') } catch (e) { if (e?.code === 'ENOENT') return { version: 1, claims: [] }; throw e }
    let parsed; try { parsed = JSON.parse(raw) } catch { fail('REPO_WRITE registry unreadable; exclusion retained') }
    if (validClaim(parsed)) return { version: 1, claims: [parsed] } // legacy single claim is never silently discarded
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.claims) || !parsed.claims.every(validClaim)) fail('REPO_WRITE registry malformed; exclusion retained')
    return parsed
  }
  function transaction(action, write = false) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const deadline = Date.now() + guardWaitMs
    for (;;) { try { fs.mkdirSync(guard); break } catch (e) { if (e?.code !== 'EEXIST') throw e; if (Date.now() >= deadline) fail('REPO_WRITE registry guard is held or orphaned; no automatic removal (fail closed)'); sleepSync(10) } }
    try {
      const reg = readRegistry(), result = action(reg)
      if (write) { const staged = `${file}.new-${process.pid}-${randomUUID()}`; try { fs.writeFileSync(staged, JSON.stringify(reg, null, 2), 'utf8'); fs.renameSync(staged, file) } finally { fs.rmSync(staged, { force: true }) } }
      return result
    } finally { fs.rmSync(guard, { recursive: true, force: true }) }
  }
  const iso = () => new Date(now()).toISOString()
  const loadGen = () => { try { return new Map(Object.entries(JSON.parse(fs.readFileSync(epochFile, 'utf8')))) } catch { return new Map() } }
  const stale = c => !realAlive(c.pid) // live isStale(REPO_WRITE): a dead pid ends a hold; a late heartbeat NEVER does
  return {
    localHost,
    get state() { return { gen: loadGen() } },
    pidAlive: pid => realAlive(pid),
    list: () => transaction(reg => reg.claims.map(c => structuredClone(c))),
    acquire({ missionId: rawMission, operation, workspaceRoot, fileIds = [], targets = [], pid }) {
      const missionId = String(rawMission).startsWith('blueprint:') ? String(rawMission) : `blueprint:${rawMission}` // a Foundry mission runtime can neither adopt nor release this lease
      const scope = { version: 1, workspaceRoot, targets, fileIds }; if (!validScope(scope)) fail('Invalid lock scope', 'WORKSPACE_MISMATCH')
      return transaction(reg => {
        const dropped = reg.claims.filter(c => c.repoWriteScope && stale(c)); reg.claims = reg.claims.filter(c => !(c.repoWriteScope && stale(c))) // only SCOPED dead claims are reclaimed (unscoped legacy stay conservative)
        const holder = reg.claims.find(c => overlaps(scope, c.repoWriteScope)); if (holder) return { state: 'BUSY', holder: structuredClone(holder) } // no adoption, ever
        const claim = { resource: 'REPO_WRITE', missionId, callId: `blueprint-${randomUUID()}`, pid, acquiredAt: iso(), heartbeatAt: iso(), exclusive: true, operation, paths: [], repoWriteScope: scope }
        reg.claims.push(claim); return { state: 'ACQUIRED', claim: structuredClone(claim), dropped: dropped.map(d => ({ callId: d.callId, pid: d.pid, missionId: d.missionId })) }
      }, true)
    },
    heartbeat(missionId, callId) { transaction(reg => { for (const c of reg.claims) if (c.missionId === missionId && c.callId === callId) c.heartbeatAt = iso() }, true) }, // void: live gives no loss signal
    release(missionId, callId) { return transaction(reg => { const k = reg.claims.length; reg.claims = reg.claims.filter(c => !(c.missionId === missionId && c.callId === callId)); return reg.claims.length < k }, true) },
    nextEpoch(root) { const g = loadGen(), n = (Number(g.get(root)) || 0) + 1; g.set(root, n); atomicWrite(epochFile, JSON.stringify(Object.fromEntries(g)), 0o600); return n },
  }
}

/** Durable control plane for the isolated blueprint adapter: approvals, workspace leases, cancel requests, effect ledger.
 *
 * Format: plain JSON files / JSONL under a host-chosen `root` (must be outside the target workspace; the core enforces it).
 *   reviews/<reviewId>.json            signed review record (embeds raw package; digest is recomputed on use)
 *   reviews/<reviewId>.used            exclusive marker: review executed once
 *   approvals/<sha256(handle)>.json    signed approval record (the handle itself is never stored)
 *   approvals/<sha256(handle)>.consumed exclusive marker: one-use
 *   leases/<sha256(workspaceId)[0:32]>.json   current lease; leases/*.history.jsonl takeover history
 *   cancels/<kind>-<id>.json           signed cancel request (kind = run | review)
 *   effects/<runId>.jsonl              hash-chained append-only effect ledger
 *   .key                               random 32-byte HMAC key (0600)
 *
 * TRUST: signatures are TAMPER-EVIDENCE against corruption/naive forgery by a process that cannot read `.key`; they are not
 * authentication. A same-user process that can read the store can forge anything. Lease files give logical exclusivity
 * among cooperating holders, NOT OS-level exclusion. Caller authentication, base identity and the check registry remain
 * host responsibilities.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import * as fs from 'node:fs'
import { BlueprintError, UUID, atomicWrite, canonical, createExclusive, hash, path, readJson } from './base.mjs'

const fail = (code, stage, message, detail) => { throw new BlueprintError(code, stage, message, detail) }
const dirs = (root, names) => { for (const n of names) fs.mkdirSync(path.join(root, n), { recursive: true, mode: 0o700 }) }
const wsKey = id => hash(String(id)).slice(0, 32)
const HEX64 = /^[a-f0-9]{64}$/

function createSigner(root) {
  const keyFile = path.join(root, '.key')
  if (!fs.existsSync(keyFile)) createExclusive(keyFile, randomBytes(32).toString('hex'), 0o600)
  const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex')
  if (key.length !== 32) fail('CONTROL_STORE_CORRUPT', 'control', 'Invalid control key')
  const mac = body => createHmac('sha256', key).update(canonical(body)).digest()
  return {
    seal: body => ({ ...body, mac: mac(body).toString('hex') }),
    tag: text => createHmac('sha256', key).update(String(text)).digest('hex'),
    open(rec, code = 'CONTROL_STORE_CORRUPT') {
      if (!rec || typeof rec !== 'object' || typeof rec.mac !== 'string' || !HEX64.test(rec.mac)) fail(code, 'control', 'Record is unsigned or malformed')
      const { mac: given, ...body } = rec, want = mac(body), got = Buffer.from(given, 'hex')
      if (got.length !== want.length || !timingSafeEqual(got, want)) fail(code, 'control', 'Record failed integrity verification')
      return body
    },
  }
}

// ---------------------------------------------------------------- approvals + reviews
function createApprovalStore({ root, signer, now }) {
  const rev = id => { if (!UUID.test(id)) fail('APPROVAL_MISMATCH', 'approval', 'Invalid review id'); return path.join(root, 'reviews', `${id}.json`) }
  const apr = h => path.join(root, 'approvals', `${h}.json`)
  return {
    putReview({ reviewId, raw, digest, workspaceId }) {
      const rec = signer.seal({ reviewId, raw, digest, workspaceId, createdAt: now() })
      if (!createExclusive(rev(reviewId), JSON.stringify(rec))) fail('CONTROL_STORE_CORRUPT', 'control', 'Review id collision')
    },
    getReview(reviewId) {
      const rec = readJson(rev(reviewId)); if (!rec) return null
      return { ...signer.open(rec), used: fs.existsSync(rev(reviewId).replace(/\.json$/, '.used')) }
    },
    markReviewUsed(reviewId, runId) { return createExclusive(rev(reviewId).replace(/\.json$/, '.used'), JSON.stringify({ runId, at: now() })) },
    /** kind 'execute' binds {reviewId,digest}; kind 'resume' binds {runId,digest}. The returned handle is the only copy. */
    issue({ kind, reviewId = null, runId = null, digest, workspaceId, actor, baseRevision, ttlMs, checkBinding = null }) {
      const handle = randomBytes(32).toString('hex'), t = now()
      const rec = signer.seal({ kind, reviewId, runId, digest, workspaceId, actor, baseRevision, checkBinding, issuedAt: t, expiresAt: t + ttlMs })
      createExclusive(apr(hash(handle)), JSON.stringify(rec))
      return handle
    },
    /** null if unknown; throws APPROVAL_FORGED if the stored record was altered. */
    load(handle) {
      if (typeof handle !== 'string' || !HEX64.test(handle)) return null
      const h = hash(handle), rec = readJson(apr(h)); if (!rec) return null
      const consumed = readJson(apr(h).replace(/\.json$/, '.consumed'))
      return { handleHash: h, record: signer.open(rec, 'APPROVAL_FORGED'), consumed }
    },
    consume(handleHash, runId) { return createExclusive(apr(handleHash).replace(/\.json$/, '.consumed'), JSON.stringify({ runId, at: now() })) },
  }
}

// ---------------------------------------------------------------- workspace lease
function createLeaseStore({ root, signer, now, defaultTtlMs }) {
  const file = ws => path.join(root, 'leases', `${wsKey(ws)}.json`)
  const history = ws => path.join(root, 'leases', `${wsKey(ws)}.history.jsonl`)
  const note = (ws, entry) => { const fd = fs.openSync(history(ws), 'a', 0o600); try { fs.writeSync(fd, JSON.stringify({ at: now(), ...entry }) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
  const current = ws => { const rec = readJson(file(ws)); return rec ? signer.open(rec) : null }
  // Heartbeats go to a per-lease sidecar so a stale holder can never overwrite (resurrect over) a takeover's lease record.
  const hbFile = (ws, leaseId) => path.join(root, 'leases', `${wsKey(ws)}.${leaseId}.hb`)
  const effectiveExpiry = rec => {
    try { const hb = readJson(hbFile(rec.workspaceId, rec.leaseId)); if (hb) { const b = signer.open(hb); if (b.leaseId === rec.leaseId && b.epoch === rec.epoch) return Math.max(rec.expiresAt, b.expiresAt) } } catch { /* unreadable/forged sidecar: ignore (shorter expiry = conservative) */ }
    return rec.expiresAt
  }
  const live = rec => !!rec && now() < effectiveExpiry(rec)
  function handleFor(rec) {
    let lost = false
    const same = cur => !!cur && cur.leaseId === rec.leaseId && cur.epoch === rec.epoch && cur.holder === rec.holder
    const check = () => { // sticky: once lost, never valid again for this handle
      if (lost) return null
      let cur; try { cur = current(rec.workspaceId) } catch { lost = true; return null }
      if (!same(cur) || !live(cur)) { lost = true; return null }
      return cur
    }
    return {
      leaseId: rec.leaseId, epoch: rec.epoch, holder: rec.holder, workspaceId: rec.workspaceId, acquiredAt: rec.acquiredAt, takeoverOf: rec.takeoverOf ?? null,
      verify: () => check() !== null,
      heartbeat(ttlMs) {
        const cur = check(); if (!cur) return false
        ttlMs ??= cur.ttlMs ?? defaultTtlMs
        atomicWrite(hbFile(rec.workspaceId, rec.leaseId), JSON.stringify(signer.seal({ leaseId: cur.leaseId, epoch: cur.epoch, heartbeatAt: now(), expiresAt: now() + ttlMs })), 0o600)
        return true
      },
      release() {
        const cur = check(); if (!cur) return false
        const tomb = file(rec.workspaceId) + `.released.${cur.epoch}`
        try { fs.renameSync(file(rec.workspaceId), tomb); fs.unlinkSync(tomb) } catch { return false }
        try { fs.unlinkSync(hbFile(rec.workspaceId, rec.leaseId)) } catch { /* none */ }
        note(rec.workspaceId, { event: 'RELEASED', leaseId: rec.leaseId, epoch: rec.epoch, holder: rec.holder }); lost = true; return true
      },
      info: () => ({ leaseId: rec.leaseId, epoch: rec.epoch, holder: rec.holder, workspaceId: rec.workspaceId, acquiredAt: rec.acquiredAt, expiresAt: (c => c ? effectiveExpiry(c) : null)(current(rec.workspaceId)) }),
    }
  }
  return {
    /** Never steals: refuses while a valid lease exists (even for the same holder name). An EXPIRED lease is replaced
     * (stale takeover) and the previous record is retained in history + `takeoverOf` for the operator. */
    acquire({ workspaceId, holder, ttlMs = defaultTtlMs }) {
      if (typeof holder !== 'string' || !holder.trim() || holder.length > 200) fail('LEASE_HELD', 'lease', 'Invalid holder')
      if (typeof workspaceId !== 'string' || !workspaceId) fail('LEASE_HELD', 'lease', 'Invalid workspace')
      let cur = current(workspaceId), takeoverOf = null
      if (cur) {
        if (live(cur)) fail('LEASE_HELD', 'lease', 'Workspace lease is held', { observed: { holder: cur.holder, expiresAt: effectiveExpiry(cur) }, expected: null })
        const tomb = file(workspaceId) + `.stale.${cur.epoch}.${randomBytes(4).toString('hex')}`
        try { fs.renameSync(file(workspaceId), tomb) } catch { fail('LEASE_HELD', 'lease', 'Lease changed during takeover') } // lost the race
        takeoverOf = { leaseId: cur.leaseId, holder: cur.holder, epoch: cur.epoch, expiredAt: effectiveExpiry(cur) }
        note(workspaceId, { event: 'STALE_TAKEOVER', ...takeoverOf, newHolder: holder }); fs.unlinkSync(tomb)
        try { fs.unlinkSync(hbFile(workspaceId, cur.leaseId)) } catch { /* none */ }
      }
      const t = now(), rec = signer.seal({ leaseId: randomBytes(16).toString('hex'), workspaceId, holder, epoch: (cur?.epoch ?? 0) + 1, acquiredAt: t, heartbeatAt: t, ttlMs, expiresAt: t + ttlMs, takeoverOf })
      if (!createExclusive(file(workspaceId), JSON.stringify(rec))) fail('LEASE_HELD', 'lease', 'Workspace lease is held')
      note(workspaceId, { event: 'ACQUIRED', leaseId: rec.leaseId, epoch: rec.epoch, holder })
      return handleFor(rec)
    },
    /** Restart recovery: a returning holder proves it knows the leaseId; only succeeds while the lease is still valid. */
    reattach({ workspaceId, holder, leaseId }) {
      const cur = current(workspaceId)
      if (!cur || cur.holder !== holder || cur.leaseId !== leaseId) fail('LEASE_LOST', 'lease', 'No matching lease to reattach')
      if (!live(cur)) fail('LEASE_LOST', 'lease', 'Lease expired; acquire a new one (stale lease handling applies)')
      return handleFor(cur)
    },
    inspect: workspaceId => { const c = current(workspaceId); return c ? { ...c, expiresAt: effectiveExpiry(c), valid: live(c) } : null },
  }
}

// ---------------------------------------------------------------- cancel requests
function createCancelStore({ root, signer, now }) {
  const f = (kind, id) => { if (!['run', 'review'].includes(kind) || !UUID.test(id)) fail('INVALID_PACKAGE', 'cancel', 'Invalid cancel target'); return path.join(root, 'cancels', `${kind}-${id}.json`) }
  return {
    /** Idempotent: the first request for a target wins. disposition ROLLBACK (default) | RETAIN (keep applied files, no success claim). */
    request({ runId = null, reviewId = null, actor, reason = '', disposition = 'ROLLBACK' }) {
      if ((!runId) === (!reviewId)) fail('INVALID_PACKAGE', 'cancel', 'Exactly one of runId/reviewId')
      if (typeof actor !== 'string' || !actor.trim() || actor.length > 200) fail('INVALID_PACKAGE', 'cancel', 'Invalid actor')
      if (!['ROLLBACK', 'RETAIN'].includes(disposition)) fail('INVALID_PACKAGE', 'cancel', 'Invalid disposition')
      const kind = runId ? 'run' : 'review', id = runId ?? reviewId
      createExclusive(f(kind, id), JSON.stringify(signer.seal({ kind, id, actor, reason: String(reason).slice(0, 500), disposition, requestedAt: now() })))
      return this.find({ runId, reviewId })
    },
    /** Read-only; checked by the execution loop. Tampered record => CONTROL_STORE_CORRUPT (fails closed: treated as stop). */
    find({ runId = null, reviewId = null } = {}) {
      for (const [kind, id] of [['run', runId], ['review', reviewId]]) {
        if (!id) continue
        const rec = readJson(f(kind, id)); if (rec) return signer.open(rec)
      }
      return null
    },
  }
}

// ---------------------------------------------------------------- pause / stop requests
/** scope run|review|global. PAUSE = hold a run at its next safe boundary; STOP = global hold (broker takes no new work). Cancel wins over pause. */
function createPauseStore({ root, signer, now }) {
  const f = (scope, id) => { if (scope === 'global') return path.join(root, 'pauses', 'global.json'); if (!['run', 'review'].includes(scope) || !UUID.test(id)) fail('INVALID_PACKAGE', 'pause', 'Invalid pause target'); return path.join(root, 'pauses', `${scope}-${id}.json`) }
  const get = (scope, id) => { const r = readJson(f(scope, id)); return r ? signer.open(r) : null }
  return {
    request({ runId = null, reviewId = null, global = false, actor, reason = '', kind = 'PAUSE' }) {
      if ([runId, reviewId, global || null].filter(Boolean).length !== 1) fail('INVALID_PACKAGE', 'pause', 'Exactly one of runId/reviewId/global')
      if (typeof actor !== 'string' || !actor.trim() || actor.length > 200) fail('INVALID_PACKAGE', 'pause', 'Invalid actor')
      if (!['PAUSE', 'STOP'].includes(kind)) fail('INVALID_PACKAGE', 'pause', 'Invalid kind')
      const scope = global ? 'global' : runId ? 'run' : 'review', id = global ? 'global' : runId ?? reviewId, cur = get(scope, id)
      if (cur?.state === 'ACTIVE') return cur
      atomicWrite(f(scope, id), JSON.stringify(signer.seal({ scope, id, kind, actor, reason: String(reason).slice(0, 500), state: 'ACTIVE', seq: (cur?.seq ?? 0) + 1, requestedAt: now(), clearedBy: null, clearedAt: null })), 0o600)
      return get(scope, id)
    },
    /** Read-only; tampered record throws (fails closed => the run stops/blocks). */
    active({ runId = null, reviewId = null } = {}) {
      for (const [scope, id] of [['run', runId], ['review', reviewId], ['global', 'global']]) { if (scope !== 'global' && !id) continue; const r = get(scope, id); if (r?.state === 'ACTIVE') return r }
      return null
    },
    clear({ runId = null, reviewId = null, global = false, actor }) {
      const scope = global ? 'global' : runId ? 'run' : 'review', id = global ? 'global' : runId ?? reviewId, cur = get(scope, id)
      if (cur?.state !== 'ACTIVE') return false
      atomicWrite(f(scope, id), JSON.stringify(signer.seal({ ...cur, state: 'CLEARED', clearedBy: actor, clearedAt: now() })), 0o600); return true
    },
  }
}

// ---------------------------------------------------------------- effect ledger
export const EFFECT_STATES = ['PLANNED', 'STARTED', 'COMPLETED', 'FAILED', 'UNKNOWN_AFTER_CRASH']
const LEGAL = { PLANNED: ['STARTED', 'FAILED'], STARTED: ['COMPLETED', 'FAILED', 'UNKNOWN_AFTER_CRASH'], UNKNOWN_AFTER_CRASH: ['COMPLETED', 'FAILED'], FAILED: [], COMPLETED: [] }
function createEffectLedger({ root, now, signer }) {
  const file = runId => { if (!UUID.test(runId)) fail('CONTROL_STORE_CORRUPT', 'ledger', 'Invalid run id'); return path.join(root, 'effects', `${runId}.jsonl`) }
  const effectId = (runId, digest, stepId) => hash(`${runId}|${digest}|${stepId}`).slice(0, 32)
  function read(runId) {
    let text; try { text = fs.readFileSync(file(runId), 'utf8') } catch (e) { if (e.code === 'ENOENT') return { effects: new Map(), torn: false, bytes: 0 }; fail('CONTROL_STORE_CORRUPT', 'ledger', 'Ledger unreadable') }
    const lines = text.split('\n'), effects = new Map(); let prev = '0'.repeat(64), good = 0
    const torn = lines.at(-1) !== '' // last append lacked its newline: interrupted write; its content is NOT trusted
    for (const line of lines.slice(0, -1)) {
      let e; try { e = JSON.parse(line) } catch { fail('CONTROL_STORE_CORRUPT', 'ledger', 'Ledger line unreadable') }
      if (e.prev !== prev || e.chain !== signer.tag(prev + canonical({ ...e, chain: undefined }))) fail('CONTROL_STORE_CORRUPT', 'ledger', 'Ledger hash chain broken')
      prev = e.chain; good += Buffer.byteLength(line) + 1
      const cur = effects.get(e.effectId)
      effects.set(e.effectId, { effectId: e.effectId, runId: e.runId, packageDigest: e.packageDigest, stepId: e.stepId, kind: e.kind, irreversible: e.irreversible, deterministic: e.deterministic, state: e.state, detail: e.detail ?? null, history: [...(cur?.history ?? []), { state: e.state, at: e.at }] })
    }
    return { effects, torn, bytes: good, prev }
  }
  function append(runId, entry) {
    const { prev, torn } = read(runId)
    if (torn) fail('RECONCILIATION_REQUIRED', 'ledger', 'Ledger has a torn tail; repair under a lease first')
    const body = { prev: prev ?? '0'.repeat(64), at: now(), runId, ...entry }, line = { ...body, chain: signer.tag(body.prev + canonical({ ...body, chain: undefined })) }
    const fd = fs.openSync(file(runId), 'a', 0o600); try { fs.writeSync(fd, JSON.stringify(line) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }
  const meta = e => ({ effectId: e.effectId, packageDigest: e.packageDigest, stepId: e.stepId, kind: e.kind, irreversible: e.irreversible, deterministic: e.deterministic })
  return {
    effectId,
    /** Record effects BEFORE execution. kind e.g. 'file-write' | 'check' | 'file-restore'; irreversible effects are never auto-replayed. */
    /** Idempotent plan: only steps with no ledger entry yet are appended (resume/pause safe). */
    planMissing(runId, digest, list) { const have = read(runId).effects; this.plan(runId, digest, list.filter(x => !have.has(effectId(runId, digest, x.stepId)))) },
    plan(runId, digest, list) {
      for (const x of list) append(runId, { effectId: effectId(runId, digest, x.stepId), packageDigest: digest, stepId: x.stepId, kind: x.kind, irreversible: !!x.irreversible, deterministic: x.deterministic !== false, state: 'PLANNED' })
    },
    read,
    get(runId, digest, stepId) { return read(runId).effects.get(effectId(runId, digest, stepId)) ?? null },
    transition(runId, digest, stepId, state, detail = null) {
      const cur = this.get(runId, digest, stepId)
      if (!cur) fail('CONTROL_STORE_CORRUPT', 'ledger', 'Effect was not planned', { stepId })
      if (!LEGAL[cur.state].includes(state) && !(cur.state === 'FAILED' && state === 'STARTED' && cur.detail?.notApplied && !cur.irreversible)) fail('CONTROL_STORE_CORRUPT', 'ledger', `Illegal effect transition ${cur.state}->${state}`, { stepId, observed: cur.state })
      append(runId, { ...meta(cur), state, detail })
    },
    /** Decision before running a step: never repeat COMPLETED; never replay unknown/started; deterministic not-applied FAILED may retry. */
    decide(runId, digest, stepId) {
      const cur = this.get(runId, digest, stepId)
      if (!cur || cur.state === 'PLANNED') return 'EXECUTE'
      if (cur.state === 'COMPLETED') return 'SKIP_COMPLETED'
      if (cur.state === 'FAILED') return cur.detail?.notApplied && !cur.irreversible ? 'EXECUTE' : 'BLOCKED_FAILED'
      return 'RECONCILE_REQUIRED' // STARTED or UNKNOWN_AFTER_CRASH
    },
    /** Called by recovery: any STARTED effect of a dead run becomes UNKNOWN_AFTER_CRASH. */
    markUnknownAfterCrash(runId) {
      const out = []
      for (const e of read(runId).effects.values()) if (e.state === 'STARTED') { append(runId, { ...meta(e), state: 'UNKNOWN_AFTER_CRASH', detail: { reason: 'crash-recovery' } }); out.push(e.stepId) }
      return out
    },
    repairTail(runId) { const { torn, bytes } = read(runId); if (torn) fs.truncateSync(file(runId), bytes); return torn },
  }
}

export function createControlPlane({ root, now = Date.now, leaseTtlMs = 60_000 }) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const real = fs.realpathSync(root)
  dirs(real, ['reviews', 'approvals', 'leases', 'cancels', 'effects', 'pauses'])
  const signer = createSigner(real)
  return {
    root: real, now, signer,
    approvals: createApprovalStore({ root: real, signer, now }),
    leases: createLeaseStore({ root: real, signer, now, defaultTtlMs: leaseTtlMs }),
    cancels: createCancelStore({ root: real, signer, now }),
    pauses: createPauseStore({ root: real, signer, now }),
    effects: createEffectLedger({ root: real, now, signer }),
  }
}

/** Isolated broker around the blueprint core. The core stays deterministic and authority-free; the broker supplies HOST authority:
 * authenticated actor (from a host session adapter only), mission/assignment binding, resource lease, base identity, immutable check
 * registry, durable package store, pause/cancel/stop, recovery, source-only status projection and the Phase 9 outcome outbox.
 *
 * NOT WIRED TO LIVE WAR ROOM. Every `host.*` member is an interface a fake implements in tests and War Room must implement later.
 * Trust boundaries: the host authenticates sessions, owns missions/assignments, owns the lock backing, attests base identity and
 * owns check implementations. Store signatures are tamper-evidence only (see control.mjs). Imported packages never carry authority:
 * no actor, mission, assignment, approval, permission or claim field is accepted from package JSON (strict schema).
 *
 * Store layout under <control.root>/broker (all 0600/0700; records signed with the control-plane key):
 *   packages/<execId>.pkg.json   IMMUTABLE signed package record {rawHash, normalizedHash, reviewId, binding, importedBy, importedAt}
 *   packages/<execId>.raw        IMMUTABLE original package bytes (0400);  .normalized.json canonical form (0400)
 *   exec/<execId>.json           MUTABLE signed execution state {state, runId, lease, approval, stages, history, seq, ...}
 *   secrets/<execId>.handle      core approval handle (bearer secret; never copied into receipts/events/projections)
 *   requests/<hash>.json         request-id idempotency records
 *   assertions/<execId>.json     signed holder-death assertions
 *   outbox/<eventId>.json|.sent  Phase 9 events pending/delivered
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import { assertBuildStage, createLeaseAdapter, createSourceOnlyBuildStage, validateActor } from './adapters.mjs'
import { BlueprintError, UUID, atomicWrite, canonical, createExclusive, describeError, hash, readJson, refuse } from './base.mjs'
import { createBlueprintCore } from './core.mjs'
import { createControlPlane } from './control.mjs'
import { AUTH_FAILURE_CODES, authFailure } from './authbridge.mjs'
import { normalizeBaseIdentity, recoveryClassOf } from './baseid.mjs'
import { ASSIGNMENT_TERMINAL, MISSION_TERMINAL, authorizePackageScope, lifecyclePermits, normalizeOwnership, ownershipDigestOf } from './ownership.mjs'
import { holderIdFor, leaseBindingOf } from './reslock.mjs'
import { filesDigest, treeDigest } from './artifacts.mjs'
import { createBuildEngine, inputDigestOf, procState } from './buildexec.mjs'
import { deriveClaims } from './stages.mjs'
import { buildOutcomeEvent, validateOutcomeEvent } from './phase9.mjs'

const TERMINAL = new Set(['VERIFIED_SOURCE', 'FAILED_ROLLED_BACK', 'BLOCKED', 'ROLLBACK_INCOMPLETE', 'CANCELLED_ROLLED_BACK', 'CANCELLED_NO_CHANGES', 'CANCELLED_RETAINED', 'CANCELLED_ROLLBACK_INCOMPLETE', 'RECOVERED_ROLLED_BACK', 'FAILED_BEFORE_RUN'])
const RESTORABLE = new Set(['ROLLBACK_INCOMPLETE', 'CANCELLED_ROLLBACK_INCOMPLETE'])
const CTX_KEYS = ['missionId', 'assignmentId', 'workspaceId', 'requestingSubsystem']
const CTX_OPTIONAL = ['workerId'] // optional claim by the CALLER; must equal the assignment's owner agent (never taken from the package)
const ROLE_POLICY = {
  import: ['commander', 'operator'], read: ['commander', 'operator', 'viewer'], approve: ['commander'], execute: ['commander'], pause: ['commander', 'operator'],
  resume: ['commander'], cancel: ['commander'], stop: ['commander'], recover: ['commander'], reconcile: ['commander'], restore: ['commander'], assert: ['commander'], outbox: ['commander'], build: ['commander'],
}
const wsKey = id => hash(String(id)).slice(0, 32)
const idStr = (v, label) => { if (typeof v !== 'string' || !/^[\w.:@/-]{1,200}$/.test(v)) refuse('INVALID_PACKAGE', 'broker', `Invalid ${label}`); return v }

export function createBroker({ brokerId, control: injected, controlRoot, evidenceRoot, host, now = Date.now, leaseTtlMs = 60_000, approvalTtlMs = 15 * 60_000, checkTimeoutMs = 30_000, faultHook, afterWrite, leaseBacking = null }) {
  if (!host?.sessions?.resolve || !host.missions?.verifyAssignment || !host.workspaces?.resolve || !host.baseIdentity?.resolve || !host.checks?.toCoreChecks) throw new Error('host adapters sessions/missions/workspaces/baseIdentity/checks are required')
  if (typeof brokerId !== 'string' || !brokerId) throw new Error('brokerId required')
  const control = injected ?? createControlPlane({ root: controlRoot, now, leaseTtlMs })
  const signer = control.signer, policy = host.policy ?? {}, buildStage = assertBuildStage(host.buildStage ?? createSourceOnlyBuildStage()), sink = host.phase9Sink ?? null
  const leases = createLeaseAdapter({ backing: leaseBacking ?? control.leases, holderId: brokerId, defaultTtlMs: leaseTtlMs })
  const B = path.join(control.root, 'broker')
  for (const d of ['packages', 'exec', 'secrets', 'requests', 'assertions', 'outbox']) fs.mkdirSync(path.join(B, d), { recursive: true, mode: 0o700 })
  fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 })
  const P = (d, name) => { if (!UUID.test(name.slice(0, 36))) refuse('BROKER_STATE', 'broker', 'Invalid id'); return path.join(B, d, name) }
  const cores = new Map(), active = new Set()
  const buildStageCalls = []
  // ---------------------------------------------------------------- build/package pipeline (host-owned recipes; REAL bounded execution against an isolated fixture only)
  const pipeline = host.pipeline ?? null, depv = host.dependencies ?? null
  const engine = pipeline ? createBuildEngine({ root: path.join(B, 'build'), signer, now, hooks: pipeline.hooks }) : null

  // ---------------------------------------------------------------- host authority
  const actorFor = (token, op) => {
    let raw = null; try { raw = host.sessions.resolve(token) } catch (x) { if (x instanceof BlueprintError && AUTH_FAILURE_CODES.includes(x.code)) throw authFailure(x.code); raw = null } // typed auth failures pass through with FIXED text (no host/raw error content)
    const actor = validateActor(raw, { now: now(), maxAuthAgeMs: policy.maxAuthAgeMs })
    if (!ROLE_POLICY[op]?.includes(actor.role)) refuse('ROLE_DENIED', 'auth', `Role ${actor.role} may not perform ${op}`)
    return actor
  }
  const ctxOk = (ctx, binding) => {
    if (!ctx || typeof ctx !== 'object' || Object.keys(ctx).some(k => !CTX_KEYS.includes(k) && !CTX_OPTIONAL.includes(k))) refuse('BINDING_MISMATCH', 'broker', 'Invalid execution context')
    if (ctx.missionId !== binding.missionId) refuse('MISSION_MISMATCH', 'broker', 'Package is bound to a different mission', { expected: binding.missionId, observed: ctx.missionId ?? null })
    if (ctx.assignmentId !== binding.assignmentId) refuse('ASSIGNMENT_MISMATCH', 'broker', 'Package is bound to a different assignment', { expected: binding.assignmentId, observed: ctx.assignmentId ?? null })
    if (ctx.workspaceId !== binding.workspaceId) refuse('WORKSPACE_MISMATCH', 'broker', 'Package is bound to a different workspace', { expected: binding.workspaceId, observed: ctx.workspaceId ?? null })
    if (ctx.requestingSubsystem !== undefined && ctx.requestingSubsystem !== binding.requestingSubsystem) refuse('BINDING_MISMATCH', 'broker', 'Requesting subsystem differs from the recorded binding')
    if (ctx.workerId !== undefined) { const f = strict ? ownerFacts(binding) : null; if (!f?.complete || f.ownerId !== ctx.workerId) refuse('WORKER_MISMATCH', 'broker', 'Requesting worker is not the assignment owner') }
  }
  // ---------------------------------------------------------------- mission/assignment ownership (host-owned; READ-ONLY). Strict mode when host.missions.resolve exists.
  const strict = typeof host.missions.resolve === 'function'
  const ownerFacts = b => { if (!strict) return null; let r = null; try { r = host.missions.resolve({ missionId: b.missionId, assignmentId: b.assignmentId }) } catch { r = null } return normalizeOwnership(r) }
  const ownerGate = (b, op) => { // returns facts (strict) or null (legacy fake hosts); throws a typed refusal otherwise
    if (!strict) return null
    const f = ownerFacts(b)
    if (!f?.complete) refuse('OWNERSHIP_UNAVAILABLE', 'ownership', 'Mission/assignment ownership could not be proven by the host')
    if (f.missionId !== b.missionId) refuse('MISSION_MISMATCH', 'ownership', 'Host resolved a different mission')
    if (f.assignmentId !== b.assignmentId) refuse('ASSIGNMENT_MISMATCH', 'ownership', 'Host resolved a different assignment')
    if (f.workspaceId !== b.workspaceId) refuse('WORKSPACE_MISMATCH', 'ownership', 'Assignment/mission workspace differs from the binding')
    const v = lifecyclePermits(op, f); if (!v.ok) refuse(v.code, 'ownership', `Ownership refuses ${op}: ${v.reason}`)
    return f
  }
  const scopeFor = (f, raw) => { const p = JSON.parse(raw), r = authorizePackageScope(f, { writePaths: p.permissions.writePaths, changePaths: p.changes.map(c => c.path) }); if (!r.ok) refuse(r.code, 'ownership', `Write scope refused: ${r.reason}`, { path: r.path ?? null }); return r }
  const ownershipOf = (f, sc) => ({ digest: ownershipDigestOf(f, sc.effectiveScopeDigest), effectiveScopeDigest: sc.effectiveScopeDigest, liveScopeDigest: f.writeScope.digest })
  const assignmentOk = (binding, actor, op = 'import') => {
    const f = ownerGate(binding, op) // strict facts first: specific, typed refusals (mission/assignment/workspace/lifecycle/scope)
    let ok = false; try { ok = host.missions.verifyAssignment({ ...binding }, { ...actor }) === true } catch { ok = false } // host's actor-aware verdict must ALSO agree
    if (!ok) refuse('ASSIGNMENT_INACTIVE', 'broker', 'Host does not consider this assignment active for this actor/workspace')
    return f
  }
  /** Re-read host authority for an existing execution: lifecycle permits `op`, identity (owner/workspace/task class/granted write) unchanged since approval/start, and for RESUME the live write scope unchanged. */
  const ownershipRecheck = (exec, op) => {
    const f = ownerGate(exec.binding, op); if (!f) return null
    const stored = exec.ownership ?? exec.approval?.ownership; if (!stored) refuse('OWNERSHIP_CHANGED', 'ownership', 'No ownership binding was recorded for this execution')
    const work = !['restore', 'reconcile'].includes(op), sc = work ? scopeFor(f, loadPackage(exec.execId).raw) : { effectiveScopeDigest: stored.effectiveScopeDigest }
    if (ownershipDigestOf(f, sc.effectiveScopeDigest) !== stored.digest) refuse('OWNERSHIP_CHANGED', 'ownership', 'Mission/assignment ownership changed since approval')
    if (op === 'resume' && f.writeScope.digest !== stored.liveScopeDigest) refuse('RECOVERY_NOT_ALLOWED', 'recovery', 'Mission write scope changed since the run started; operator review required', { observed: 'SCOPE_CHANGED_REVIEW_REQUIRED' })
    return f
  }
  /** Mid-run host authority (core stop points): cancel/terminal => CANCEL (rollback under lease); anything else that removes authority => PAUSE (no blind rollback). */
  const authorityFor = exec => () => {
    if (!strict) return null
    const f = ownerFacts(exec.binding), stored = exec.ownership
    if (!f?.complete) return { kind: 'PAUSE', reason: 'OWNERSHIP_UNAVAILABLE' }
    if (f.cancelRequested || f.missionState === 'CANCELLED' || ['CANCEL_REQUESTED', 'STOPPING', 'CANCELLED'].includes(f.assignmentState)) return { kind: 'CANCEL', reason: 'HOST_CANCELLED' }
    if (MISSION_TERMINAL.includes(f.missionState) || ASSIGNMENT_TERMINAL.includes(f.assignmentState)) return { kind: 'CANCEL', reason: 'HOST_AUTHORITY_ENDED' }
    if (f.pauseRequested || f.missionState !== 'EXECUTING' || f.assignmentState !== 'RUNNING' || f.ownerState !== 'ACTIVE') return { kind: 'PAUSE', reason: 'HOST_PAUSED_OR_PHASE_CHANGED' }
    try { const sc = scopeFor(f, loadPackage(exec.execId).raw); if (stored && ownershipDigestOf(f, sc.effectiveScopeDigest) !== stored.digest) return { kind: 'PAUSE', reason: 'OWNERSHIP_CHANGED' } } catch { return { kind: 'PAUSE', reason: 'SCOPE_REVOKED' } }
    return null
  }
  const stoppedCheck = () => { if (control.pauses.active({})?.kind === 'STOP') refuse('BROKER_STOPPED', 'broker', 'Broker is stopped') }

  // ---------------------------------------------------------------- stores
  function loadPackage(execId) {
    const rec = readJson(P('packages', `${execId}.pkg.json`)); if (!rec) refuse('BROKER_STATE', 'broker', 'Unknown execution')
    const pkg = signer.open(rec)
    const raw = fs.readFileSync(P('packages', `${execId}.raw`), 'utf8')
    if (hash(raw) !== pkg.rawHash) refuse('CONTROL_STORE_CORRUPT', 'broker', 'Imported package bytes changed after import')
    const norm = fs.readFileSync(P('packages', `${execId}.normalized.json`), 'utf8')
    if (hash(norm) !== pkg.normalizedFileHash) refuse('CONTROL_STORE_CORRUPT', 'broker', 'Normalized package changed after import')
    return { pkg, raw }
  }
  function loadExec(execId) {
    const rec = readJson(P('exec', `${execId}.json`)); if (!rec) refuse('BROKER_STATE', 'broker', 'Unknown execution')
    const exec = signer.open(rec)
    const { pkg } = loadPackage(execId)
    if (exec.bindingHash !== hash(canonical(pkg.binding)) || exec.normalizedHash !== pkg.normalizedHash || exec.rawHash !== pkg.rawHash) refuse('BINDING_MISMATCH', 'broker', 'Execution record no longer matches the immutable package binding')
    return { ...exec, binding: pkg.binding, requestedBy: pkg.importedBy }
  }
  function saveExec(exec, event) {
    const { binding, requestedBy, ...rest } = exec
    const cur = readJson(P('exec', `${exec.execId}.json`))
    if (cur && signer.open(cur).seq !== exec.seq) refuse('CONTROL_STORE_CORRUPT', 'broker', 'Concurrent execution record update')
    const next = { ...rest, seq: exec.seq + 1, history: [...exec.history, { at: now(), event, state: exec.state }].slice(-50) }
    atomicWrite(P('exec', `${exec.execId}.json`), JSON.stringify(signer.seal(next)), 0o600)
    return { ...next, binding, requestedBy }
  }
  /** Merge a patch into the LATEST stored execution record (pause/cancel/stop requests may have bumped it while a run was in flight). */
  const update = (execId, patch, event) => saveExec({ ...loadExec(execId), ...patch }, event)
  /** Read authorization: any authenticated role may read, narrowed by host policy.canRead(actor, binding) (War Room mission ACLs). */
  const readable = (token, execId) => {
    const actor = actorFor(token, 'read'), exec = loadExec(execId)
    let ok = true; try { ok = policy.canRead ? policy.canRead({ ...actor }, { ...exec.binding }) === true : true } catch { ok = false }
    if (!ok) refuse('ROLE_DENIED', 'auth', 'Not permitted to read this execution'); return exec
  }
  const secretPath = execId => P('secrets', `${execId}.handle`)
  function once(requestId, op, execId, fn) { // duplicate broker requests cannot duplicate effects
    if (requestId === undefined) return fn()
    const f = path.join(B, 'requests', `${hash(`${op}|${execId}|${idStr(requestId, 'requestId')}`)}.json`)
    if (!createExclusive(f, JSON.stringify(signer.seal({ state: 'IN_PROGRESS', op, execId, at: now() })))) {
      const rec = signer.open(readJson(f))
      if (rec.state === 'DONE') return { ...rec.result, deduplicated: true }
      refuse('DUPLICATE_REQUEST_IN_PROGRESS', 'broker', 'A request with this id is already in progress')
    }
    const done = r => { atomicWrite(f, JSON.stringify(signer.seal({ state: 'DONE', op, execId, at: now(), result: r })), 0o600); return r }
    const failed = e => { try { fs.unlinkSync(f) } catch { /* gone */ } throw e } // a FAILED request may be retried with the same id; the state machine still prevents duplicate effects
    let out; try { out = fn() } catch (e) { return failed(e) }
    return out instanceof Promise ? out.then(done, failed) : done(out)
  }

  // ---------------------------------------------------------------- core wiring
  function coreFor(workspaceId) {
    if (cores.has(workspaceId)) return cores.get(workspaceId)
    const ws = host.workspaces.resolve(workspaceId); if (!ws || ws.id !== workspaceId) refuse('WORKSPACE_MISMATCH', 'broker', 'Host could not resolve this workspace')
    const slot = leases.bindCore(), stateRoot = path.join(evidenceRoot, wsKey(workspaceId)), entry = { core: null, slot, authority: null }
    const getDependencies = depv ? names => Object.fromEntries(names.map(n => { const ev = depv.evidence(workspaceId, { name: n }); return ev && ev.resolved !== null && ev.lockfile === ev.resolved && ev.manifest !== null ? [n, ev.resolved] : null }).filter(Boolean)) : undefined // host EVIDENCE at check time
    const core = createBlueprintCore({ workspace: { id: ws.id, root: ws.root, dependencies: ws.dependencies ?? {}, ...(getDependencies ? { getDependencies } : {}), getBaseRevision: () => host.baseIdentity.resolve(workspaceId) }, stateRoot, control, lease: slot,
      checks: host.checks.toCoreChecks(), authorityStop: (c, point) => (entry.authority ? entry.authority(point) : null), previewRequiresLease: false, now, approvalTtlMs, checkTimeoutMs, faultHook, afterWrite })
    entry.core = core; cores.set(workspaceId, entry); return entry
  }
  const checkBindingNow = (workspaceId, view) => host.checks.bindingFor(view.checks.map(c => ({ id: c.id, version: c.version })))
  const reportOf = (exec, receipt) => {
    const st = exec.state
    if (st === 'VERIFIED_SOURCE' && receipt?.claims?.sourceValidated === true && exec.stages?.validateSource?.status === 'PASS') return 'SOURCE_VALIDATED'
    if (st === 'FAILED_ROLLED_BACK') return receipt?.error?.code === 'VALIDATION_FAILED' ? 'SOURCE_FAILED' : 'ROLLED_BACK'
    if (st === 'BLOCKED' || st === 'FAILED_BEFORE_RUN') return 'SOURCE_FAILED'
    if (st === 'RECOVERED_ROLLED_BACK') return 'ROLLED_BACK'
    if (String(st).startsWith('CANCELLED')) return 'CANCELLED'
    return 'NEEDS_REVIEW'
  }
  function projectionOf(exec, receipt) {
    const sv = receipt?.claims?.sourceValidated === true && receipt.status === 'VERIFIED_SOURCE' && exec.state === 'VERIFIED_SOURCE' && exec.stages?.validateSource?.status === 'PASS'
    return {
      execId: exec.execId, state: exec.state, runId: exec.runId ?? null, packageId: exec.binding.packageId,
      binding: { ...exec.binding }, status: receipt?.status ?? exec.state, terminal: TERMINAL.has(exec.state),
      // Source-only honesty: only sourceValidated can ever be true here. built/packaged/installed/taskComplete are NOT performed in this slice.
      claims: { sourceValidated: sv, built: false, packaged: false, installed: false, taskComplete: false, missionComplete: false, assignmentComplete: false },
      // The broker REPORTS source-level facts only. Mission/assignment lifecycle is advanced exclusively by the host mission engine; nothing here can do it.
      report: reportOf(exec, receipt), hostLifecycle: { missionAdvanced: false, assignmentAdvanced: false },
      stages: { validateSource: exec.stages?.validateSource ?? { status: sv ? 'PASS' : 'NOT_RUN' }, baseIdentity: exec.stages?.baseIdentity ?? { status: 'NOT_RUN' }, checkBinding: exec.stages?.checkBinding ?? { status: 'NOT_RUN' }, build: { status: 'NOT_RUN', reason: 'build stage not implemented' }, package: { status: 'NOT_RUN', reason: 'package stage not implemented' }, verifyArtifact: { status: 'NOT_RUN', reason: 'not implemented' }, install: { status: 'NOT_RUN', reason: 'out of scope' } },
      headline: exec.state === 'VERIFIED_SOURCE' ? 'SOURCE_VERIFIED_ONLY' : exec.state,
      artifact: receipt?.artifact ?? null, checks: receipt?.checks ?? [], error: receipt?.error ?? null, rollback: receipt?.rollback ?? null, cancel: receipt?.cancel ?? null, pause: receipt?.pause ?? null,
      approvedBy: exec.approval ? { ...exec.approval.approvedBy } : null, recoveries: exec.recoveries ?? 0,
      note: 'Source validation only. Build, package and install were not performed; no task-complete claim is made.',
    }
  }

  // ---------------------------------------------------------------- Phase 9 outbox
  function emitOutcome(exec, receipt, outcome) {
    if (!sink) return 'NO_SINK'
    const ev = validateOutcomeEvent(buildOutcomeEvent({ exec, receipt, outcome, recoveries: exec.recoveries ?? 0, emittedAt: now() }))
    createExclusive(path.join(B, 'outbox', `${ev.eventId}.json`), JSON.stringify(ev))
    return deliver(ev.eventId)
  }
  function deliver(eventId) {
    const f = path.join(B, 'outbox', `${eventId}.json`), sent = f.replace(/\.json$/, '.sent')
    if (fs.existsSync(sent)) return 'SENT'
    try { sink.emit(JSON.parse(fs.readFileSync(f, 'utf8'))); createExclusive(sent, '{}'); return 'SENT' } catch { return 'PENDING' }
  }

  // ---------------------------------------------------------------- lifecycle
  async function finalize(exec, receipt, outcomeOverride) {
    let next = { ...loadExec(exec.execId), state: outcomeOverride ?? receipt.status, terminalStatus: TERMINAL.has(outcomeOverride ?? receipt.status) ? (outcomeOverride ?? receipt.status) : null, receiptRef: receipt.evidenceRef }
    if (receipt.status === 'VERIFIED_SOURCE') { // the ONLY build-stage method this slice ever calls
      buildStageCalls.push('validateSource')
      let r; try { r = await buildStage.validateSource({ execId: exec.execId, receipt: structuredClone(receipt) }) } catch { r = { status: 'ERROR' } }
      next.stages = { ...(next.stages ?? {}), validateSource: { status: ['PASS', 'FAIL'].includes(r?.status) ? r.status : 'INCONCLUSIVE' } }
      if (next.stages.validateSource.status !== 'PASS') next.state = 'NEEDS_OPERATOR_REVIEW_SOURCE_STAGE'
    }
    if (receipt.status === 'VERIFIED_SOURCE' && next.state === 'VERIFIED_SOURCE') { // broker-side final gate: success is only reported if base identity AND check implementations are still exactly what was approved/started
      let baseOk = true; const started = next.baseIdentity ?? next.approval?.baseIdentity
      try { baseOk = !started || baseNow(next.binding.workspaceId).digest === started.digest } catch { baseOk = false }
      let checksOk = true; try { checksOk = receipt.checkBinding === next.approval?.checkBinding && host.checks.bindingFor((receipt.checks ?? []).map(c => ({ id: c.id, version: c.version }))) === next.approval?.checkBinding } catch { checksOk = false } // registry NOW must still match what ran and what was approved
      next.stages = { ...(next.stages ?? {}), baseIdentity: { status: baseOk ? 'PASS' : 'FAIL' }, checkBinding: { status: checksOk ? 'PASS' : 'FAIL' } }
      if (!baseOk) next.state = 'NEEDS_OPERATOR_REVIEW_BASE'; else if (!checksOk) next.state = 'NEEDS_OPERATOR_REVIEW_CHECKS'
    }
    next = saveExec(next, 'FINALIZED')
    if (engine && next.state === 'VERIFIED_SOURCE') recordSourceReceipt(next, receipt)
    if (TERMINAL.has(next.state)) next = update(next.execId, { outcomeEmission: emitOutcome(next, receipt, next.state) }, 'OUTCOME_EMITTED')
    return { exec: next, projection: projectionOf(next, receipt) }
  }
  /** Per-execution holder: broker + mission + assignment + workspace. A lease taken for one execution can never be reattached/reused by another. */
  const holderFor = b => holderIdFor({ brokerId, missionId: b.missionId, assignmentId: b.assignmentId, workspaceId: b.workspaceId })
  const leaseBinding = (b, holder) => leaseBindingOf({ workspaceId: b.workspaceId, baseIdentity: host.baseIdentity.resolve(b.workspaceId), missionId: b.missionId, assignmentId: b.assignmentId, holder })
  /** Defensive: the handle placed in the core slot must belong to THIS execution's workspace and holder (cross-workspace/mission/assignment replay refusal). */
  const setSlot = (entry, handle, b) => {
    if (handle.workspaceId !== b.workspaceId || handle.holder !== holderFor(b)) { try { leases.release(handle) } catch { /* best effort */ } refuse('BINDING_MISMATCH', 'lease', 'Lease does not belong to this execution (workspace/mission/assignment/holder)') }
    entry.slot.set(handle)
  }
  /** Base identity of the workspace NOW: opaque digest (always) + normalized identity (when the host adapter can inspect). resolve() refuses unproven identities. */
  const baseNow = ws => ({ digest: host.baseIdentity.resolve(ws), identity: host.baseIdentity.inspect ? (() => { try { return host.baseIdentity.inspect(ws) } catch { return null } })() : null })
  const baseClassify = (stored, ws) => { // null when the host cannot inspect (digest-only adapters): then only digest equality is enforced elsewhere
    if (!host.baseIdentity.inspect || !stored?.identity) return null
    let cur = null; try { cur = host.baseIdentity.inspect(ws) } catch { cur = null }
    return (host.baseIdentity.classify ?? (() => 'UNKNOWN'))(normalizeBaseIdentity(stored.identity), cur)
  }
  const baseGate = (exec, action) => { // recovery must not proceed on a base that moved/rebound/is unproven; restore/reconcile tolerate a mere commit advance (content hash guards apply)
    const cls = baseClassify(exec.baseIdentity ?? exec.approval?.baseIdentity, exec.binding.workspaceId); if (cls === null) return
    const ok = action === 'RESUME' ? cls === 'BASE_UNCHANGED' : ['BASE_UNCHANGED', 'BASE_ADVANCED_EXTERNALLY'].includes(cls)
    if (!ok) refuse('RECOVERY_NOT_ALLOWED', 'recovery', `Workspace base identity changed or is unproven (${recoveryClassOf(cls)}); operator review required`, { observed: recoveryClassOf(cls) })
  }
  const approvalBindingHash = (exec, a) => hash(canonical({ digest: exec.normalizedHash, binding: exec.binding, checkBinding: a.checkBinding, actorId: a.approvedBy.actorId, sessionId: a.approvedBy.sessionId, baseIdentity: a.baseIdentity?.digest ?? null, holder: holderFor(exec.binding), ownership: a.ownership?.digest ?? null, pipeline: a.pipeline ?? null }))
  const leaseRecord = (info, b) => ({ leaseId: info.leaseId, holder: info.holder, epoch: info.epoch, bindingHash: leaseBinding(b, info.holder) })
  /** `checkBase`: resumption must find the SAME base identity the lease was bound to (restore/reconcile do not need it: they act on observed state). */
  const takeLease = (entry, exec, workspaceId, assertion, { checkBase = false } = {}) => {
    const b = exec.binding, holder = holderFor(b)
    if (checkBase && exec.lease?.bindingHash && exec.lease.bindingHash !== leaseBinding(b, exec.lease.holder)) refuse('BINDING_MISMATCH', 'lease', 'Lease binding (workspace/base identity/mission/assignment/holder) no longer matches; operator review required')
    const handle = leases.acquireForRecovery({ workspaceId, previous: exec.lease ?? null, holderDead: assertion, holder, meta: { missionId: b.missionId } })
    setSlot(entry, handle, b); return handle
  }
  const holderDeadFor = exec => { const rec = readJson(P('assertions', `${exec.execId}.json`)); return rec ? signer.open(rec) : null }
  const requireState = (exec, allowed, op) => { if (!allowed.includes(exec.state)) refuse('BROKER_STATE', 'broker', `Cannot ${op} while execution is ${exec.state}`, { observed: exec.state, expected: allowed }) }

  // ---------------------------------------------------------------- build input digest + lineage helpers
  const pkgOf = execId => JSON.parse(loadPackage(execId).raw)
  const wsRootOf = b => host.workspaces.resolve(b.workspaceId).root
  const safe = fn => { try { return fn() } catch { return 'UNPROVEN' } }
  const recipeLive = r => (r.currentScriptDigest() === r.scriptDigest ? r.digest : hash(`DRIFT:${r.digest}:${r.currentScriptDigest()}`)) // an on-disk change to a registered recipe script is part of the input digest
  const stageBinding = stage => host.checks.bindingFor(pipeline.stageChecks(stage).map(id => ({ id, version: host.checks.get(id)?.version ?? '?' })))
  /** Source-level inputs (STALE group): the validated source + who/where/base it was validated under. */
  function sourceComponents(exec, p) {
    const b = exec.binding; let own = null
    if (strict) own = safe(() => { const f = ownerFacts(b); return f?.complete ? ownershipOf(f, scopeFor(f, loadPackage(exec.execId).raw)).digest : 'UNAVAILABLE' })
    return { packageDigest: exec.normalizedHash, sourceHashes: safe(() => filesDigest(wsRootOf(b), p.changes.map(c => c.path))), baseIdentityDigest: safe(() => baseNow(b.workspaceId).digest), ownershipDigest: own, leaseHolder: holderFor(b), checkBinding: safe(() => host.checks.bindingFor(p.checks.map(c => ({ id: c.id, version: c.version })))) }
  }
  async function depResult(exec, p, recipe) {
    const seen = new Set(), declared = [...p.dependencies, ...recipe.requiredDeps].filter(d => { const k = `${d.name}@${d.version}`; if (seen.has(k)) return false; seen.add(k); return true }).map(d => ({ name: d.name, version: d.version }))
    if (!depv) return { deps: [], digest: hash(declared.length ? 'NO_VERIFIER_WITH_DEPENDENCIES' : 'NO_DEPENDENCIES'), counts: {}, allUsable: declared.length === 0 }
    return depv.verify(exec.binding.workspaceId, declared)
  }
  const buildComponents = (exec, p, recipe, dep) => ({ ...sourceComponents(exec, p), inputTree: safe(() => treeDigest(wsRootOf(exec.binding), recipe.inputRoots)), dependencyDigest: dep.digest, stageCheckBinding: safe(() => stageBinding('build')), recipeDigest: recipeLive(recipe), envDigest: safe(() => pipeline.environment.identity().digest) })
  const packageComponents = (execId, recipe) => { const br = engine.receipts(execId, 'BUILD').filter(r => r.rec.body.status === 'PASSED').at(-1); return { buildInputDigest: br?.rec.body.inputDigest ?? null, buildReceiptId: br?.id ?? null, buildManifestDigest: br?.rec.body.manifest?.manifestDigest ?? null, recipeDigest: recipeLive(recipe), envDigest: safe(() => pipeline.environment.identity().digest), stageCheckBinding: safe(() => stageBinding('package')) } }
  const withDigest = components => ({ components, digest: inputDigestOf(components) })
  /** Everything "now": used to derive CURRENT/STALE/REQUIRES_REBUILD for existing receipts. */
  async function nowInputs(exec, p) {
    const rb = pipeline.recipe('build'), dep = await depResult(exec, p, rb), src = sourceComponents(exec, p)
    return { source: { components: src }, dependencies: { digest: dep.digest }, build: withDigest(buildComponents(exec, p, rb, dep)), package: pipeline.has('package') ? withDigest(packageComponents(exec.execId, pipeline.recipe('package'))) : { components: {}, digest: null }, depResult: dep }
  }
  function recordSourceReceipt(exec, receipt) {
    try {
      if (engine.receipts(exec.execId, 'SOURCE').some(r => r.rec.body.runId === receipt.runId)) return
      const p = pkgOf(exec.execId)
      engine.appendReceipt(exec.execId, 'SOURCE', { runId: receipt.runId, evidenceRef: receipt.evidenceRef, packageDigest: exec.normalizedHash, components: sourceComponents(exec, p), checks: (receipt.checks ?? []).map(c => ({ id: c.id, version: c.version, status: c.status, implementationDigest: c.implementationDigest ?? null })),
        validateSource: exec.stages?.validateSource?.status ?? null, rollback: receipt.rollback ? { attempted: receipt.rollback.attempted ?? 0 } : null, binding: { missionId: exec.binding.missionId, assignmentId: exec.binding.assignmentId, workspaceId: exec.binding.workspaceId }, scope: scopeLabelOf() })
    } catch { /* a missing SOURCE receipt blocks stages later; it never blocks source validation reporting */ }
  }
  const stageSummary = (execId, kind, cur) => {
    const r = engine.receipts(execId, kind).at(-1); if (!r) return { status: 'NOT_RUN' }; const b = r.rec.body
    return { status: b.status === 'PASSED' ? 'PASS' : b.status === 'CANCELLED' ? 'CANCELLED' : b.status === 'INTERRUPTED' ? 'INTERRUPTED' : 'FAIL', attempt: b.attempt, failureCode: b.failure?.code ?? null, toolIdentity: b.toolIdentity, toolVersion: b.toolVersion, manifestDigest: b.manifest?.manifestDigest ?? null,
      artifactCount: b.manifest?.entries.length ?? 0, latencyMs: Math.max(0, (b.finishedAt ?? 0) - (b.startedAt ?? 0)), receiptId: r.id, currentStatus: cur?.status ?? 'UNKNOWN' }
  }
  /** Recompute CURRENT state (+ optionally record invalidation observations), refresh the exec summaries (stages/lineage) and return the authoritative lineage view. */
  async function refreshLineage(execId, { record = false } = {}) {
    let exec = loadExec(execId), p = pkgOf(execId), now0 = await nowInputs(exec, p)
    const cur = engine.current(execId, now0, { record: false }), ver = engine.receipts(execId, 'VERIFICATION').at(-1)?.rec.body ?? null
    if (!engine.verifyChain(execId).ok) for (const k of ['source', 'build', 'package']) if (cur[k].status === 'CURRENT') cur[k] = { ...cur[k], status: 'UNUSABLE', reason: 'LINEAGE_CHAIN_BROKEN' } // unverifiable history can never support a current claim
    if (record && engine.verifyChain(execId).ok) engine.current(execId, now0, { record: true })
    const bs = stageSummary(execId, 'BUILD', cur.build), ps = stageSummary(execId, 'PACKAGE', cur.package)
    const builtOk = cur.build.status === 'CURRENT' && !!ver?.build?.ok, packagedOk = builtOk && cur.package.status === 'CURRENT' && !!ver?.package?.ok
    const verifyStatus = !ver ? { status: 'NOT_RUN' } : { status: ver.build?.ok !== false && ver.package?.ok !== false ? 'PASS' : 'FAIL', builtVerified: builtOk, packagedVerified: packagedOk, receiptId: engine.receipts(execId, 'VERIFICATION').at(-1).id }
    const can = engine.loadCancel(execId), runsB = engine.runsFor(execId, 'build'), runsP = engine.runsFor(execId, 'package'), inv = engine.receipts(execId, 'INVALIDATION').at(-1)?.rec.body ?? null
    const lineage = { buildInputDigest: now0.build.digest, dependencyResult: { state: now0.depResult.allUsable ? 'VERIFIED_USABLE' : 'BLOCKED', digest: now0.depResult.digest, counts: now0.depResult.counts }, cancellation: { state: can?.state ?? 'NONE' },
      interruption: [...runsB, ...runsP].filter(r => ['INTERRUPTED', 'UNKNOWN_AFTER_CRASH'].includes(r.state)).map(r => ({ stage: r.stage, attempt: r.attempt, state: r.state })).slice(-3), retry: { build: runsB.length, package: runsP.length },
      invalidation: inv ? { stage: inv.stage, reason: String(inv.reason ?? '').slice(0, 120), status: inv.status } : null, current: { source: cur.source.status, dependencies: cur.dependencies.status, build: cur.build.status, package: cur.package.status }, provenance: ver && ver.build?.ok !== false && ver.package?.ok !== false ? 'CURRENT_RUN_VERIFIED' : ver ? 'ARTIFACT_PROVENANCE_UNKNOWN' : 'NOT_VERIFIED', scopeLabel: scopeLabelOf() }
    const stages = { ...(exec.stages ?? {}), build: bs, package: ps, verifyArtifact: verifyStatus }
    exec = update(execId, { stages, lineage }, 'LINEAGE_REFRESHED')
    return { exec, cur, lineage, claims: deriveClaims({ sourceValidated: exec.stages?.validateSource?.status === 'PASS' && exec.state === 'VERIFIED_SOURCE' && cur.source.status === 'CURRENT', stages }), now: now0 } // a stale source is no longer 'source validated' NOW
  }
  /** What a pass here establishes: only the isolated fixture is labelled ISOLATED_*; a live workspace pipeline is labelled as such. Neither is installed acceptance. */
  const scopeLabelOf = () => (pipeline.kind === 'isolated-fixture' ? 'ISOLATED_FIXTURE' : 'LIVE_WORKSPACE_BLUEPRINT')
  const claimPrefix = () => (pipeline.kind === 'isolated-fixture' ? 'ISOLATED_' : 'BLUEPRINT_')
  const emitStageEvent = exec => { try { const rc = coreFor(exec.binding.workspaceId).core.readReceipt(exec.runId); return emitOutcome(exec, rc, 'VERIFIED_SOURCE') } catch { return 'NO_EVENT' } }
  async function runCheckFor(id, args) {
    const e = host.checks.get(id); if (!e) return { status: 'ERROR' }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), e.timeoutMs)
    try { return await e.run({ ...args, signal: ctl.signal }) } finally { clearTimeout(timer) }
  }
  const lineageView = async (execId, opts) => {
    const r = await refreshLineage(execId, opts), chain = engine.verifyChain(execId)
    const history = engine.listReceipts(execId).map(x => ({ id: x.id, kind: x.kind, broken: x.broken, at: x.rec?.at ?? null, status: x.rec?.body?.status ?? x.rec?.body?.state ?? null, inputDigest: x.rec?.body?.inputDigest ?? null, digest: x.rec?.digest ?? null }))
    return { execId, scopeLabel: r.lineage.scopeLabel, current: r.cur, lineage: r.lineage, claims: { ...r.claims, labels: [r.claims.sourceValidated && `${claimPrefix()}SOURCE_VALIDATED`, r.claims.built && `${claimPrefix()}BUILD_VERIFIED`, r.claims.packaged && `${claimPrefix()}PACKAGE_VERIFIED`].filter(Boolean) }, notClaimed: ['WAR_ROOM_DESKTOP_BUILD', 'PRODUCTION_PACKAGE', 'INSTALLED_RUNTIME', 'TASK_COMPLETE', 'DEPLOYMENT'], history, chain }
  }

  const api = {
    /** Intake + review creation. Context comes from the HOST (mission adapter), never from the package. */
    importPackage(token, raw, ctx) {
      const actor = actorFor(token, 'import')
      if (!ctx || typeof ctx !== 'object' || Object.keys(ctx).some(k => !CTX_KEYS.includes(k) && !CTX_OPTIONAL.includes(k)) || CTX_KEYS.some(k => !(k in ctx))) refuse('BINDING_MISMATCH', 'broker', 'Execution context must be exactly missionId, assignmentId, workspaceId, requestingSubsystem (+ optional workerId)')
      if (ctx.workerId !== undefined) idStr(ctx.workerId, 'workerId')
      const binding = Object.fromEntries(CTX_KEYS.map(k => [k, idStr(ctx[k], k)]))
      const ownerF = assignmentOk(binding, actor, 'import')
      if (ctx.workerId !== undefined && ownerF?.ownerId !== ctx.workerId) refuse('WORKER_MISMATCH', 'broker', 'Requesting worker is not the assignment owner') // the caller's claim must match what the host proves
      const { core } = coreFor(binding.workspaceId)
      const view = core.preview(raw) // schema + preflight; refuses wrong workspace/forged fields/etc.
      if (ownerF) scopeFor(ownerF, raw) // package write scope must lie inside the mission write set (never widened)
      { const bq = JSON.parse(raw).build; if (bq && (!pipeline || bq.recipeId !== pipeline.recipe('build')?.id || bq.recipeVersion !== pipeline.recipe('build')?.version)) refuse('UNAPPROVED_RECIPE', 'broker', 'The requested build recipe is not a host-registered recipe id/version') } // a package may only REQUEST a known recipe
      const execId = randomUUID(), packageId = JSON.parse(raw).id, normalized = canonical(JSON.parse(raw)), importedBy = { actorId: actor.actorId, role: actor.role, sessionId: actor.sessionId }
      const full = { ...binding, packageId }
      for (const [name, body, mode] of [['raw', raw, 0o400], ['normalized.json', normalized, 0o400]]) { const fd = fs.openSync(P('packages', `${execId}.${name}`), 'wx', mode); try { fs.writeFileSync(fd, body); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
      createExclusive(P('packages', `${execId}.pkg.json`), JSON.stringify(signer.seal({ execId, rawHash: hash(raw), normalizedHash: view.digest, normalizedFileHash: hash(normalized), reviewId: view.reviewId, binding: full, importedBy, importedAt: now() })))
      let exec = { execId, rawHash: hash(raw), normalizedHash: view.digest, bindingHash: hash(canonical(full)), reviewId: view.reviewId, state: 'PREVIEWED', runId: null, lease: null, approval: null, stages: {}, recoveries: 0, seq: 0, history: [], binding: full, requestedBy: importedBy }
      exec = saveExec(exec, 'IMPORTED')
      return { execId, preview: view, projection: projectionOf(exec, null) }
    },
    preview(token, execId) {
      const exec = readable(token, execId)
      if (['PREVIEWED', 'APPROVED'].includes(exec.state)) return coreFor(exec.binding.workspaceId).core.reviewView(exec.reviewId) // live: re-evaluates staleness
      const { raw } = loadPackage(execId), p = JSON.parse(raw) // historical: from the immutable stored package; staleness is NOT re-evaluated
      return { execId, state: exec.state, historical: true, digest: exec.normalizedHash, rawHash: exec.rawHash, packageId: p.id, goal: p.goal, changes: p.changes.map(c => ({ path: c.path, operation: c.operation, beforeHash: c.beforeHash, afterHash: hash(c.content) })), checks: p.checks, note: 'Historical view of the immutable imported package; not re-validated against the current workspace.' }
    },
    /** Commander approval request: server-issued, bound to the exact package digest, actor, session, mission binding and check implementations. */
    approve(token, execId, ctx, { requestId } = {}) {
      const actor = actorFor(token, 'approve'), pre = loadExec(execId); ctxOk(ctx, pre.binding); assignmentOk(pre.binding, actor, 'approve') // authority is checked on EVERY call, before request-id dedupe
      return once(requestId, 'approve', execId, () => {
        let exec = loadExec(execId)
        requireState(exec, ['PREVIEWED'], 'approve')
        const { core } = coreFor(exec.binding.workspaceId), view = core.reviewView(exec.reviewId)
        if (view.digest !== exec.normalizedHash) refuse('APPROVAL_MISMATCH', 'approval', 'Review no longer matches the imported package')
        const ownerF = ownerGate(exec.binding, 'approve'), own = ownerF ? ownershipOf(ownerF, scopeFor(ownerF, loadPackage(execId).raw)) : null // approval binds WHO owns the work and the effective write scope
        const base = baseNow(exec.binding.workspaceId) // approval is bound to the base identity the Commander saw; an unproven identity cannot be approved
        const handle = core.approve(exec.reviewId, view.digest, actor.actorId)
        atomicWrite(secretPath(execId), handle, 0o600)
        const approval = { approvedBy: { actorId: actor.actorId, role: actor.role, sessionId: actor.sessionId }, approvedAt: now(), expiresAt: now() + approvalTtlMs, checkBinding: view.checkBinding, baseIdentity: base, ownership: own, pipeline: pipeline ? pipeline.binding() : null, approvalRef: hash(handle).slice(0, 16) }
        exec = saveExec({ ...exec, state: 'APPROVED', approval: { ...approval, bindingHash: approvalBindingHash(exec, approval) } }, 'APPROVED')
        return projectionOf(exec, null)
      })
    },
    async execute(token, execId, ctx, { requestId } = {}) {
      const actor = actorFor(token, 'execute'); stoppedCheck(); const pre = loadExec(execId); ctxOk(ctx, pre.binding); assignmentOk(pre.binding, actor, 'execute')
      return once(requestId, 'execute', execId, async () => {
        let exec = loadExec(execId)
        requireState(exec, ['APPROVED'], 'execute')
        const a = exec.approval
        if (a.bindingHash !== approvalBindingHash(exec, a)) refuse('BINDING_MISMATCH', 'approval', 'Approval no longer matches the immutable package binding')
        if (a.approvedBy.actorId !== actor.actorId || a.approvedBy.sessionId !== actor.sessionId) {
          let allowed = false; try { allowed = policy.allowApprovalTransfer?.({ ...a.approvedBy }, { actorId: actor.actorId, role: actor.role, sessionId: actor.sessionId }, { execId, binding: exec.binding }) === true } catch { allowed = false }
          if (!allowed) refuse(a.approvedBy.actorId !== actor.actorId ? 'ACTOR_MISMATCH' : 'SESSION_MISMATCH', 'approval', 'Approval belongs to a different actor/session')
        }
        if (now() > a.expiresAt) refuse('APPROVAL_EXPIRED', 'approval', 'Approval expired')
        const ownerF = ownerGate(exec.binding, 'execute'), ownNow = ownerF ? ownershipOf(ownerF, scopeFor(ownerF, loadPackage(execId).raw)) : null // scope shrink => WRITE_SCOPE_DENIED; rebinding => OWNERSHIP_CHANGED; both BEFORE the approval is consumed
        if ((ownNow?.digest ?? null) !== (a.ownership?.digest ?? null)) refuse('OWNERSHIP_CHANGED', 'approval', 'Mission/assignment ownership changed since approval; preview and approve again')
        if ((pipeline ? pipeline.binding() : null) !== (a.pipeline ?? null)) refuse('TOOL_DRIFT', 'approval', 'The host build pipeline (recipes/policy/stage checks) changed since approval; preview and approve again')
        const baseCur = baseNow(exec.binding.workspaceId) // base moved/rebound since approval => refuse BEFORE the approval is consumed or any lease is taken
        if (baseCur.digest !== a.baseIdentity?.digest) refuse('BASE_REVISION_MISMATCH', 'approval', 'Workspace base identity changed since approval; preview and approve again', { observed: recoveryClassOf(baseClassify(a.baseIdentity, exec.binding.workspaceId) ?? 'UNKNOWN') })
        const entry = coreFor(exec.binding.workspaceId), { core, slot } = entry, view = core.reviewView(exec.reviewId)
        const nowBinding = checkBindingNow(exec.binding.workspaceId, view)
        if (nowBinding !== a.checkBinding) refuse('CHECK_DRIFT', 'approval', 'A registered check changed after approval', { expected: a.checkBinding, observed: nowBinding })
        const handleFile = secretPath(execId), coreHandle = fs.readFileSync(handleFile, 'utf8').trim()
        const lease = leases.acquire({ workspaceId: exec.binding.workspaceId, holder: holderFor(exec.binding), meta: { missionId: exec.binding.missionId } }); setSlot({ slot }, lease, exec.binding)
        const runId = randomUUID(), info = leases.info(lease)
        exec = update(execId, { executedBy: { actorId: actor.actorId, role: actor.role, sessionId: actor.sessionId }, state: 'RUNNING', runId, baseIdentity: baseCur, ownership: ownNow, lease: leaseRecord(info, exec.binding) }, 'RUN_STARTING') // durable BEFORE any effect
        active.add(execId); entry.authority = authorityFor(exec)
        try {
          let receipt
          try { receipt = await core.execute(exec.reviewId, coreHandle, { runId }) } catch (e) {
            let consumed = false; try { consumed = control.approvals.load(coreHandle)?.consumed != null } catch { consumed = true }
            const rr = (() => { try { return core.readReceipt(runId) } catch { return null } })()
            if (rr) receipt = rr
            else if (!consumed) { update(execId, { state: 'APPROVED', runId: null, lease: null, lastError: describeError(e) }, 'REFUSED_BEFORE_RUN'); throw e }
            else { const f = update(execId, { state: 'FAILED_BEFORE_RUN', lastError: describeError(e) }, 'FAILED_BEFORE_RUN'); emitOutcome(f, null, 'FAILED_BEFORE_RUN'); throw e }
          }
          return (await finalize(exec, receipt)).projection
        } finally { active.delete(execId); entry.authority = null; leases.release(lease); slot.clear() }
      })
    },
    /** PAUSE: no new consequential step begins; the current step finishes; durable across restart. */
    pause(token, execId, ctx, { reason = '' } = {}) {
      const actor = actorFor(token, 'pause'); const exec = loadExec(execId); ctxOk(ctx, exec.binding); assignmentOk(exec.binding, actor, 'pause')
      if (TERMINAL.has(exec.state)) refuse('BROKER_STATE', 'broker', 'Execution is already terminal')
      const rec = exec.runId ? control.pauses.request({ runId: exec.runId, actor: actor.actorId, reason }) : control.pauses.request({ reviewId: exec.reviewId, actor: actor.actorId, reason })
      saveExec(exec, 'PAUSE_REQUESTED'); return { requested: true, kind: rec.kind, seq: rec.seq }
    },
    /** RESUME from durable state: Commander authority + valid lease + SAFE_TO_RESUME + stable base + reconciled effects (core enforces the last three). */
    async resume(token, execId, ctx, { requestId } = {}) {
      const actor = actorFor(token, 'resume'); stoppedCheck(); const pre = loadExec(execId); ctxOk(ctx, pre.binding); assignmentOk(pre.binding, actor, 'resume')
      return once(requestId, 'resume', execId, async () => {
        let exec = loadExec(execId); requireState(exec, ['PAUSED'], 'resume'); ownershipRecheck(exec, 'resume'); baseGate(exec, 'RESUME')
        const entry = coreFor(exec.binding.workspaceId), { core, slot } = entry, lease = takeLease({ slot }, exec, exec.binding.workspaceId, holderDeadFor(exec), { checkBase: true })
        try {
          const h = core.approveResume(exec.runId, actor.actorId) // refuses unless classification is SAFE_TO_RESUME
          control.pauses.clear({ runId: exec.runId, actor: actor.actorId }); control.pauses.clear({ reviewId: exec.reviewId, actor: actor.actorId })
          const info = leases.info(lease); exec = update(execId, { lastActionBy: { actorId: actor.actorId, role: actor.role, sessionId: actor.sessionId }, state: 'RUNNING', recoveries: (exec.recoveries ?? 0) + 1, lease: leaseRecord(info, exec.binding) }, 'RESUME_STARTING')
          active.add(execId); entry.authority = authorityFor(exec)
          try { return (await finalize(exec, await core.resumeRun(exec.runId, h))).projection } finally { active.delete(execId); entry.authority = null }
        } finally { leases.release(lease); slot.clear() }
      })
    },
    /** CANCEL: no new work; disposition (ROLLBACK default, RETAIN only if host policy allows) is explicit and receipted. */
    cancel(token, execId, ctx, { reason = '', disposition = 'ROLLBACK', requestId } = {}) {
      const actor = actorFor(token, 'cancel'), pre = loadExec(execId); ctxOk(ctx, pre.binding); assignmentOk(pre.binding, actor, 'cancel')
      return once(requestId, 'cancel', execId, () => {
        let exec = loadExec(execId)
        if (TERMINAL.has(exec.state)) refuse('BROKER_STATE', 'broker', 'Execution is already terminal')
        let retainOk = false; try { retainOk = policy.allowRetain?.({ ...actor }, { execId, binding: exec.binding }) === true } catch { retainOk = false }
        const effective = disposition === 'RETAIN' && retainOk ? 'RETAIN' : 'ROLLBACK'
        const target = exec.runId ? { runId: exec.runId } : { reviewId: exec.reviewId }
        const req = control.cancels.request({ ...target, actor: actor.actorId, reason, disposition: effective })
        exec = saveExec(exec, 'CANCEL_REQUESTED')
        if (active.has(execId)) return { requested: true, observedBy: 'running-execution', disposition: req.disposition, state: exec.state }
        if (!exec.runId) { exec = update(execId, { state: 'CANCELLED_NO_CHANGES', terminalStatus: 'CANCELLED_NO_CHANGES' }, 'CANCELLED_BEFORE_START'); emitOutcome(exec, null, exec.state); return projectionOf(exec, null) }
        if (req.disposition === 'RETAIN') return { requested: true, disposition: 'RETAIN', state: exec.state, note: 'Applied work retained for operator decision; use restore to roll back' }
        return { requested: true, disposition: 'ROLLBACK', state: exec.state, note: 'Run is not active; use restoreRun under a lease to apply the rollback disposition' }
      })
    },
    /** STOP: the worker takes no new work; in-flight runs hold at their next safe boundary (PAUSED); no terminal state is mutated. */
    stop(token, { reason = '' } = {}) { const actor = actorFor(token, 'stop'); return { kind: control.pauses.request({ global: true, kind: 'STOP', actor: actor.actorId, reason }).kind } },
    start(token) { const actor = actorFor(token, 'stop'); return { cleared: control.pauses.clear({ global: true, actor: actor.actorId }) } },
    /** Read-only summaries of the executions this actor may read (newest first). Never exposes raw package content, handles or credentials. */
    list(token) {
      const actor = actorFor(token, 'read'), out = []
      for (const name of fs.readdirSync(path.join(B, 'exec')).filter(n => n.endsWith('.json'))) {
        const execId = name.slice(0, -5)
        try {
          const x = loadExec(execId); let ok = true; try { ok = policy.canRead ? policy.canRead({ ...actor }, { ...x.binding }) === true : true } catch { ok = false }
          if (ok) out.push({ execId, packageId: x.binding.packageId, state: x.state, binding: { missionId: x.binding.missionId, assignmentId: x.binding.assignmentId, workspaceId: x.binding.workspaceId, requestingSubsystem: x.binding.requestingSubsystem }, importedAt: x.history?.[0]?.at ?? null, approved: !!x.approval, runId: x.runId ?? null })
        } catch { out.push({ execId, state: 'UNREADABLE' }) }
      }
      return out.sort((a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0))
    },
    /** Read-only approval view for the Commander UI: exactly what the approval is bound to, what those inputs are NOW, and which changed (=> STALE: a new approval is required). */
    approvalState(token, execId) {
      const exec = readable(token, execId), a = exec.approval
      if (!a) return { approved: false, state: exec.state, usable: false, stale: [] }
      const cur = { baseIdentity: null, checkBinding: null, ownership: null, pipeline: pipeline ? pipeline.binding() : null }
      try { cur.baseIdentity = baseNow(exec.binding.workspaceId).digest } catch { cur.baseIdentity = null }
      try { cur.checkBinding = host.checks.bindingFor(pkgOf(execId).checks.map(c => ({ id: c.id, version: c.version }))) } catch { cur.checkBinding = null }
      if (strict) { try { const f = ownerFacts(exec.binding); cur.ownership = f?.complete ? ownershipOf(f, scopeFor(f, loadPackage(execId).raw)).digest : null } catch { cur.ownership = null } }
      const bound = { packageDigest: exec.normalizedHash, baseIdentity: a.baseIdentity?.digest ?? null, checkBinding: a.checkBinding ?? null, ownership: a.ownership?.digest ?? null, pipeline: a.pipeline ?? null, holder: holderFor(exec.binding) }
      const stale = ['baseIdentity', 'checkBinding', 'ownership', 'pipeline'].filter(k => (bound[k] ?? null) !== (cur[k] ?? null))
      const expired = now() > a.expiresAt
      return { approved: true, state: exec.state, approvedBy: { ...a.approvedBy }, approvedAt: a.approvedAt, expiresAt: a.expiresAt, expired, consumed: exec.state !== 'APPROVED', bound, current: cur, stale, usable: exec.state === 'APPROVED' && !expired && stale.length === 0 }
    },
    status(token, execId) {
      const exec = readable(token, execId); let receipt = null
      if (exec.runId) { try { receipt = coreFor(exec.binding.workspaceId).core.readReceipt(exec.runId) } catch { receipt = null } }
      return projectionOf(exec, receipt)
    },
    /** Run the next authorized stage(s) (build, then package) as REAL bounded host-owned recipes. Commander + live ownership + valid lease; never installs; stops at the first non-PASS stage. */
    async advanceStages(token, execId, ctx, { requestId } = {}) {
      const actor = actorFor(token, 'build'); stoppedCheck(); const pre = loadExec(execId); ctxOk(ctx, pre.binding); assignmentOk(pre.binding, actor, 'execute')
      return once(requestId, 'advance', execId, async () => {
        if (!engine) refuse('STAGE_NOT_AUTHORIZED', 'build', 'The host provides no build pipeline')
        let exec = loadExec(execId); const a = exec.approval
        if (exec.state !== 'VERIFIED_SOURCE' || exec.stages?.validateSource?.status !== 'PASS' || exec.stages?.baseIdentity?.status !== 'PASS' || exec.stages?.checkBinding?.status !== 'PASS') refuse('BROKER_STATE', 'build', 'Stages require validated source (VERIFIED_SOURCE with PASS source, base-identity and check-binding gates)')
        const p = pkgOf(execId); if (!p.build) refuse('STAGE_NOT_AUTHORIZED', 'build', 'The package did not request a host build recipe')
        const rb = pipeline.recipe('build'); if (p.build.recipeId !== rb.id || p.build.recipeVersion !== rb.version) refuse('UNAPPROVED_RECIPE', 'build', 'Requested recipe is not the registered recipe')
        if (a?.pipeline !== pipeline.binding()) refuse('TOOL_DRIFT', 'build', 'The host build pipeline changed since approval; preview and approve again')
        if (engine.cancelState(execId)) refuse('CANCELLED', 'build', 'Build/package work was cancelled for this execution')
        const src = engine.receipts(execId, 'SOURCE').at(-1); if (!src) refuse('BROKER_STATE', 'build', 'No source receipt exists for this execution')
        const nowSrc = sourceComponents(exec, p), changed = Object.keys(nowSrc).filter(k => canonical(nowSrc[k]) !== canonical(src.rec.body.components[k] ?? null)); if (changed.length) refuse('APPROVAL_STALE', 'build', `Source-level inputs changed since validation (${changed.join(', ')}); re-validate the source`, { observed: changed })
        const lease = leases.acquire({ workspaceId: exec.binding.workspaceId, holder: holderFor(exec.binding), meta: { missionId: exec.binding.missionId } })
        const poll = () => { if (!leases.heartbeat(lease)) return 'LEASE_LOST'; const au = authorityFor(exec)('stage'); return au ? au.reason : null } // heartbeat = verify + extend: a long stage must not outlive its own lease, and a lost lease stops the stage
        const results = []
        try {
          for (const stage of ['build', 'package']) {
            if (!pipeline.has(stage)) continue
            if (engine.cancelState(execId)) break
            const recipe = pipeline.recipe(stage), wsRoot = wsRootOf(exec.binding)
            let input, binds, inDir = null, upstream = null, inputNow
            if (stage === 'build') {
              const dep = await depResult(exec, p, recipe); const last = engine.receipts(execId, 'DEPENDENCIES').at(-1)
              if (!last || last.rec.body.digest !== dep.digest) engine.appendReceipt(execId, 'DEPENDENCIES', { digest: dep.digest, allUsable: dep.allUsable, counts: dep.counts, deps: dep.deps.map(d => ({ name: d.name, version: d.version, state: d.state, reasons: d.reasons })) })
              if (!dep.allUsable) refuse('DEPENDENCY_PLAN_REQUIRED', 'build', 'Dependencies are not VERIFIED_USABLE in the build environment; blueprint execution never installs or fetches', { observed: dep.counts })
              input = withDigest(buildComponents(exec, p, recipe, dep)); const c = input.components
              binds = { packageDigest: c.packageDigest, baseIdentityDigest: c.baseIdentityDigest, checkBinding: c.checkBinding, sourceDigest: hash(canonical({ packageDigest: c.packageDigest, sourceHashes: c.sourceHashes, inputTree: c.inputTree, baseIdentityDigest: c.baseIdentityDigest })), buildDigest: hash(canonical({ recipeDigest: c.recipeDigest, envDigest: c.envDigest, dependencyDigest: c.dependencyDigest, checkBinding: c.checkBinding })), inputDigest: input.digest, dependencyDigest: c.dependencyDigest, recipeDigest: c.recipeDigest, envDigest: c.envDigest }
              inputNow = async () => withDigest(buildComponents(exec, p, recipe, await depResult(exec, p, recipe)))
            } else {
              const view = await lineageView(execId); if (view.current.build.status !== 'CURRENT') refuse('BUILD_NOT_CURRENT', 'build', `The build is ${view.current.build.status} for the present inputs; rebuild before packaging`, { observed: view.current.build.status })
              const ver = engine.verifyArtifacts(execId); if (ver.build && !ver.build.ok) refuse('ARTIFACT_MISMATCH', 'build', 'Build artifacts failed re-verification; packaging refused', { observed: ver.build.problems.slice(0, 3).map(x => x.code) })
              const br = engine.receipts(execId, 'BUILD').filter(r => r.rec.body.status === 'PASSED').at(-1), brun = engine.runsFor(execId, 'build').find(r => r.runId === br.rec.body.runId)
              inDir = engine.outDirOf(brun); upstream = { buildReceiptId: br.id, buildManifestDigest: br.rec.body.manifest.manifestDigest }
              input = withDigest(packageComponents(execId, recipe)); const bc = br.rec.body.components
              binds = { packageDigest: bc.packageDigest, baseIdentityDigest: bc.baseIdentityDigest, checkBinding: bc.checkBinding, sourceDigest: br.rec.body.manifest.binds.sourceDigest, buildDigest: hash(canonical({ recipeDigest: recipe.digest, upstreamManifestDigest: upstream.buildManifestDigest })), upstreamManifestDigest: upstream.buildManifestDigest, inputDigest: input.digest, recipeDigest: recipe.digest, envDigest: input.components.envDigest, dependencyDigest: bc.dependencyDigest }
              inputNow = async () => { const cv = await nowInputs(exec, p); const b2 = cv.build.digest !== br.rec.body.inputDigest; return withDigest({ ...packageComponents(execId, recipe), ...(b2 ? { buildInputDigest: cv.build.digest } : {}) }) }
            }
            if (!leases.heartbeat(lease)) refuse('LEASE_LOST', 'lease', 'The workspace lease was lost before the stage could start')
            const r = await engine.runStage({ execId, stage, recipe, input, workspaceRoot: wsRoot, inDir, binds, upstream, inputNow, poll, stageChecks: pipeline.stageChecks(stage), runCheck: (id, args) => runCheckFor(id, { ...args, inDir }), scopeLabel: scopeLabelOf() })
            results.push({ stage, reused: r.reused, status: r.run.state, attempt: r.run.attempt, receiptId: r.run.receiptId })
            if (r.run.state !== 'PASSED') break
          }
          if (engine.receipts(execId, 'BUILD').some(r => r.rec.body.status === 'PASSED')) engine.verifyArtifacts(execId) // post-production verification, recorded as a VERIFICATION receipt
        } finally { try { leases.release(lease) } catch { /* released or lost */ } }
        const view = await lineageView(execId, { record: true }); emitStageEvent(loadExec(execId))
        return { ...view, ran: results }
      })
    },
    /** Durable build/package cancellation: persists first, stops future stages, signals the running host process (ours or, after a restart, a verified-alive foreign pid) and records the acknowledgement. */
    async cancelBuild(token, execId, ctx, { reason = '' } = {}) {
      const actor = actorFor(token, 'cancel'); const pre = loadExec(execId); ctxOk(ctx, pre.binding); if (!engine) refuse('STAGE_NOT_AUTHORIZED', 'build', 'The host provides no build pipeline')
      const f = ownerFacts(pre.binding); if (strict && !f?.complete) refuse('OWNERSHIP_UNAVAILABLE', 'ownership', 'Ownership could not be proven'); // cancel needs a provable owner but is allowed in any non-terminal OR terminal host state: stopping work is always permitted
      const c = await engine.cancel({ execId, actor: actor.actorId, reason }); await refreshLineage(execId, { record: false }); emitStageEvent(loadExec(execId)); return { state: c.state, ack: c.ack, requestedBy: c.requestedBy }
    },
    /** Operator decision about an UNKNOWN_AFTER_CRASH (or non-retryable FAILED) attempt: RETRY authorizes exactly one new attempt; outputs of the unknown run are never adopted. */
    reconcileStage(token, execId, ctx, stage, { decision, reason = '' } = {}) {
      const actor = actorFor(token, 'recover'); const pre = loadExec(execId); ctxOk(ctx, pre.binding); assignmentOk(pre.binding, actor, 'reconcile'); if (!engine || !['build', 'package'].includes(stage)) refuse('STAGE_NOT_AUTHORIZED', 'build', 'Unknown stage')
      const r = engine.reconcile({ execId, stage, actor: actor.actorId, decision, reason }); return { receiptId: r.id, decision, stage }
    },
    /** AUTHORITATIVE current build/package state (never a cached success): recomputes every bound input; history stays queryable. */
    async lineage(token, execId) { readable(token, execId); if (!engine) refuse('STAGE_NOT_AUTHORIZED', 'build', 'The host provides no build pipeline'); return lineageView(execId, { record: false }) },
    /** Commander: re-derive current state, APPEND invalidation observations, refresh summaries, emit a Phase 9 event. */
    async refreshLineage(token, execId) { actorFor(token, 'build'); const pre = loadExec(execId); if (!engine) refuse('STAGE_NOT_AUTHORIZED', 'build', 'The host provides no build pipeline'); const v = await lineageView(execId, { record: true }); emitStageEvent(loadExec(execId)); void pre; return v },
    /** Re-verify artifacts on disk now; appends a VERIFICATION receipt when the result differs from the last one. */
    async verifyArtifacts(token, execId) { actorFor(token, 'build'); if (!engine) refuse('STAGE_NOT_AUTHORIZED', 'build', 'The host provides no build pipeline'); const r = engine.verifyArtifacts(execId); const v = await lineageView(execId, { record: true }); emitStageEvent(loadExec(execId)); return { ...r, current: v.current } },
    /** Read-only artifact manifest view (newest PASSED build/package receipt) plus the newest recorded VERIFICATION result. Does NOT re-verify; use verifyArtifacts for that. Out-dir absolute paths are never returned. */
    artifactManifest(token, execId) {
      readable(token, execId); if (!engine) return { stages: {}, verification: null }
      const pick = e => ({ name: e.name ?? e.path, path: e.path, kind: e.kind ?? null, sha256: e.sha256 ?? null, bytes: e.bytes ?? null, runId: e.runId ?? null, sourceDigest: e.sourceDigest ?? null, dependencyDigest: e.dependencyDigest ?? null, recipeDigest: e.recipeDigest ?? null, envDigest: e.envDigest ?? null })
      const stages = {}
      for (const [k, kind] of [['build', 'BUILD'], ['package', 'PACKAGE']]) {
        const last = engine.receipts(execId, kind).filter(r => r.rec.body.status === 'PASSED').at(-1)
        stages[k] = last ? { receiptId: last.id, runId: last.rec.body.runId ?? null, manifestDigest: last.rec.body.manifest?.manifestDigest ?? null, entries: (last.rec.body.manifest?.entries ?? []).map(pick) } : null
      }
      const v = engine.receipts(execId, 'VERIFICATION').at(-1)
      return { stages, verification: v ? { receiptId: v.id, at: v.rec.body.at ?? null, build: v.rec.body.build ?? null, package: v.rec.body.package ?? null } : null }
    },
    /** Read-only view of stage runs: state, activity timestamps, bounded structured progress (null when the recipe has none), process liveness (never the raw pid). */
    stageRuns(token, execId) {
      readable(token, execId); if (!engine) return []
      return ['build', 'package'].flatMap(stage => engine.runsFor(execId, stage)).map(r => ({ stage: r.stage, attempt: r.attempt, state: r.state, effectId: r.effectId, startedAt: r.startedAt ?? null, lastActivityAt: r.lastActivityAt ?? null, lastHeartbeatAt: r.lastHeartbeatAt ?? null, lastOutputAt: r.lastOutputAt ?? null, elapsedMs: r.elapsedMs ?? null, progress: r.progress ?? null, processState: ['STARTING', 'RUNNING'].includes(r.state) ? procState(r.pid, r.procToken) : null, processAlive: ['STARTING', 'RUNNING'].includes(r.state) ? (ps => (ps === 'ALIVE' ? true : ps === 'DEAD' ? false : null))(procState(r.pid, r.procToken)) : null, failureCode: r.failureCode ?? null, receiptId: r.receiptId ?? null, outputs: r.outputs ?? null }))
    },
    /** Read-only crash classification for every execution that has stage runs. */
    async recoverStages(token) {
      actorFor(token, 'read'); if (!engine) return []; const out = []
      for (const name of fs.readdirSync(path.join(B, 'exec')).filter(n => n.endsWith('.json'))) {
        let exec; try { exec = loadExec(name.slice(0, -5)) } catch { continue }
        if (!engine.runsFor(exec.execId, 'build').length && !engine.runsFor(exec.execId, 'package').length) continue
        const p = pkgOf(exec.execId), now0 = await nowInputs(exec, p), row = { execId: exec.execId, cancellation: engine.cancelState(exec.execId) }
        for (const stage of ['build', 'package']) if (pipeline.has(stage)) row[stage] = engine.classify({ execId: exec.execId, stage, inputDigest: (stage === 'build' ? now0.build : now0.package).digest, recipe: pipeline.recipe(stage) })
        out.push(row)
      }
      return out
    },
    getReceipt(token, execId) { const exec = readable(token, execId); if (!exec.runId) refuse('BROKER_STATE', 'broker', 'No run yet'); return coreFor(exec.binding.workspaceId).core.readReceipt(exec.runId) },
    assertHolderDead(token, execId, { leaseId, evidence }) {
      const actor = actorFor(token, 'assert'); const exec = loadExec(execId)
      if (!exec.lease || exec.lease.leaseId !== leaseId) refuse('BINDING_MISMATCH', 'broker', 'Assertion does not name this execution\'s lease')
      if (typeof evidence !== 'string' || evidence.length < 5 || evidence.length > 500) refuse('INVALID_PACKAGE', 'broker', 'Evidence of holder death required')
      createExclusive(P('assertions', `${execId}.json`), JSON.stringify(signer.seal({ execId, leaseId, assertedBy: actor.actorId, sessionId: actor.sessionId, evidence, at: now() })))
      return { asserted: true }
    },
    /** READ-ONLY scan of durable non-terminal executions after a broker restart. Never mutates workspace, stores or states. */
    recoverAll(token) {
      actorFor(token, 'read'); const out = []
      for (const name of fs.readdirSync(path.join(B, 'exec')).filter(n => n.endsWith('.json'))) {
        let exec; try { exec = loadExec(name.slice(0, -5)) } catch (e) { out.push({ execId: name.slice(0, -5), classification: 'NEEDS_OPERATOR_REVIEW', reasons: [e instanceof BlueprintError ? `${e.code}: ${e.message}` : 'unreadable'] }); continue }
        if (TERMINAL.has(exec.state)) continue
        if (!exec.runId) { out.push({ execId: exec.execId, state: exec.state, classification: 'NOT_STARTED', reasons: ['no run was started'] }); continue }
        let cls; try { cls = coreFor(exec.binding.workspaceId).core.classifyRun(exec.runId) } catch (e) { cls = { classification: 'NEEDS_OPERATOR_REVIEW', reasons: [describeError(e).code] } }
        out.push({ execId: exec.execId, state: exec.state, runId: exec.runId, classification: cls.classification, reasons: cls.reasons, allowed: cls.allowed ?? [], requiresReconcile: !!cls.requiresReconcile, base: (c => ({ classification: c, recovery: c === null ? null : recoveryClassOf(c) }))(baseClassify(exec.baseIdentity ?? exec.approval?.baseIdentity, exec.binding.workspaceId)), authority: strict ? (() => { try { ownershipRecheck(exec, 'resume'); return { resume: 'PERMITTED' } } catch (e) { return { resume: 'REFUSED', code: e.code ?? 'UNKNOWN', observed: e.observed ?? null } } })() : null, orphaned: exec.state === 'RUNNING' && !active.has(exec.execId) })
      }
      return out
    },
    /** Authorised recovery step: Commander + valid lease (holder-death assertion when the old lease is still valid) + core classification gates. */
    async recoverRun(token, execId, action, ctx, { requestId } = {}) {
      const actor = actorFor(token, 'recover'); stoppedCheck()
      if (!['RECONCILE', 'RESTORE', 'RESUME'].includes(action)) refuse('BROKER_STATE', 'broker', 'Unknown recovery action')
      const pre = loadExec(execId); ctxOk(ctx, pre.binding); assignmentOk(pre.binding, actor, action.toLowerCase())
      return once(requestId, `recover:${action}`, execId, async () => {
        let exec = loadExec(execId)
        if (!exec.runId) refuse('BROKER_STATE', 'broker', 'Execution has no run to recover'); // An incomplete rollback (e.g. lease lost mid-run: rollback deferred) is terminal for resume/reconcile but MUST remain restorable under a fresh lease.
        if (TERMINAL.has(exec.state) && !(action === 'RESTORE' && RESTORABLE.has(exec.state))) refuse('BROKER_STATE', 'broker', 'Execution is already terminal')
        if (active.has(execId)) refuse('WORKSPACE_BUSY', 'broker', 'Execution is active in this broker')
        ownershipRecheck(exec, action.toLowerCase()) // host authority is re-read after any restart/crash: cancelled/retired/completed/rebound/scope-changed => refuse
        baseGate(exec, action)
        const entry = coreFor(exec.binding.workspaceId), { core, slot } = entry, lease = takeLease({ slot }, exec, exec.binding.workspaceId, holderDeadFor(exec), { checkBase: action === 'RESUME' })
        try {
          if (action === 'RECONCILE') { const r = core.reconcileRun(exec.runId, actor.actorId); exec = update(execId, { recoveries: (exec.recoveries ?? 0) + 1 }, 'RECONCILED'); return { action, outcomes: r.outcomes, classificationAfter: r.classificationAfter } }
          if (action === 'RESTORE') {
            const r = core.restoreRun(exec.runId, actor.actorId), cancelled = control.cancels.find({ runId: exec.runId, reviewId: exec.reviewId })
            const state = r.final === 'RESTORED' ? (cancelled ? 'CANCELLED_ROLLED_BACK' : 'RECOVERED_ROLLED_BACK') : (cancelled ? 'CANCELLED_ROLLBACK_INCOMPLETE' : 'ROLLBACK_INCOMPLETE')
            exec = update(execId, { state, terminalStatus: TERMINAL.has(state) ? state : null, recoveries: (exec.recoveries ?? 0) + 1 }, 'RESTORED')
            const receipt = core.readReceipt(exec.runId); exec = update(execId, { outcomeEmission: emitOutcome(exec, { ...receipt, error: receipt.error ?? { code: cancelled ? 'CANCELLED' : 'INTERRUPTED_RUN', stage: 'recovery' }, rollback: { attempted: r.files.length, errors: r.errors, preserved: r.preserved } }, state) }, 'OUTCOME_EMITTED')
            return { action, final: r.final, projection: projectionOf(exec, receipt) }
          }
          const h = core.approveResume(exec.runId, actor.actorId), info = leases.info(lease)
          exec = update(execId, { lastActionBy: { actorId: actor.actorId, role: actor.role, sessionId: actor.sessionId }, state: 'RUNNING', recoveries: (exec.recoveries ?? 0) + 1, lease: leaseRecord(info, exec.binding) }, 'RECOVERY_RESUME_STARTING')
          active.add(execId); entry.authority = authorityFor(exec)
          try { const res = await finalize(exec, await core.resumeRun(exec.runId, h)); return { action, projection: res.projection } } finally { active.delete(execId); entry.authority = null }
        } finally { leases.release(lease); slot.clear() }
      })
    },
    /** Redeliver Phase 9 events that the sink previously refused (at-least-once, deduped by eventId). */
    flushOutbox(token) {
      actorFor(token, 'outbox'); let sent = 0, pending = 0
      if (!sink) return { sent, pending }
      for (const n of fs.readdirSync(path.join(B, 'outbox')).filter(x => x.endsWith('.json'))) { if (deliver(n.slice(0, -5)) === 'SENT') sent++; else pending++ }
      return { sent, pending }
    },
    buildStageCalls: () => [...buildStageCalls],
  }
  return api
}

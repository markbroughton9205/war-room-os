/* eslint-disable @typescript-eslint/no-unused-vars -- reference suite ported verbatim from the isolated implementation (terse style) */
// Run: node --test tests/control.test.mjs   (Node built-ins only, hermetic fixtures under tests/.fixtures-ctl-*, removed after)
// "Restart" = a brand-new control plane + core over the same on-disk stores. Crashes are real SIGKILLs of a child process.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBlueprintCore, hash } from '../../lib/native-builder/blueprint/core.mjs'
import { createControlPlane } from '../../lib/native-builder/blueprint/control.mjs'
import { canonical } from '../../lib/native-builder/blueprint/base.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = fs.mkdtempSync(path.join(here, '.fixtures-ctl-'))
after(() => fs.rmSync(base, { recursive: true, force: true }))
const A0 = 'export const a = 1\n', A1 = 'export const a = 2\n', C1 = "import { a } from '../src/a.mjs'\nexport const c = a\n"
const audit = { version: '1', role: 'dependency-audit', run: async () => ({ status: 'PASS', evidence: 'audit ok' }) }
const behavior = { version: '1', role: 'behavior', run: async ({ root }) => ({ status: 'PASS', evidence: `a=${fs.readFileSync(path.join(root, 'src/a.mjs'), 'utf8').trim()}` }) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const codeOf = fn => { try { fn() } catch (x) { return x } assert.fail('expected throw') }
const failing = async fn => { try { await fn() } catch (x) { return x } assert.fail('expected rejection') }

function env() {
  const dir = fs.mkdtempSync(path.join(base, 't-')), ws = path.join(dir, 'ws')
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/a.mjs'), A0)
  const e = { dir, ws: fs.realpathSync(ws), state: path.join(dir, 'state'), control: path.join(dir, 'control'), t: 1_700_000_000_000, rev: 'rev1' }
  e.now = () => e.t
  return e
}
const rd = (e, rel) => fs.readFileSync(path.join(e.ws, rel), 'utf8')
const PKG = (over = {}) => JSON.stringify({
  version: 1, id: 'pkg-1', goal: 'Bump a and add c', workspace: { id: 'ws-1', baseRevision: 'rev1' },
  changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }, { path: 'lib/new/c.mjs', operation: 'create', beforeHash: null, content: C1 }],
  dependencies: [], checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '1' }],
  permissions: { writePaths: ['src/a.mjs', 'lib/new/c.mjs'] }, artifact: { path: 'src/a.mjs', sha256: hash(A1), kind: 'source-file' },
  research: [], recipe: { id: 'r', version: '1', applicability: 'demo', provenance: 'manual' }, ...over,
})
/** (Re)boot a "process": fresh control plane + core over the same directories. */
function boot(e, o = {}) {
  const control = createControlPlane({ root: e.control, now: e.now, leaseTtlMs: o.leaseTtlMs ?? 60_000 })
  const wsId = o.wsId ?? 'ws-1'
  const lease = o.lease ?? (o.reattach ? control.leases.reattach({ workspaceId: wsId, holder: o.holder ?? 'host-A', leaseId: o.reattach }) : control.leases.acquire({ workspaceId: wsId, holder: o.holder ?? 'host-A' }))
  const core = createBlueprintCore({ workspace: { id: wsId, root: e.ws, getBaseRevision: () => e.rev, dependencies: {} }, stateRoot: e.state, control, lease,
    checks: o.checks ?? { audit, behavior }, now: e.now, approvalTtlMs: o.ttl ?? 600_000, faultHook: o.faultHook, afterWrite: o.afterWrite, checkTimeoutMs: 2000 })
  return { control, lease, core }
}
const approveNew = (core, raw = PKG()) => { const v = core.preview(raw); return { v, h: core.approve(v.reviewId, v.digest, 'commander@test') } }
const runDirs = e => fs.existsSync(e.state) ? fs.readdirSync(e.state) : []
const apprFile = (e, h) => path.join(e.control, 'approvals', `${hash(h)}.json`)

/** Run a package in a child process that SIGKILLs itself at `point` ('after-intent' | 'after-write-before-ledger' | 'after-write:<path>'). */
function crash(e, point, raw = PKG(), leaseTtlMs = 200) {
  const code = `
    import fs from 'node:fs'; import { createBlueprintCore } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/core.mjs'))}
    import { createControlPlane } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/control.mjs'))}
    const [pt, ap] = process.env.POINT.split(':'), kill = () => process.kill(process.pid, 'SIGKILL')
    const control = createControlPlane({ root: process.env.CTL, leaseTtlMs: ${leaseTtlMs} }), lease = control.leases.acquire({ workspaceId: 'ws-1', holder: 'child' })
    const audit = { version: '1', role: 'dependency-audit', run: async () => ({ status: 'PASS', evidence: 'audit ok' }) }
    const behavior = { version: '1', role: 'behavior', run: async ({ root }) => ({ status: 'PASS', evidence: 'x' }) }
    const core = createBlueprintCore({ workspace: { id: 'ws-1', root: process.env.WS, getBaseRevision: () => 'rev1', dependencies: {} }, stateRoot: process.env.ST, control, lease, checks: { audit, behavior },
      faultHook: p => { if (p === pt && pt !== 'after-write') kill() }, afterWrite: p => { if (pt === 'after-write' && p === ap) kill() } })
    const v = core.preview(process.env.PKG); await core.execute(v.reviewId, core.approve(v.reviewId, v.digest, 'commander@test'))`
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, POINT: point, CTL: e.control, WS: e.ws, ST: e.state, PKG: raw }, timeout: 15000 })
  assert.equal(res.signal, 'SIGKILL', String(res.stderr))
  return runDirs(e)[0]
}
/** Parent "restart" after a crash: wait out the dead child's lease, then take it over (stale lease handling). */
async function recoverBoot(e, o = {}) {
  await sleep(260)
  e.offset = 0; e.now = () => Date.now() + e.offset // real time, matching the child's clock; tests can advance e.offset
  const b = boot(e, { leaseTtlMs: 5000, ...o }); return b
}

// ================================================================= approvals (durable)
test('A1 approval + review survive restart (new process executes what the old one approved)', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core); a.lease.release()
  const b = boot(e), r = await b.core.execute(v.reviewId, h)
  assert.equal(r.status, 'VERIFIED_SOURCE'); assert.equal(r.actor, 'commander@test'); assert.equal(r.approval.boundDigest, v.digest); assert.equal(rd(e, 'src/a.mjs'), A1)
})

test('A2 expired approval is rejected after restart, nothing applied', async () => {
  const e = env(), a = boot(e, { ttl: 1000 }), { v, h } = approveNew(a.core); e.t += 2000
  const b = boot(e, { reattach: a.lease.leaseId, ttl: 1000 })
  assert.equal((await failing(() => b.core.execute(v.reviewId, h))).code, 'APPROVAL_EXPIRED'); assert.equal(rd(e, 'src/a.mjs'), A0); assert.deepEqual(runDirs(e), [])
})

test('A3 used approval cannot replay after restart; used review cannot be re-approved', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core); assert.equal((await a.core.execute(v.reviewId, h)).status, 'VERIFIED_SOURCE')
  const b = boot(e, { reattach: a.lease.leaseId })
  assert.equal((await failing(() => b.core.execute(v.reviewId, h))).code, 'APPROVAL_REPLAYED')
  assert.equal(codeOf(() => b.core.approve(v.reviewId, v.digest, 'x')).code, 'APPROVAL_REPLAYED')
  assert.equal(runDirs(e).length, 1)
})

test('A4 forged/tampered approvals and reviews are rejected (integrity, binding, workspace)', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core), f = apprFile(e, h), orig = fs.readFileSync(f, 'utf8')
  const mutate = fn => { const r = JSON.parse(orig); fn(r); fs.writeFileSync(f, JSON.stringify(r)) }
  for (const [name, fn] of [['actor', r => { r.actor = 'evil' }], ['expiry', r => { r.expiresAt += 1e9 }], ['digest', r => { r.digest = 'f'.repeat(64) }], ['no mac', r => { delete r.mac }], ['bad mac', r => { r.mac = 'f'.repeat(64) }]]) {
    mutate(fn); assert.equal((await failing(() => a.core.execute(v.reviewId, h))).code, 'APPROVAL_FORGED', name)
  }
  fs.writeFileSync(f, orig)
  const planted = 'a'.repeat(64); fs.writeFileSync(apprFile(e, planted), JSON.stringify({ kind: 'execute', reviewId: v.reviewId, digest: v.digest, workspaceId: 'ws-1', actor: 'evil', expiresAt: 9e15, mac: 'b'.repeat(64) }))
  assert.equal((await failing(() => a.core.execute(v.reviewId, planted))).code, 'APPROVAL_FORGED')
  assert.equal((await failing(() => a.core.execute(v.reviewId, 'not-a-handle'))).code, 'APPROVAL_REQUIRED')
  const other = approveNew(a.core, PKG({ id: 'pkg-2' }))
  assert.equal((await failing(() => a.core.execute(v.reviewId, other.h))).code, 'APPROVAL_REQUIRED') // bound to its own review
  const w2 = boot(e, { wsId: 'ws-2' }) // same stores, different workspace
  assert.equal((await failing(() => w2.core.execute(v.reviewId, h))).code, 'APPROVAL_REQUIRED')
  const rf = path.join(e.control, 'reviews', `${v.reviewId}.json`), rv = JSON.parse(fs.readFileSync(rf, 'utf8')); rv.raw = rv.raw.replace('Bump a', 'Evil a'); fs.writeFileSync(rf, JSON.stringify(rv))
  assert.equal((await failing(() => a.core.execute(v.reviewId, h))).code, 'CONTROL_STORE_CORRUPT'); assert.equal(rd(e, 'src/a.mjs'), A0)
})

test('A5 stale approval: workspace changed after approval -> refused before any write, approval burned', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core); fs.writeFileSync(path.join(e.ws, 'src/a.mjs'), 'user change\n')
  const b = boot(e, { reattach: a.lease.leaseId }), r = await b.core.execute(v.reviewId, h)
  assert.equal(r.status, 'BLOCKED'); assert.equal(r.error.code, 'FILE_HASH_MISMATCH'); assert.equal(rd(e, 'src/a.mjs'), 'user change\n'); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
  assert.equal((await failing(() => b.core.execute(v.reviewId, h))).code, 'APPROVAL_REPLAYED')
})

// ================================================================= lease
test('L1 lease: no stealing, heartbeat, expiry, sticky loss, stale takeover with history, no zombie writes', () => {
  const e = env(), c = createControlPlane({ root: e.control, now: e.now })
  const l1 = c.leases.acquire({ workspaceId: 'w', holder: 'A', ttlMs: 1000 })
  assert.equal(l1.verify(), true); assert.equal(l1.epoch, 1)
  for (const holder of ['B', 'A']) assert.equal(codeOf(() => c.leases.acquire({ workspaceId: 'w', holder })).code, 'LEASE_HELD')
  e.t += 500; assert.equal(l1.heartbeat(), true); e.t += 800; assert.equal(l1.verify(), true, 'heartbeat extended expiry')
  e.t += 800; assert.equal(l1.verify(), false); assert.equal(l1.heartbeat(), false); assert.equal(l1.release(), false)
  const l2 = c.leases.acquire({ workspaceId: 'w', holder: 'B', ttlMs: 1000 })
  assert.equal(l2.epoch, 2); assert.equal(l2.takeoverOf.holder, 'A'); assert.equal(l1.verify(), false, 'old handle stays lost'); assert.equal(l1.heartbeat(), false)
  const hist = fs.readFileSync(fs.readdirSync(path.join(e.control, 'leases')).map(n => path.join(e.control, 'leases', n)).find(n => n.endsWith('.history.jsonl')), 'utf8')
  assert.match(hist, /STALE_TAKEOVER/); assert.match(hist, /ACQUIRED/)
  const c2 = createControlPlane({ root: e.control, now: e.now }) // restart
  assert.equal(c2.leases.reattach({ workspaceId: 'w', holder: 'B', leaseId: l2.leaseId }).verify(), true)
  assert.equal(codeOf(() => c2.leases.reattach({ workspaceId: 'w', holder: 'C', leaseId: l2.leaseId })).code, 'LEASE_LOST')
  assert.equal(codeOf(() => c2.leases.reattach({ workspaceId: 'w', holder: 'B', leaseId: 'x' })).code, 'LEASE_LOST')
  assert.equal(l2.release(), true); assert.equal(l2.verify(), false); const l3 = c2.leases.acquire({ workspaceId: 'w', holder: 'C', ttlMs: 1000 })
  e.t += 5000; assert.equal(codeOf(() => c2.leases.reattach({ workspaceId: 'w', holder: 'C', leaseId: l3.leaseId })).code, 'LEASE_LOST')
})

test('L2 tampered lease record is never valid', () => {
  const e = env(), c = createControlPlane({ root: e.control, now: e.now }), l = c.leases.acquire({ workspaceId: 'w', holder: 'A', ttlMs: 1e6 })
  const f = path.join(e.control, 'leases', fs.readdirSync(path.join(e.control, 'leases')).find(n => n.endsWith('.json'))), r = JSON.parse(fs.readFileSync(f, 'utf8'))
  r.expiresAt += 1; fs.writeFileSync(f, JSON.stringify(r)); assert.equal(l.verify(), false)
  assert.equal(codeOf(() => c.leases.acquire({ workspaceId: 'w', holder: 'B' })).code, 'CONTROL_STORE_CORRUPT') // fails closed, no takeover of an unreadable lease
})

test('L3 lease required before mutation: expired at preview/execute blocks; lost mid-apply stops writes and defers rollback; operator recovery under a NEW lease restores', async () => {
  const e = env(), a = boot(e, { leaseTtlMs: 1000 }); e.t += 5000
  assert.equal(codeOf(() => a.core.preview(PKG())).code, 'WORKSPACE_BUSY')
  const e2 = env(), b = boot(e2, { leaseTtlMs: 1000 }), { v, h } = approveNew(b.core); e2.t += 5000
  const r0 = await b.core.execute(v.reviewId, h); assert.equal(r0.status, 'BLOCKED'); assert.equal(r0.error.code, 'WORKSPACE_BUSY'); assert.equal(rd(e2, 'src/a.mjs'), A0)
  const e3 = env(); let c = boot(e3, { leaseTtlMs: 1000, afterWrite: p => { if (p === 'src/a.mjs') e3.t += 5000 } }); const w = approveNew(c.core)
  const r = await c.core.execute(w.v.reviewId, w.h)
  assert.equal(r.error.code, 'LEASE_LOST'); assert.equal(r.status, 'ROLLBACK_INCOMPLETE'); assert.equal(rd(e3, 'src/a.mjs'), A1, 'no mutation (not even rollback) without a lease'); assert.ok(!fs.existsSync(path.join(e3.ws, 'lib')))
  const op = boot(e3, { holder: 'operator' }) // stale takeover
  assert.equal(op.lease.takeoverOf.holder, 'host-A'); assert.equal(op.core.classifyRun(r.runId).classification, 'SAFE_TO_ROLLBACK')
  const rec = op.core.restoreRun(r.runId, 'operator@test'); assert.equal(rec.final, 'RESTORED'); assert.equal(rd(e3, 'src/a.mjs'), A0)
})

// ================================================================= cancellation
test('C1 cancel before start (by review) persists across restart and applies nothing', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core)
  a.control.cancels.request({ reviewId: v.reviewId, actor: 'commander@test', reason: 'changed my mind' })
  const b = boot(e, { reattach: a.lease.leaseId }), r = await b.core.execute(v.reviewId, h)
  assert.equal(r.status, 'CANCELLED_NO_CHANGES'); assert.equal(r.cancel.stopPoint, 'before-start'); assert.equal(r.cancel.request.actor, 'commander@test'); assert.equal(r.error.code, 'CANCELLED')
  assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(r.claims.sourceValidated, false)
})

test('C2 cancel mid-run: no new steps, applied work rolled back with explicit disposition, receipt has request/observation/stop point; persists across restart', async () => {
  const e = env(); let ctl
  const a = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') ctl.cancels.request({ runId: runDirs(e)[0], actor: 'commander@test', reason: 'stop', disposition: 'ROLLBACK' }) } }); ctl = a.control
  const { v, h } = approveNew(a.core), r = await a.core.execute(v.reviewId, h)
  assert.equal(r.status, 'CANCELLED_ROLLED_BACK'); assert.equal(r.cancel.stopPoint, 'before-file:lib/new/c.mjs'); assert.equal(r.cancel.disposition, 'ROLLED_BACK')
  assert.ok(r.cancel.observedAt && r.cancel.request.requestedAt); assert.equal(rd(e, 'src/a.mjs'), A0); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
  assert.deepEqual(r.claims, { sourceValidated: false, built: false, packaged: false, installed: false, taskComplete: false }); assert.equal(r.artifact, null)
  const again = boot(e, { reattach: a.lease.leaseId }); assert.equal(again.control.cancels.find({ runId: r.runId }).actor, 'commander@test')
  assert.equal(again.core.classifyRun(r.runId).classification, 'ALREADY_COMPLETE')
  assert.equal(a.control.cancels.request({ runId: r.runId, actor: 'someone-else', reason: 'second' }).actor, 'commander@test', 'first request wins (idempotent)')
})

test('C3 cancel observed after all checks passed still cannot become success', async () => {
  const e = env(); let ctl
  const last = { version: '1', role: 'behavior', run: async () => { ctl.cancels.request({ runId: runDirs(e)[0], actor: 'commander@test' }); return { status: 'PASS', evidence: 'passed' } } }
  const a = boot(e, { checks: { audit, behavior: last } }); ctl = a.control
  const { v, h } = approveNew(a.core), r = await a.core.execute(v.reviewId, h)
  assert.deepEqual(r.checks.map(c => c.status), ['PASS', 'PASS']); assert.equal(r.status, 'CANCELLED_ROLLED_BACK'); assert.equal(r.cancel.stopPoint, 'before-finalize')
  assert.equal(r.claims.sourceValidated, false); assert.equal(r.artifact, null); assert.equal(rd(e, 'src/a.mjs'), A0); assert.notEqual(r.recipe.status, 'VALIDATED_ON_THIS_TASK_ONLY')
})

test('C4 RETAIN disposition keeps applied work but never claims success; operator can still restore under lease', async () => {
  const e = env(); let ctl
  const a = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') ctl.cancels.request({ runId: runDirs(e)[0], actor: 'commander@test', disposition: 'RETAIN' }) } }); ctl = a.control
  const { v, h } = approveNew(a.core), r = await a.core.execute(v.reviewId, h)
  assert.equal(r.status, 'CANCELLED_RETAINED'); assert.equal(r.cancel.disposition, 'RETAINED_FOR_REVIEW'); assert.deepEqual(r.rollback.retained, ['src/a.mjs']); assert.equal(rd(e, 'src/a.mjs'), A1)
  assert.equal(r.claims.sourceValidated, false); assert.equal(a.core.classifyRun(r.runId).classification, 'NEEDS_OPERATOR_REVIEW')
  assert.equal(a.core.restoreRun(r.runId, 'operator@test').final, 'RESTORED'); assert.equal(rd(e, 'src/a.mjs'), A0)
})

test('C5 tampered cancel record fails closed (run does not proceed)', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core); a.control.cancels.request({ reviewId: v.reviewId, actor: 'c' })
  const f = path.join(e.control, 'cancels', `review-${v.reviewId}.json`), r0 = JSON.parse(fs.readFileSync(f, 'utf8')); r0.actor = 'x'; fs.writeFileSync(f, JSON.stringify(r0))
  const r = await a.core.execute(v.reviewId, h); assert.equal(r.status, 'BLOCKED'); assert.equal(r.error.code, 'CONTROL_STORE_CORRUPT'); assert.equal(rd(e, 'src/a.mjs'), A0)
})

// ================================================================= effect ledger
test('E1 ledger: legal transitions only, COMPLETED never repeated, hash chain + torn tail detection', () => {
  const e = env(), c = createControlPlane({ root: e.control, now: e.now }), run = '11111111-1111-4111-8111-111111111111', d = 'd'.repeat(64)
  c.effects.plan(run, d, [{ stepId: 's1', kind: 'file-write' }, { stepId: 's2', kind: 'external', irreversible: true }])
  assert.equal(c.effects.decide(run, d, 's1'), 'EXECUTE')
  c.effects.transition(run, d, 's1', 'STARTED'); assert.equal(c.effects.decide(run, d, 's1'), 'RECONCILE_REQUIRED')
  c.effects.transition(run, d, 's1', 'COMPLETED'); assert.equal(c.effects.decide(run, d, 's1'), 'SKIP_COMPLETED')
  for (const s of ['STARTED', 'FAILED', 'PLANNED', 'UNKNOWN_AFTER_CRASH']) assert.equal(codeOf(() => c.effects.transition(run, d, 's1', s)).code, 'CONTROL_STORE_CORRUPT', s)
  assert.equal(c.effects.get(run, d, 's1').effectId, c.effects.effectId(run, d, 's1')); assert.notEqual(c.effects.effectId(run, d, 's1'), c.effects.effectId('22222222-2222-4222-8222-222222222222', d, 's1'))
  c.effects.transition(run, d, 's2', 'STARTED'); assert.deepEqual(c.effects.markUnknownAfterCrash(run), ['s2'])
  c.effects.transition(run, d, 's2', 'FAILED', {}); assert.equal(c.effects.decide(run, d, 's2'), 'BLOCKED_FAILED', 'failed irreversible effect is never auto-retried')
  const f = path.join(e.control, 'effects', `${run}.jsonl`), good = fs.readFileSync(f, 'utf8')
  fs.appendFileSync(f, '{"partial":'); assert.equal(c.effects.read(run).torn, true); assert.equal(codeOf(() => c.effects.transition(run, d, 's1', 'COMPLETED')).code === undefined, false)
  assert.equal(c.effects.repairTail(run), true); assert.equal(fs.readFileSync(f, 'utf8'), good)
  fs.writeFileSync(f, good.replace('"s1"', '"sX"')); assert.equal(codeOf(() => c.effects.read(run)).code, 'CONTROL_STORE_CORRUPT')
})

// ================================================================= crash + recovery
test('R1 crash AFTER FIRST WRITE: classified SAFE_TO_RESUME; resume does not repeat the COMPLETED effect; lease takeover recorded', async () => {
  const e = env(), runId = crash(e, 'after-write:src/a.mjs'), inoBefore = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino
  assert.equal(rd(e, 'src/a.mjs'), A1)
  const b = await recoverBoot(e); assert.equal(b.lease.takeoverOf.holder, 'child')
  const cls = b.core.classifyRun(runId)
  assert.equal(cls.classification, 'SAFE_TO_RESUME'); assert.equal(cls.requiresReconcile, false); assert.deepEqual(cls.allowed, ['RESUME', 'ROLLBACK']); assert.equal(cls.status, 'APPLYING')
  assert.deepEqual(b.control.effects.get(runId, JSON.parse(fs.readFileSync(path.join(e.state, runId, 'receipt.json'), 'utf8')).digest, 'write:0:src/a.mjs').history.map(h => h.state), ['PLANNED', 'STARTED', 'COMPLETED'])
  const h = b.core.approveResume(runId, 'operator@test'), r = await b.core.resumeRun(runId, h)
  assert.equal(r.status, 'VERIFIED_SOURCE'); assert.equal(r.resumes, 1); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, inoBefore, 'completed write was not repeated'); assert.equal(rd(e, 'lib/new/c.mjs'), C1)
  assert.deepEqual(r.claims, { sourceValidated: true, built: false, packaged: false, installed: false, taskComplete: false })
  assert.equal((await failing(() => b.core.resumeRun(runId, h))).code, 'APPROVAL_REPLAYED'); assert.equal(b.core.classifyRun(runId).classification, 'ALREADY_COMPLETE')
})

test('R2 crash AFTER INTENT, BEFORE WRITE: effect STARTED => UNKNOWN requires reconciliation; no replay until reconciled under a lease', async () => {
  const e = env(), runId = crash(e, 'after-intent'); assert.equal(rd(e, 'src/a.mjs'), A0)
  const b = await recoverBoot(e), cls = b.core.classifyRun(runId)
  assert.equal(cls.classification, 'SAFE_TO_RESUME'); assert.equal(cls.requiresReconcile, true); assert.deepEqual(cls.allowed, ['RECONCILE', 'ROLLBACK']); assert.match(cls.reasons.join(' '), /reconciliation/)
  const h = b.core.approveResume(runId, 'operator@test')
  assert.equal((await failing(() => b.core.resumeRun(runId, h))).code, 'RECONCILIATION_REQUIRED'); assert.equal(rd(e, 'src/a.mjs'), A0)
  const rec = b.core.reconcileRun(runId, 'operator@test')
  assert.deepEqual(rec.markedUnknown, ['write:0:src/a.mjs']); assert.equal(rec.outcomes[0].result, 'NOT_APPLIED_OBSERVED_BEFORE'); assert.equal(rec.kind, 'reconcile')
  assert.equal(b.core.classifyRun(runId).requiresReconcile, false)
  const r = await b.core.resumeRun(runId, h) // approval survived the refused attempt (not burned)
  assert.equal(r.status, 'VERIFIED_SOURCE'); assert.equal(rd(e, 'src/a.mjs'), A1)
  const digest = r.digest, hist = b.control.effects.get(runId, digest, 'write:0:src/a.mjs').history.map(x => x.state)
  assert.deepEqual(hist, ['PLANNED', 'STARTED', 'UNKNOWN_AFTER_CRASH', 'FAILED', 'STARTED', 'COMPLETED'])
})

test('R3 crash between atomic write and ledger COMPLETED: reconcile observes AFTER, resume skips the write', async () => {
  const e = env(), runId = crash(e, 'after-write-before-ledger'); assert.equal(rd(e, 'src/a.mjs'), A1)
  const b = await recoverBoot(e), ino = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino
  assert.equal(b.core.classifyRun(runId).requiresReconcile, true)
  assert.equal(b.core.reconcileRun(runId, 'operator@test').outcomes[0].result, 'COMPLETED_OBSERVED_AFTER')
  const r = await b.core.resumeRun(runId, b.core.approveResume(runId, 'operator@test'))
  assert.equal(r.status, 'VERIFIED_SOURCE'); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, ino)
})

test('R4 drift after crash: NEEDS_OPERATOR_REVIEW, no auto-resume, reconcile leaves UNKNOWN, restore preserves the concurrent edit', async () => {
  const e = env(), runId = crash(e, 'after-write:lib/new/c.mjs') // both files applied, then crash
  fs.writeFileSync(path.join(e.ws, 'src/a.mjs'), 'export const a = "user"\n')
  const b = await recoverBoot(e), cls = b.core.classifyRun(runId)
  assert.equal(cls.classification, 'NEEDS_OPERATOR_REVIEW'); assert.match(cls.reasons.join(' '), /drift/); assert.deepEqual(cls.files.map(f => f.observed), ['DRIFTED', 'AFTER'])
  assert.equal(codeOf(() => b.core.approveResume(runId, 'operator@test')).code, 'RECOVERY_NOT_ALLOWED')
  const rec = b.core.restoreRun(runId, 'operator@test')
  assert.equal(rec.final, 'RESTORE_INCOMPLETE'); assert.equal(rd(e, 'src/a.mjs'), 'export const a = "user"\n', 'concurrent edit preserved'); assert.ok(!fs.existsSync(path.join(e.ws, 'lib/new/c.mjs')), 'run-owned file removed')
  assert.ok(!fs.existsSync(path.join(e.ws, 'lib')), 'directories created by the run removed when empty')
  assert.ok(rec.errors.some(x => x.path === 'src/a.mjs' && /Concurrent edit preserved/.test(x.message)))
})

test('R5 restore under valid lease: verified snapshot, created dirs removed, durable signed recovery receipt, terminal afterwards', async () => {
  const e = env(), runId = crash(e, 'after-write:lib/new/c.mjs'); assert.equal(rd(e, 'lib/new/c.mjs'), C1)
  const b = await recoverBoot(e), rec = b.core.restoreRun(runId, 'operator@test')
  assert.equal(rec.final, 'RESTORED'); assert.deepEqual(rec.files.map(f => f.action).sort(), ['REMOVED', 'RESTORED']); assert.equal(rd(e, 'src/a.mjs'), A0); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
  assert.equal(rec.lease.holder, 'host-A'); assert.equal(rec.sequence, 1); assert.equal(rec.claims.built, false)
  const onDisk = JSON.parse(fs.readFileSync(b.core.resolveEvidence(rec.ref), 'utf8')); assert.equal(onDisk.final, 'RESTORED'); assert.ok(onDisk.mac)
  const after = b.core.classifyRun(runId); assert.equal(after.classification, 'ALREADY_COMPLETE'); assert.equal(after.outcome, 'RECOVERED_ROLLED_BACK')
  assert.equal(codeOf(() => b.core.restoreRun(runId, 'operator@test')).code, 'RECOVERY_NOT_ALLOWED')
})

test('R6 restore REFUSES without a valid exclusive lease and changes nothing', async () => {
  const e = env(), runId = crash(e, 'after-write:src/a.mjs'), b = await recoverBoot(e, { leaseTtlMs: 1000 })
  e.offset = 10_000 // lease expired for this holder
  const x = codeOf(() => b.core.restoreRun(runId, 'operator@test')); assert.equal(x.code, 'LEASE_LOST'); assert.equal(rd(e, 'src/a.mjs'), A1)
  assert.equal(codeOf(() => b.core.reconcileRun(runId, 'operator@test')).code, 'LEASE_LOST')
  assert.equal(fs.readdirSync(path.join(e.state, runId)).filter(n => n.startsWith('recovery-')).length, 0)
})

test('R7 tampered snapshot is not restored; tampered receipt is rejected; restoring a verified run is not allowed', async () => {
  const e = env(), runId = crash(e, 'after-write:src/a.mjs')
  fs.writeFileSync(path.join(e.state, runId, '0.before'), 'tampered snapshot')
  const b = await recoverBoot(e), rec = b.core.restoreRun(runId, 'operator@test')
  assert.equal(rec.final, 'RESTORE_INCOMPLETE'); assert.match(rec.errors[0].message, /Snapshot integrity/); assert.equal(rd(e, 'src/a.mjs'), A1)
  const e2 = env(), runId2 = crash(e2, 'after-write:src/a.mjs'), f = path.join(e2.state, runId2, 'receipt.json'), rcpt = JSON.parse(fs.readFileSync(f, 'utf8'))
  rcpt.files[0].path = 'src/b.mjs'; fs.writeFileSync(f, JSON.stringify(rcpt))
  const b2 = await recoverBoot(e2); assert.equal(b2.core.classifyRun(runId2).classification, 'NEEDS_OPERATOR_REVIEW'); assert.equal(codeOf(() => b2.core.restoreRun(runId2, 'operator@test')).code, 'CONTROL_STORE_CORRUPT')
  const e3 = env(), a = boot(e3), { v, h } = approveNew(a.core), r = await a.core.execute(v.reviewId, h)
  assert.equal(codeOf(() => a.core.restoreRun(r.runId, 'operator@test')).code, 'RECOVERY_NOT_ALLOWED'); assert.equal(rd(e3, 'src/a.mjs'), A1)
})

test('R8 classification matrix: ALREADY_COMPLETE / SAFE_TO_RESUME / SAFE_TO_ROLLBACK / NEEDS_OPERATOR_REVIEW (base change, ledger tamper, irreversible unknown, cancel requested)', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core), done = await a.core.execute(v.reviewId, h)
  assert.deepEqual([a.core.classifyRun(done.runId).classification, a.core.classifyRun(done.runId).outcome], ['ALREADY_COMPLETE', 'VERIFIED_SOURCE'])
  fs.writeFileSync(path.join(e.ws, 'src/a.mjs'), 'later user edit\n'); assert.equal(a.core.classifyRun(done.runId).classification, 'NEEDS_OPERATOR_REVIEW')
  const e2 = env(), runId = crash(e2, 'after-write:src/a.mjs'), b = await recoverBoot(e2)
  assert.equal(b.core.classifyRun(runId).classification, 'SAFE_TO_RESUME')
  const digest = JSON.parse(fs.readFileSync(path.join(e2.state, runId, 'receipt.json'), 'utf8')).digest
  b.control.cancels.request({ runId, actor: 'commander@test' }); const cr = b.core.classifyRun(runId); assert.equal(cr.classification, 'SAFE_TO_ROLLBACK'); assert.deepEqual(cr.allowed, ['ROLLBACK'])
  assert.equal(codeOf(() => b.core.approveResume(runId, 'operator@test')).code, 'RECOVERY_NOT_ALLOWED')
  e2.rev = 'rev2'; assert.equal(b.core.classifyRun(runId).classification, 'NEEDS_OPERATOR_REVIEW'); e2.rev = 'rev1'
  const e3 = env(), runId3 = crash(e3, 'after-write:src/a.mjs'), c = await recoverBoot(e3), d3 = JSON.parse(fs.readFileSync(path.join(e3.state, runId3, 'receipt.json'), 'utf8')).digest
  c.control.effects.plan(runId3, d3, [{ stepId: 'install:x', kind: 'external', irreversible: true }]); c.control.effects.transition(runId3, d3, 'install:x', 'STARTED')
  const ci = c.core.classifyRun(runId3); assert.equal(ci.classification, 'NEEDS_OPERATOR_REVIEW'); assert.match(ci.reasons.join(' '), /irreversible/)
  assert.equal(c.core.reconcileRun(runId3, 'operator@test').outcomes.find(o => o.stepId === 'install:x').result, 'LEFT_UNKNOWN_OPERATOR_REQUIRED'); assert.equal(c.core.classifyRun(runId3).classification, 'NEEDS_OPERATOR_REVIEW')
  const lf = path.join(e3.control, 'effects', `${runId3}.jsonl`); fs.writeFileSync(lf, fs.readFileSync(lf, 'utf8').replace('write:0', 'write:9'))
  assert.equal(c.core.classifyRun(runId3).classification, 'NEEDS_OPERATOR_REVIEW'); assert.match(c.core.classifyRun(runId3).reasons.join(' '), /LEDGER/)
})

test('R9 resume authority: fresh server-issued approval bound to run+digest; execute-approvals and other runs cannot resume; reconcile/resume need a lease', async () => {
  const e = env(), runId = crash(e, 'after-write:src/a.mjs'), b = await recoverBoot(e)
  const o = 'export const o = 1\n', exec = approveNew(b.core, PKG({ id: 'other', changes: [{ path: 'lib/other.mjs', operation: 'create', beforeHash: null, content: o }], permissions: { writePaths: ['lib/other.mjs'] }, artifact: { path: 'lib/other.mjs', sha256: hash(o), kind: 'source-file' } })).h // an execute approval for a different review
  assert.equal((await failing(() => b.core.resumeRun(runId, exec))).code, 'APPROVAL_REQUIRED')
  assert.equal((await failing(() => b.core.resumeRun(runId, 'f'.repeat(64)))).code, 'APPROVAL_REQUIRED')
  const h = b.core.approveResume(runId, 'operator@test'), f = apprFile(e, h), orig = fs.readFileSync(f, 'utf8'), r0 = JSON.parse(orig); r0.runId = '33333333-3333-4333-8333-333333333333'; fs.writeFileSync(f, JSON.stringify(r0))
  assert.equal((await failing(() => b.core.resumeRun(runId, h))).code, 'APPROVAL_FORGED'); fs.writeFileSync(f, orig)
  e.offset = 10_000 // lease expires for the resumer
  assert.equal((await failing(() => b.core.resumeRun(runId, h))).code, 'LEASE_LOST'); assert.equal(rd(e, 'src/a.mjs'), A1); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
})

// ================================================================= regression tests from the independent review of restart/replay/lease semantics
test('V1 a stale holder cannot resurrect its lease over a takeover; forged heartbeat sidecars never extend a lease', () => {
  const e = env(), c = createControlPlane({ root: e.control, now: e.now }), l1 = c.leases.acquire({ workspaceId: 'w', holder: 'A', ttlMs: 1000 })
  e.t += 2000; const l2 = c.leases.acquire({ workspaceId: 'w', holder: 'B', ttlMs: 10_000 })
  assert.equal(l1.heartbeat(), false); assert.equal(l1.heartbeat(5e9), false); assert.equal(l2.verify(), true); assert.equal(c.leases.inspect('w').holder, 'B')
  const e2 = env(), c2 = createControlPlane({ root: e2.control, now: e2.now }), l = c2.leases.acquire({ workspaceId: 'w', holder: 'A', ttlMs: 1000 })
  const hb = path.join(e2.control, 'leases', `${hash('w').slice(0, 32)}.${l.leaseId}.hb`)
  fs.writeFileSync(hb, JSON.stringify({ leaseId: l.leaseId, epoch: 1, expiresAt: 9e15, mac: 'c'.repeat(64) })); e2.t += 5000
  assert.equal(l.verify(), false); assert.equal(c2.leases.inspect('w').valid, false)
})

test('V2 created-directory intent is durable BEFORE directories exist; orphan empty dirs from a crash are cleaned by restore', async () => {
  const e = env(), raw = PKG({ changes: [{ path: 'lib/new/c.mjs', operation: 'create', beforeHash: null, content: C1 }, { path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }], permissions: { writePaths: ['lib/new/c.mjs', 'src/a.mjs'] } })
  const runId = crash(e, 'after-intent', raw)
  const rec0 = JSON.parse(fs.readFileSync(path.join(e.state, runId, 'receipt.json'), 'utf8')).files[0]
  assert.deepEqual(rec0.createdDirs, ['lib', 'lib/new']); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')), 'intent recorded before creation')
  fs.mkdirSync(path.join(e.ws, 'lib/new'), { recursive: true }) // simulate: crash right after mkdir
  const b = await recoverBoot(e), out = b.core.restoreRun(runId, 'operator@test')
  assert.equal(out.final, 'RESTORED'); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
  fs.mkdirSync(path.join(e.ws, 'lib')); fs.writeFileSync(path.join(e.ws, 'lib/user.txt'), 'mine')
  const e2 = env(), runId2 = crash(e2, 'after-intent', raw); fs.mkdirSync(path.join(e2.ws, 'lib/new'), { recursive: true }); fs.writeFileSync(path.join(e2.ws, 'lib/user.txt'), 'mine')
  const b2 = await recoverBoot(e2); assert.equal(b2.core.restoreRun(runId2, 'operator@test').final, 'RESTORED')
  assert.ok(!fs.existsSync(path.join(e2.ws, 'lib/new')) && fs.existsSync(path.join(e2.ws, 'lib/user.txt')), 'only the run\'s empty dir removed; foreign content kept')
})

test('V3 approval issued against an older base is STALE: refused without burning it, usable again if the base returns', async () => {
  const e = env(), a = boot(e), { v, h } = approveNew(a.core); e.rev = 'rev2'
  const x = await failing(() => a.core.execute(v.reviewId, h)); assert.equal(x.code, 'APPROVAL_STALE'); assert.equal(x.observed, 'rev2'); assert.equal(rd(e, 'src/a.mjs'), A0)
  e.rev = 'rev1'; assert.equal((await a.core.execute(v.reviewId, h)).status, 'VERIFIED_SOURCE')
})

test('V4 effect-ledger chain is keyed: recomputing a plain hash chain after editing history is detected', () => {
  const e = env(), c = createControlPlane({ root: e.control, now: e.now }), run = '44444444-4444-4444-8444-444444444444', d = 'e'.repeat(64)
  c.effects.plan(run, d, [{ stepId: 's1', kind: 'file-write' }]); c.effects.transition(run, d, 's1', 'STARTED')
  const f = path.join(e.control, 'effects', `${run}.jsonl`), lines = fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  lines[1].state = 'COMPLETED'; let prev = '0'.repeat(64) // attacker rewrites history and "repairs" the chain without the key
  const forged = lines.map(l => { l.prev = prev; delete l.chain; l.chain = hash(prev + canonical({ ...l, chain: undefined })); prev = l.chain; return JSON.stringify(l) }).join('\n') + '\n'
  fs.writeFileSync(f, forged); assert.equal(codeOf(() => c.effects.read(run)).code, 'CONTROL_STORE_CORRUPT')
})

test('V5 recovery output never leaks absolute host paths', async () => {
  const e = env(), runId = crash(e, 'after-write:lib/new/c.mjs'), b = await recoverBoot(e), cls = b.core.classifyRun(runId), rec = b.core.restoreRun(runId, 'operator@test')
  for (const o of [cls, rec]) { const text = JSON.stringify(o); assert.ok(!text.includes(e.dir) && !text.includes(base), 'no absolute fixture paths') }
})

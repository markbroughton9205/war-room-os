/* eslint-disable @typescript-eslint/no-unused-vars -- reference suite ported verbatim from the isolated implementation (terse style) */
// Step 6: mission + assignment OWNERSHIP seam. Hermetic live-record MODEL (tests/ownership-fixture.mjs); the bridge/broker only read it. Real SIGKILL crash tests in OW9.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { hash } from '../../lib/native-builder/blueprint/base.mjs'
import { createBroker } from '../../lib/native-builder/blueprint/broker.mjs'
import { ASSIGNMENT_STATES, MISSION_STATES, authorizePackageScope, classifyWritePath, createMissionOwnershipBridge, lifecyclePermits, normalizeOwnership, ownershipDigestOf } from '../../lib/native-builder/blueprint/ownership.mjs'
import { validateOutcomeEvent } from '../../lib/native-builder/blueprint/phase9.mjs'
import { createFakeHost } from './fake-host.mjs'
import { createLiveModel } from './ownership-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = fs.mkdtempSync(path.join(here, '.fixtures-own-'))
after(() => fs.rmSync(base, { recursive: true, force: true }))
const A0 = 'export const a = 1\n', A1 = 'export const a = 2\n', C1 = "import { a } from '../src/a.mjs'\nexport const c = a\n"
const CTX = { missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1', requestingSubsystem: 'foundry' }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const failing = async fn => { try { await fn() } catch (x) { return x } assert.fail('expected rejection') }
const PKG = (over = {}) => JSON.stringify({ version: 1, id: 'pkg-1', goal: 'Bump a and add c', workspace: { id: 'ws-1', baseRevision: 'rev1' },
  changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }, { path: 'lib/new/c.mjs', operation: 'create', beforeHash: null, content: C1 }],
  dependencies: [], checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '1' }], permissions: { writePaths: ['src/a.mjs', 'lib/new/c.mjs'] },
  artifact: { path: 'src/a.mjs', sha256: hash(A1), kind: 'source-file' }, research: [], recipe: { id: 'r', version: '1', applicability: 'demo', provenance: 'manual' }, ...over })
function env(modelOpts, hostOpts = {}) {
  const dir = fs.mkdtempSync(path.join(base, 't-')), ws = path.join(dir, 'ws'); fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/a.mjs'), A0)
  const e = { dir, ws: fs.realpathSync(ws), control: path.join(dir, 'control'), evidence: path.join(dir, 'evidence'), offset: 0 }
  e.now = () => Date.now() + e.offset; e.live = createLiveModel(e.ws, modelOpts)
  e.host = createFakeHost({ now: e.now, workspaces: { 'ws-1': { id: 'ws-1', root: e.ws }, 'ws-2': { id: 'ws-2', root: e.ws } }, ...hostOpts })
  e.host.missions = { verifyAssignment: e.live.bridge.verifyAssignment, resolve: e.live.bridge.resolve }
  e.host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); e.host.issue('tok-op', { actorId: 'op1', role: 'operator', sessionId: 'sess-op-0001' })
  return e
}
const boot = (e, o = {}) => createBroker({ brokerId: 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: o.host ?? e.host, now: e.now, leaseTtlMs: o.leaseTtlMs ?? 60_000, checkTimeoutMs: 2000, faultHook: o.faultHook, afterWrite: o.afterWrite })
const ready = (b, raw = PKG(), ctx = CTX) => { const { execId } = b.importPackage('tok-cmd', raw, ctx); b.approve('tok-cmd', execId, ctx); return execId }
const rd = (e, rel) => fs.readFileSync(path.join(e.ws, rel), 'utf8')
const loadExec = (e, id) => JSON.parse(fs.readFileSync(path.join(e.control, 'broker/exec', `${id}.json`), 'utf8'))
const execCount = e => fs.readdirSync(path.join(e.control, 'broker/exec')).length
const untouched = e => { assert.equal(rd(e, 'src/a.mjs'), A0); assert.ok(!fs.existsSync(path.join(e.ws, 'lib'))) }

test('OW1 normalized ownership: strict, only proven fields, workerId stays UNKNOWN, free text never crosses, linkage verified, bridge is read-only', () => {
  const e = env(), L = e.live, raw = L.bridge.resolve({ missionId: 'm-1', assignmentId: 'a-1' }), f = normalizeOwnership(raw), before = L.snapshot()
  assert.equal(f.complete, true); assert.deepEqual([f.ownerType, f.ownerId, f.workerId, f.missionState, f.assignmentState, f.writeGrantedBy, f.writeCapable, f.ownerState], ['agent', 'agent-eng', 'UNKNOWN', 'EXECUTING', 'RUNNING', 'commander', true, 'ACTIVE']); assert.ok(Object.isFrozen(f))
  assert.ok(!/SECRET/.test(JSON.stringify(raw) + JSON.stringify(f)), 'objective/title/request/owner free text never crosses'); assert.equal(f.writeScope.paths.length, 3)
  for (const bad of [null, [], { ...raw, extra: 1 }, { ...raw, token: 'x' }]) assert.equal(normalizeOwnership(bad), null)
  assert.equal(normalizeOwnership({ ...raw, missionId: undefined }).complete, false); assert.equal(normalizeOwnership({ ...JSON.parse(JSON.stringify(f)), complete: true, ownerId: 'bad id!' }).complete, false, '`complete` is recomputed')
  assert.equal(normalizeOwnership({ ...raw, workerId: 'worker-9' }).workerId, 'worker-9', 'the normalizer carries a host-PROVEN worker if one ever exists'); assert.equal(raw.workerId, 'UNKNOWN', 'but today the bridge supplies none: live does not link workers to assignments')
  const breaks = { 'parent mission': a => ({ ...a, parentMission: { id: 'm-2', title: 't' } }), 'workspace id': (a, x) => ({ ...a, workspace: { id: 'ws-9', root: x.ws, kind: 'project' } }), 'workspace root': a => ({ ...a, workspace: { id: 'ws-1', root: '/elsewhere', kind: 'project' } }), 'no workspace': a => ({ ...a, workspace: null }) }
  for (const [name, f] of Object.entries(breaks)) { const x = env(); x.live.asg().assignment = f(x.live.asg().assignment, x); assert.equal(normalizeOwnership(x.live.bridge.resolve({ missionId: 'm-1', assignmentId: 'a-1' })).complete, false, `linkage: ${name}`) }
  assert.equal(L.bridge.resolve({ missionId: 'm-1', assignmentId: 'nope' }), null); assert.equal(L.bridge.resolve({ missionId: 'm-9', assignmentId: 'a-1' }), null)
  assert.deepEqual(Object.keys(L.bridge).sort(), ['resolve', 'verifyAssignment']); assert.ok(Object.isFrozen(L.bridge)); assert.equal(L.snapshot(), before, 'reads never mutate live records')
  assert.throws(() => createMissionOwnershipBridge({}), /required/)
})

test('OW2 lifecycle authorization map: execute/resume only RUNNING+EXECUTING+ACTIVE owner; terminal assignments/missions take no new package work; restore/reconcile (cleanup) stay possible', () => {
  const e = env(), F = over => normalizeOwnership({ ...e.live.bridge.resolve({ missionId: 'm-1', assignmentId: 'a-1' }), ...over })
  const ok = (op, over) => lifecyclePermits(op, F(over)).ok
  for (const op of ['execute', 'resume']) { for (const a of ASSIGNMENT_STATES) assert.equal(ok(op, { assignmentState: a }), a === 'RUNNING', `${op}/${a}`); for (const m of MISSION_STATES) assert.equal(ok(op, { missionState: m }), m === 'EXECUTING', `${op}/${m}`) }
  assert.deepEqual(ASSIGNMENT_STATES.filter(a => ok('import', { assignmentState: a })), ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED']); assert.deepEqual(ASSIGNMENT_STATES.filter(a => ok('approve', { assignmentState: a })), ['QUEUED', 'RUNNING'])
  for (const t of ['COMPLETED', 'FAILED', 'CANCELLED', 'HANDED_OFF', 'INTERRUPTED', 'CANCEL_REQUESTED', 'STOPPING']) for (const op of ['import', 'approve', 'execute', 'resume', 'pause']) assert.equal(ok(op, { assignmentState: t }), false, `${op}/${t}`)
  for (const t of ['COMPLETE', 'FAILED', 'CANCELLED']) { for (const op of ['import', 'approve', 'execute', 'resume', 'pause', 'cancel']) assert.equal(ok(op, { missionState: t }), false, `${op}/${t}`); assert.equal(ok('restore', { missionState: t, assignmentState: 'COMPLETED' }), true); assert.equal(ok('reconcile', { missionState: t, assignmentState: 'CANCELLED' }), true) }
  assert.equal(ok('approve', { missionState: 'WAITING_AUTHORIZATION' }), true); assert.equal(ok('approve', { missionState: 'PAUSED' }), false)
  assert.equal(ok('execute', { pauseRequested: true }), false); assert.equal(ok('execute', { cancelRequested: true }), false); assert.equal(ok('execute', { ownerState: 'PAUSED' }), false); assert.equal(ok('execute', { ownerState: undefined }), false)
  assert.equal(ok('execute', { missionKind: 'app_builder' }), false); assert.equal(ok('execute', { writeCapable: false }), false); assert.equal(ok('execute', { writeGrantedBy: 'system' }), false)
  assert.equal(lifecyclePermits('execute', null).code, 'OWNERSHIP_UNAVAILABLE'); assert.equal(lifecyclePermits('bogus', F({})).code, 'OWNERSHIP_UNAVAILABLE'); assert.equal(ok('execute', { assignmentState: 'UNKNOWN' }), false)
})

test('OW3 write-scope intersection: package ⊆ mission write set (exact paths), package stays narrower, no proximity/prefix inference, unestablished/protected/vendor/traversal refused', () => {
  const F = scope => normalizeOwnership({ ...env().live.bridge.resolve({ missionId: 'm-1', assignmentId: 'a-1' }), writeScope: scope })
  const wp = ['src/a.mjs', 'lib/new/c.mjs'], cp = wp
  const broad = authorizePackageScope(F({ established: true, paths: [...wp, 'x/y.mjs', 'z.mjs'] }), { writePaths: wp, changePaths: cp }); assert.deepEqual(broad.effectivePaths, [...cp].sort()); assert.equal(broad.ok, true, 'a broader mission scope never widens the package')
  assert.equal(authorizePackageScope(F({ established: true, paths: ['src/a.mjs'] }), { writePaths: wp, changePaths: cp }).ok, false, 'package asks for more than the assignment')
  assert.equal(authorizePackageScope(F({ established: true, paths: wp }), { writePaths: [...wp, 'unused.mjs'], changePaths: cp }).ok, false, 'declared-but-unused extra writePath is still an ask')
  assert.equal(authorizePackageScope(F({ established: true, paths: ['src', 'lib', 'src/'] }), { writePaths: wp, changePaths: cp }).ok, false, 'directory prefix / proximity grants nothing')
  assert.equal(authorizePackageScope(F({ established: true, paths: ['src/a.mjs.bak', 'lib/new/c.mjs.old'] }), { writePaths: wp, changePaths: cp }).ok, false)
  assert.equal(authorizePackageScope(F({ established: false, paths: wp }), { writePaths: wp, changePaths: cp }).reason, 'mission write set is not established')
  for (const bad of ['../x.mjs', '/abs.mjs', 'node_modules/x.js', 'lib/terra/a.ts', 'components/war-room/terra/x.tsx', 'public/terra/x.js', 'lib/wrim-environment/x.ts', 'src/cesium/loader.js', '.next/x.js', 'C:/x.js']) { assert.equal(classifyWritePath(bad).ok, false, bad); assert.equal(F({ established: true, paths: [bad] }).writeScope.established, false, `a scope containing ${bad} is unusable`) }
  assert.equal(classifyWritePath('.\\src\\a.mjs').path, 'src/a.mjs'); assert.equal(classifyWritePath('src/a.mjs').ok, true)
  assert.equal(authorizePackageScope(F({ established: true, paths: wp }), { writePaths: wp, changePaths: ['src/other.mjs'] }).ok, false); assert.equal(authorizePackageScope(null, { writePaths: wp, changePaths: cp }).code, 'OWNERSHIP_UNAVAILABLE')
})

test('OW4 valid mission/assignment: full flow succeeds; approval binds ownership + effective scope; source validation never advances mission or assignment', async () => {
  const e = env(), b = boot(e), before = e.live.snapshot(), id = ready(b), a = loadExec(e, id).approval
  assert.match(a.ownership.digest, /^own1:[a-f0-9]{64}$/); assert.equal(a.ownership.liveScopeDigest, normalizeOwnership(e.live.bridge.resolve(CTX)).writeScope.digest)
  const out = await b.execute('tok-cmd', id, { ...CTX, workerId: 'agent-eng' }); assert.equal(out.state, 'VERIFIED_SOURCE'); assert.equal(out.report, 'SOURCE_VALIDATED'); assert.deepEqual(out.hostLifecycle, { missionAdvanced: false, assignmentAdvanced: false })
  assert.deepEqual([out.claims.missionComplete, out.claims.assignmentComplete, out.claims.taskComplete, out.claims.built], [false, false, false, false]); assert.equal(e.live.snapshot(), before, 'live mission/assignment untouched')
  assert.equal(e.live.mission().status, 'EXECUTING'); assert.equal(e.live.asg().state, 'RUNNING'); const ev = e.host.phase9Sink.state.events[0]; assert.equal(ev.claims.missionComplete, false); assert.equal(ev.claims.assignmentComplete, false)
  assert.equal(loadExec(e, id).ownership.digest, a.ownership.digest)
})

test('OW5 binding failures before any package is stored: wrong mission / assignment / workspace, missing or retired assignment, terminal mission', async () => {
  const cases = [
    ['wrong mission id', e => ({ ...CTX, missionId: 'm-2' }), 'OWNERSHIP_UNAVAILABLE'], ['wrong assignment id', e => ({ ...CTX, assignmentId: 'a-9' }), 'OWNERSHIP_UNAVAILABLE'],
    ['wrong workspace', e => ({ ...CTX, workspaceId: 'ws-2' }), 'WORKSPACE_MISMATCH'], ['assignment completed', e => (e.live.set('assignments', 'a-1', { state: 'COMPLETED' }), CTX), 'ASSIGNMENT_INACTIVE'],
    ['assignment retired (handed off)', e => (e.live.set('assignments', 'a-1', { state: 'HANDED_OFF' }), CTX), 'ASSIGNMENT_INACTIVE'], ['assignment cancel requested', e => (e.live.set('assignments', 'a-1', { state: 'CANCEL_REQUESTED' }), CTX), 'ASSIGNMENT_INACTIVE'],
    ['mission COMPLETE', e => (e.live.set('missions', 'm-1', { status: 'COMPLETE' }), CTX), 'MISSION_INACTIVE'], ['mission cancel requested', e => (e.live.set('missions', 'm-1', { cancelRequested: true }), CTX), 'MISSION_INACTIVE'],
    ['assignment missing', e => (e.live.assignments.delete('a-1'), CTX), 'OWNERSHIP_UNAVAILABLE'], ['mission missing', e => (e.live.missions.delete('m-1'), CTX), 'OWNERSHIP_UNAVAILABLE'],
    ['write tool not granted', e => { const a = e.live.asg().assignment; e.live.asg().assignment = { ...a, tools: ['read_workspace'] }; return CTX }, 'WRITE_SCOPE_DENIED'], ['grant not by Commander', e => { const a = e.live.asg().assignment; e.live.asg().assignment = { ...a, createdBy: 'system:mission' }; return CTX }, 'WRITE_SCOPE_DENIED'],
    ['write set unestablished', e => (e.live.mission().writeSet.established = false, CTX), 'WRITE_SCOPE_DENIED'], ['package outside scope', e => (e.live.mission().writeSet.paths = ['src/a.mjs'], CTX), 'WRITE_SCOPE_DENIED'],
  ]
  for (const [name, setup, code] of cases) { const e = env(), b = boot(e), ctx = setup(e); assert.equal((await failing(async () => b.importPackage('tok-cmd', PKG(), ctx))).code, code, name); assert.equal(execCount(e), 0, `${name}: nothing stored`); untouched(e) }
})

test('OW6 worker identity: live proves only the owner agent; workerId is UNKNOWN; a caller claim must equal the owner; a package cannot nominate a worker/owner/assignment', async () => {
  const e = env(), b = boot(e)
  assert.equal((await failing(async () => b.importPackage('tok-cmd', PKG(), { ...CTX, workerId: 'agent-other' }))).code, 'WORKER_MISMATCH'); assert.equal((await failing(async () => b.importPackage('tok-cmd', PKG(), { ...CTX, workerId: 'x'.repeat(300) }))).code, 'INVALID_PACKAGE')
  const { execId } = b.importPackage('tok-cmd', PKG(), { ...CTX, workerId: 'agent-eng' }); b.approve('tok-cmd', execId, CTX)
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { ...CTX, workerId: 'agent-other' }))).code, 'WORKER_MISMATCH'); untouched(e)
  for (const key of ['workerId', 'worker', 'owner', 'assignmentId', 'missionId', 'ownerId']) assert.equal((await failing(async () => b.importPackage('tok-cmd', PKG({ [key]: 'agent-eng' }), CTX))).code, 'INVALID_PACKAGE', key)
  assert.equal(normalizeOwnership(e.live.bridge.resolve(CTX)).workerId, 'UNKNOWN'); assert.equal((await b.execute('tok-cmd', execId, { ...CTX, workerId: 'agent-eng' })).state, 'VERIFIED_SOURCE')
})

test('OW7 package ownership is immutable after review: rebinding, workspace change, scope shrink, lifecycle transition all refuse before the approval is consumed; harmless changes do not', async () => {
  const run = async (mutate, code, { recover } = {}) => { const e = env(), b = boot(e), id = ready(b); mutate(e); const err = await failing(() => b.execute('tok-cmd', id, CTX)); assert.equal(err.code, code, String(err.code)); untouched(e); assert.equal(loadExec(e, id).state, 'APPROVED', 'approval not burned'); assert.equal(e.live.reads > 0, true); return { e, b, id } }
  await run(e => { e.live.asg().assignment = { ...e.live.asg().assignment, agentId: 'agent-2' }; e.live.agents.set('agent-2', { state: 'ACTIVE' }) }, 'OWNERSHIP_CHANGED') // assignment rebound to another owner
  await run(e => { e.live.asg().assignment = { ...e.live.asg().assignment, taskClass: 'something_else' } }, 'OWNERSHIP_CHANGED')
  await run(e => { e.live.asg().assignment = { ...e.live.asg().assignment, createdAt: '2026-10-08T00:00:00.000Z' } }, 'OWNERSHIP_CHANGED') // recreated assignment under the same id
  await run(e => { e.live.mission().workspaceBinding = { ...e.live.mission().workspaceBinding, workspaceId: 'ws-2' }; e.live.asg().assignment = { ...e.live.asg().assignment, workspace: { id: 'ws-2', root: e.ws, kind: 'project' } } }, 'WORKSPACE_MISMATCH')
  await run(e => { e.live.mission().writeSet.paths = ['src/a.mjs', 'extra/other.mjs'] }, 'WRITE_SCOPE_DENIED') // scope SHRINK after approval removes a package path
  await run(e => { e.live.set('assignments', 'a-1', { state: 'PAUSED' }) }, 'ASSIGNMENT_INACTIVE'); await run(e => { e.live.set('missions', 'm-1', { status: 'VALIDATING' }) }, 'MISSION_INACTIVE')
  await run(e => { e.live.set('missions', 'm-1', { pauseRequested: true }) }, 'MISSION_INACTIVE'); await run(e => { e.live.agents.set('agent-eng', { state: 'PAUSED' }) }, 'ASSIGNMENT_INACTIVE')
  { const { e, b, id } = await run(e => e.live.set('assignments', 'a-1', { state: 'PAUSED' }), 'ASSIGNMENT_INACTIVE'); e.live.set('assignments', 'a-1', { state: 'RUNNING' }); assert.equal((await b.execute('tok-cmd', id, CTX)).state, 'VERIFIED_SOURCE', 'authority restored: same approval works') }
  { const e = env(), b = boot(e), id = ready(b); e.live.mission().writeSet.paths = [...e.live.mission().writeSet.paths, 'more/new.mjs']; e.live.mission().updatedAt = '2026-10-09T00:00:00.000Z'; e.live.mission().controlRevision = 99
    assert.equal((await b.execute('tok-cmd', id, CTX)).state, 'VERIFIED_SOURCE', 'unrelated scope expansion / mission revision bump does not invalidate the approval (package stays narrower)') }
})

test('OW8 live authority wins mid-run: assignment pause => PAUSED (no rollback); mission cancel => CANCELLED + rollback even with a broker-local pause; terminal => stop; unreadable/phase change => pause; no resume while paused/terminal', async () => {
  { const e = env(); let b; b = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') e.live.set('assignments', 'a-1', { state: 'PAUSED' }) } }); const id = ready(b), ino = (() => null)()
    const out = await b.execute('tok-cmd', id, CTX); assert.equal(out.state, 'PAUSED'); assert.equal(out.pause.actor, 'host-authority'); assert.equal(rd(e, 'src/a.mjs'), A1); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')), 'second write never started'); assert.equal(out.claims.sourceValidated, false); void ino
    assert.equal((await failing(() => boot(e).resume('tok-cmd', id, CTX))).code, 'ASSIGNMENT_INACTIVE'); assert.equal(rd(e, 'src/a.mjs'), A1)
    e.live.set('assignments', 'a-1', { state: 'RUNNING' }); const inoA = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino; const done = await boot(e).resume('tok-cmd', id, CTX); assert.equal(done.state, 'VERIFIED_SOURCE'); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, inoA, 'completed write not repeated') }
  { const e = env(); let b; b = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') { b.pause('tok-op', id, CTX, { reason: 'local' }); e.live.set('missions', 'm-1', { cancelRequested: true }) } } }); const id = ready(b)
    const out = await b.execute('tok-cmd', id, CTX); assert.match(out.state, /^CANCELLED/); assert.equal(out.report, 'CANCELLED'); assert.equal(out.cancel.request.actor, 'host-authority'); assert.equal(out.cancel.request.disposition, 'ROLLBACK'); assert.equal(rd(e, 'src/a.mjs'), A0, 'rolled back under the valid lease'); assert.ok(!fs.existsSync(path.join(e.ws, 'lib'))); assert.equal(out.claims.sourceValidated, false)
    assert.ok(['BROKER_STATE', 'MISSION_INACTIVE'].includes((await failing(() => boot(e).resume('tok-cmd', id, CTX))).code), 'terminal: no resume'); assert.equal(rd(e, 'src/a.mjs'), A0) }
  for (const [name, mutate, want] of [['assignment completed externally', e => e.live.set('assignments', 'a-1', { state: 'COMPLETED' }), /^CANCELLED/], ['mission FAILED externally', e => e.live.set('missions', 'm-1', { status: 'FAILED' }), /^CANCELLED/], ['assignment cancel requested', e => e.live.set('assignments', 'a-1', { state: 'CANCEL_REQUESTED' }), /^CANCELLED/],
    ['mission phase changed', e => e.live.set('missions', 'm-1', { status: 'VALIDATING' }), /^PAUSED$/], ['mission pause requested', e => e.live.set('missions', 'm-1', { pauseRequested: true }), /^PAUSED$/], ['agent no longer ACTIVE', e => e.live.agents.set('agent-eng', { state: 'PAUSED' }), /^PAUSED$/], ['ownership rebound', e => { e.live.asg().assignment = { ...e.live.asg().assignment, taskClass: 'other' } }, /^PAUSED$/],
    ['scope revoked', e => { e.live.mission().writeSet.paths = ['src/a.mjs'] }, /^PAUSED$/]]) {
    const e = env(), b = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') mutate(e) } }), id = ready(b), out = await b.execute('tok-cmd', id, CTX); assert.match(out.state, want, name); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')), `${name}: no consequential step after the change`); assert.equal(out.claims.sourceValidated, false)
    if (want.test('PAUSED')) assert.equal(rd(e, 'src/a.mjs'), A1, `${name}: pause never rolls back blindly`); else assert.equal(rd(e, 'src/a.mjs'), A0, `${name}: authority ended => rolled back under lease`) }
  { const e = env(); let down = false; const flaky = { ...e.host, missions: { verifyAssignment: e.live.bridge.verifyAssignment, resolve: x => { if (down) throw new Error('mission store down'); return e.live.bridge.resolve(x) } } }
    const b = boot(e, { host: flaky, afterWrite: p => { if (p === 'src/a.mjs') down = true } }), id = ready(b), out = await b.execute('tok-cmd', id, CTX); assert.equal(out.state, 'PAUSED'); assert.equal(out.pause.reason, 'OWNERSHIP_UNAVAILABLE'); assert.equal(rd(e, 'src/a.mjs'), A1, 'unreadable authority pauses; it never rolls back blindly') }
})

function crash(e, point) {
  const code = `
    import { createBroker } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/broker.mjs'))}
    import { createFakeHost } from ${JSON.stringify(path.join(here, 'fake-host.mjs'))}
    import { createLiveModel } from ${JSON.stringify(path.join(here, 'ownership-fixture.mjs'))}
    const live = createLiveModel(process.env.WS), host = createFakeHost({ workspaces: { 'ws-1': { id: 'ws-1', root: process.env.WS } } }); host.missions = { verifyAssignment: live.bridge.verifyAssignment, resolve: live.bridge.resolve }
    host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); const ctx = ${JSON.stringify(CTX)}
    const b = createBroker({ brokerId: 'broker-1', controlRoot: process.env.CTL, evidenceRoot: process.env.EV, host, leaseTtlMs: 200, afterWrite: p => { if (p === ${JSON.stringify(point)}) process.kill(process.pid, 'SIGKILL') } })
    const { execId } = b.importPackage('tok-cmd', process.env.PKG, ctx); b.approve('tok-cmd', execId, ctx); await b.execute('tok-cmd', execId, ctx)`
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, CTL: e.control, EV: e.evidence, WS: e.ws, PKG: PKG() }, timeout: 20000 }); assert.equal(res.signal, 'SIGKILL', String(res.stderr))
  return fs.readdirSync(path.join(e.control, 'broker/exec'))[0].slice(0, -5)
}

test('OW9 crash/recovery re-reads host authority: unchanged => resume works; cancelled/retired/interrupted/terminal => no resume; scope changed/rebound/unavailable => refused; restore stays available for cleanup (except rebound/unavailable)', async () => {
  const scenario = async mutate => { const e = env(), id = crash(e, 'src/a.mjs'); await sleep(260); mutate?.(e); return { e, id, b: boot(e) } }
  { const { e, id, b } = await scenario(); assert.deepEqual(b.recoverAll('tok-cmd')[0].authority, { resume: 'PERMITTED' }); const ino = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino
    const done = await b.recoverRun('tok-cmd', id, 'RESUME', CTX); assert.equal(done.projection.state, 'VERIFIED_SOURCE'); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, ino, 'completed write not repeated'); assert.equal(done.projection.report, 'SOURCE_VALIDATED') }
  for (const [name, mut, code] of [['assignment CANCELLED while down', e => e.live.set('assignments', 'a-1', { state: 'CANCELLED' }), 'ASSIGNMENT_INACTIVE'], ['assignment INTERRUPTED by live recovery', e => e.live.set('assignments', 'a-1', { state: 'INTERRUPTED' }), 'ASSIGNMENT_INACTIVE'],
    ['assignment COMPLETED while down', e => e.live.set('assignments', 'a-1', { state: 'COMPLETED' }), 'ASSIGNMENT_INACTIVE'], ['assignment HANDED_OFF', e => e.live.set('assignments', 'a-1', { state: 'HANDED_OFF' }), 'ASSIGNMENT_INACTIVE'],
    ['mission terminal (COMPLETE)', e => e.live.set('missions', 'm-1', { status: 'COMPLETE' }), 'MISSION_INACTIVE'], ['mission CANCELLED', e => e.live.set('missions', 'm-1', { status: 'CANCELLED' }), 'MISSION_INACTIVE'], ['assignment PAUSED', e => e.live.set('assignments', 'a-1', { state: 'PAUSED' }), 'ASSIGNMENT_INACTIVE']]) {
    const { e, id, b } = await scenario(mut), scan = b.recoverAll('tok-cmd')[0]; assert.deepEqual([scan.authority.resume, scan.authority.code], ['REFUSED', code], name); assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, code, name); assert.equal(rd(e, 'src/a.mjs'), A1, `${name}: nothing touched by refused resume`)
    if (name !== 'assignment PAUSED') { const r = await b.recoverRun('tok-cmd', id, 'RESTORE', CTX); assert.equal(r.final, 'RESTORED', `${name}: restore (cleanup) is allowed under terminal authority`); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(r.projection.state, 'RECOVERED_ROLLED_BACK'); assert.equal(r.projection.report, 'ROLLED_BACK'); assert.equal(r.projection.claims.missionComplete, false) } }
  { const { e, id, b } = await scenario(e => { e.live.mission().writeSet.paths = [...e.live.mission().writeSet.paths, 'new/elsewhere.mjs'] }); const err = await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX)); assert.equal(err.code, 'RECOVERY_NOT_ALLOWED'); assert.equal(err.observed, 'SCOPE_CHANGED_REVIEW_REQUIRED'); assert.equal(rd(e, 'src/a.mjs'), A1)
    assert.equal((await b.recoverRun('tok-cmd', id, 'RESTORE', CTX)).final, 'RESTORED') }
  { const { e, id, b } = await scenario(e => { e.live.mission().writeSet.paths = ['src/a.mjs'] }); assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'WRITE_SCOPE_DENIED'); assert.equal(rd(e, 'src/a.mjs'), A1); assert.equal((await b.recoverRun('tok-cmd', id, 'RESTORE', CTX)).final, 'RESTORED', 'shrink: cleanup still allowed') }
  { const { e, id, b } = await scenario(e => { e.live.asg().assignment = { ...e.live.asg().assignment, agentId: 'agent-2' }; e.live.agents.set('agent-2', { state: 'ACTIVE' }) }); for (const act of ['RESUME', 'RESTORE', 'RECONCILE']) assert.equal((await failing(() => b.recoverRun('tok-cmd', id, act, CTX))).code, 'OWNERSHIP_CHANGED', act); assert.equal(rd(e, 'src/a.mjs'), A1) }
  { const { e, id, b } = await scenario(e => e.live.missions.delete('m-1')); assert.equal(b.recoverAll('tok-cmd')[0].authority.code, 'OWNERSHIP_UNAVAILABLE'); for (const act of ['RESUME', 'RESTORE', 'RECONCILE']) assert.equal((await failing(() => b.recoverRun('tok-cmd', id, act, CTX))).code, 'OWNERSHIP_UNAVAILABLE', act); assert.equal(rd(e, 'src/a.mjs'), A1) }
})

test('OW10 completion honesty: success, validation failure, cancel and rollback never touch mission/assignment lifecycle; reports are source-level only; events cannot claim mission/assignment completion', async () => {
  const REPORTS = ['SOURCE_VALIDATED', 'SOURCE_FAILED', 'ROLLED_BACK', 'CANCELLED', 'NEEDS_REVIEW']
  const failChecks = [{ id: 'audit', version: '1', role: 'dependency-audit', source: 'audit-impl-v1', run: async () => ({ status: 'PASS', evidence: 'ok' }) }, { id: 'behavior', version: '1', role: 'behavior', source: 'behavior-impl-v1', run: async () => ({ status: 'FAIL', evidence: 'nope' }) }]
  const flows = [['success', env(), async (e, b, id) => b.execute('tok-cmd', id, CTX), 'SOURCE_VALIDATED'], ['validation failure', env(undefined, { checks: failChecks }), async (e, b, id) => b.execute('tok-cmd', id, CTX), 'SOURCE_FAILED'],
    ['broker-local cancel before start', env(), async (e, b, id) => { b.cancel('tok-cmd', id, CTX, { reason: 'x' }); return b.execute('tok-cmd', id, CTX).catch(x => ({ state: 'REFUSED', report: 'NEEDS_REVIEW', claims: {} })) }, null]]
  for (const [name, e, go, want] of flows) { const b = boot(e), id = ready(b), before = e.live.snapshot(), out = await go(e, b, id); assert.equal(e.live.snapshot(), before, `${name}: live mission/assignment records byte-identical`)
    if (want) assert.equal(out.report, want, name); assert.ok(REPORTS.includes(out.report), `${name}: ${out.report}`); assert.ok(!out.claims.missionComplete && !out.claims.assignmentComplete && !out.claims.taskComplete && !out.claims.built && !out.claims.installed, name) }
  const e = env(), b = boot(e), id = ready(b); await b.execute('tok-cmd', id, CTX); const ev = e.host.phase9Sink.state.events[0]
  for (const k of ['missionComplete', 'assignmentComplete', 'built', 'taskComplete']) assert.throws(() => validateOutcomeEvent({ ...ev, claims: { ...ev.claims, [k]: true } }), /claims beyond source validation|built claimed without|packaged claimed without/, k)
  assert.deepEqual(Object.keys(e.host.missions).sort(), ['resolve', 'verifyAssignment']); assert.ok(!/MISSION_COMPLETE|ASSIGNMENT_COMPLETE|BUILD_COMPLETE|INSTALL_COMPLETE/.test(JSON.stringify(b.status('tok-cmd', id)) + JSON.stringify(ev)))
})

test('OW11 review regressions: request-id replay cannot outlive authority; strict facts override a permissive legacy verifier; revoked write tool/owner change after approval; cleanup after host terminal state; no broker-local override of host cancel', async () => {
  { const e = env(), b = boot(e), id = ready(b); assert.equal((await b.execute('tok-cmd', id, CTX, { requestId: 'req-1' })).state, 'VERIFIED_SOURCE'); e.live.set('assignments', 'a-1', { state: 'COMPLETED' })
    assert.equal((await failing(() => b.execute('tok-cmd', id, CTX, { requestId: 'req-1' }))).code, 'ASSIGNMENT_INACTIVE', 'a cached result is never served to a caller whose authority ended') }
  { const e = env(); e.host.missions = { verifyAssignment: () => true, resolve: () => null }; const b = boot(e); assert.equal((await failing(async () => b.importPackage('tok-cmd', PKG(), CTX))).code, 'OWNERSHIP_UNAVAILABLE'); assert.equal(execCount(e), 0) }
  { const e = env(); e.host.missions = { verifyAssignment: () => false, resolve: e.live.bridge.resolve }; assert.equal((await failing(async () => boot(e).importPackage('tok-cmd', PKG(), CTX))).code, 'ASSIGNMENT_INACTIVE', 'the host actor-aware verdict must also agree') }
  { const e = env(), b = boot(e), id = ready(b); e.live.asg().assignment = { ...e.live.asg().assignment, tools: ['read_workspace'] }; assert.equal((await failing(() => b.execute('tok-cmd', id, CTX))).code, 'WRITE_SCOPE_DENIED'); untouched(e) }
  { const e = env(); let b; b = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') e.live.set('assignments', 'a-1', { state: 'PAUSED' }) } }); const id = ready(b); assert.equal((await b.execute('tok-cmd', id, CTX)).state, 'PAUSED')
    e.live.set('assignments', 'a-1', { state: 'CANCELLED' }); assert.equal((await failing(async () => b.cancel('tok-cmd', id, CTX, { reason: 'late' }))).code, 'ASSIGNMENT_INACTIVE', 'new package-work controls need a live assignment')
    const r = await boot(e).recoverRun('tok-cmd', id, 'RESTORE', CTX); assert.equal(r.final, 'RESTORED'); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(r.projection.state, 'RECOVERED_ROLLED_BACK') }
  { const e = env(undefined, { policy: { allowRetain: () => true } }); let b; b = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') { b.cancel('tok-cmd', id, CTX, { reason: 'retain', disposition: 'RETAIN' }); e.live.set('missions', 'm-1', { cancelRequested: true }) } } }); const id = ready(b)
    const out = await b.execute('tok-cmd', id, CTX); assert.match(out.state, /^CANCELLED/); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')), 'no further step after host cancel'); assert.equal(out.cancel.request.actor, 'host-authority', 'host cancel is observed before the broker-local RETAIN record')
    assert.equal(out.cancel.request.disposition, 'ROLLBACK'); assert.equal(rd(e, 'src/a.mjs'), A0, 'live authority wins: rolled back, not retained') }
})

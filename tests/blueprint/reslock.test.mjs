/* eslint-disable @typescript-eslint/no-unused-vars -- reference suite ported verbatim from the isolated implementation (terse style) */
// Step 4: resource-lock / workspace-lease seam. Hermetic: models the live REPO_WRITE lock (foundryRepoWriteLocks.ts semantics) and never touches live War Room.
// RL13 uses REAL child processes and real pid liveness (kill -0) against a file-persisted model registry.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBaseIdentityAdapter, createLeaseAdapter } from '../../lib/native-builder/blueprint/adapters.mjs'
import { hash } from '../../lib/native-builder/blueprint/base.mjs'
import { createBroker } from '../../lib/native-builder/blueprint/broker.mjs'
import { createControlPlane } from '../../lib/native-builder/blueprint/control.mjs'
import { classifyHolder, createLiveLockModel, createLiveShapedBacking, createReadOnlyLockBridge, describeHolder, holderIdFor, leaseBindingOf, normalizeLockClaim, operationFor } from '../../lib/native-builder/blueprint/reslock.mjs'
import { createFakeHost } from './fake-host.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = fs.mkdtempSync(path.join(here, '.fixtures-rl-'))
after(() => fs.rmSync(base, { recursive: true, force: true }))
const A0 = 'export const a = 1\n', A1 = 'export const a = 2\n', C1 = "import { a } from '../src/a.mjs'\nexport const c = a\n"
const CTX = { missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1', requestingSubsystem: 'foundry' }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const codeOf = fn => { try { fn() } catch (x) { return x } assert.fail('expected throw') }
const failing = async fn => { try { await fn() } catch (x) { return x } assert.fail('expected rejection') }
const PKG = () => JSON.stringify({ version: 1, id: 'pkg-1', goal: 'Bump a and add c', workspace: { id: 'ws-1', baseRevision: 'rev1' },
  changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }, { path: 'lib/new/c.mjs', operation: 'create', beforeHash: null, content: C1 }],
  dependencies: [], checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '1' }], permissions: { writePaths: ['src/a.mjs', 'lib/new/c.mjs'] },
  artifact: { path: 'src/a.mjs', sha256: hash(A1), kind: 'source-file' }, research: [], recipe: { id: 'r', version: '1', applicability: 'demo', provenance: 'manual' } })
const mkChecks = (e, hooks = {}) => [
  { id: 'audit', version: '1', role: 'dependency-audit', source: 'audit-impl-v1', run: async () => { hooks.audit?.(); return { status: 'PASS', evidence: 'audit ok' } } },
  { id: 'behavior', version: '1', role: 'behavior', source: 'behavior-impl-v1', run: async () => { hooks.behavior?.(); return { status: 'PASS', evidence: 'ok' } } },
]
function env({ hooks, backing = 'live', ws2 = true } = {}) {
  const dir = fs.mkdtempSync(path.join(base, 't-')), ws = path.join(dir, 'ws'); fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/a.mjs'), A0)
  const e = { dir, ws: fs.realpathSync(ws), control: path.join(dir, 'control'), evidence: path.join(dir, 'evidence'), offset: 0, hooks: hooks ?? {}, model: createLiveLockModel({ localHost: true }) }
  e.now = () => Date.now() + e.offset
  e.rootOf = id => ({ root: e.ws, fileIds: [] })
  e.backing = createLiveShapedBacking({ model: e.model, rootOf: e.rootOf, pid: 4242 }); e.model.setPid(4242, true)
  e.host = createFakeHost({ now: e.now, workspaces: { 'ws-1': { id: 'ws-1', root: e.ws }, ...(ws2 ? { 'ws-2': { id: 'ws-2', root: e.ws } } : {}) }, checks: mkChecks(e, { audit: () => e.hooks.audit?.(), behavior: () => e.hooks.behavior?.() }), rev: { 'ws-1': 'rev1', 'ws-2': 'rev1' } })
  e.host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); e.host.issue('tok-op', { actorId: 'op1', role: 'operator', sessionId: 'sess-op-0001' }); e.host.issue('tok-view', { actorId: 'v1', role: 'viewer', sessionId: 'sess-view-001' })
  e.host.assignments.add('m-1|a-1|ws-1'); e.host.assignments.add('m-1|a-2|ws-1'); e.host.assignments.add('m-2|a-1|ws-1'); e.host.assignments.add('m-1|a-1|ws-2')
  e.useLive = backing === 'live'
  return e
}
const boot = (e, o = {}) => createBroker({ brokerId: o.brokerId ?? 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: o.host ?? e.host, now: e.now, leaseTtlMs: 60_000, checkTimeoutMs: 2000,
  leaseBacking: o.backing === null ? undefined : (o.backing ?? (e.useLive ? e.backing : undefined)), faultHook: o.faultHook, afterWrite: o.afterWrite })
const rd = (e, rel) => fs.readFileSync(path.join(e.ws, rel), 'utf8')
const ready = (b, ctx = CTX, raw = PKG(), tok = 'tok-cmd') => { const { execId } = b.importPackage(tok, raw, ctx); b.approve(tok, execId, ctx); return execId }
const loadExec = (e, id) => JSON.parse(fs.readFileSync(path.join(e.control, 'broker/exec', `${id}.json`), 'utf8'))
const H = { brokerId: 'broker-1', missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1' }

test('RL1 live claim normalization is strict: only scoped REPO_WRITE claims normalize; unknown keys, legacy/unscoped, bad pid/scope => null (never "free")', () => {
  const good = { resource: 'REPO_WRITE', missionId: 'm-1', callId: 'c-1', pid: 99, acquiredAt: '2026-10-07T00:00:00.000Z', heartbeatAt: '2026-10-07T00:01:00.000Z', exclusive: true, operation: operationFor('bp-abc'), paths: [], repoWriteScope: { version: 1, workspaceRoot: '/w', targets: ['/w/a'], fileIds: ['1:2'] } }
  const n = normalizeLockClaim(good); assert.deepEqual([n.leaseId, n.holder, n.foreign, n.workspaceRoot, n.expiresAt, n.targetCount], ['c-1', 'bp-abc', false, '/w', null, 1]); assert.ok(Object.isFrozen(n))
  assert.equal(normalizeLockClaim({ ...good, operation: 'someone elses free text token=LEAK' }).holder, null); assert.ok(!JSON.stringify(normalizeLockClaim({ ...good, operation: 'free text LEAK' })).includes('LEAK'))
  const { repoWriteScope, ...legacy } = good
  for (const bad of [null, [], { ...good, extra: 1 }, { ...good, token: 'x' }, legacy, { ...good, resource: 'BUILD_PIPELINE' }, { ...good, pid: -1 }, { ...good, pid: 1.5 }, { ...good, callId: '' }, { ...good, acquiredAt: 'nope' },
    { ...good, repoWriteScope: { ...repoWriteScope, version: 2 } }, { ...good, repoWriteScope: { ...repoWriteScope, workspaceRoot: 'rel' } }, { ...good, repoWriteScope: { ...repoWriteScope, fileIds: ['x'] } }, { ...good, repoWriteScope: { ...repoWriteScope, secret: 1 } }]) assert.equal(normalizeLockClaim(bad), null, JSON.stringify(bad).slice(0, 80))
})

test('RL2 holder identity: stable across restarts, differs per broker/mission/assignment/workspace, never derived from pid/session; audit record is strict and secret-free', () => {
  const id = holderIdFor(H); assert.match(id, /^bp-[a-f0-9]{32}$/); assert.equal(holderIdFor({ ...H }), id)
  for (const k of ['brokerId', 'missionId', 'assignmentId', 'workspaceId']) assert.notEqual(holderIdFor({ ...H, [k]: 'other' }), id, k)
  assert.throws(() => holderIdFor({ ...H, missionId: '' }), /holder field/); assert.throws(() => holderIdFor({ ...H, assignmentId: 'a b;c' }), /holder field/)
  const rec = describeHolder({ holderId: id, processId: 123, sessionId: 'lses_x', missionId: 'm-1', assignmentId: 'a-1', brokerInstanceId: 'inst-1', acquiredAt: 5 }); assert.equal(rec.processId, 123)
  assert.throws(() => describeHolder({ holderId: id, token: 'x' }), /holder record/)
  const lb = { workspaceId: 'ws-1', baseIdentity: 'rev1', missionId: 'm-1', assignmentId: 'a-1', holder: id }, b0 = leaseBindingOf(lb)
  for (const [k, v] of [['workspaceId', 'ws-2'], ['baseIdentity', 'rev2'], ['missionId', 'm-2'], ['assignmentId', 'a-2'], ['holder', 'bp-other']]) assert.notEqual(leaseBindingOf({ ...lb, [k]: v }), b0, k)
})

test('RL3 holder-death classification: UNKNOWN never permits takeover; a late heartbeat or invisible process proves nothing', () => {
  const lease = { expiresAt: null, heartbeatAt: 0 }
  assert.equal(classifyHolder(lease, { pidAlive: true, localHost: true, now: 9e12 }), 'PROVEN_ALIVE') // ancient heartbeat, live pid: live never evicts a REPO_WRITE holder
  assert.equal(classifyHolder(lease, { pidAlive: false, localHost: true }), 'PROVEN_DEAD')
  assert.equal(classifyHolder(lease, { pidAlive: false, localHost: false }), 'UNKNOWN') // pid absent on another host/namespace proves nothing
  for (const p of [{}, { pidAlive: null, localHost: true }, { pidAlive: undefined, localHost: true }, { pidAlive: 'dead', localHost: true }]) assert.equal(classifyHolder(lease, p), 'UNKNOWN')
  assert.equal(classifyHolder(null, { pidAlive: false, localHost: true }), 'UNKNOWN')
  assert.equal(classifyHolder({ expiresAt: 1000 }, { now: 1000 }), 'LEASE_EXPIRED'); assert.notEqual(classifyHolder({ expiresAt: 1000 }, { now: 999 }), 'LEASE_EXPIRED')
})

test('RL4 read-only lock bridge: inspects only; unreadable/legacy claims keep exclusion (UNKNOWN, never FREE); takeover permitted only for proven-dead holders', async () => {
  const claim = (over = {}) => ({ resource: 'REPO_WRITE', missionId: 'm-9', callId: 'c-9', pid: 77, acquiredAt: new Date().toISOString(), heartbeatAt: new Date(0).toISOString(), exclusive: true, operation: 'something', paths: [], repoWriteScope: { version: 1, workspaceRoot: '/repo', targets: [], fileIds: [] }, ...over })
  let claims = [claim()], probe = { alive: true, localHost: true }; const frozen = JSON.stringify(claims)
  const br = createReadOnlyLockBridge({ listClaims: async () => claims, probe: () => probe })
  assert.deepEqual(Object.keys(br), ['inspectRoot']); assert.ok(Object.isFrozen(br))
  let r = await br.inspectRoot('/repo/sub'); assert.deepEqual([r.state, r.holders[0].classification, r.holders[0].foreign, r.takeoverPermitted], ['HELD', 'PROVEN_ALIVE', true, false]); assert.ok(r.holders[0].heartbeatAgeMs > 1e9)
  probe = { alive: false, localHost: true }; r = await br.inspectRoot('/repo'); assert.deepEqual([r.holders[0].classification, r.takeoverPermitted], ['PROVEN_DEAD', true])
  probe = { alive: false, localHost: false }; r = await br.inspectRoot('/repo'); assert.deepEqual([r.holders[0].classification, r.takeoverPermitted], ['UNKNOWN', false])
  claims = [claim({ repoWriteScope: undefined }), claim({ extra: 1 })]; r = await br.inspectRoot('/other'); assert.equal(r.state, 'HELD'); assert.ok(r.holders.every(h => h.classification === 'UNKNOWN') && !r.takeoverPermitted) // unscoped/malformed: machine-wide exclusion
  claims = [claim({ resource: 'BUILD_PIPELINE' }), claim({ repoWriteScope: { version: 1, workspaceRoot: '/unrelated', targets: [], fileIds: [] } })]; assert.equal((await br.inspectRoot('/repo')).state, 'FREE')
  for (const bad of [() => { throw new Error('boom LEAK') }, () => 'nope']) { const b2 = createReadOnlyLockBridge({ listClaims: bad, probe: () => probe }); r = await b2.inspectRoot('/repo'); assert.deepEqual([r.state, r.reason], ['UNKNOWN', 'LOCK_SOURCE_UNAVAILABLE']); assert.ok(!JSON.stringify(r).includes('LEAK')) }
  assert.equal(frozen, JSON.stringify([claim()].map(c => ({ ...c, acquiredAt: JSON.parse(frozen)[0].acquiredAt })))) // listing was not mutated
  assert.throws(() => createReadOnlyLockBridge({}), /required/)
})

test('RL5 live-lock model fidelity: same mission+pid adopts; dead-pid claims are reclaimed; heartbeat/release are silent no-ops when the claim is gone; roots overlap by nesting', () => {
  const m = createLiveLockModel(), args = { missionId: 'm-1', operation: 'op', workspaceRoot: '/w', pid: 10 }; m.setPid(10, true); m.setPid(11, true)
  const a = m.acquire(args), b = m.acquire(args); assert.equal(a.claim.callId, b.claim.callId, 'live adopts own claim (generation unchanged)'); assert.equal(m.acquire({ ...args, adopt: false }).state, 'BUSY')
  assert.equal(m.acquire({ ...args, missionId: 'm-2', workspaceRoot: '/w/sub', pid: 11 }).state, 'BUSY', 'nested root overlaps'); assert.equal(m.acquire({ ...args, missionId: 'm-2', workspaceRoot: '/x', pid: 11 }).state, 'ACQUIRED')
  assert.equal(m.acquire({ ...args, pid: 11 }).state, 'BUSY', 'same mission, other pid: busy'); m.setPid(10, false)
  const t = m.acquire({ ...args, pid: 11 }); assert.equal(t.state, 'ACQUIRED'); assert.notEqual(t.claim.callId, a.claim.callId, 'takeover mints a NEW generation token'); assert.equal(t.dropped[0].pid, 10)
  m.forceDrop(t.claim.callId); assert.equal(m.heartbeat('m-1', t.claim.callId), undefined); assert.equal(m.release('m-1', t.claim.callId), false)
})

test('RL6 lease adapter over live-shaped lock: acquire never adopts/steals (even same holder), refuses other missions/aliased workspaces/foreign Foundry owners; heartbeat detects silent loss', () => {
  const e = env(), L = createLeaseAdapter({ backing: e.backing, holderId: 'broker-1' }), h1 = holderIdFor(H)
  const lease = L.acquire({ workspaceId: 'ws-1', holder: h1, meta: { missionId: 'm-1' } }); assert.ok(L.verify(lease)); assert.equal(L.info(lease).holder, h1); assert.equal(L.info(lease).expiresAt, null)
  assert.equal(e.model.list()[0].operation, operationFor(h1)); assert.equal(e.model.list()[0].missionId, 'm-1')
  for (const [ws, holder, mission] of [['ws-1', h1, 'm-1'], ['ws-1', holderIdFor({ ...H, assignmentId: 'a-2' }), 'm-1'], ['ws-1', holderIdFor({ ...H, missionId: 'm-2' }), 'm-2'], ['ws-2', holderIdFor({ ...H, workspaceId: 'ws-2' }), 'm-1']]) {
    assert.equal(codeOf(() => L.acquire({ workspaceId: ws, holder, meta: { missionId: mission } })).code, 'LEASE_HELD', `${ws}/${holder.slice(0, 6)}/${mission}`) // same holder, other assignment, other mission, aliased workspace
  }
  assert.equal(codeOf(() => L.acquire({ workspaceId: 'ws-1', holder: h1 })).code, 'LEASE_HELD') // missing mission context
  assert.equal(L.inspect('ws-2').holder, h1, 'alias sees the same physical lock'); assert.ok(L.heartbeat(lease)); assert.ok(L.release(lease)); assert.equal(L.verify(lease), false)
  const l2 = L.acquire({ workspaceId: 'ws-1', holder: h1, meta: { missionId: 'm-1' } }); e.model.forceDrop(l2.leaseId) // another actor reclaimed it; live heartbeat would return void
  assert.equal(L.heartbeat(l2), false, 'adapter turns live silent loss into an explicit false'); assert.equal(L.verify(l2), false)
  e.model.acquire({ missionId: 'm-77', operation: 'foundry-runtime', workspaceRoot: e.ws, pid: 5000 }); e.model.setPid(5000, true) // a foreign Foundry mission owns the repo
  const err = codeOf(() => L.acquire({ workspaceId: 'ws-1', holder: h1, meta: { missionId: 'm-1' } })); assert.equal(err.code, 'LEASE_HELD'); assert.equal(L.inspect('ws-1').holder, 'foreign:m-77')
})

test('RL7 holder-death rules on live-shaped lock: alive/UNKNOWN block even with an assertion; no cross-process reattach; proven-dead (local host) permits takeover with a new generation; non-local host stays UNKNOWN', () => {
  const e = env(), h1 = holderIdFor(H), other = createLiveShapedBacking({ model: e.model, rootOf: e.rootOf, pid: 4343 }); e.model.setPid(4343, true)
  const L1 = createLeaseAdapter({ backing: e.backing, holderId: 'broker-1' }), L2 = createLeaseAdapter({ backing: other, holderId: 'broker-1' })
  const lease = L1.acquire({ workspaceId: 'ws-1', holder: h1, meta: { missionId: 'm-1' } }), prev = { leaseId: lease.leaseId, holder: h1 }, dead = { leaseId: lease.leaseId }
  assert.equal(codeOf(() => L1.acquireForRecovery({ workspaceId: 'ws-1', previous: prev, holder: h1, meta: { missionId: 'm-1' } })).code, 'HOLDER_DEATH_REQUIRED')
  assert.ok(L1.verify(L1.acquireForRecovery({ workspaceId: 'ws-1', previous: prev, holderDead: dead, holder: h1, meta: { missionId: 'm-1' } })), 'same process + same holder + assertion: reattach')
  assert.equal(codeOf(() => L2.acquireForRecovery({ workspaceId: 'ws-1', previous: prev, holderDead: dead, holder: h1, meta: { missionId: 'm-1' } })).code, 'LEASE_LOST', 'a different (alive) process can never silently reattach')
  assert.equal(codeOf(() => L2.acquireForRecovery({ workspaceId: 'ws-1', previous: prev, holderDead: dead, holder: holderIdFor({ ...H, assignmentId: 'a-2' }), meta: { missionId: 'm-1' } })).code, 'LEASE_HELD', 'a different assignment/holder is refused even with an assertion')
  e.model.setPid(4242, null); assert.equal(L2.inspect('ws-1').classification, 'UNKNOWN'); assert.equal(L2.inspect('ws-1').valid, true)
  assert.equal(codeOf(() => L2.acquireForRecovery({ workspaceId: 'ws-1', previous: prev, holderDead: dead, holder: h1, meta: { missionId: 'm-1' } })).code, 'LEASE_LOST', 'UNKNOWN + assertion still cannot take over')
  assert.equal(codeOf(() => L2.acquire({ workspaceId: 'ws-1', holder: h1, meta: { missionId: 'm-1' } })).code, 'LEASE_HELD')
  e.model.setPid(4242, false); e.model.localHost = false; assert.equal(L2.inspect('ws-1').classification, 'UNKNOWN', 'dead pid on an unattested host is UNKNOWN'); assert.equal(codeOf(() => L2.acquire({ workspaceId: 'ws-1', holder: h1, meta: { missionId: 'm-1' } })).code, 'LEASE_HELD')
  e.model.localHost = true; assert.equal(L2.inspect('ws-1').classification, 'PROVEN_DEAD'); const t = L2.acquireForRecovery({ workspaceId: 'ws-1', previous: prev, holder: h1, meta: { missionId: 'm-1' } })
  assert.notEqual(t.leaseId, lease.leaseId, 'takeover = new generation'); assert.equal(t.epoch, 2); assert.ok(L2.verify(t)); assert.equal(L1.verify(lease), false, 'the dead holder\'s handle is lost')
})

test('RL8 broker end-to-end on live-shaped lock: claim carries mission + holder; lease bound to workspace/base/mission/assignment; lock released; Phase 9 and claims stay honest', async () => {
  const e = env(), b = boot(e), id = ready(b); let seen
  e.hooks.audit = () => { seen = e.model.list() }
  const out = await b.execute('tok-cmd', id, CTX); assert.equal(out.state, 'VERIFIED_SOURCE'); assert.equal(rd(e, 'src/a.mjs'), A1)
  assert.equal(seen.length, 1); assert.deepEqual([seen[0].missionId, seen[0].operation, seen[0].repoWriteScope.workspaceRoot], ['m-1', operationFor(holderIdFor(H)), e.ws])
  const x = loadExec(e, id); assert.equal(x.lease.holder, holderIdFor(H)); assert.equal(x.lease.bindingHash, leaseBindingOf({ workspaceId: 'ws-1', baseIdentity: 'rev1', missionId: 'm-1', assignmentId: 'a-1', holder: holderIdFor(H) }))
  assert.equal(e.model.list().length, 0, 'released'); assert.deepEqual([out.claims.built, out.claims.packaged, out.claims.installed, out.claims.taskComplete], [false, false, false, false])
})

test('RL9 concurrent owners are refused before any mutation: foreign Foundry mission, another assignment, aliased workspace id, manual-process gap documented; approval is not burned', async () => {
  const e = env(), b = boot(e), id = ready(b)
  e.model.acquire({ missionId: 'm-77', operation: 'foundry-runtime', workspaceRoot: e.ws, pid: 5000 }); e.model.setPid(5000, true)
  assert.equal((await failing(() => b.execute('tok-cmd', id, CTX))).code, 'LEASE_HELD'); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(loadExec(e, id).state, 'APPROVED')
  e.model.forceDrop(e.model.list()[0].callId)
  const lease = createLeaseAdapter({ backing: e.backing, holderId: 'broker-1' }).acquire({ workspaceId: 'ws-1', holder: holderIdFor({ ...H, assignmentId: 'a-2' }), meta: { missionId: 'm-1' } }) // sibling assignment, SAME mission (live would adopt it)
  assert.equal((await failing(() => b.execute('tok-cmd', id, CTX))).code, 'LEASE_HELD'); lease.release()
  const c2 = { ...CTX, workspaceId: 'ws-2' }, id2 = ready(b, c2, PKG().replace('"id":"ws-1"', '"id":"ws-2"')); const held = createLeaseAdapter({ backing: e.backing, holderId: 'broker-1' }).acquire({ workspaceId: 'ws-1', holder: holderIdFor(H), meta: { missionId: 'm-1' } })
  assert.equal((await failing(() => b.execute('tok-cmd', id2, c2))).code, 'LEASE_HELD', 'ws-2 aliases the same physical root'); assert.equal(rd(e, 'src/a.mjs'), A0)
  held.release(); assert.equal((await b.execute('tok-cmd', id, CTX)).state, 'VERIFIED_SOURCE') // nothing was burned
  // GAP (documented): a manual process / non-Foundry writer takes no REPO_WRITE claim, so no lock can refuse it; only base-identity rechecks (below) can notice its edits.
})

test('RL10 lease is bound to workspace + holder + base + mission + assignment: a handle from another execution is refused and released; base change refuses resume', async () => {
  const e = env(), L = createLeaseAdapter({ backing: e.backing, holderId: 'broker-1' })
  for (const [name, mk] of [['holder', h => ({ ...h, holder: holderIdFor({ ...H, assignmentId: 'a-2' }) })], ['workspace', h => ({ ...h, workspaceId: 'ws-2' })]]) {
    const bad = { acquire: (...a) => e.backing.acquire(...a), reattach: (...a) => e.backing.reattach(...a), inspect: (...a) => e.backing.inspect(...a) }
    const wrapped = { ...bad, acquire: args => { const h = e.backing.acquire(args); return { ...h, ...mk(h) } } } // buggy/hostile backing returning someone else's handle
    const b = boot(e, { backing: wrapped }), id = ready(b, CTX, PKG(), 'tok-cmd')
    assert.equal((await failing(() => b.execute('tok-cmd', id, CTX))).code, 'BINDING_MISMATCH', name); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(e.model.list().length, 0, `${name}: foreign handle released, nothing left held`)
    fs.rmSync(path.join(e.control, 'broker'), { recursive: true, force: true }); fs.rmSync(path.join(e.control, 'approvals'), { recursive: true, force: true })
  }
  // base identity coupling at resume: lease binding was made against rev1
  const e2 = env(); let br; br = boot(e2, { afterWrite: p => { if (p === 'src/a.mjs') br.pause('tok-op', id2, CTX, { reason: 'review' }) } }); const id2 = ready(br)
  assert.equal((await br.execute('tok-cmd', id2, CTX)).state, 'PAUSED'); e2.host.state.rev['ws-1'] = 'rev2'
  const err = await failing(() => boot(e2).resume('tok-cmd', id2, CTX)); assert.equal(err.code, 'BINDING_MISMATCH'); assert.equal(e2.model.list().length, 0, 'no lease taken for a mismatched base')
  e2.host.state.rev['ws-1'] = 'rev1'; assert.equal((await boot(e2).resume('tok-cmd', id2, CTX)).state, 'VERIFIED_SOURCE')
})

test('RL11 cross-workspace/mission replay: an execution bound to ws-1/m-1/a-1 cannot be driven with another context, and its holder/lease never matches another execution', async () => {
  const e = env(), b = boot(e), id = ready(b)
  for (const ctx of [{ ...CTX, workspaceId: 'ws-2' }, { ...CTX, missionId: 'm-2' }, { ...CTX, assignmentId: 'a-2' }]) assert.ok(['WORKSPACE_MISMATCH', 'MISSION_MISMATCH', 'ASSIGNMENT_MISMATCH'].includes((await failing(() => b.execute('tok-cmd', id, ctx))).code))
  assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(e.model.list().length, 0)
  const ids = new Set([holderIdFor(H), holderIdFor({ ...H, workspaceId: 'ws-2' }), holderIdFor({ ...H, missionId: 'm-2' }), holderIdFor({ ...H, assignmentId: 'a-2' }), holderIdFor({ ...H, brokerId: 'broker-2' })]); assert.equal(ids.size, 5)
  assert.equal((await failing(() => boot(e, { brokerId: 'broker-2' }).execute('tok-cmd', id, CTX))).code, 'BINDING_MISMATCH', 'approval is bound to the lease holder: another broker identity cannot use it'); assert.equal(rd(e, 'src/a.mjs'), A0)
})

// ---- lock loss mid-run (4 points). Loss = another actor reclaims the lock (live-shaped) or the TTL lease lapses (file-backed).
const LOSS = { 'before first write': e => ({ base: true }), 'after one write': e => ({ afterWrite: true }), 'during validation': e => ({ audit: true }), 'before finalization': e => ({ behavior: true }) }
for (const backing of ['live', 'file']) for (const [point, spec] of Object.entries(LOSS)) {
  test(`RL12 lock lost ${point} [${backing}]: no further consequential actions, no blind rollback, honest non-success state, controlled restore under a fresh lease`, async () => {
    const e = env({ backing }); let lost = false, writesAfter = 0
    const lose = () => { if (lost) return; lost = true; if (backing === 'live') e.model.forceDrop(e.model.list()[0].callId); else e.offset += 61_000 }
    const s = spec(e)
    if (s.audit) e.hooks.audit = lose; if (s.behavior) e.hooks.behavior = lose
    if (s.base) { const orig = e.host.baseIdentity; let armed = false; e.host.baseIdentity = createBaseIdentityAdapter({ get: id => { if (!lost && (backing === 'live' ? e.model.list().length : fs.existsSync(path.join(e.control, 'leases')) && fs.readdirSync(path.join(e.control, 'leases')).some(n => n.endsWith('.json')))) lose(); return { kind: 'commit', value: e.host.state.rev[id] } }, stableAcrossAdapterWrites: true }) }
    const b = boot(e, { afterWrite: p => { if (lost) writesAfter++; if (s.afterWrite && p === 'src/a.mjs') lose() } }), id = ready(b)
    const out = await b.execute('tok-cmd', id, CTX).catch(x => x); assert.ok(lost, 'loss injected')
    const st = out.state ?? out.code; assert.ok(!['VERIFIED_SOURCE'].includes(st), `never success: ${st}`); assert.equal(writesAfter, 0, 'no write after loss')
    const a = rd(e, 'src/a.mjs'), hasC = fs.existsSync(path.join(e.ws, 'lib/new/c.mjs')); if (s.afterWrite) { assert.equal(a, A1); assert.equal(hasC, false, 'second write never happened') }
    if (s.base) { assert.equal(a, A0); assert.equal(hasC, false) }
    if (s.audit || s.behavior) assert.equal(a, A1, 'validation-time loss: applied work is retained, rollback deferred (no authority to mutate)')
    const claims = out.claims ?? {}; assert.ok(!claims.sourceValidated && !claims.built && !claims.packaged && !claims.installed && !claims.taskComplete)
    const x = loadExec(e, id); assert.notEqual(x.state, 'VERIFIED_SOURCE')
    // controlled recovery needs a fresh, valid lease and a Commander: a rival owner blocks it, then restore succeeds and the workspace returns to baseline
    if (x.runId && (a !== A0 || hasC)) {
      const rival = backing === 'live' ? (() => { e.model.acquire({ missionId: 'm-77', operation: 'x', workspaceRoot: e.ws, pid: 5000 }); e.model.setPid(5000, true); return () => e.model.forceDrop(e.model.list()[0].callId) })() : (() => { const h = createControlPlane({ root: e.control, now: e.now }).leases.acquire({ workspaceId: 'ws-1', holder: 'rival', ttlMs: 60_000 }); return () => h.release() })()
      const r2 = boot(e), rc = (await failing(() => r2.recoverRun('tok-cmd', id, 'RESTORE', CTX))).code; assert.ok(['LEASE_HELD', 'HOLDER_DEATH_REQUIRED'].includes(rc), rc); assert.equal(rd(e, 'src/a.mjs'), a, 'no rollback without a lease'); rival()
      const done = await r2.recoverRun('tok-cmd', id, 'RESTORE', CTX); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(fs.existsSync(path.join(e.ws, 'lib')), false); assert.ok(done)
    }
  })
}

// ---- RL13: REAL processes, REAL pid liveness against a file-persisted live-shaped registry
function childScript(e, extra) {
  return `
    import fs from 'node:fs'
    import { createBroker } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/broker.mjs'))}
    import { createLiveLockModel, createLiveShapedBacking } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/reslock.mjs'))}
    import { createFakeHost } from ${JSON.stringify(path.join(here, 'fake-host.mjs'))}
    const model = createLiveLockModel({ persistFile: process.env.REG }), backing = createLiveShapedBacking({ model, rootOf: () => ({ root: process.env.WS, fileIds: [] }) })
    const host = createFakeHost({ workspaces: { 'ws-1': { id: 'ws-1', root: process.env.WS } } }); host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); host.assignments.add('m-1|a-1|ws-1')
    const ctx = ${JSON.stringify(CTX)}
    const b = createBroker({ brokerId: 'broker-1', controlRoot: process.env.CTL, evidenceRoot: process.env.EV, host, leaseBacking: backing, ${extra} })
    const { execId } = b.importPackage('tok-cmd', process.env.PKG, ctx); b.approve('tok-cmd', execId, ctx); await b.execute('tok-cmd', execId, ctx)`
}
const envOf = e => ({ ...process.env, CTL: e.control, EV: e.evidence, WS: e.ws, PKG: PKG(), REG: path.join(e.dir, 'registry.json') })
const execIds = e => fs.readdirSync(path.join(e.control, 'broker/exec')).map(n => n.slice(0, -5))

test('RL13a real SIGKILL after first write: dead pid is PROVEN_DEAD on the local host, takeover mints a new generation, recovery resumes without repeating the write', async () => {
  const e = env(), reg = path.join(e.dir, 'registry.json')
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', childScript(e, "afterWrite: p => { if (p === 'src/a.mjs') process.kill(process.pid, 'SIGKILL') }")], { env: envOf(e), timeout: 20000 }); assert.equal(res.signal, 'SIGKILL', String(res.stderr))
  const model = createLiveLockModel({ persistFile: reg }), claim = model.list()[0]; assert.ok(claim, 'claim left behind by the crashed process'); assert.equal(model.pidAlive(claim.pid), false)
  const backing = createLiveShapedBacking({ model, rootOf: e.rootOf }), b = boot(e, { backing }), id = execIds(e)[0]; const ino = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino
  assert.equal(backing.inspect('ws-1').classification, 'PROVEN_DEAD'); assert.equal(b.recoverAll('tok-cmd')[0].classification, 'SAFE_TO_RESUME')
  const done = await b.recoverRun('tok-cmd', id, 'RESUME', CTX); assert.equal(done.projection.state, 'VERIFIED_SOURCE'); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, ino, 'completed write not repeated')
  assert.ok(model.state.log.some(l => l.event === 'STALE_RECLAIMED' && l.pid === claim.pid), 'takeover reclaimed the dead holder'); assert.equal(model.list().length, 0)
})

test('RL13b still-alive holder (real process): recovery is refused even with a Commander holder-death assertion and no cross-process reattach; after the holder really dies it proceeds; UNKNOWN blocks', async () => {
  const e = env(), reg = path.join(e.dir, 'registry.json'), ready = path.join(e.dir, 'ready')
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript(e, `afterWrite: p => { if (p === 'src/a.mjs') { fs.writeFileSync(process.env.READY, String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25000) } }`)], { env: { ...envOf(e), READY: ready }, stdio: 'ignore' })
  const exited = new Promise(r => child.on('exit', (code, sig) => r(sig ?? code))); for (let i = 0; i < 200 && !fs.existsSync(ready); i++) await sleep(50); assert.ok(fs.existsSync(ready), 'child reached the hold point')
  const model = createLiveLockModel({ persistFile: reg }), backing = createLiveShapedBacking({ model, rootOf: e.rootOf }), b = boot(e, { backing }), id = execIds(e)[0], leaseId = loadExec(e, id).lease.leaseId
  assert.equal(backing.inspect('ws-1').classification, 'PROVEN_ALIVE'); e.offset += 3_600_000 // a very late heartbeat proves nothing
  assert.equal(backing.inspect('ws-1').valid, true)
  assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'HOLDER_DEATH_REQUIRED')
  b.assertHolderDead('tok-cmd', id, { leaseId, evidence: 'operator believes it is dead' }); assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'LEASE_LOST', 'assertion cannot override a live holder: no cross-process reattach')
  assert.equal(rd(e, 'src/a.mjs'), A1); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')), 'nothing was done to the workspace while the holder lives')
  model.setPid(Number(fs.readFileSync(ready, 'utf8')), null); assert.equal(backing.inspect('ws-1').classification, 'UNKNOWN'); assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'LEASE_LOST', 'UNKNOWN never permits takeover')
  child.kill('SIGKILL'); assert.equal(await exited, 'SIGKILL'); await sleep(100); model.state.pids.clear()
  assert.equal(backing.inspect('ws-1').classification, 'PROVEN_DEAD'); const done = await b.recoverRun('tok-cmd', id, 'RESUME', CTX); assert.equal(done.projection.state, 'VERIFIED_SOURCE'); assert.equal(rd(e, 'lib/new/c.mjs'), C1)
})

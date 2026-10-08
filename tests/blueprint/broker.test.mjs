/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions -- reference suite ported verbatim from the isolated implementation (terse style) */
// Run: node --test tests/broker.test.mjs  (Node built-ins only; hermetic fixtures under tests/.fixtures-brk-*, removed after)
// A "restart" = a brand-new broker + control plane over the same directories while the (fake) host keeps its sessions.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createBaseIdentityAdapter, createCheckRegistry, createLeaseAdapter, createSourceOnlyBuildStage, validateActor } from '../../lib/native-builder/blueprint/adapters.mjs'
import { hash } from '../../lib/native-builder/blueprint/base.mjs'
import { createBroker } from '../../lib/native-builder/blueprint/broker.mjs'
import { createControlPlane } from '../../lib/native-builder/blueprint/control.mjs'
import { buildOutcomeEvent, createMemorySink, validateOutcomeEvent } from '../../lib/native-builder/blueprint/phase9.mjs'
import { audit, behavior, createFakeHost } from './fake-host.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = fs.mkdtempSync(path.join(here, '.fixtures-brk-'))
after(() => fs.rmSync(base, { recursive: true, force: true }))
const A0 = 'export const a = 1\n', A1 = 'export const a = 2\n', C1 = "import { a } from '../src/a.mjs'\nexport const c = a\n"
const CTX = { missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1', requestingSubsystem: 'foundry' }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const codeOf = fn => { try { fn() } catch (x) { return x } assert.fail('expected throw') }
const failing = async fn => { try { await fn() } catch (x) { return x } assert.fail('expected rejection') }
const PKG2 = id => { const o = `export const o = '${id}'\n`; return PKG({ id, changes: [{ path: `lib/${id}.mjs`, operation: 'create', beforeHash: null, content: o }], permissions: { writePaths: [`lib/${id}.mjs`] }, artifact: { path: `lib/${id}.mjs`, sha256: hash(o), kind: 'source-file' } }) }
const PKG = (over = {}) => JSON.stringify({
  version: 1, id: 'pkg-1', goal: 'Bump a and add c', workspace: { id: 'ws-1', baseRevision: 'rev1' },
  changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }, { path: 'lib/new/c.mjs', operation: 'create', beforeHash: null, content: C1 }],
  dependencies: [], checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '1' }],
  permissions: { writePaths: ['src/a.mjs', 'lib/new/c.mjs'] }, artifact: { path: 'src/a.mjs', sha256: hash(A1), kind: 'source-file' },
  research: [], recipe: { id: 'r', version: '1', applicability: 'demo', provenance: 'manual' }, ...over,
})

function env(hostOpts = {}) {
  const dir = fs.mkdtempSync(path.join(base, 't-')), ws = path.join(dir, 'ws')
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/a.mjs'), A0)
  const e = { dir, ws: fs.realpathSync(ws), control: path.join(dir, 'control'), evidence: path.join(dir, 'evidence'), offset: 0 }
  e.now = () => Date.now() + e.offset
  e.host = createFakeHost({ now: e.now, workspaces: { 'ws-1': { id: 'ws-1', root: e.ws }, 'ws-2': { id: 'ws-2', root: e.ws } }, ...hostOpts })
  e.host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); e.host.issue('tok-cmd2', { actorId: 'cmd1', sessionId: 'sess-cmd-0002' })
  e.host.issue('tok-other', { actorId: 'cmd2', sessionId: 'sess-other-01' }); e.host.issue('tok-op', { actorId: 'op1', role: 'operator', sessionId: 'sess-op-0001' }); e.host.issue('tok-view', { actorId: 'v1', role: 'viewer', sessionId: 'sess-view-001' })
  e.host.assignments.add('m-1|a-1|ws-1')
  return e
}
const boot = (e, o = {}) => createBroker({ brokerId: o.brokerId ?? 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: o.host ?? e.host, now: e.now, leaseTtlMs: o.leaseTtlMs ?? 60_000, approvalTtlMs: o.approvalTtlMs ?? 600_000, faultHook: o.faultHook, afterWrite: o.afterWrite, checkTimeoutMs: 2000 })
const ctl = e => createControlPlane({ root: e.control, now: e.now })
const rd = (e, rel) => fs.readFileSync(path.join(e.ws, rel), 'utf8')
const ready = (b, raw = PKG(), tok = 'tok-cmd') => { const { execId, preview } = b.importPackage(tok, raw, CTX); b.approve(tok, execId, CTX); return { execId, preview } }
const execIds = e => fs.readdirSync(path.join(e.control, 'broker/exec')).map(n => n.slice(0, -5))
function walk(dir, out = []) { for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n), st = fs.lstatSync(f); st.isDirectory() ? walk(f, out) : out.push(f) } return out }

/** Child process runs the whole broker flow and SIGKILLs itself at `point`. */
function crash(e, point, { leaseTtl = 200, raw = PKG() } = {}) {
  const code = `
    import { createBroker } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/broker.mjs'))}
    import { createFakeHost } from ${JSON.stringify(path.join(here, 'fake-host.mjs'))}
    const [pt, ap] = process.env.POINT.split(':'), kill = () => process.kill(process.pid, 'SIGKILL')
    const host = createFakeHost({ workspaces: { 'ws-1': { id: 'ws-1', root: process.env.WS } } })
    host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); host.assignments.add('m-1|a-1|ws-1')
    const ctx = ${JSON.stringify(CTX)}
    const b = createBroker({ brokerId: 'broker-1', controlRoot: process.env.CTL, evidenceRoot: process.env.EV, host, leaseTtlMs: ${leaseTtl},
      faultHook: p => { if (p === pt && pt !== 'after-write') kill() }, afterWrite: p => { if (pt === 'after-write' && p === ap) kill() } })
    const { execId } = b.importPackage('tok-cmd', process.env.PKG, ctx); b.approve('tok-cmd', execId, ctx); await b.execute('tok-cmd', execId, ctx)`
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, POINT: point, CTL: e.control, EV: e.evidence, WS: e.ws, PKG: raw }, timeout: 20000 })
  assert.equal(res.signal, 'SIGKILL', String(res.stderr)); return execIds(e)[0]
}

test('B1 happy path through the broker: source-only honesty, durable stores, Phase 9 event, no credentials/handles in stores', async () => {
  const e = env(), b = boot(e), { execId, preview } = b.importPackage('tok-cmd', PKG(), CTX)
  assert.equal(preview.checks[0].implementationDigest.length, 64); assert.equal(b.status('tok-view', execId).state, 'PREVIEWED')
  b.approve('tok-cmd', execId, CTX); const out = await b.execute('tok-cmd', execId, CTX)
  assert.equal(out.state, 'VERIFIED_SOURCE'); assert.equal(out.headline, 'SOURCE_VERIFIED_ONLY'); assert.deepEqual(out.claims, { sourceValidated: true, built: false, packaged: false, installed: false, taskComplete: false, missionComplete: false, assignmentComplete: false })
  assert.deepEqual(['build', 'package', 'verifyArtifact', 'install'].map(k => out.stages[k].status), ['NOT_RUN', 'NOT_RUN', 'NOT_RUN', 'NOT_RUN']); assert.deepEqual(b.buildStageCalls(), ['validateSource'])
  assert.equal(rd(e, 'src/a.mjs'), A1); assert.equal(b.getReceipt('tok-view', execId).actor, 'cmd1'); assert.equal(b.getReceipt('tok-view', execId).checks[0].implementationDigest.length, 64)
  const ev = e.host.phase9Sink.state.events; assert.equal(ev.length, 1); assert.equal(ev[0].outcome, 'VERIFIED_SOURCE'); assert.equal(ev[0].mission.missionId, 'm-1'); assert.equal(ev[0].mission.assignmentId, 'a-1'); assert.equal(ev[0].actor.actorId, 'cmd1'); assert.equal(ev[0].approvedBy.sessionId, 'sess-cmd-0001')
  const handle = fs.readFileSync(path.join(e.control, 'broker/secrets', `${execId}.handle`), 'utf8').trim()
  for (const f of walk(e.dir).filter(f => !f.includes('/secrets/') && !f.includes('/ws/') && !f.endsWith('.key'))) { const t = fs.readFileSync(f, 'utf8'); assert.ok(!t.includes(handle), `handle leaked in ${f}`); for (const tok of ['tok-cmd', 'tok-view']) assert.ok(!t.includes(tok), `token leaked in ${f}`) }
  assert.equal((fs.statSync(path.join(e.control, 'broker/secrets', `${execId}.handle`)).mode & 0o777), 0o600)
})

test('B2 actor authority: only host sessions confer identity; forged/credential-bearing/stale actors and package-supplied identity are rejected', async () => {
  const e = env(), b = boot(e)
  for (const extra of [{ actor: 'evil' }, { actorId: 'cmd1' }, { approvedBy: 'cmd1' }, { missionId: 'm-9' }, { assignmentId: 'a-9' }, { requestedBy: 'cmd1' }, { sessionId: 'x' }])
    assert.equal(codeOf(() => b.importPackage('tok-cmd', JSON.stringify({ ...JSON.parse(PKG()), ...extra }), CTX)).code, 'INVALID_PACKAGE', Object.keys(extra)[0])
  assert.equal(codeOf(() => b.importPackage('tok-cmd', PKG(), { ...CTX, requestedBy: 'cmd1' })).code, 'BINDING_MISMATCH')
  assert.equal(codeOf(() => b.importPackage('nope', PKG(), CTX)).code, 'ACTOR_INVALID'); e.host.tokens.set('tok-leaky', { ...e.host.tokens.get('tok-cmd'), token: 'secret-bearer' })
  assert.equal(codeOf(() => b.importPackage('tok-leaky', PKG(), CTX)).code, 'ACTOR_INVALID'); e.host.issue('tok-old', { authenticatedAt: Date.now() - 13 * 3600_000 })
  assert.equal(codeOf(() => b.importPackage('tok-old', PKG(), CTX)).code, 'ACTOR_INVALID')
  assert.equal(codeOf(() => b.importPackage('tok-view', PKG(), CTX)).code, 'ROLE_DENIED')
  const { execId } = b.importPackage('tok-op', PKG(), CTX); assert.equal(codeOf(() => b.approve('tok-op', execId, CTX)).code, 'ROLE_DENIED'); b.approve('tok-cmd', execId, CTX)
  assert.equal((await failing(() => b.execute('tok-op', execId, CTX))).code, 'ROLE_DENIED'); assert.equal(rd(e, 'src/a.mjs'), A0)
  e.host.tokens.delete('tok-cmd'); assert.equal((await failing(() => b.execute('tok-cmd', execId, CTX))).code, 'ACTOR_INVALID') // revoked session
  assert.equal(validateActor({ actorId: 'a@b.c', role: 'commander', sessionId: 'sess-12345', authenticatedAt: Date.now(), authenticationSource: 'x' }).role, 'commander')
})

test('B3 approval is bound to actor AND session; transfer only if host policy explicitly permits', async () => {
  const e = env(), b = boot(e), { execId } = ready(b)
  for (const [tok, code] of [['tok-cmd2', 'SESSION_MISMATCH'], ['tok-other', 'ACTOR_MISMATCH']]) assert.equal((await failing(() => b.execute(tok, execId, CTX))).code, code, tok) // same actor/new session vs different actor
  assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(b.status('tok-view', execId).state, 'APPROVED')
  const e2 = env({ policy: { allowApprovalTransfer: (from, to) => from.actorId === to.actorId } }), b2 = boot(e2), r = ready(b2)
  assert.equal((await b2.execute('tok-cmd2', r.execId, CTX)).state, 'VERIFIED_SOURCE'); assert.equal((await failing(() => b2.execute('tok-other', r.execId, CTX))).code, 'BROKER_STATE')
  const e3 = env({ policy: { allowApprovalTransfer: (from, to) => from.actorId === to.actorId } }), b3 = boot(e3), r3 = ready(b3)
  assert.equal((await failing(() => b3.execute('tok-other', r3.execId, CTX))).code, 'ACTOR_MISMATCH')
})

test('B4 mission/assignment/workspace ownership; package cannot rebind itself; immutable package and binding', async () => {
  const e = env(), b = boot(e), { execId } = ready(b)
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { ...CTX, missionId: 'm-2' }))).code, 'MISSION_MISMATCH')
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { ...CTX, assignmentId: 'a-2' }))).code, 'ASSIGNMENT_MISMATCH')
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { ...CTX, workspaceId: 'ws-2' }))).code, 'WORKSPACE_MISMATCH')
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { ...CTX, requestingSubsystem: 'other' }))).code, 'BINDING_MISMATCH')
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { missionId: 'm-1' }))).code, 'ASSIGNMENT_MISMATCH'); assert.equal(rd(e, 'src/a.mjs'), A0)
  e.host.assignments.delete('m-1|a-1|ws-1'); assert.equal((await failing(() => b.execute('tok-cmd', execId, CTX))).code, 'ASSIGNMENT_INACTIVE')
  assert.equal(codeOf(() => b.importPackage('tok-cmd', PKG(), CTX)).code, 'ASSIGNMENT_INACTIVE'); e.host.assignments.add('m-1|a-1|ws-1')
  e.host.assignments.add('m-2|a-2|ws-1'); const other = b.importPackage('tok-cmd', PKG(), { ...CTX, missionId: 'm-2', assignmentId: 'a-2' }) // same package, other mission => separate execution, no inherited approval
  assert.equal((await failing(() => b.execute('tok-cmd', other.execId, { ...CTX, missionId: 'm-2', assignmentId: 'a-2' }))).code, 'BROKER_STATE')
  assert.equal(codeOf(() => b.importPackage('tok-cmd', JSON.stringify({ ...JSON.parse(PKG()), workspace: { id: 'ws-2', baseRevision: 'rev1' } }), CTX)).code, 'WORKSPACE_MISMATCH')
  const pkgFile = path.join(e.control, 'broker/packages', `${execId}.pkg.json`), rec = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); rec.binding.missionId = 'm-evil'; fs.writeFileSync(pkgFile, JSON.stringify(rec))
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { ...CTX, missionId: 'm-evil' }))).code, 'CONTROL_STORE_CORRUPT')
  const e2 = env(), b2 = boot(e2), r2 = ready(b2), rawFile = path.join(e2.control, 'broker/packages', `${r2.execId}.raw`); fs.chmodSync(rawFile, 0o600); fs.writeFileSync(rawFile, PKG({ goal: 'tampered goal' }))
  assert.equal((await failing(() => b2.execute('tok-cmd', r2.execId, CTX))).code, 'CONTROL_STORE_CORRUPT'); assert.equal(rd(e2, 'src/a.mjs'), A0)
  const e3 = env(), b3 = boot(e3), r3 = ready(b3), xf = path.join(e3.control, 'broker/exec', `${r3.execId}.json`), xr = JSON.parse(fs.readFileSync(xf, 'utf8')); xr.bindingHash = 'f'.repeat(64); fs.writeFileSync(xf, JSON.stringify(xr))
  assert.equal((await failing(() => b3.execute('tok-cmd', r3.execId, CTX))).code, 'CONTROL_STORE_CORRUPT')
})

test('B5 package store + review + approval survive broker restart; nothing is held only in memory', async () => {
  const e = env(), b1 = boot(e), { execId } = ready(b1), b2 = boot(e)
  assert.equal(b2.preview('tok-view', execId).digest.length, 64); assert.equal(b2.status('tok-view', execId).approvedBy.actorId, 'cmd1')
  assert.equal((await b2.execute('tok-cmd', execId, CTX)).state, 'VERIFIED_SOURCE'); const b3 = boot(e)
  assert.equal(b3.status('tok-view', execId).state, 'VERIFIED_SOURCE'); assert.equal((await failing(() => b3.execute('tok-cmd', execId, CTX))).code, 'BROKER_STATE'); assert.deepEqual(b3.recoverAll('tok-cmd'), [])
})

test('B6 check registry binding: implementation drift after approval is refused (and does not burn the approval); registry is immutable', async () => {
  const e = env(), b1 = boot(e), { execId } = ready(b1)
  const drifted = createFakeHost({ now: e.now, workspaces: e.host.workspaces.resolve ? { 'ws-1': { id: 'ws-1', root: e.ws } } : {}, checks: [audit, { ...behavior, source: 'behavior-impl-v2-CHANGED' }] })
  for (const t of ['tok-cmd']) drifted.issue(t, { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); drifted.assignments.add('m-1|a-1|ws-1')
  const b2 = boot(e, { host: drifted }); assert.equal((await failing(() => b2.execute('tok-cmd', execId, CTX))).code, 'CHECK_DRIFT'); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(b2.status('tok-view' in {} ? 'x' : 'tok-cmd', execId).state, 'APPROVED')
  assert.equal((await boot(e).execute('tok-cmd', execId, CTX)).state, 'VERIFIED_SOURCE', 'original registry still executes the same approval')
  const reg = createCheckRegistry([audit, behavior]); assert.throws(() => { reg.get('audit').digest = 'x' }, TypeError);
  assert.ok(Object.isFrozen(reg) && Object.isFrozen(reg.get('audit')) && Object.isFrozen(reg.toCoreChecks()))
  assert.notEqual(reg.bindingFor([{ id: 'audit', version: '1' }]), createCheckRegistry([{ ...audit, source: 'other' }]).bindingFor([{ id: 'audit', version: '1' }]))
  assert.equal(createCheckRegistry([{ ...audit, implementationDigest: 'a'.repeat(64) }]).get('audit').digestKind, 'host-supplied'); assert.throws(() => createCheckRegistry([{ ...audit, scope: 'everything' }]), /scope/)
})

test('B6b check timeout is per-check and AbortSignal-aware; version change refuses at preflight', async () => {
  let aborted = false
  const hang = { id: 'behavior', version: '1', role: 'behavior', source: 'hang', timeoutMs: 30, run: ({ signal }) => new Promise(() => signal.addEventListener('abort', () => { aborted = true })) }
  const e = env({ checks: [audit, hang] }), b = boot(e), { execId } = ready(b), out = await b.execute('tok-cmd', execId, CTX)
  assert.equal(out.state, 'FAILED_ROLLED_BACK'); assert.equal(out.checks.at(-1).status, 'TIMEOUT'); assert.equal(aborted, true); assert.equal(rd(e, 'src/a.mjs'), A0)
  const e2 = env(), b2 = boot(e2); assert.equal(codeOf(() => b2.importPackage('tok-cmd', PKG({ checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '2' }] }), CTX)).code, 'UNAPPROVED_RECIPE')
})

test('B7 base identity: adapter contract; stale before execute, changed mid-run, changed before finalize all block; crash+change => NEEDS_OPERATOR_REVIEW', async () => {
  assert.throws(() => createBaseIdentityAdapter({ get: () => 'x' }), /stable across/); const g = v => createBaseIdentityAdapter({ get: () => v, stableAcrossAdapterWrites: true })
  assert.equal(codeOf(() => g({ kind: 'commit', value: 'abc', dirty: true }).resolve('w')).code, 'BASE_REVISION_MISMATCH'); assert.equal(codeOf(() => g({ kind: 'dirty-tree-hash', value: 'abc' }).resolve('w')).code, 'BASE_REVISION_MISMATCH')
  assert.equal(codeOf(() => g({ kind: 'commit', value: 'bad value!' }).resolve('w')).code, 'BASE_REVISION_MISMATCH'); assert.equal(g({ kind: 'snapshot', value: 'snap:1' }).resolve('w'), 'snap:1')
  const e = env(), b = boot(e), { execId } = ready(b); e.host.state.rev['ws-1'] = 'rev2'
  assert.equal((await failing(() => b.execute('tok-cmd', execId, CTX))).code, 'BASE_REVISION_MISMATCH'); e.host.state.rev['ws-1'] = 'rev1'; assert.equal(b.status('tok-cmd', execId).state, 'APPROVED')
  const e2 = env(); const b2 = boot(e2, { afterWrite: p => { if (p === 'src/a.mjs') e2.host.state.rev['ws-1'] = 'rev9' } }), r2 = ready(b2), o2 = await b2.execute('tok-cmd', r2.execId, CTX)
  assert.equal(o2.state, 'FAILED_ROLLED_BACK'); assert.equal(o2.error.code, 'BASE_REVISION_MISMATCH'); assert.equal(rd(e2, 'src/a.mjs'), A0)
  const mover = { id: 'behavior', version: '1', role: 'behavior', source: 'mover', run: async () => { e3.host.state.rev['ws-1'] = 'rev9'; return { status: 'PASS', evidence: 'ok' } } }
  const e3 = env({ checks: [audit, mover] }), b3 = boot(e3), r3 = ready(b3), o3 = await b3.execute('tok-cmd', r3.execId, CTX)
  assert.equal(o3.state, 'FAILED_ROLLED_BACK'); assert.equal(o3.error.code, 'BASE_REVISION_MISMATCH'); assert.equal(o3.claims.sourceValidated, false); assert.equal(rd(e3, 'src/a.mjs'), A0)
  const e4 = env(), id4 = crash(e4, 'after-write:src/a.mjs'); e4.host.state.rev['ws-1'] = 'rev2'; const scan = boot(e4).recoverAll('tok-cmd')
  assert.equal(scan[0].classification, 'NEEDS_OPERATOR_REVIEW'); assert.match(scan[0].reasons.join(' '), /base identity/)
})

test('L-A resource-lock adapter semantics: no steal, sticky loss, heartbeat, stale takeover, holder-death assertion rules, swappable backing', () => {
  const e = env(), c = ctl(e), A = createLeaseAdapter({ backing: c.leases, holderId: 'broker-1', defaultTtlMs: 1000 }), B = createLeaseAdapter({ backing: c.leases, holderId: 'broker-2', defaultTtlMs: 1000 })
  const h = A.acquire({ workspaceId: 'w' }); assert.equal(A.verify(h), true); assert.equal(A.info(h).holder, 'broker-1'); assert.equal(codeOf(() => B.acquire({ workspaceId: 'w' })).code, 'LEASE_HELD'); assert.equal(codeOf(() => A.acquire({ workspaceId: 'w' })).code, 'LEASE_HELD')
  assert.equal(codeOf(() => B.acquireForRecovery({ workspaceId: 'w', previous: { leaseId: h.leaseId }, holderDead: { leaseId: h.leaseId } })).code, 'LEASE_HELD', 'different holder identity cannot take a valid lease even with an assertion')
  assert.equal(codeOf(() => A.acquireForRecovery({ workspaceId: 'w', previous: { leaseId: h.leaseId } })).code, 'HOLDER_DEATH_REQUIRED')
  assert.equal(codeOf(() => A.acquireForRecovery({ workspaceId: 'w', previous: { leaseId: h.leaseId }, holderDead: { leaseId: 'other' } })).code, 'HOLDER_DEATH_REQUIRED')
  const re = A.acquireForRecovery({ workspaceId: 'w', previous: { leaseId: h.leaseId }, holderDead: { leaseId: h.leaseId } }); assert.equal(re.leaseId, h.leaseId); assert.equal(A.heartbeat(re), true)
  const slot = A.bindCore(); assert.equal(slot.verify(), false); slot.set(re); assert.equal(slot.verify(), true); assert.equal(slot.info().leaseId, h.leaseId)
  assert.equal(A.release(re), true); assert.equal(slot.verify(), false); const h2 = A.acquire({ workspaceId: 'w' }); e.offset += 5000
  assert.equal(A.verify(h2), false); const h3 = B.acquireForRecovery({ workspaceId: 'w', previous: { leaseId: h2.leaseId } }); assert.equal(h3.takeoverOf.holder, 'broker-1'); assert.equal(A.heartbeat(h2), false)
  assert.throws(() => createLeaseAdapter({ backing: {}, holderId: 'x' }), /backing/); // any backing with acquire/reattach/inspect (e.g. War Room locks) fits
})

test('L-B broker execute never steals a lease and does not burn the approval when the lock is held', async () => {
  const e = env(), b = boot(e), { execId } = ready(b), other = ctl(e).leases.acquire({ workspaceId: 'ws-1', holder: 'someone-else', ttlMs: 60_000 })
  assert.equal((await failing(() => b.execute('tok-cmd', execId, CTX))).code, 'LEASE_HELD'); assert.equal(b.status('tok-cmd', execId).state, 'APPROVED'); assert.equal(rd(e, 'src/a.mjs'), A0)
  other.release(); assert.equal((await b.execute('tok-cmd', execId, CTX)).state, 'VERIFIED_SOURCE')
})

test('P1 pause mid-run holds at a safe boundary (no rollback, no claims), persists across restart, resume needs Commander + valid lease and does not repeat completed work', async () => {
  const e = env(); let br, id; br = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') br.pause('tok-op', id, CTX, { reason: 'review' }) } })
  id = ready(br).execId; const out = await br.execute('tok-cmd', id, CTX), ino = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino
  assert.equal(out.state, 'PAUSED'); assert.equal(out.pause.stopPoint, 'before-file:lib/new/c.mjs'); assert.equal(out.pause.actor, 'op1'); assert.equal(rd(e, 'src/a.mjs'), A1); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
  assert.equal(out.claims.sourceValidated, false); assert.equal(e.host.phase9Sink.state.events.length, 0, 'non-terminal: no outcome event')
  const b2 = boot(e); assert.equal(b2.status('tok-view', id).state, 'PAUSED'); assert.ok(ctl(e).pauses.active({ runId: out.runId }), 'pause record is durable')
  assert.deepEqual(b2.recoverAll('tok-cmd').map(r => [r.classification, r.state]), [['SAFE_TO_RESUME', 'PAUSED']])
  assert.equal((await failing(() => b2.resume('tok-op', id, CTX))).code, 'ROLE_DENIED'); assert.equal((await failing(() => b2.resume('tok-cmd', id, { ...CTX, missionId: 'x' }))).code, 'MISSION_MISMATCH')
  const held = ctl(e).leases.acquire({ workspaceId: 'ws-1', holder: 'rival', ttlMs: 60_000 })
  assert.equal((await failing(() => b2.resume('tok-cmd', id, CTX))).code, 'HOLDER_DEATH_REQUIRED'); assert.ok(ctl(e).pauses.active({ runId: out.runId }), 'refused resume leaves the pause in place'); held.release()
  const done = await b2.resume('tok-cmd', id, CTX)
  assert.equal(done.state, 'VERIFIED_SOURCE'); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, ino, 'completed write not repeated'); assert.equal(rd(e, 'lib/new/c.mjs'), C1); assert.equal(done.recoveries, 1)
  assert.equal(e.host.phase9Sink.state.events.length, 1); assert.equal(e.host.phase9Sink.state.events[0].retries.resumes, 1)
})

test('P2 pause before start: execute holds immediately; resume completes (idempotent effect planning)', async () => {
  const e = env(), b = boot(e), { execId } = ready(b); b.pause('tok-cmd', execId, CTX)
  const out = await b.execute('tok-cmd', execId, CTX); assert.equal(out.state, 'PAUSED'); assert.equal(out.pause.stopPoint, 'before-start'); assert.equal(rd(e, 'src/a.mjs'), A0)
  assert.equal((await boot(e).resume('tok-cmd', execId, CTX)).state, 'VERIFIED_SOURCE'); assert.equal(rd(e, 'src/a.mjs'), A1)
})

test('X1 cancel: mid-run -> explicit disposition; RETAIN only if host policy allows; cancel persists; cancel beats resume; cancel before start', async () => {
  const e = env(); let br, id; br = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') br.cancel('tok-cmd', id, CTX, { reason: 'abort', disposition: 'RETAIN' }) } })
  id = ready(br).execId; const out = await br.execute('tok-cmd', id, CTX)
  assert.equal(out.state, 'CANCELLED_ROLLED_BACK', 'RETAIN is ignored without host policy'); assert.equal(out.cancel.disposition, 'ROLLED_BACK'); assert.equal(out.cancel.request.disposition, 'ROLLBACK'); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(out.claims.sourceValidated, false)
  const ev = e.host.phase9Sink.state.events.at(-1); assert.equal(ev.outcome, 'CANCELLED_ROLLED_BACK'); assert.equal(ev.failure.class, 'CANCELLED'); assert.equal(ev.headline, 'CANCELLED'); assert.equal(boot(e).status('tok-view', id).cancel.request.actor, 'cmd1')
  const e2 = env({ policy: { allowRetain: () => true } }); let br2, id2; br2 = boot(e2, { afterWrite: p => { if (p === 'src/a.mjs') br2.cancel('tok-cmd', id2, CTX, { disposition: 'RETAIN' }) } })
  id2 = ready(br2).execId; const o2 = await br2.execute('tok-cmd', id2, CTX); assert.equal(o2.state, 'CANCELLED_RETAINED'); assert.equal(rd(e2, 'src/a.mjs'), A1); assert.equal(o2.claims.sourceValidated, false); assert.equal(o2.headline, 'CANCELLED_RETAINED')
  const e3 = env(); let br3, id3; br3 = boot(e3, { afterWrite: p => { if (p === 'src/a.mjs') br3.pause('tok-cmd', id3, CTX) } }); id3 = ready(br3).execId; await br3.execute('tok-cmd', id3, CTX)
  const b3 = boot(e3); const c3 = b3.cancel('tok-cmd', id3, CTX, { reason: 'no' }); assert.equal(c3.disposition, 'ROLLBACK')
  assert.equal((await failing(() => b3.resume('tok-cmd', id3, CTX))).code, 'RECOVERY_NOT_ALLOWED'); assert.equal(rd(e3, 'src/a.mjs'), A1, 'cancel is not silently applied or resumed')
  const r3 = await b3.recoverRun('tok-cmd', id3, 'RESTORE', CTX); assert.equal(r3.final, 'RESTORED'); assert.equal(rd(e3, 'src/a.mjs'), A0); assert.equal(b3.status('tok-view', id3).state, 'CANCELLED_ROLLED_BACK')
  const e4 = env(), b4 = boot(e4), { execId } = ready(b4); assert.equal(b4.cancel('tok-cmd', execId, CTX).state, 'CANCELLED_NO_CHANGES'); assert.equal((await failing(() => b4.execute('tok-cmd', execId, CTX))).code, 'BROKER_STATE'); assert.equal(e4.host.phase9Sink.state.events.at(-1).outcome, 'CANCELLED_NO_CHANGES')
})

test('S1 stop: in-flight run holds (never rolled back or finished), no new work accepted, terminal states untouched, persists across restart; start resumes service', async () => {
  const e = env(); let br, id; br = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') br.stop('tok-cmd', { reason: 'maintenance' }) } })
  const done = ready(br, PKG({ id: 'pkg-done' })); 
  // a previously verified run must stay terminal through a stop:
  const e2 = env(), b0 = boot(e2), r0 = ready(b0); assert.equal((await b0.execute('tok-cmd', r0.execId, CTX)).state, 'VERIFIED_SOURCE'); b0.stop('tok-cmd'); assert.equal(boot(e2).status('tok-cmd', r0.execId).state, 'VERIFIED_SOURCE')
  id = done.execId; const out = await br.execute('tok-cmd', id, CTX)
  assert.equal(out.state, 'PAUSED'); assert.equal(out.pause.kind, 'STOP'); assert.equal(rd(e, 'src/a.mjs'), A1); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
  const b2 = boot(e); assert.equal((await failing(() => b2.resume('tok-cmd', id, CTX))).code, 'BROKER_STOPPED'); const x = b2.importPackage('tok-cmd', PKG2('pkg-x'), CTX); b2.approve('tok-cmd', x.execId, CTX)
  assert.equal((await failing(() => b2.execute('tok-cmd', x.execId, CTX))).code, 'BROKER_STOPPED'); assert.equal((await failing(() => b2.recoverRun('tok-cmd', id, 'RESTORE', CTX))).code, 'BROKER_STOPPED')
  assert.equal(b2.start('tok-cmd').cleared, true); assert.equal((await b2.resume('tok-cmd', id, CTX)).state, 'VERIFIED_SOURCE')
})

test('D1 duplicate broker requests cannot duplicate effects (request-id idempotency + state machine)', async () => {
  const e = env(), b = boot(e), { execId } = ready(b), p1 = b.execute('tok-cmd', execId, CTX, { requestId: 'req-1' }), p2 = failing(() => b.execute('tok-cmd', execId, CTX, { requestId: 'req-1' }))
  assert.equal((await p2).code, 'DUPLICATE_REQUEST_IN_PROGRESS'); const first = await p1
  const again = await b.execute('tok-cmd', execId, CTX, { requestId: 'req-1' }); assert.equal(again.deduplicated, true); assert.equal(again.runId, first.runId)
  assert.equal((await failing(() => b.execute('tok-cmd', execId, CTX, { requestId: 'req-2' }))).code, 'BROKER_STATE'); assert.equal(fs.readdirSync(path.join(e.evidence, hash('ws-1').slice(0, 32))).length, 1, 'exactly one run')
  const digest = JSON.parse(fs.readFileSync(path.join(e.evidence, hash('ws-1').slice(0, 32), first.runId, 'receipt.json'), 'utf8')).digest
  assert.deepEqual(ctl(e).effects.get(first.runId, digest, 'write:0:src/a.mjs').history.map(h => h.state), ['PLANNED', 'STARTED', 'COMPLETED']); assert.equal(e.host.phase9Sink.state.events.length, 1)
  const x = b.importPackage('tok-cmd', PKG2('p2'), CTX).execId, a1 = b.approve('tok-cmd', x, CTX, { requestId: 'ap-1' }), a2 = b.approve('tok-cmd', x, CTX, { requestId: 'ap-1' }) // approve is idempotent per request id too
  assert.equal(a1.state, 'APPROVED'); assert.equal(a2.deduplicated, true); assert.equal(fs.readdirSync(path.join(e.control, 'approvals')).filter(n => n.endsWith('.json')).length, 2, 'one approval per execution, none duplicated')
})

test('F1 crash after FIRST WRITE (SIGKILL of a broker process): restart scan is read-only; recovery needs lease (expiry) + authority; effect not repeated', async () => {
  const e = env(), id = crash(e, 'after-write:src/a.mjs'), ino = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino; await sleep(260)
  const b = boot(e), before = JSON.stringify([rd(e, 'src/a.mjs'), fs.readFileSync(path.join(e.control, 'broker/exec', `${id}.json`), 'utf8'), fs.readdirSync(path.join(e.control, 'leases'))])
  const scan = b.recoverAll('tok-cmd'); assert.equal(scan.length, 1); assert.deepEqual([scan[0].classification, scan[0].state, scan[0].orphaned, scan[0].requiresReconcile], ['SAFE_TO_RESUME', 'RUNNING', true, false])
  assert.equal(JSON.stringify([rd(e, 'src/a.mjs'), fs.readFileSync(path.join(e.control, 'broker/exec', `${id}.json`), 'utf8'), fs.readdirSync(path.join(e.control, 'leases'))]), before, 'recoverAll mutated nothing (no auto-resume)')
  assert.equal((await failing(() => b.recoverRun('tok-op', id, 'RESUME', CTX))).code, 'ROLE_DENIED'); assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', { ...CTX, assignmentId: 'zz' }))).code, 'ASSIGNMENT_MISMATCH')
  const r = await b.recoverRun('tok-cmd', id, 'RESUME', CTX); assert.equal(r.projection.state, 'VERIFIED_SOURCE'); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, ino); assert.equal(r.projection.recoveries, 1)
  assert.equal(e.host.phase9Sink.state.events.at(-1).retries.recoveries, 1)
})

test('F2 crash with the lease STILL VALID: recovery refused until holder death is asserted by a Commander; then same-identity reattach', async () => {
  const e = env(), id = crash(e, 'after-write:src/a.mjs', { leaseTtl: 60_000 }), b = boot(e)
  assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'HOLDER_DEATH_REQUIRED')
  const leaseId = ctl(e).leases.inspect('ws-1').leaseId; assert.equal(codeOf(() => b.assertHolderDead('tok-op', id, { leaseId, evidence: 'pm says exited' })).code, 'ROLE_DENIED')
  assert.equal(codeOf(() => b.assertHolderDead('tok-cmd', id, { leaseId: 'wrong', evidence: 'pm says exited' })).code, 'BINDING_MISMATCH'); assert.equal(codeOf(() => b.assertHolderDead('tok-cmd', id, { leaseId, evidence: 'x' })).code, 'INVALID_PACKAGE')
  assert.equal((await failing(() => boot(e, { brokerId: 'broker-2' }).recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'HOLDER_DEATH_REQUIRED'); b.assertHolderDead('tok-cmd', id, { leaseId, evidence: 'process manager: pid exited, host confirmed' })
  assert.equal((await failing(() => boot(e, { brokerId: 'broker-2' }).recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'LEASE_HELD', 'a different broker identity cannot take a valid lease even with an assertion')
  assert.equal((await b.recoverRun('tok-cmd', id, 'RESUME', CTX)).projection.state, 'VERIFIED_SOURCE')
})

test('F3 crash AFTER INTENT: unknown effect needs reconciliation before any replay; failed-not-applied retries once; irreversible/unretryable never auto-replay', async () => {
  const e = env(), id = crash(e, 'after-intent'); await sleep(260); const b = boot(e), scan = b.recoverAll('tok-cmd')[0]
  assert.deepEqual([scan.classification, scan.requiresReconcile, scan.allowed], ['SAFE_TO_RESUME', true, ['RECONCILE', 'ROLLBACK']])
  assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'RECONCILIATION_REQUIRED'); assert.equal(rd(e, 'src/a.mjs'), A0)
  const rec = await b.recoverRun('tok-cmd', id, 'RECONCILE', CTX); assert.equal(rec.outcomes[0].result, 'NOT_APPLIED_OBSERVED_BEFORE')
  const done = await b.recoverRun('tok-cmd', id, 'RESUME', CTX); assert.equal(done.projection.state, 'VERIFIED_SOURCE'); assert.equal(rd(e, 'src/a.mjs'), A1)
  const e2 = env(), id2 = crash(e2, 'after-write:src/a.mjs'); await sleep(260); const c = ctl(e2), runId = fs.readdirSync(path.join(e2.evidence, hash('ws-1').slice(0, 32)))[0]
  const digest = JSON.parse(fs.readFileSync(path.join(e2.evidence, hash('ws-1').slice(0, 32), runId, 'receipt.json'), 'utf8')).digest
  c.effects.plan(runId, digest, [{ stepId: 'install:x', kind: 'external', irreversible: true }]); c.effects.transition(runId, digest, 'install:x', 'STARTED')
  const b2 = boot(e2), s2 = b2.recoverAll('tok-cmd')[0]; assert.equal(s2.classification, 'NEEDS_OPERATOR_REVIEW'); assert.equal((await failing(() => b2.recoverRun('tok-cmd', id2, 'RESUME', CTX))).code, 'RECOVERY_NOT_ALLOWED')
  const e3 = env(), id3 = crash(e3, 'after-write:src/a.mjs'); await sleep(260); const r3 = fs.readdirSync(path.join(e3.evidence, hash('ws-1').slice(0, 32)))[0], d3 = JSON.parse(fs.readFileSync(path.join(e3.evidence, hash('ws-1').slice(0, 32), r3, 'receipt.json'), 'utf8')).digest
  const c3 = ctl(e3); c3.effects.transition(r3, d3, 'write:1:lib/new/c.mjs', 'FAILED', { reason: 'boom' }) // FAILED without notApplied => policy forbids automatic retry
  const b3 = boot(e3), s3 = b3.recoverAll('tok-cmd')[0]; assert.equal(s3.classification, 'NEEDS_OPERATOR_REVIEW'); assert.match(s3.reasons.join(' '), /not retryable/); assert.equal((await failing(() => b3.recoverRun('tok-cmd', id3, 'RESUME', CTX))).code, 'RECOVERY_NOT_ALLOWED')
})

test('F4 recovery can restore (Commander + lease) and reports honest terminal state; missing evidence => NEEDS_OPERATOR_REVIEW', async () => {
  const e = env(), id = crash(e, 'after-write:lib/new/c.mjs'); await sleep(260); const b = boot(e), r = await b.recoverRun('tok-cmd', id, 'RESTORE', CTX)
  assert.equal(r.final, 'RESTORED'); assert.equal(rd(e, 'src/a.mjs'), A0); assert.ok(!fs.existsSync(path.join(e.ws, 'lib'))); assert.equal(r.projection.state, 'RECOVERED_ROLLED_BACK'); assert.equal(r.projection.claims.sourceValidated, false)
  const ev = e.host.phase9Sink.state.events.at(-1); assert.equal(ev.outcome, 'RECOVERED_ROLLED_BACK'); assert.equal(ev.failure.class, 'CRASH'); assert.deepEqual(b.recoverAll('tok-cmd'), [])
  const e2 = env(), id2 = crash(e2, 'after-write:src/a.mjs'); const runDir = path.join(e2.evidence, hash('ws-1').slice(0, 32)); fs.rmSync(path.join(runDir, fs.readdirSync(runDir)[0], 'receipt.json'))
  assert.equal(boot(e2).recoverAll('tok-cmd')[0].classification, 'NEEDS_OPERATOR_REVIEW')
})

test('H1 source-only honesty: a build stage can never flip built/packaged/installed/taskComplete; only validateSource is invoked; failing source stage is not success', async () => {
  const calls = [], stage = { validateSource: async () => { calls.push('validateSource'); return { status: 'PASS' } }, build: async () => { calls.push('build'); return { status: 'PASS', built: true } }, package: async () => { calls.push('package'); return { status: 'PASS' } }, verifyArtifact: async () => { calls.push('verifyArtifact'); return { status: 'PASS' } } }
  const e = env({ buildStage: stage }), b = boot(e), { execId } = ready(b), out = await b.execute('tok-cmd', execId, CTX)
  assert.deepEqual(calls, ['validateSource']); assert.deepEqual(out.claims, { sourceValidated: true, built: false, packaged: false, installed: false, taskComplete: false, missionComplete: false, assignmentComplete: false }); assert.equal(out.stages.build.status, 'NOT_RUN')
  const e2 = env({ buildStage: { ...stage, validateSource: async () => ({ status: 'FAIL' }) } }), b2 = boot(e2), r2 = ready(b2), o2 = await b2.execute('tok-cmd', r2.execId, CTX)
  assert.equal(o2.state, 'NEEDS_OPERATOR_REVIEW_SOURCE_STAGE'); assert.notEqual(o2.headline, 'SOURCE_VERIFIED_ONLY'); assert.equal(e2.host.phase9Sink.state.events.length, 0)
  assert.throws(() => boot(e, { host: { ...e.host, buildStage: { validateSource() {} } } }), /must implement/); const src = createSourceOnlyBuildStage(); assert.equal((await src.build({})).status, 'NOT_IMPLEMENTED')
})

test('O1 Phase 9 event: shape, failure class, rollback, validation, latency, retries; at-least-once outbox with dedupe; survives restart', async () => {
  const failer = { id: 'behavior', version: '1', role: 'behavior', source: 'fail', run: async () => ({ status: 'FAIL', evidence: 'expected 3 got 2' }) }
  const sink = createMemorySink({ failNext: 1 }), e = env({ checks: [audit, failer] }); e.host.phase9Sink = sink
  const b = boot(e), { execId } = ready(b), out = await b.execute('tok-cmd', execId, CTX); assert.equal(out.state, 'FAILED_ROLLED_BACK'); assert.equal(sink.state.events.length, 0, 'sink down: event pending in the outbox')
  assert.equal(fs.readdirSync(path.join(e.control, 'broker/outbox')).filter(n => n.endsWith('.json')).length, 1); assert.equal(codeOf(() => b.flushOutbox('tok-op')).code, 'ROLE_DENIED')
  const b2 = boot(e); assert.deepEqual(b2.flushOutbox('tok-cmd'), { sent: 1, pending: 0 }); assert.deepEqual(b2.flushOutbox('tok-cmd'), { sent: 1, pending: 0 }); assert.equal(sink.state.events.length, 1, 'delivered exactly once')
  const ev = sink.state.events[0]; validateOutcomeEvent(ev)
  assert.deepEqual([ev.schemaVersion, ev.eventType, ev.outcome, ev.headline], [2, 'blueprint.execution.outcome', 'FAILED_ROLLED_BACK', 'FAILED_ROLLED_BACK']); assert.deepEqual(ev.failure, { class: 'VALIDATION', code: 'VALIDATION_FAILED', stage: 'validate', path: null, checkId: 'behavior' })
  assert.equal(ev.rollback.attempted, 2); assert.equal(ev.rollback.errors, 0); assert.deepEqual(ev.validation.map(v => [v.id, v.status]), [['audit', 'PASS'], ['behavior', 'FAIL']]); assert.ok(ev.validation[0].implementationDigest)
  assert.ok(Number.isFinite(ev.latencyMs)); assert.deepEqual(ev.retries, { resumes: 0, recoveries: 0 }); assert.equal(ev.package.id, 'pkg-1'); assert.equal(ev.mission.assignmentId, 'a-1'); assert.equal(ev.workspaceId, 'ws-1')
  assert.deepEqual(ev.provenance, { sourceKind: 'manual-package-import', recipeId: 'r', recipeVersion: '1', provenanceClaimVerified: false, researchRefCount: 0, externalAssistance: null }); assert.deepEqual(ev.claims, { sourceValidated: false, built: false, packaged: false, installed: false, taskComplete: false, missionComplete: false, assignmentComplete: false })
  const bad = structuredClone(ev); bad.claims.built = true; assert.throws(() => validateOutcomeEvent(bad), /claims beyond|built claimed without|packaged claimed without/); const bad2 = structuredClone(ev); bad2.extra = 1; assert.throws(() => validateOutcomeEvent(bad2), /unexpected/)
  const bad3 = structuredClone(ev); bad3.actor.apiToken = 'x'; assert.throws(() => validateOutcomeEvent(bad3), /credential/); assert.equal(buildOutcomeEvent({ exec: { execId: 'e', binding: { packageId: 'p', missionId: 'm', assignmentId: 'a', requestingSubsystem: 's', workspaceId: 'w' }, normalizedHash: 'd', rawHash: 'r', requestedBy: { actorId: 'x', role: 'commander', sessionId: 's' }, approval: null }, receipt: null, outcome: 'BLOCKED', emittedAt: 0 }).latencyMs, null)
})

// ================================================================= regression tests from the independent broker review
test('V1 request-id dedupe never bypasses authority: wrong mission/assignment/role/session cannot read a cached result', async () => {
  const e = env(), b = boot(e), { execId } = ready(b); await b.execute('tok-cmd', execId, CTX, { requestId: 'req-x' })
  assert.equal((await failing(() => b.execute('tok-cmd', execId, { ...CTX, missionId: 'm-evil' }, { requestId: 'req-x' }))).code, 'MISSION_MISMATCH')
  assert.equal((await failing(() => b.execute('tok-op', execId, CTX, { requestId: 'req-x' }))).code, 'ROLE_DENIED'); e.host.assignments.delete('m-1|a-1|ws-1')
  assert.equal((await failing(() => b.execute('tok-cmd', execId, CTX, { requestId: 'req-x' }))).code, 'ASSIGNMENT_INACTIVE')
  const e2 = env(), b2 = boot(e2), x = b2.importPackage('tok-cmd', PKG(), CTX); b2.approve('tok-cmd', x.execId, CTX, { requestId: 'ap' }); assert.equal(codeOf(() => b2.approve('tok-cmd', x.execId, { ...CTX, assignmentId: 'zz' }, { requestId: 'ap' })).code, 'ASSIGNMENT_MISMATCH')
})

test('V2 Phase 9 attributes the run to the EXECUTING actor/session (not the importer) and records the approver separately', async () => {
  const e = env({ policy: { allowApprovalTransfer: (f, t) => f.actorId === t.actorId } }), b = boot(e), { execId } = ready(b); await b.execute('tok-cmd2', execId, CTX)
  const ev = e.host.phase9Sink.state.events[0]; assert.equal(ev.actor.sessionId, 'sess-cmd-0002'); assert.equal(ev.approvedBy.sessionId, 'sess-cmd-0001')
})

test('V3 projection never reports sourceValidated when the source stage did not PASS; historical preview works after execution; read ACL is host policy', async () => {
  const e = env({ buildStage: { ...createSourceOnlyBuildStage(), validateSource: async () => ({ status: 'FAIL' }) } }), b = boot(e), { execId } = ready(b), out = await b.execute('tok-cmd', execId, CTX)
  assert.equal(out.claims.sourceValidated, false); assert.equal(b.status('tok-view', execId).claims.sourceValidated, false); assert.equal(b.status('tok-view', execId).stages.validateSource.status, 'FAIL')
  const e2 = env({ policy: { canRead: (a, binding) => a.role === 'commander' || binding.missionId === 'm-ok' } }), b2 = boot(e2), r2 = ready(b2); await b2.execute('tok-cmd', r2.execId, CTX)
  const hist = b2.preview('tok-cmd', r2.execId); assert.equal(hist.historical, true); assert.equal(hist.changes[0].afterHash, hash(A1)); assert.equal(hist.digest, r2.preview.digest)
  assert.equal(codeOf(() => b2.status('tok-view', r2.execId)).code, 'ROLE_DENIED'); assert.equal(codeOf(() => b2.getReceipt('tok-view', r2.execId)).code, 'ROLE_DENIED'); assert.equal(codeOf(() => b2.preview('tok-view', r2.execId)).code, 'ROLE_DENIED')
})

test('V4 check drift is also refused on RESUME and crash-RECOVERY (resume authority cannot be minted against changed checks)', async () => {
  const drifted = e => { const h = createFakeHost({ now: e.now, workspaces: { 'ws-1': { id: 'ws-1', root: e.ws } }, checks: [audit, { ...behavior, source: 'behavior-impl-CHANGED' }] }); h.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); h.assignments.add('m-1|a-1|ws-1'); return h }
  const e = env(); let br, id; br = boot(e, { afterWrite: p => { if (p === 'src/a.mjs') br.pause('tok-cmd', id, CTX) } }); id = ready(br).execId; await br.execute('tok-cmd', id, CTX)
  const bad = boot(e, { host: drifted(e) }); assert.equal((await failing(() => bad.resume('tok-cmd', id, CTX))).code, 'CHECK_DRIFT'); assert.equal(bad.status('tok-cmd', id).state, 'PAUSED'); assert.equal(rd(e, 'lib/new/c.mjs' && 'src/a.mjs'), A1); assert.ok(!fs.existsSync(path.join(e.ws, 'lib')))
  assert.equal((await boot(e).resume('tok-cmd', id, CTX)).state, 'VERIFIED_SOURCE')
  const e2 = env(), id2 = crash(e2, 'after-write:src/a.mjs'); await sleep(260)
  assert.equal((await failing(() => boot(e2, { host: drifted(e2) }).recoverRun('tok-cmd', id2, 'RESUME', CTX))).code, 'CHECK_DRIFT'); assert.ok(!fs.existsSync(path.join(e2.ws, 'lib')))
  assert.equal((await boot(e2).recoverRun('tok-cmd', id2, 'RESUME', CTX)).projection.state, 'VERIFIED_SOURCE')
})

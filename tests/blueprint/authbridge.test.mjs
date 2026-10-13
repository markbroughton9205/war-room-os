/* eslint-disable @typescript-eslint/no-unused-expressions -- reference suite ported verbatim from the isolated implementation (terse style) */
// Step 3: War Room session/auth seam, READ-ONLY bridge. Hermetic: no live War Room import, no network. The live gate is represented by the
// result shapes it returns ({ok,userId} | {ok:false,response:{status}}). An opt-in test (BLUEPRINT_LIVE_AUTH_INSPECT=1) READS live source files to
// confirm the modelled facts; it never imports or executes them.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BlueprintError, canonical, describeError, hash } from '../../lib/native-builder/blueprint/base.mjs'
import { AUTH_FAILURE_CODES, LIVE_SESSION_TTL_MS, READ_AUTH_MAP, commanderOnlyPolicy, createWarRoomAuthBridge } from '../../lib/native-builder/blueprint/authbridge.mjs'
import { holderIdFor } from '../../lib/native-builder/blueprint/reslock.mjs'
import { createBroker } from '../../lib/native-builder/blueprint/broker.mjs'
import { failureClassOf } from '../../lib/native-builder/blueprint/phase9.mjs'
import { createFakeHost } from './fake-host.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = fs.mkdtempSync(path.join(here, '.fixtures-auth-'))
after(() => fs.rmSync(base, { recursive: true, force: true }))
const A0 = 'export const a = 1\n', A1 = 'export const a = 2\n'
const CTX = { missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1', requestingSubsystem: 'foundry' }
const CMD = '11111111-2222-4333-8444-555555555555', COOKIE = 'wr_local_session=SUPERSECRETCOOKIEVALUE0123456789', BEARER = 'Bearer SUPERSECRETBEARER0123456789'
const PKG = () => JSON.stringify({ version: 1, id: 'pkg-1', goal: 'Bump a', workspace: { id: 'ws-1', baseRevision: 'rev1' }, changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }],
  dependencies: [], checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '1' }], permissions: { writePaths: ['src/a.mjs'] }, artifact: { path: 'src/a.mjs', sha256: hash(A1), kind: 'source-file' }, research: [], recipe: { id: 'r', version: '1', applicability: 'demo', provenance: 'manual' } })
const codeOf = fn => { try { fn() } catch (x) { return x } assert.fail('expected throw') }
const failing = async fn => { try { await fn() } catch (x) { return x } assert.fail('expected rejection') }
const OK = { ok: true, userId: CMD }, S = n => 'lses_' + hash(n).slice(0, 32)
const facts = (e, over = {}) => ({ sessionId: S('local'), authenticatedAt: e.now() - 1000, expiresAt: e.now() + 3600_000, source: 'war-room.local-session', ...over })
function env({ bridgeOpts = {}, policy = commanderOnlyPolicy } = {}) {
  const dir = fs.mkdtempSync(path.join(base, 't-')), ws = path.join(dir, 'ws'); fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/a.mjs'), A0)
  const e = { dir, ws: fs.realpathSync(ws), control: path.join(dir, 'control'), evidence: path.join(dir, 'evidence'), offset: 0, revoked: new Set() }
  e.now = () => Date.now() + e.offset
  e.bridge = createWarRoomAuthBridge({ now: e.now, isSessionLive: id => !e.revoked.has(id), ...bridgeOpts })
  const fake = createFakeHost({ now: e.now, workspaces: { 'ws-1': { id: 'ws-1', root: e.ws } }, policy }); fake.assignments.add('m-1|a-1|ws-1')
  e.host = { ...fake, sessions: e.bridge.sessions }
  e.broker = createBroker({ brokerId: 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: e.host, now: e.now, checkTimeoutMs: 2000 })
  e.tok = (over = {}, gate = OK) => e.bridge.admit(gate, facts(e, over))
  return e
}
const untouched = e => assert.equal(fs.readFileSync(path.join(e.ws, 'src/a.mjs'), 'utf8'), A0) // no mutation of the workspace
const execJson = e => { const ex = path.join(e.control, 'broker/exec'); return fs.readdirSync(ex).map(n => JSON.parse(fs.readFileSync(path.join(ex, n), 'utf8'))) }
function walk(dir, out = []) { for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n), st = fs.lstatSync(f); st.isDirectory() ? walk(f, out) : out.push(f) } return out }

test('AU1 valid Commander gate result + session facts normalize to the strict credential-free actor and drive the broker', async () => {
  const e = env(), h = e.tok(), actor = e.bridge.sessions.resolve(h)
  assert.deepEqual(Object.keys(actor).sort(), ['actorId', 'authenticatedAt', 'authenticationSource', 'role', 'sessionId'])
  assert.deepEqual({ ...actor, authenticatedAt: 0 }, { actorId: CMD, role: 'commander', sessionId: S('local'), authenticatedAt: 0, authenticationSource: 'war-room.local-session' })
  const { execId, preview } = e.broker.importPackage(h, PKG(), CTX); assert.ok(preview)
  assert.equal(typeof e.broker.status(h, execId).state, 'string')
  const gateWithExtras = { ok: true, userId: CMD, token: 'x', cookie: COOKIE, session: { token: 'y' } }
  assert.deepEqual(Object.keys(e.bridge.sessions.resolve(e.bridge.admit(gateWithExtras, facts(e)))).sort(), Object.keys(actor).sort()) // extras ignored, never copied
})

test('AU2 missing/ambiguous auth fails closed with typed codes: 401, 403, 503, malformed gate, missing facts, forged handle', async () => {
  const e = env(), t = (gate, f = facts(e)) => codeOf(() => e.bridge.admit(gate, f)).code, nf = f => codeOf(() => e.bridge.admit(OK, f)).code
  assert.equal(t({ ok: false, response: { status: 401 } }), 'UNAUTHENTICATED')
  assert.equal(t({ ok: false, response: { status: 403 } }), 'COMMANDER_REQUIRED')
  for (const g of [{ ok: false, response: { status: 503 } }, { ok: false, response: {} }, { ok: false }, null, undefined, {}, { ok: 'yes', userId: CMD }, { ok: true }, { ok: true, userId: 'a b;c' }, { ok: true, userId: 42 }]) assert.equal(t(g), 'AUTH_SOURCE_UNAVAILABLE', JSON.stringify(g))
  for (const f of [null, {}, [], { ...facts(e), sessionId: undefined }, { ...facts(e), token: 'x' }, { ...facts(e), cookie: COOKIE }, { ...facts(e), expiresAt: 'soon' }, { ...facts(e), authenticatedAt: e.now() + 3600_000 }]) assert.equal(nf(f), 'AUTH_SOURCE_UNAVAILABLE', JSON.stringify(f))
  for (const forged of ['tok-cmd', '', null, 'rq_' + 'a'.repeat(36), { actorId: CMD }]) assert.equal((await failing(() => e.broker.importPackage(forged, PKG(), CTX))).code, 'UNAUTHENTICATED')
  assert.equal(e.bridge.openHandles, 0); assert.deepEqual(fs.readdirSync(path.join(e.control, 'broker/exec')), [])
})

test('AU3 wrong role: only the Commander is ever admitted; non-Commander gate results and a different configured Commander are refused', () => {
  const e = env({ bridgeOpts: { expectedCommanderUserId: CMD } })
  assert.equal(codeOf(() => e.bridge.admit({ ok: false, response: { status: 403 } }, facts(e))).code, 'COMMANDER_REQUIRED')
  assert.equal(codeOf(() => e.bridge.admit({ ok: true, userId: 'someone-else' }, facts(e))).code, 'COMMANDER_REQUIRED')
  assert.equal(e.bridge.sessions.resolve(e.tok()).role, 'commander')
})

test('AU4 stale/expired/revoked sessions are rejected at admit, at handle expiry and mid-request; execute attempts stop before any mutation', async () => {
  const e = env(), cmd = e.tok(), { execId } = e.broker.importPackage(cmd, PKG(), CTX); e.broker.approve(cmd, execId, CTX)
  assert.equal(codeOf(() => e.tok({ expiresAt: e.now() - 1 })).code, 'SESSION_STALE')
  assert.equal(codeOf(() => e.tok({ authenticatedAt: e.now() - LIVE_SESSION_TTL_MS - 1000, expiresAt: e.now() + 1000 })).code, 'SESSION_STALE')
  e.revoked.add(S('revoked-01')); assert.equal(codeOf(() => e.tok({ sessionId: S('revoked-01') })).code, 'SESSION_STALE')
  const mid = e.tok({ sessionId: S('mid-0001') }); e.revoked.add(S('mid-0001')) // revoked AFTER admission, before the broker call
  assert.equal((await failing(() => e.broker.execute(mid, execId, CTX))).code, 'SESSION_STALE')
  const short = e.tok(); e.offset += 31_000; assert.equal((await failing(() => e.broker.execute(short, execId, CTX))).code, 'SESSION_STALE') // handle TTL
  untouched(e); assert.equal(execJson(e)[0].state, 'APPROVED'); assert.equal(fs.existsSync(path.join(e.control, 'leases')) ? fs.readdirSync(path.join(e.control, 'leases')).filter(n => n.endsWith('.json')).length : 0, 0)
})

test('AU5 approval stays bound to the ORIGINAL actor+session: session changed / actor changed after approval refuse before any mutation', async () => {
  const e = env(), a = e.tok({ sessionId: S('orig-0001') }), { execId } = e.broker.importPackage(a, PKG(), CTX); e.broker.approve(a, execId, CTX)
  const newSession = e.tok({ sessionId: S('new-00001') }), otherActor = e.tok({ sessionId: S('orig-0001') }, { ok: true, userId: 'cmd-other' })
  assert.equal((await failing(() => e.broker.execute(newSession, execId, CTX))).code, 'SESSION_MISMATCH')
  assert.equal((await failing(() => e.broker.execute(otherActor, execId, CTX))).code, 'ACTOR_MISMATCH')
  untouched(e); assert.equal(execJson(e)[0].state, 'APPROVED') // approval not burned
  assert.equal((await e.broker.execute(e.tok({ sessionId: S('orig-0001') }), execId, CTX)).state, 'VERIFIED_SOURCE') // same actor+session still works
})

test('AU6 session revoked between preview and execution attempt: nothing runs; the approval is not consumed', async () => {
  const e = env(), a = e.tok({ sessionId: S('prev-0001') }), { execId } = e.broker.importPackage(a, PKG(), CTX); e.broker.approve(a, execId, CTX)
  e.revoked.add(S('prev-0001'))
  assert.equal(codeOf(() => e.tok({ sessionId: S('prev-0001') })).code, 'SESSION_STALE'); assert.equal((await failing(() => e.broker.execute(a, execId, CTX))).code, 'SESSION_STALE')
  untouched(e); assert.equal(e.broker.buildStageCalls().length, 0); e.revoked.clear()
  assert.equal((await e.broker.execute(e.tok({ sessionId: S('prev-0001') }), execId, CTX)).state, 'VERIFIED_SOURCE')
})

test('AU7 no credential, cookie, bearer, handle or auth object is persisted anywhere (stores, receipts, outbox, events)', async () => {
  const e = env(), gate = { ok: true, userId: CMD, token: 'LEAK-token-1234567890', cookie: COOKIE, authorization: BEARER, identity: { id: 'lid', linked_remote_user_id: 'LEAK-remote' } }
  const h = e.bridge.admit(gate, facts(e)), { execId } = e.broker.importPackage(h, PKG(), CTX); e.broker.approve(h, execId, CTX); await e.broker.execute(h, execId, CTX)
  const blob = [...walk(e.control), ...walk(e.evidence)].map(f => fs.readFileSync(f, 'utf8')).join('\n')
  for (const needle of ['LEAK-', 'SUPERSECRET', 'wr_local_session', 'Bearer ', h, 'linked_remote']) assert.ok(!blob.includes(needle), `persisted ${needle}`)
  assert.ok(blob.includes(S('local')) && blob.includes(CMD)) // only normalized metadata
  assert.equal(JSON.stringify(e.bridge).includes('LEAK'), false)
})

test('AU8 auth errors are scrubbed: fixed text, no raw response/body/host error content in errors, receipts or described errors', async () => {
  const e = env(), raw = { ok: false, response: { status: 401, body: 'LEAK Authenticated token=abc', headers: { cookie: COOKIE } } }
  const x = codeOf(() => e.bridge.admit(raw, facts(e))); assert.ok(x instanceof BlueprintError); assert.ok(!JSON.stringify(describeError(x)).includes('LEAK') && !JSON.stringify(x).includes('SUPERSECRET'))
  for (const code of AUTH_FAILURE_CODES) assert.ok(describeError(new BlueprintError(code, 'auth', 'm')).nextAction.length > 10, code)
  for (const throwing of [() => { throw new Error('boom token=LEAK-xyz /home/x/.secret') }, () => { throw new BlueprintError('SESSION_STALE', 'auth', 'LEAK custom text from host') }]) {
    const h2 = { ...e.host, sessions: { resolve: throwing } }, b = createBroker({ brokerId: 'b2', controlRoot: e.control, evidenceRoot: e.evidence, host: h2, now: e.now })
    const err = codeOf(() => b.importPackage('t', PKG(), CTX)); assert.ok(!JSON.stringify(describeError(err)).includes('LEAK') && !String(err.message).includes('LEAK'), err.code)
    assert.ok(['ACTOR_INVALID', 'SESSION_STALE'].includes(err.code))
  }
  for (const code of AUTH_FAILURE_CODES) assert.equal(failureClassOf(code), 'AUTHORITY')
})

test('AU9 read policy: Commander-only like every live Foundry read route; reads need a fresh session; viewers/operators cannot be produced', async () => {
  const e = env(), h = e.tok(), { execId } = e.broker.importPackage(h, PKG(), CTX); e.broker.approve(h, execId, CTX); await e.broker.execute(h, execId, CTX)
  assert.deepEqual(Object.values(READ_AUTH_MAP), Array(5).fill('commander'))
  const rd = e.tok({ sessionId: S('read-0001') })
  assert.equal(e.broker.status(rd, execId).state, 'VERIFIED_SOURCE'); assert.ok(e.broker.getReceipt(rd, execId)); assert.ok(e.broker.preview(rd, execId, CTX))
  assert.equal(commanderOnlyPolicy.canRead({ role: 'viewer' }), false); assert.equal(commanderOnlyPolicy.canRead({ role: 'operator' }), false); assert.equal(commanderOnlyPolicy.canRead({ role: 'commander' }), true)
  const viewerHost = { ...e.host, sessions: { resolve: () => ({ actorId: 'v1', role: 'viewer', sessionId: 'sess-view-0001', authenticatedAt: e.now(), authenticationSource: 'x' }) } }
  const b = createBroker({ brokerId: 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: viewerHost, now: e.now }); assert.equal(codeOf(() => b.status('t', execId)).code, 'ROLE_DENIED') // policy narrows the broker's own role table
  e.revoked.add(S('read-0001')); assert.equal(codeOf(() => e.broker.status(rd, execId)).code, 'SESSION_STALE')
})

test('AU10 the auth bridge cannot trigger execution, approval, leases or mutation; it only mints request handles', () => {
  const e = env(), before = walk(e.control).sort().join('|')
  assert.deepEqual(Object.keys(e.bridge).filter(k => !['admit', 'close', 'sessions', 'openHandles'].includes(k)), [])
  for (let i = 0; i < 5; i++) e.tok({ sessionId: S(`many-${i}`) })
  assert.equal(walk(e.control).sort().join('|'), before); assert.deepEqual(fs.readdirSync(path.join(e.control, 'broker/exec')), []); assert.equal(fs.readFileSync(path.join(e.ws, 'src/a.mjs'), 'utf8'), A0); assert.equal(e.broker.buildStageCalls().length, 0)
})

test('AU11 approval binding preview: digest + actor + session + mission binding + check binding are all bound; changing any breaks the binding', async () => {
  const e = env(), h = e.tok(), { execId } = e.broker.importPackage(h, PKG(), CTX); e.broker.approve(h, execId, CTX)
  const pkg = JSON.parse(fs.readFileSync(path.join(e.control, 'broker/packages', `${execId}.pkg.json`), 'utf8')), x = { ...execJson(e)[0], binding: pkg.binding }, a = x.approval, mk = o => hash(canonical({ digest: x.normalizedHash, binding: x.binding, checkBinding: a.checkBinding, actorId: a.approvedBy.actorId, sessionId: a.approvedBy.sessionId, baseIdentity: a.baseIdentity.digest, holder: holderIdFor({ brokerId: 'broker-1', missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1' }), ownership: a.ownership?.digest ?? null, pipeline: a.pipeline ?? null, ...o }))
  assert.equal(a.bindingHash, mk({})); assert.equal(a.approvedBy.actorId, CMD); assert.equal(a.approvedBy.sessionId, S('local'))
  assert.deepEqual({ m: x.binding.missionId, a: x.binding.assignmentId, w: x.binding.workspaceId }, { m: 'm-1', a: 'a-1', w: 'ws-1' }); assert.match(a.checkBinding, /^[a-f0-9]{64}$/)
  for (const o of [{ digest: 'f'.repeat(64) }, { actorId: 'other' }, { sessionId: S('other-01') }, { binding: { ...x.binding, missionId: 'm-2' } }, { checkBinding: 'e'.repeat(64) }, { baseIdentity: 'rev-other' }, { holder: 'bp-other' }]) assert.notEqual(mk(o), a.bindingHash, Object.keys(o)[0])
  assert.ok(!JSON.stringify(x).includes(h)) // the request handle is never part of the approval
})

test('AU12 session fixation / handle abuse: handles are server-minted random ids, unusable after close, never derived from caller input, and the actor cannot be chosen via facts or gate fields', async () => {
  const e = env(), h1 = e.tok(), h2 = e.tok(); assert.notEqual(h1, h2); assert.match(h1, /^rq_[a-f0-9]{36}$/)
  e.bridge.close(h1); assert.equal(codeOf(() => e.bridge.sessions.resolve(h1)).code, 'UNAUTHENTICATED')
  assert.equal(codeOf(() => e.bridge.admit({ ok: true, userId: CMD, role: 'commander', actorId: 'evil' }, { ...facts(e), actorId: 'evil' })).code, 'AUTH_SOURCE_UNAVAILABLE') // facts cannot carry identity
  assert.equal(e.bridge.sessions.resolve(e.bridge.admit({ ok: true, userId: CMD, actorId: 'evil', role: 'viewer' }, facts(e))).actorId, CMD) // gate extras never choose actor/role
  const small = createWarRoomAuthBridge({ now: e.now, handleTtlMs: 1000, isSessionLive: () => true }), s = small.admit(OK, facts(e)); e.offset += 2000; assert.equal(codeOf(() => small.sessions.resolve(s)).code, 'SESSION_STALE'); assert.equal(small.openHandles, 0)
})

test('AU13 live-source conformance (mandatory; READ-ONLY file reads of THIS repo; nothing imported or executed)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url)), rd = rel => fs.readFileSync(path.join(root, rel), 'utf8')
  const gate = rd('lib/security/commanderSession.ts'), store = rd('lib/sovereign-runtime/local-ownership/store.ts'), types = rd('lib/sovereign-runtime/local-ownership/types.ts')
  assert.match(gate, /export async function requireCommanderSession\b/); assert.match(gate, /\{ ok: true, userId/); for (const st of ['status: 401', 'status: 403', 'status: 503']) assert.ok(gate.includes(st), st)
  assert.match(gate, /export async function requireCommanderSessionFacts/); assert.match(gate, /auth\.session\.session_id/) // facts come from the verified session row
  assert.match(types, /LOCAL_SESSION_TTL_MS = 12 \* 60 \* 60 \* 1000/); assert.match(store, /if \(row\.revoked_at\) return null/); assert.match(store, /expires_at\)\.getTime\(\) <= Date\.now\(\)/)
  assert.match(store, /UPDATE local_session SET last_seen_at/) // verifySessionToken WRITES last_seen_at: not a pure read
  const probe = store.slice(store.indexOf('sessionIsLive('), store.indexOf('sessionIsLive(') + 900); assert.ok(!/UPDATE|INSERT|DELETE/.test(probe.split('\n  }\n')[0])) // the liveness probe is a pure read
})

test('AU14 review regressions: a raw token/cookie value or unknown source can never be accepted as a session id; revocation check is mandatory; auth codes map to AUTHORITY', () => {
  const e = env(), tokenLike = 'x'.repeat(43), jwt = 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl'
  for (const sessionId of [tokenLike, jwt, 'lses_' + 'g'.repeat(32), 'lses_' + 'a'.repeat(31), 'sess-local-0001']) assert.equal(codeOf(() => e.tok({ sessionId })).code, 'AUTH_SOURCE_UNAVAILABLE', sessionId)
  assert.equal(codeOf(() => e.tok({ source: 'war-room.supabase' })).code, 'AUTH_SOURCE_UNAVAILABLE') // supabase path exposes no session id: fail closed until a live accessor exists
  assert.throws(() => createWarRoomAuthBridge({ now: e.now }), /isSessionLive/)
  const throwingLive = createWarRoomAuthBridge({ now: e.now, isSessionLive: () => { throw new Error('db down') } }); assert.equal(codeOf(() => throwingLive.admit(OK, facts(e))).code, 'SESSION_STALE') // liveness errors fail closed
  const asyncLive = createWarRoomAuthBridge({ now: e.now, isSessionLive: async () => true }); assert.equal(codeOf(() => asyncLive.admit(OK, facts(e))).code, 'SESSION_STALE') // a Promise is not `true`: never fail open
})

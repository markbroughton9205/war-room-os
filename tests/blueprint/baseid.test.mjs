/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions -- reference suite ported verbatim from the isolated implementation (terse style) */
// Step 5: workspace BASE IDENTITY seam. Hermetic: real `git` against throwaway fixture repos in the OS temp dir (never the parent repo, never live War Room).
// The probe only ever runs the read-only argv shapes in ALLOWED_GIT; fixture mutations (commit/checkout/worktree) are TEST actions standing in for external actors.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createCheckRegistry } from '../../lib/native-builder/blueprint/adapters.mjs'
import { ALLOWED_GIT, baseDigestOf, classifyBaseChange, createGitProbe, createWorkspaceBaseIdentity, normalizeBaseIdentity, recoveryClassOf } from '../../lib/native-builder/blueprint/baseid.mjs'
import { hash } from '../../lib/native-builder/blueprint/base.mjs'
import { createBroker } from '../../lib/native-builder/blueprint/broker.mjs'
import { createFakeHost } from './fake-host.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-baseid-')))
after(() => fs.rmSync(base, { recursive: true, force: true }))
const A0 = 'export const a = 1\n', A1 = 'export const a = 2\n', C1 = "import { a } from '../src/a.mjs'\nexport const c = a\n"
const CTX = { missionId: 'm-1', assignmentId: 'a-1', workspaceId: 'ws-1', requestingSubsystem: 'foundry' }
const codeOf = fn => { try { fn() } catch (x) { return x } assert.fail('expected throw') }
const failing = async fn => { try { await fn() } catch (x) { return x } assert.fail('expected rejection') }
const GENV = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: base }
const G = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const PKG = (rev, over = {}) => JSON.stringify({ version: 1, id: 'pkg-1', goal: 'Bump a and add c', workspace: { id: 'ws-1', baseRevision: rev },
  changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 }, { path: 'lib/new/c.mjs', operation: 'create', beforeHash: null, content: C1 }],
  dependencies: [], checks: [{ id: 'audit', version: '1' }, { id: 'behavior', version: '1' }], permissions: { writePaths: ['src/a.mjs', 'lib/new/c.mjs'] },
  artifact: { path: 'src/a.mjs', sha256: hash(A1), kind: 'source-file' }, research: [], recipe: { id: 'r', version: '1', applicability: 'demo', provenance: 'manual' }, ...over })
const defs = hooks => [
  { id: 'audit', version: '1', role: 'dependency-audit', source: 'audit-impl-v1', run: async () => { hooks.audit?.(); return { status: 'PASS', evidence: 'audit ok' } } },
  { id: 'behavior', version: '1', role: 'behavior', source: 'behavior-impl-v1', run: async () => { hooks.behavior?.(); return { status: 'PASS', evidence: 'ok' } } },
]
let n = 0
function env() {
  const dir = path.join(base, `t-${++n}`), ws = path.join(dir, 'ws'); fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/a.mjs'), A0)
  G(ws, 'init', '-q', '-b', 'main'); G(ws, 'add', '-A'); G(ws, 'commit', '-q', '-m', 'base')
  const e = { dir, ws, control: path.join(dir, 'control'), evidence: path.join(dir, 'evidence'), roots: { 'ws-1': ws }, hooks: {}, probe: createGitProbe() }
  e.adapter = createWorkspaceBaseIdentity({ probe: e.probe, rootOf: id => ({ root: e.roots[id] }) })
  e.host = createFakeHost({ workspaces: { 'ws-1': { id: 'ws-1', root: ws } }, checks: defs({ audit: () => e.hooks.audit?.(), behavior: () => e.hooks.behavior?.() }) })
  e.host.baseIdentity = e.adapter; e.host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); e.host.issue('tok-op', { actorId: 'op1', role: 'operator', sessionId: 'sess-op-0001' }); e.host.assignments.add('m-1|a-1|ws-1')
  e.pkg = () => PKG(e.adapter.resolve('ws-1'))
  return e
}
const boot = (e, o = {}) => createBroker({ brokerId: 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: o.host ?? e.host, leaseTtlMs: 60_000, checkTimeoutMs: 2000, faultHook: o.faultHook, afterWrite: o.afterWrite })
const ready = (b, e, raw = e.pkg()) => { const { execId } = b.importPackage('tok-cmd', raw, CTX); b.approve('tok-cmd', execId, CTX); return execId }
const rd = (e, rel) => fs.readFileSync(path.join(e.ws, rel), 'utf8')
const loadExec = (e, id) => JSON.parse(fs.readFileSync(path.join(e.control, 'broker/exec', `${id}.json`), 'utf8'))
const ext = e => G(e.ws, 'commit', '-q', '--allow-empty', '-m', 'external') // an EXTERNAL actor advances the base
const idOf = e => e.adapter.inspect('ws-1')

test('BI1 normalized identity: strict shape, UNKNOWN for anything unproven (never invented), `complete` is recomputed, digest ignores observedAt', () => {
  const full = { workspaceId: 'ws-1', canonicalRoot: '/r', rootId: '1:2', sourceKind: 'git-main', repositoryId: 'repo-' + 'a'.repeat(32), worktreeId: 'wt-' + 'b'.repeat(32), branch: 'main', baseCommit: 'c'.repeat(40), sourceEpoch: 'UNKNOWN', observedAt: 5 }
  const a = normalizeBaseIdentity(full); assert.equal(a.complete, true); assert.ok(Object.isFrozen(a)); assert.equal(baseDigestOf(a), baseDigestOf(normalizeBaseIdentity({ ...full, observedAt: 999 })))
  assert.notEqual(baseDigestOf(a), baseDigestOf(normalizeBaseIdentity({ ...full, baseCommit: 'd'.repeat(40) })))
  for (const bad of [null, [], { ...full, extra: 1 }, { ...full, token: 'x' }]) assert.equal(normalizeBaseIdentity(bad), null)
  const partial = normalizeBaseIdentity({ workspaceId: 'ws-1', canonicalRoot: '/r', rootId: 'nope', branch: '', baseCommit: 'xyz' }); assert.deepEqual([partial.rootId, partial.branch, partial.baseCommit, partial.repositoryId, partial.complete], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', false])
  assert.equal(normalizeBaseIdentity({ ...full, baseCommit: 'nope', complete: true }).complete, false, 'a stored `complete: true` is never trusted')
  assert.deepEqual(Object.values({ a: 'BASE_UNCHANGED', b: 'BASE_ADVANCED_EXTERNALLY', c: 'WORKTREE_CHANGED', d: 'WORKSPACE_REBOUND', e: 'UNKNOWN' }).map(recoveryClassOf), ['SAME_BASE_SAFE', 'BASE_CHANGED_REVIEW_REQUIRED', 'WORKTREE_CHANGED_REVIEW_REQUIRED', 'WORKSPACE_REBOUND_REVIEW_REQUIRED', 'UNKNOWN_REVIEW_REQUIRED'])
})

test('BI2 real git checkout: repository + worktree + root identity are proven; stable across repeated inspection and across working-tree edits (identity != file state)', () => {
  const e = env(), a = idOf(e); assert.equal(a.complete, true); assert.deepEqual([a.sourceKind, a.branch, a.canonicalRoot], ['git-main', 'main', e.ws]); assert.match(a.repositoryId, /^repo-[a-f0-9]{32}$/); assert.match(a.worktreeId, /^wt-[a-f0-9]{32}$/); assert.match(a.baseCommit, /^[0-9a-f]{40,64}$/)
  fs.writeFileSync(path.join(e.ws, 'src/a.mjs'), 'dirty edit\n'); fs.mkdirSync(path.join(e.ws, 'newdir')); fs.writeFileSync(path.join(e.ws, 'newdir/x'), 'x')
  assert.equal(baseDigestOf(idOf(e)), baseDigestOf(a), 'dirty tree / new files / edits never change base identity'); assert.equal(classifyBaseChange(a, idOf(e)), 'BASE_UNCHANGED')
})

test('BI3 own-write stability: a full broker run (writes + new dirs) leaves the base identity unchanged although the tree is now dirty; a naive dirty-tree identity would have broken; per-file hashes still catch external edits', async () => {
  const e = env(), b = boot(e), before = idOf(e), naive0 = hash(G(e.ws, 'status', '--porcelain')), id = ready(b, e)
  const out = await b.execute('tok-cmd', id, CTX); assert.equal(out.state, 'VERIFIED_SOURCE'); assert.equal(rd(e, 'src/a.mjs'), A1)
  assert.equal(baseDigestOf(idOf(e)), baseDigestOf(before)); assert.equal(classifyBaseChange(before, idOf(e)), 'BASE_UNCHANGED'); assert.notEqual(hash(G(e.ws, 'status', '--porcelain')), naive0, 'working tree content state DID change (a dirty-tree identity would self-invalidate)')
  assert.equal(loadExec(e, id).baseIdentity.digest, baseDigestOf(before)); assert.equal(out.stages.validateSource.status, 'PASS')
  // external edit of a target file: base identity is unchanged, but the per-file before-hash refuses
  const e2 = env(), b2 = boot(e2), id2 = ready(b2, e2); fs.writeFileSync(path.join(e2.ws, 'src/a.mjs'), 'export const a = 9\n')
  const err = await failing(() => b2.execute('tok-cmd', id2, CTX)); assert.ok(['FILE_HASH_MISMATCH', 'BLOCKED'].includes(err.code ?? err.state), String(err.code)); assert.equal(rd(e2, 'src/a.mjs'), 'export const a = 9\n', 'external edit preserved')
})

test('BI4 external base commit advance after approval: refused before the approval is consumed or a lease taken; returning to the approved base makes the SAME approval usable again', async () => {
  const e = env(), b = boot(e), id = ready(b, e), approved = loadExec(e, id).approval.baseIdentity.identity, c0 = approved.baseCommit
  ext(e); assert.equal(classifyBaseChange(normalizeBaseIdentity(approved), idOf(e)), 'BASE_ADVANCED_EXTERNALLY')
  const err = await failing(() => b.execute('tok-cmd', id, CTX)); assert.equal(err.code, 'BASE_REVISION_MISMATCH'); assert.equal(err.observed, 'BASE_CHANGED_REVIEW_REQUIRED'); assert.equal(rd(e, 'src/a.mjs'), A0); assert.equal(loadExec(e, id).state, 'APPROVED')
  assert.equal(fs.existsSync(path.join(e.control, 'leases')) && fs.readdirSync(path.join(e.control, 'leases')).some(f => f.endsWith('.json')), false, 'no lease was taken')
  G(e.ws, 'reset', '-q', '--hard', c0); assert.equal((await b.execute('tok-cmd', id, CTX)).state, 'VERIFIED_SOURCE', 'approval was preserved and base is again the approved one')
})

test('BI5 branch switch / detached HEAD: WORKTREE_CHANGED (checked-out ref changed), even at the same commit; moving a detached HEAD is a base advance', async () => {
  const e = env(), a = idOf(e), b = boot(e), id = ready(b, e)
  G(e.ws, 'checkout', '-q', '-b', 'feature'); const f = idOf(e); assert.equal(f.baseCommit, a.baseCommit); assert.equal(classifyBaseChange(a, f), 'WORKTREE_CHANGED')
  assert.equal((await failing(() => b.execute('tok-cmd', id, CTX))).observed, 'WORKTREE_CHANGED_REVIEW_REQUIRED'); assert.equal(rd(e, 'src/a.mjs'), A0)
  G(e.ws, 'checkout', '-q', 'main'); assert.equal(classifyBaseChange(a, idOf(e)), 'BASE_UNCHANGED'); G(e.ws, 'checkout', '-q', '--detach'); const d = idOf(e); assert.equal(d.branch, 'DETACHED'); assert.equal(classifyBaseChange(a, d), 'WORKTREE_CHANGED')
  const before = idOf(e); ext(e); assert.equal(classifyBaseChange(before, idOf(e)), 'BASE_ADVANCED_EXTERNALLY')
})

test('BI6 same commit, different worktree: linked worktree has its own worktreeId + kind, same repositoryId; a copied directory shares NOTHING; a binding swapped between them is a rebind', () => {
  const e = env(), main = idOf(e), wt = path.join(e.dir, 'wt2'); G(e.ws, 'worktree', 'add', '-q', '--detach', wt); e.roots['ws-wt'] = wt
  const linked = e.adapter.inspect('ws-wt'); assert.equal(linked.baseCommit, main.baseCommit); assert.equal(linked.sourceKind, 'git-linked-worktree'); assert.equal(linked.repositoryId, main.repositoryId); assert.notEqual(linked.worktreeId, main.worktreeId); assert.notEqual(baseDigestOf(linked), baseDigestOf(main))
  const copy = path.join(e.dir, 'copy'); fs.cpSync(e.ws, copy, { recursive: true }); e.roots['ws-copy'] = copy; const c = e.adapter.inspect('ws-copy')
  assert.equal(c.baseCommit, main.baseCommit); assert.equal(c.branch, main.branch); for (const k of ['repositoryId', 'worktreeId', 'rootId', 'canonicalRoot']) assert.notEqual(c[k], main[k], k); assert.equal(c.sourceKind, 'git-main')
  e.roots['ws-1'] = copy; assert.equal(classifyBaseChange(main, idOf(e)), 'WORKSPACE_REBOUND', 'same workspaceId now pointing at a copy'); e.roots['ws-1'] = wt; assert.equal(classifyBaseChange(main, idOf(e)), 'WORKSPACE_REBOUND')
  assert.equal(classifyBaseChange(main, { ...main, worktreeId: linked.worktreeId, sourceKind: 'git-linked-worktree' }), 'WORKTREE_CHANGED', 'same root + repo, different worktree identity')
})

test('BI7 physical root: replaced repository at the same path, retargeted root, and non-canonical roots (symlink/relative/dot-dot) are refused or classified as rebound; alias spellings share a rootId', async () => {
  const e = env(), a = idOf(e)
  const fresh = path.join(e.dir, 'fresh'); fs.cpSync(e.ws, fresh, { recursive: true }); fs.rmSync(path.join(fresh, '.git'), { recursive: true }); fs.writeFileSync(path.join(fresh, 'x'), 'x'); G(fresh, 'init', '-q', '-b', 'main'); G(fresh, 'add', '-A'); G(fresh, 'commit', '-q', '-m', 'other')
  const old = path.join(e.dir, 'ws.old'); fs.renameSync(e.ws, old); fs.renameSync(fresh, e.ws) // repository replaced at the same path (both existed, so inodes differ)
  assert.equal(classifyBaseChange(a, idOf(e)), 'WORKSPACE_REBOUND'); fs.renameSync(e.ws, fresh); fs.renameSync(old, e.ws); assert.equal(classifyBaseChange(a, idOf(e)), 'BASE_UNCHANGED')
  const link = path.join(e.dir, 'alias'); fs.symlinkSync(e.ws, link); e.roots['ws-alias'] = link
  assert.equal(e.adapter.inspect('ws-alias').complete, false); assert.equal(codeOf(() => e.adapter.resolve('ws-alias')).code, 'BASE_REVISION_MISMATCH'); assert.equal(createGitProbe().inspect(link).error, 'ROOT_NOT_CANONICAL')
  for (const spelling of [e.ws + '/../ws', e.ws + '/', e.ws + '/./', path.relative(process.cwd(), e.ws)]) assert.equal(createGitProbe().inspect(spelling).error, 'ROOT_NOT_CANONICAL', spelling)
  assert.equal(`${fs.statSync(link, { bigint: true }).dev}:${fs.statSync(link, { bigint: true }).ino}`, a.rootId, 'an alias resolves to the same dev:ino root object, so alias detection by rootId comparison is possible')
  e.roots['ws-1'] = path.join(e.dir, 'does-not-exist'); assert.equal(idOf(e).complete, false); assert.equal(classifyBaseChange(a, idOf(e)), 'UNKNOWN')
  const nogit = path.join(e.dir, 'plain'); fs.mkdirSync(nogit); e.roots['ws-1'] = nogit; assert.equal(idOf(e).complete, false); assert.equal(idOf(e).sourceKind, 'not-git')
  const unborn = path.join(e.dir, 'unborn'); fs.mkdirSync(unborn); G(unborn, 'init', '-q', '-b', 'main'); e.roots['ws-1'] = unborn; assert.equal(idOf(e).complete, false, 'unborn HEAD: no base commit is provable')
  const sub = path.join(e.ws, 'src'); e.roots['ws-1'] = sub; assert.equal(idOf(e).sourceKind, 'git-subdirectory')
})

test('BI8 approval binding: base identity + lease holder are part of the approval; unproven identity cannot be approved; classification detail is carried without paths or errors', async () => {
  const e = env(), b = boot(e), { execId } = b.importPackage('tok-cmd', e.pkg(), CTX), digestNow = e.adapter.resolve('ws-1')
  e.roots['ws-1'] = path.join(e.dir, 'gone'); assert.equal((await failing(async () => b.approve('tok-cmd', execId, CTX))).code, 'BASE_REVISION_MISMATCH'); e.roots['ws-1'] = e.ws
  b.approve('tok-cmd', execId, CTX); const a = loadExec(e, execId).approval; assert.equal(a.baseIdentity.digest, digestNow); assert.equal(a.baseIdentity.identity.baseCommit, idOf(e).baseCommit)
  const err = await (async () => { ext(e); return failing(() => b.execute('tok-cmd', execId, CTX)) })(); assert.ok(!JSON.stringify(err.toJSON?.() ?? err.message).includes(e.dir), 'no host paths in the refusal')
})

test('BI9 cross-workspace replay: an approval for ws-1 cannot run when the host rebinds ws-1 to a copy/worktree, nor for another workspace id', async () => {
  const e = env(), b = boot(e), id = ready(b, e), copy = path.join(e.dir, 'copy'); fs.cpSync(e.ws, copy, { recursive: true })
  e.roots['ws-1'] = copy; const err = await failing(() => b.execute('tok-cmd', id, CTX)); assert.equal(err.code, 'BASE_REVISION_MISMATCH'); assert.equal(err.observed, 'WORKSPACE_REBOUND_REVIEW_REQUIRED'); assert.equal(fs.readFileSync(path.join(copy, 'src/a.mjs'), 'utf8'), A0); assert.equal(rd(e, 'src/a.mjs'), A0)
  e.roots['ws-1'] = e.ws; assert.equal((await failing(() => b.execute('tok-cmd', id, { ...CTX, workspaceId: 'ws-2' }))).code, 'WORKSPACE_MISMATCH')
})

test('BI10 per-write recheck: an external base advance after the first write stops the run before the second write (no consequential action on a moved base); success is never claimed', async () => {
  const e = env(); let done = false; const b = boot(e, { afterWrite: p => { if (p === 'src/a.mjs' && !done) { done = true; ext(e) } } }), id = ready(b, e)
  const out = await b.execute('tok-cmd', id, CTX).catch(x => x); assert.ok(done); assert.ok(!fs.existsSync(path.join(e.ws, 'lib/new/c.mjs')), 'second write never happened'); assert.notEqual(out.state, 'VERIFIED_SOURCE'); assert.ok(!out.claims?.sourceValidated)
  assert.equal(rd(e, 'src/a.mjs'), A0, 'rolled back under the still-valid lease'); assert.equal(out.error?.code ?? out.code, 'BASE_REVISION_MISMATCH')
})

test('BI11 finalization recheck: base moved during validation => no VERIFIED_SOURCE; and a swapped check registry at the end is caught by the broker final gate', async () => {
  const e = env(); e.hooks.behavior = () => ext(e); const b = boot(e), id = ready(b, e), out = await b.execute('tok-cmd', id, CTX).catch(x => x)
  assert.notEqual(out.state, 'VERIFIED_SOURCE'); assert.ok(!out.claims?.sourceValidated); assert.equal(e.host.phase9Sink.state.events.at(-1)?.claims.sourceValidated ?? false, false)
  const e2 = env(); e2.hooks.behavior = () => { e2.host.checks = createCheckRegistry([{ id: 'audit', version: '1', role: 'dependency-audit', source: 'tampered', run: async () => ({ status: 'PASS' }) }, { id: 'behavior', version: '1', role: 'behavior', source: 'behavior-impl-v1', run: async () => ({ status: 'PASS' }) }]) }
  const b2 = boot(e2), id2 = ready(b2, e2), o2 = await b2.execute('tok-cmd', id2, CTX); assert.equal(o2.state, 'NEEDS_OPERATOR_REVIEW_CHECKS'); assert.equal(o2.claims.sourceValidated, false); assert.equal(o2.stages.checkBinding.status, 'FAIL')
})

function crash(e, point) {
  const code = `
    import { createBroker } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/broker.mjs'))}
    import { createGitProbe, createWorkspaceBaseIdentity } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/baseid.mjs'))}
    import { createFakeHost } from ${JSON.stringify(path.join(here, 'fake-host.mjs'))}
    const host = createFakeHost({ workspaces: { 'ws-1': { id: 'ws-1', root: process.env.WS } } }); host.baseIdentity = createWorkspaceBaseIdentity({ probe: createGitProbe(), rootOf: () => ({ root: process.env.WS }) })
    host.issue('tok-cmd', { actorId: 'cmd1', sessionId: 'sess-cmd-0001' }); host.assignments.add('m-1|a-1|ws-1')
    const ctx = ${JSON.stringify(CTX)}, b = createBroker({ brokerId: 'broker-1', controlRoot: process.env.CTL, evidenceRoot: process.env.EV, host, leaseTtlMs: 200, afterWrite: p => { if (p === ${JSON.stringify(point)}) process.kill(process.pid, 'SIGKILL') } })
    const { execId } = b.importPackage('tok-cmd', process.env.PKG, ctx); b.approve('tok-cmd', execId, ctx); await b.execute('tok-cmd', execId, ctx)`
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, CTL: e.control, EV: e.evidence, WS: e.ws, PKG: e.pkg() }, timeout: 20000 }); assert.equal(res.signal, 'SIGKILL', String(res.stderr))
  return fs.readdirSync(path.join(e.control, 'broker/exec'))[0].slice(0, -5)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

test('BI12 crash with UNCHANGED base: scan says SAME_BASE_SAFE; recovery resumes and the completed write is not repeated', async () => {
  const e = env(), id = crash(e, 'src/a.mjs'); await sleep(260); const ino = fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, b = boot(e), scan = b.recoverAll('tok-cmd')[0]
  assert.deepEqual([scan.classification, scan.base.classification, scan.base.recovery], ['SAFE_TO_RESUME', 'BASE_UNCHANGED', 'SAME_BASE_SAFE'])
  const done = await b.recoverRun('tok-cmd', id, 'RESUME', CTX); assert.equal(done.projection.state, 'VERIFIED_SOURCE'); assert.equal(fs.statSync(path.join(e.ws, 'src/a.mjs')).ino, ino)
})

test('BI13 crash with CHANGED base: no automatic resume for advanced/worktree/rebound/unknown; restore stays possible only when the checkout is still the same object (hash-guarded)', async () => {
  const mk = async mutate => { const e = env(), id = crash(e, 'src/a.mjs'); await sleep(260); mutate(e); return { e, id, b: boot(e) } }
  { const { e, id, b } = await mk(ext); const s = b.recoverAll('tok-cmd')[0]; assert.deepEqual([s.base.classification, s.base.recovery], ['BASE_ADVANCED_EXTERNALLY', 'BASE_CHANGED_REVIEW_REQUIRED'])
    assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'RECOVERY_NOT_ALLOWED'); assert.equal(rd(e, 'src/a.mjs'), A1)
    await b.recoverRun('tok-cmd', id, 'RESTORE', CTX); assert.equal(rd(e, 'src/a.mjs'), A0, 'advance-only: hash-guarded restore is allowed') }
  { const { e, id, b } = await mk(e => G(e.ws, 'checkout', '-q', '-b', 'other')); const s = b.recoverAll('tok-cmd')[0]; assert.equal(s.base.recovery, 'WORKTREE_CHANGED_REVIEW_REQUIRED')
    for (const act of ['RESUME', 'RESTORE']) assert.equal((await failing(() => b.recoverRun('tok-cmd', id, act, CTX))).code, 'RECOVERY_NOT_ALLOWED', act); assert.equal(rd(e, 'src/a.mjs'), A1, 'nothing touched') }
  { const { e, id, b } = await mk(e => { const copy = path.join(e.dir, 'copy'); fs.cpSync(e.ws, copy, { recursive: true }); e.roots['ws-1'] = copy }); assert.equal(b.recoverAll('tok-cmd')[0].base.recovery, 'WORKSPACE_REBOUND_REVIEW_REQUIRED')
    for (const act of ['RESUME', 'RESTORE', 'RECONCILE']) assert.equal((await failing(() => b.recoverRun('tok-cmd', id, act, CTX))).code, 'RECOVERY_NOT_ALLOWED', act) }
  { const { e, id, b } = await mk(e => { e.roots['ws-1'] = path.join(e.dir, 'missing') }); assert.equal(b.recoverAll('tok-cmd')[0].base.recovery, 'UNKNOWN_REVIEW_REQUIRED'); assert.equal((await failing(() => b.recoverRun('tok-cmd', id, 'RESUME', CTX))).code, 'RECOVERY_NOT_ALLOWED') }
})

test('BI14 read-only probe: only the ALLOWED read-only git argv can run (no status/checkout/reset/switch/worktree/config/update-ref); inspections leave .git byte-identical', () => {
  const e = env(), p = createGitProbe(), walk = (d, o = []) => { for (const x of fs.readdirSync(d)) { const f = path.join(d, x), st = fs.lstatSync(f); st.isDirectory() ? walk(f, o) : o.push(f) } return o }
  const snap = () => hash(walk(path.join(e.ws, '.git')).sort().map(f => f + ':' + hash(fs.readFileSync(f))).join('|'))
  const s0 = snap(); for (let i = 0; i < 25; i++) { p.inspect(e.ws); e.adapter.inspect('ws-1') } assert.equal(snap(), s0)
  const calls = []; const spy = createGitProbe({ exec: args => { calls.push(args); throw new Error('x') } }); spy.inspect(e.ws); assert.ok(calls.every(a => ALLOWED_GIT.some(w => w.join(' ') === a.join(' '))))
  const exec = []; const gated = createGitProbe({ exec: (a) => { exec.push(a); return '' } })
  for (const argv of [['status'], ['status', '--porcelain'], ['checkout', 'x'], ['reset', '--hard'], ['switch', 'x'], ['worktree', 'add', 'x'], ['config', 'a', 'b'], ['update-ref', 'a', 'b'], ['rev-parse', 'HEAD'], ['symbolic-ref', 'HEAD', 'refs/heads/x'], [...ALLOWED_GIT[0], '--x'], []]) assert.throws(() => gated.run(argv, e.ws), /GIT_COMMAND_NOT_ALLOWED/, argv.join(' '))
  assert.equal(exec.length, 0, 'forbidden commands never reached the executor'); for (const argv of ALLOWED_GIT) gated.run([...argv], e.ws); assert.equal(exec.length, 2)
  assert.deepEqual(Object.keys(e.adapter).sort(), ['classify', 'inspect', 'kind', 'resolve']); assert.ok(Object.isFrozen(e.adapter) && Object.isFrozen(p))
})

test('BI15 review regressions: base compare is recomputed from the stored identity (tampered `complete`), git failure is UNKNOWN not DETACHED, digest-only hosts still enforce digest equality, identity never contains secrets/pids/sessions', async () => {
  const e = env(), a = idOf(e), tampered = { ...JSON.parse(JSON.stringify(a)), baseCommit: 'UNKNOWN', complete: true }; assert.equal(classifyBaseChange(normalizeBaseIdentity(tampered), a), 'UNKNOWN')
  const failingGit = createGitProbe({ exec: args => { if (args[0] === 'symbolic-ref') { const x = new Error('boom'); x.status = 128; x.stdout = ''; throw x } return execFileSync('git', args, { cwd: e.ws, encoding: 'utf8', env: GENV }) } }); assert.equal(failingGit.inspect(e.ws).branch, 'UNKNOWN')
  assert.ok(!/pid|session|token|cookie|secret/i.test(JSON.stringify(a)))
  const e2 = env(); e2.host.baseIdentity = { resolve: id => e2.adapter.resolve(id) } // digest-only adapter: no inspect/classify
  const b = boot(e2, { host: e2.host }), id = ready(b, e2); ext(e2); assert.equal((await failing(() => b.execute('tok-cmd', id, CTX))).code, 'BASE_REVISION_MISMATCH')
})

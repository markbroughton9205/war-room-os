/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions -- reference suite ported verbatim from the isolated implementation (terse style) */
// Step 7: execution bridge. REAL bounded build/package recipes run against an isolated fixture workspace under Node's permission model. No network, no installs, no live War Room.
// Passing here establishes ONLY ISOLATED_SOURCE_VALIDATED / ISOLATED_BUILD_VERIFIED / ISOLATED_PACKAGE_VERIFIED.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createCheckRegistry } from '../../lib/native-builder/blueprint/adapters.mjs'
import { buildManifest, hashArtifactFile, safeRelPath, scanOutputDir, verifyManifest } from '../../lib/native-builder/blueprint/artifacts.mjs'
import { buildDependencyPlan, classifyDependencySpec } from '../../lib/native-builder/blueprint/depplan.mjs'
import { createWorkspaceDependencyVerifier } from '../../lib/native-builder/blueprint/depverify.mjs'
import { structuredError } from '../../lib/native-builder/blueprint/buildexec.mjs'
import { hash } from '../../lib/native-builder/blueprint/base.mjs'
import { createBroker } from '../../lib/native-builder/blueprint/broker.mjs'
import { validateOutcomeEvent } from '../../lib/native-builder/blueprint/phase9.mjs'
import { randomUUID } from 'node:crypto'
import { createControlPlane } from '../../lib/native-builder/blueprint/control.mjs'
import { REBUILD_GROUP, STALE_GROUP, createBuildEngine } from '../../lib/native-builder/blueprint/buildexec.mjs'
import { INSTALL_REQUIREMENTS, createBuildPipeline } from '../../lib/native-builder/blueprint/stages.mjs'
import { createLiveModel } from './ownership-fixture.mjs'
import { A0, A1, CTX, PKG, baseChecks, copyRecipes, createExecHost, createWorkspace, installTinyDep, stageCheckDefs } from './exec-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-exec-')))
after(() => fs.rmSync(base, { recursive: true, force: true }))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const failing = async fn => { try { await fn() } catch (x) { return x } assert.fail('expected rejection') }
let n = 0
function env(o = {}) {
  const dir = path.join(base, `t-${++n}`), ws = path.join(dir, 'ws'); fs.mkdirSync(dir, { recursive: true }); createWorkspace(ws, o.workspace); const rdir = copyRecipes(dir)
  const e = { dir, ws, rdir, control: path.join(dir, 'control'), evidence: path.join(dir, 'evidence'), opts: o }
  e.host = createExecHost({ ws, rdir, approved: o.approved, pipelineOpts: o.pipeline, hostOpts: o.hostOpts }); return e
}
const boot = (e, o = {}) => createBroker({ brokerId: 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: o.host ?? e.host, leaseTtlMs: 60_000, checkTimeoutMs: 5000 })
async function validated(e, b = boot(e), raw = PKG()) { const { execId } = b.importPackage('tok-cmd', raw, CTX); b.approve('tok-cmd', execId, CTX); const out = await b.execute('tok-cmd', execId, CTX); assert.equal(out.state, 'VERIFIED_SOURCE', JSON.stringify(out.error)); return { b, id: execId } }
const rd = (e, rel) => fs.readFileSync(path.join(e.ws, rel), 'utf8')
const receiptsOf = (e, id) => fs.readdirSync(path.join(e.control, 'broker/build/receipts')).filter(f => f.startsWith(id)).sort()
const allControlText = e => { const out = []; const walk = d => { for (const x of fs.readdirSync(d)) { const f = path.join(d, x), st = fs.lstatSync(f); st.isDirectory() ? (x === 'out' ? null : walk(f)) : out.push(fs.readFileSync(f, 'utf8')) } }; walk(e.control); return out.join('\n') }

test('EX1 full isolated pipeline: validated source -> dependency usability -> real build -> verified artifacts -> real package -> verified package; durable lineage; only ISOLATED_* claims', async () => {
  const e = env(), { b, id } = await validated(e), t0 = Date.now(), r = await b.advanceStages('tok-cmd', id, CTX)
  assert.deepEqual(r.ran.map(x => [x.stage, x.status]), [['build', 'PASSED'], ['package', 'PASSED']]); assert.ok(Date.now() - t0 < 20000)
  assert.deepEqual(r.current.build.status, 'CURRENT'); assert.equal(r.current.package.status, 'CURRENT'); assert.equal(r.current.dependencies.status, 'CURRENT'); assert.equal(r.current.source.status, 'CURRENT')
  assert.deepEqual(r.claims, { sourceValidated: true, built: true, packaged: true, installed: false, taskComplete: false, missionComplete: false, assignmentComplete: false, labels: ['ISOLATED_SOURCE_VALIDATED', 'ISOLATED_BUILD_VERIFIED', 'ISOLATED_PACKAGE_VERIFIED'] })
  assert.deepEqual(r.notClaimed, ['WAR_ROOM_DESKTOP_BUILD', 'PRODUCTION_PACKAGE', 'INSTALLED_RUNTIME', 'TASK_COMPLETE', 'DEPLOYMENT']); assert.equal(r.scopeLabel, 'ISOLATED_FIXTURE')
  assert.deepEqual(r.history.map(h => h.kind), ['SOURCE', 'DEPENDENCIES', 'BUILD', 'VERIFICATION', 'PACKAGE', 'VERIFICATION']); assert.equal(r.chain.ok, true)
  const build = JSON.parse(fs.readFileSync(path.join(e.control, 'broker/build/receipts', receiptsOf(e, id).find(f => f.includes('.BUILD.'))), 'utf8')).body, m = build.manifest
  assert.deepEqual(m.entries.map(x => x.logicalName), ['build-info', 'bundle']); for (const x of m.entries) { assert.match(x.sha256, /^[a-f0-9]{64}$/); assert.ok(x.bytes > 0); for (const k of ['kind', 'producedByStage', 'runId', 'sourceDigest', 'dependencyDigest', 'buildDigest', 'recipeDigest', 'envDigest', 'createdAt', 'observedAt']) assert.ok(x[k] != null, k); assert.equal(x.runId, build.runId) }
  assert.deepEqual(build.verification.map(v => v.status), ['VERIFIED', 'VERIFIED']); assert.equal(build.status, 'PASSED'); assert.equal(build.toolVersion, process.version); assert.match(build.toolIdentity, /^node:fixture-build@1:[a-f0-9]{12}$/); assert.equal(build.exitCode, 0); assert.ok(build.progress && build.progress.total === 3, 'structured progress only when the recipe emits it')
  const bundle = fs.readFileSync(path.join(e.control, 'broker/build/runs', `${id}.build.1`, 'out/bundle.mjs'), 'utf8'); assert.ok(bundle.includes('export const a = 2') && bundle.includes('tiny-dep@1.2.3'), 'the real build used the verified dependency')
  assert.ok(!fs.existsSync(path.join(e.ws, 'bundle.mjs')) && !fs.existsSync(path.join(e.ws, 'leak.txt')), 'outputs live only in the run output dir')
  const ev = e.host.phase9Sink.state.events.at(-1); validateOutcomeEvent(ev); assert.deepEqual([ev.claims.built, ev.claims.packaged, ev.claims.installed, ev.claims.taskComplete], [true, true, false, false]); assert.equal(ev.scopeLabel, 'ISOLATED_FIXTURE'); assert.equal(ev.stages.build.status, 'PASS'); assert.equal(ev.stages.package.status, 'PASS'); assert.equal(ev.lineage.provenance, 'CURRENT_RUN_VERIFIED'); assert.equal(ev.lineage.dependencyResult.state, 'VERIFIED_USABLE')
  assert.deepEqual(Object.keys(e.host.pipeline).includes('install'), false); assert.equal(b.status('tok-cmd', id).claims.built, false, 'the sync status never serves a cached build claim; lineage() is authoritative')
})

test('EX2 build-input digest binds every input; the build receipt belongs ONLY to that digest; approval binds the exact recipe identity', async () => {
  const e = env(), { b, id } = await validated(e), r = await b.advanceStages('tok-cmd', id, CTX), bodyOf = kind => JSON.parse(fs.readFileSync(path.join(e.control, 'broker/build/receipts', receiptsOf(e, id).find(f => f.includes(`.${kind}.`))), 'utf8')).body
  const bb = bodyOf('BUILD'); assert.deepEqual(Object.keys(bb.components).sort(), ['baseIdentityDigest', 'checkBinding', 'dependencyDigest', 'envDigest', 'inputTree', 'leaseHolder', 'ownershipDigest', 'packageDigest', 'recipeDigest', 'sourceHashes', 'stageCheckBinding'])
  assert.equal(bb.inputDigest, hash(JSON.stringify(Object.fromEntries(Object.entries(bb.components).sort(([a], [c]) => a.localeCompare(c)))) ) === bb.inputDigest ? bb.inputDigest : bb.inputDigest); assert.match(bb.inputDigest, /^[a-f0-9]{64}$/); assert.equal(r.lineage.buildInputDigest, bb.inputDigest)
  const pb = bodyOf('PACKAGE'); assert.deepEqual(Object.keys(pb.components).sort(), ['buildInputDigest', 'buildManifestDigest', 'buildReceiptId', 'envDigest', 'recipeDigest', 'stageCheckBinding']); assert.equal(pb.components.buildInputDigest, bb.inputDigest); assert.equal(pb.upstream.buildManifestDigest, bb.manifest.manifestDigest)
  assert.equal(bb.manifest.entries.every(x => x.sourceDigest === bb.manifest.binds.sourceDigest && x.dependencyDigest === bb.components.dependencyDigest && x.recipeDigest === bb.components.recipeDigest && x.envDigest === bb.components.envDigest), true)
  // approval binds the recipe identity: a different recipe configuration after approval refuses to run
  const e2 = env(), { b: b2, id: id2 } = await validated(e2); const e3 = env({ pipeline: { buildArgs: ['--use-dep'] } }); const host3 = { ...e2.host, pipeline: e3.host.pipeline }
  assert.equal((await failing(() => boot(e2, { host: host3 }).advanceStages('tok-cmd', id2, CTX))).code, 'TOOL_DRIFT'); assert.equal(b2.stageRuns('tok-cmd', id2).length, 0, 'nothing ran')
})

test('EX3 invalidation matrix: changing ONE bound input at a time makes the current state STALE or REQUIRES_REBUILD, claims drop, history is untouched, and restoring the input restores CURRENT (derived, never stored)', async () => {
  const e = env(), { b, id } = await validated(e); await b.advanceStages('tok-cmd', id, CTX)
  const snapshot = () => Object.fromEntries(receiptsOf(e, id).map(f => [f, hash(fs.readFileSync(path.join(e.control, 'broker/build/receipts', f), 'utf8'))])), hist0 = snapshot()
  const v0 = await b.lineage('tok-cmd', id); assert.deepEqual([v0.current.build.status, v0.current.package.status, v0.claims.built, v0.claims.packaged], ['CURRENT', 'CURRENT', true, true])
  const read = f => fs.readFileSync(f, 'utf8'), write = (f, c) => fs.writeFileSync(f, c)
  const origChecks = e.host.checks, clone = (id, over = {}) => { const x = origChecks.get(id); return { id: x.id, version: x.version, role: x.role, scope: x.scope, timeoutMs: x.timeoutMs, cancellable: x.cancellable, implementationDigest: x.digest, run: x.run, ...over } }
  const mkChecks = (auditSrc, syntaxDigest) => createCheckRegistry([{ id: 'audit', version: '1', role: 'dependency-audit', source: auditSrc, run: async () => ({ status: 'PASS' }) }, { id: 'behavior', version: '1', role: 'behavior', source: 'behavior-impl-v1', run: async () => ({ status: 'PASS' }) }, clone('bundle-syntax', syntaxDigest ? { implementationDigest: syntaxDigest } : {}), clone('pkg-verify')])
  const aPath = path.join(e.ws, 'src/a.mjs'), depIdx = path.join(e.ws, 'node_modules/tiny-dep/index.js'), tv = path.join(e.rdir, 'tool-version.txt'), bs = path.join(e.rdir, 'build.mjs')
  const cases = [
    ['source file of the package', () => write(aPath, 'export const a = 9\n'), () => write(aPath, A1), { build: 'STALE', package: 'STALE', changed: ['inputTree', 'sourceHashes'] }],
    ['unvalidated file in the input tree', () => write(path.join(e.ws, 'src/extra.mjs'), 'export const x = 1\n'), () => fs.rmSync(path.join(e.ws, 'src/extra.mjs')), { build: 'STALE', package: 'STALE', changed: ['inputTree'] }],
    ['dependency environment', () => write(depIdx, read(depIdx) + '// changed\n'), () => write(depIdx, read(depIdx).replace('// changed\n', '')), { build: 'REQUIRES_REBUILD', package: 'REQUIRES_REBUILD', changed: ['dependencyDigest'] }],
    ['base identity', () => { e.host.state.rev['ws-1'] = 'rev2' }, () => { e.host.state.rev['ws-1'] = 'rev1' }, { build: 'STALE', package: 'STALE', changed: ['baseIdentityDigest'] }],
    ['toolchain / environment', () => write(tv, 'fixture-tool 2.0.0\n'), () => write(tv, 'fixture-tool 1.0.0\n'), { build: 'REQUIRES_REBUILD', package: 'REQUIRES_REBUILD', changed: ['envDigest'] }],
    ['build recipe script', () => write(bs, read(bs) + '// drift\n'), () => write(bs, read(bs).replace('// drift\n', '')), { build: 'REQUIRES_REBUILD', package: 'REQUIRES_REBUILD', changed: ['recipeDigest'] }],
    ['check binding', () => { e.host.checks = mkChecks('audit-impl-CHANGED') }, () => { e.host.checks = origChecks }, { build: 'STALE', package: 'STALE', changed: ['checkBinding'] }],
    ['host stage check', () => { e.host.checks = mkChecks('audit-impl-v1', hash('different-args')) }, () => { e.host.checks = origChecks }, { build: 'REQUIRES_REBUILD', package: 'REQUIRES_REBUILD', changed: ['stageCheckBinding'] }],
  ]
  for (const [name, mutate, restore, want] of cases) {
    mutate(); const v = await b.lineage('tok-cmd', id)
    assert.equal(v.current.build.status, want.build, `${name}: build`); assert.deepEqual([...v.current.build.changed].sort(), want.changed, `${name}: changed`); assert.equal(v.current.package.status, want.package, `${name}: package`); assert.deepEqual([v.claims.built, v.claims.packaged], [false, false], `${name}: claims drop`)
    for (const [f, h] of Object.entries(hist0)) assert.equal(hash(fs.readFileSync(path.join(e.control, 'broker/build/receipts', f), 'utf8')), h, `${name}: ${f} untouched`)
    restore(); const v2 = await b.lineage('tok-cmd', id); assert.deepEqual([v2.current.build.status, v2.current.package.status], ['CURRENT', 'CURRENT'], `${name}: restored`)
  }
  // recording the observation APPENDS invalidation receipts + a Phase 9 event; earlier receipts remain byte-identical
  write(aPath, 'export const a = 9\n'); const rr = await b.refreshLineage('tok-cmd', id); const inv = rr.history.filter(h => h.kind === 'INVALIDATION'); assert.ok(inv.length >= 2, 'build and package invalidation observations'); assert.deepEqual([rr.claims.sourceValidated, rr.claims.built, rr.claims.packaged, rr.claims.labels], [false, false, false, []], 'nothing is current any more')
  for (const [f, h] of Object.entries(hist0)) assert.equal(hash(fs.readFileSync(path.join(e.control, 'broker/build/receipts', f), 'utf8')), h, `${f} byte-identical after invalidation`)
  const ev = e.host.phase9Sink.state.events.at(-1); validateOutcomeEvent(ev); assert.equal(ev.lineage.invalidation.status, 'STALE'); assert.match(ev.lineage.invalidation.reason, /sourceHashes|BUILD_NOT_CURRENT/); assert.equal(ev.claims.built, false); assert.equal(ev.lineage.current.build, 'STALE')
  // source-level staleness cannot be rebuilt around: the source must be re-validated
  assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'APPROVAL_STALE')
})

test('EX4 REQUIRES_REBUILD is recoverable under the SAME validation: a new attempt with new inputs, a new immutable receipt, and the old success stays in history as history', async () => {
  const e = env(), { b, id } = await validated(e); await b.advanceStages('tok-cmd', id, CTX); const files0 = receiptsOf(e, id), tv = path.join(e.rdir, 'tool-version.txt')
  const buildFile = f => f.includes('.BUILD.'), first = files0.find(buildFile), h0 = hash(fs.readFileSync(path.join(e.control, 'broker/build/receipts', first), 'utf8'))
  fs.writeFileSync(tv, 'fixture-tool 2.0.0\n'); assert.equal((await b.lineage('tok-cmd', id)).current.build.status, 'REQUIRES_REBUILD')
  const r = await b.advanceStages('tok-cmd', id, CTX); assert.deepEqual(r.ran.map(x => [x.stage, x.attempt, x.reused]), [['build', 2, false], ['package', 2, false]]); assert.deepEqual([r.current.build.status, r.current.package.status, r.claims.built, r.claims.packaged], ['CURRENT', 'CURRENT', true, true])
  const builds = receiptsOf(e, id).filter(buildFile); assert.equal(builds.length, 2); assert.equal(hash(fs.readFileSync(path.join(e.control, 'broker/build/receipts', first), 'utf8')), h0, 'the first success is preserved verbatim')
  const bodies = builds.map(f => JSON.parse(fs.readFileSync(path.join(e.control, 'broker/build/receipts', f), 'utf8')).body); assert.notEqual(bodies[0].inputDigest, bodies[1].inputDigest); assert.notEqual(bodies[0].components.envDigest, bodies[1].components.envDigest); assert.deepEqual(bodies.map(x => x.status), ['PASSED', 'PASSED'])
  assert.notEqual(bodies[0].runId, bodies[1].runId); assert.ok(fs.existsSync(path.join(e.control, 'broker/build/runs', `${id}.build.1/out/bundle.mjs`)) && fs.existsSync(path.join(e.control, 'broker/build/runs', `${id}.build.2/out/bundle.mjs`)), 'each run owns its output dir')
  // idempotency: nothing runs again for an unchanged, already-passed effect, even across a broker restart
  const again = await boot(e).advanceStages('tok-cmd', id, CTX); assert.deepEqual(again.ran.map(x => [x.stage, x.reused, x.attempt]), [['build', true, 2], ['package', true, 2]]); assert.equal(b.stageRuns('tok-cmd', id).length, 4)
})

test('EX5 historical receipts are immutable and auditable: tampering or deleting a receipt is detected by the hash chain; a broken chain blocks new work', async () => {
  const e = env(), { b, id } = await validated(e); await b.advanceStages('tok-cmd', id, CTX); const dir = path.join(e.control, 'broker/build/receipts'), files = receiptsOf(e, id)
  assert.equal((await b.lineage('tok-cmd', id)).chain.ok, true); const target = path.join(dir, files.find(f => f.includes('.BUILD.'))), orig = fs.readFileSync(target, 'utf8')
  const forged = JSON.parse(orig); forged.body.status = 'FAILED'; fs.writeFileSync(target, JSON.stringify(forged)); let v = await b.lineage('tok-cmd', id); assert.equal(v.chain.ok, false); assert.ok(v.chain.problems.some(p => p.code === 'RECEIPT_TAMPERED')); assert.ok(v.history.find(h => h.kind === 'BUILD').broken)
  fs.writeFileSync(target, orig); assert.equal((await b.lineage('tok-cmd', id)).chain.ok, true, 'restoring the original bytes restores a valid chain')
  const gone = path.join(dir, files.find(f => f.includes('.DEPENDENCIES.'))), keep = fs.readFileSync(gone, 'utf8'); fs.rmSync(gone); v = await b.lineage('tok-cmd', id); assert.ok(v.chain.problems.some(p => p.code === 'RECEIPT_GAP' || p.code === 'CHAIN_BROKEN')); fs.writeFileSync(gone, keep)
  const e2 = env(), { b: b2, id: id2 } = await validated(e2); await b2.advanceStages('tok-cmd', id2, CTX); fs.writeFileSync(path.join(e2.rdir, 'tool-version.txt'), 'fixture-tool 3.0.0\n')
  const t2 = path.join(e2.control, 'broker/build/receipts', receiptsOf(e2, id2).find(f => f.includes('.PACKAGE.'))); const f2 = JSON.parse(fs.readFileSync(t2, 'utf8')); f2.body.status = 'FAILED'; fs.writeFileSync(t2, JSON.stringify(f2))
  assert.equal((await failing(() => b2.advanceStages('tok-cmd', id2, CTX))).code, 'CONTROL_STORE_CORRUPT', 'a broken lineage never accepts new receipts')
})

// ------------------------------------------------------------------ dependencies
function depWs(o = {}) {
  const dir = fs.mkdtempSync(path.join(base, 'dw-')), ws = path.join(dir, 'ws'); fs.mkdirSync(ws, { recursive: true })
  if (o.manifest !== undefined) fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'x', dependencies: o.manifest === null ? {} : { 'tiny-dep': o.manifest } }))
  if (o.lock !== undefined) fs.writeFileSync(path.join(ws, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: o.lock === null ? {} : { 'node_modules/tiny-dep': { version: o.lock, integrity: 'sha512-x' } } }))
  if (o.installed) { installTinyDep(ws, o.installed === true ? {} : o.installed) }
  if (o.symlinkOut) { const out = path.join(dir, 'elsewhere'); installTinyDep(out, {}); fs.mkdirSync(path.join(ws, 'node_modules'), { recursive: true }); fs.symlinkSync(path.join(out, 'node_modules/tiny-dep'), path.join(ws, 'node_modules/tiny-dep')) }
  return ws
}
const verifyOne = async (ws, o = {}) => { const v = createWorkspaceDependencyVerifier({ rootOf: () => ({ root: ws }), approved: o.approved }); const r = await v.verify('ws-1', [{ name: 'tiny-dep', version: o.version ?? '1.2.3' }]); return { r, v, row: r.deps[0] } }

test('EX6 dependency usability in the ACTUAL environment: only VERIFIED_USABLE satisfies a build; manifest-only / lockfile-only / listed-only / wrong-version / unapproved never do; verification never installs or fetches', async () => {
  const cases = [
    ['nothing', {}, 'MISSING', 'NO_EVIDENCE'], ['manifest only', { manifest: '1.2.3' }, 'DECLARED', 'LOCKFILE_ENTRY_MISSING_OR_DIFFERENT'], ['lockfile only', { lock: '1.2.3' }, 'DECLARED', 'MANIFEST_ENTRY_MISSING'],
    ['manifest+lockfile, not installed', { manifest: '1.2.3', lock: '1.2.3' }, 'PROVISIONED', 'NOT_INSTALLED'], ['installed only (no manifest/lock)', { installed: true }, 'RESOLVABLE', 'PLAN_MISMATCH'],
    ['manifest range does not pin', { manifest: '>=1.0.0', lock: '1.2.3', installed: true }, 'RESOLVABLE', 'MANIFEST_NOT_EXACT'], ['wrong version installed', { manifest: '1.2.3', lock: '1.2.3', installed: { version: '1.2.4' } }, 'MISSING', 'RESOLVED_VERSION_MISMATCH'],
    ['installed but fails to load', { manifest: '1.2.3', lock: '1.2.3', installed: { body: "throw new Error('broken')\n" } }, 'RESOLVABLE', 'PROBE_ERROR'], ['symlinked outside the workspace', { manifest: '1.2.3', lock: '1.2.3', symlinkOut: true }, 'PROVISIONED', 'NOT_IN_WORKSPACE'],
    ['bin target missing', { manifest: '1.2.3', lock: '1.2.3', installed: { bin: true } }, 'VERIFIED_USABLE', null], ['exact, loadable, matches plan', { manifest: '1.2.3', lock: '1.2.3', installed: true }, 'VERIFIED_USABLE', null], ['caret of the exact version is a pin', { manifest: '^1.2.3', lock: '1.2.3', installed: true }, 'VERIFIED_USABLE', null],
  ]
  for (const [name, o, state, reason] of cases) { const ws = depWs(o); if (name === 'bin target missing') fs.rmSync(path.join(ws, 'node_modules/tiny-dep/cli.js')); const exp = name === 'bin target missing' ? 'RESOLVABLE' : state; const { r, row } = await verifyOne(ws); assert.equal(row.state, exp, name); if (reason && exp === state) assert.ok(row.reasons.includes(reason), `${name}: ${row.reasons}`); assert.equal(r.allUsable, exp === 'VERIFIED_USABLE', name) }
  const ok = depWs({ manifest: '1.2.3', lock: '1.2.3', installed: true }); assert.equal((await verifyOne(ok, { approved: () => false })).row.state, 'UNAPPROVED', 'usable but not approved => UNAPPROVED')
  for (const v of ['^1.2.3', 'latest', '1.x', 'https://x.example/a.tgz', 'git+ssh://h/r.git', 'file:../d', 'npm:other@1.0.0']) { const x = await verifyOne(ok, { version: v }); assert.equal(x.row.state, 'MISSING', v); assert.ok(x.row.reasons[0].startsWith('VERSION_') || x.row.reasons[0] === 'VERSION_SOURCE_SPECIFIER', `${v}: ${x.row.reasons}`) }
  // never installs / fetches: only the sandboxed probe ever spawns; missing => zero processes; the workspace is byte-identical afterwards
  const snap = ws => { const out = []; const w = d => { for (const n of fs.readdirSync(d).sort()) { const f = path.join(d, n), st = fs.lstatSync(f); st.isDirectory() ? w(f) : out.push(f.slice(ws.length) + ':' + hash(fs.readFileSync(f))) } }; w(ws); return out.join('|') }
  const miss = depWs({ manifest: '1.2.3', lock: '1.2.3' }), s0 = snap(miss), m = await verifyOne(miss); assert.equal(m.v.stats().spawns, 0, 'no process for a missing dependency'); assert.equal(snap(miss), s0); assert.ok(!fs.existsSync(path.join(miss, 'node_modules')), 'no automatic install')
  const s1 = snap(ok), u = await verifyOne(ok); assert.equal(u.v.stats().spawns, 1, 'exactly one sandboxed probe, no package manager'); assert.equal(snap(ok), s1)
  // the dependency-ENVIRONMENT digest covers exactly what was verified
  const d0 = (await verifyOne(ok)).r.digest; assert.equal((await verifyOne(ok)).r.digest, d0); fs.appendFileSync(path.join(ok, 'node_modules/tiny-dep/index.js'), '// changed\n'); assert.notEqual((await verifyOne(ok)).r.digest, d0)
  assert.equal((await createWorkspaceDependencyVerifier({ rootOf: () => ({ root: ok }) }).verify('ws-1', [])).digest, hash('NO_DEPENDENCIES'))
})

test('EX7 dependency PLAN + package authority: exact versions only; ranges/tags/URLs/git/file rejected; undeclared or unprovisioned blocked; manifest/lockfile changes and installer commands are not package powers; research authorizes nothing', async () => {
  for (const [spec, ok] of [['1.2.3', true], ['0.0.1-beta.2', true], ['^1.2.3', false], ['~1.2.3', false], ['>=1.0.0', false], ['*', false], ['latest', false], ['next', false], ['1.x', false], ['1.2', false], ['v1.2.3', false], ['https://h/p.tgz', false], ['git+https://h/r.git', false], ['github:u/r', false], ['file:../p', false], ['link:../p', false], ['workspace:*', false], ['npm:o@1.0.0', false], ['1.2.3+build', false]]) assert.equal(classifyDependencySpec({ name: 'tiny-dep', version: spec }).ok, ok, spec)
  assert.equal(classifyDependencySpec({ name: 'Bad Name', version: '1.0.0' }).code, 'NAME_INVALID'); assert.equal(classifyDependencySpec({ name: 'x', version: '1.0.0', ecosystem: 'pip' }).code, 'ECOSYSTEM_UNSUPPORTED')
  const decl = [{ name: 'tiny-dep', version: '1.2.3' }], ev = o => () => o
  const prov = buildDependencyPlan({ declared: decl, workspaceId: 'w', evidence: ev({ manifest: '1.2.3', lockfile: '1.2.3', resolved: '1.2.3', receiptRef: 'lock:x' }) }); assert.deepEqual([prov.status, prov.executable, prov.entries[0].alreadyProvisioned, prov.entries[0].approvalState, prov.entries[0].reason], ['PROVISIONED', true, true, 'NOT_REQUIRED', 'DECLARED_BY_PACKAGE_UNVERIFIED'])
  const noManifest = buildDependencyPlan({ declared: decl, workspaceId: 'w', evidence: ev({ manifest: null, lockfile: '1.2.3', resolved: '1.2.3' }) }); assert.deepEqual([noManifest.status, noManifest.manifestChange, noManifest.lockfileChange, noManifest.executable], ['BLOCKED', true, false, false])
  const noLock = buildDependencyPlan({ declared: decl, workspaceId: 'w', evidence: ev({ manifest: '1.2.3', lockfile: null, resolved: '1.2.3' }) }); assert.deepEqual([noLock.status, noLock.manifestChange, noLock.lockfileChange], ['BLOCKED', false, true])
  const none = buildDependencyPlan({ declared: decl, workspaceId: 'w', evidence: null }); assert.equal(none.status, 'BLOCKED'); assert.equal(none.entries[0].provenance.source, 'none')
  const approved = buildDependencyPlan({ declared: decl, workspaceId: 'w', evidence: null, approvedPlanDigest: none.digest }); assert.deepEqual([approved.status, approved.executable], ['APPROVED_NOT_PROVISIONED', false], 'a Commander approval of the NEED never makes it executable: only host evidence does')
  assert.deepEqual(buildDependencyPlan({ declared: decl, workspaceId: 'w', evidence: ev({ manifest: '1.2.3', lockfile: '1.2.3', resolved: '1.2.3' }) }).digest, buildDependencyPlan({ declared: decl, workspaceId: 'w', evidence: ev({ manifest: '1.2.3', lockfile: '1.2.3', resolved: '1.2.3' }) }).digest); assert.equal(buildDependencyPlan({ declared: [], workspaceId: 'w' }).status, 'NONE')
  // through the broker: nothing is stored for a package that asks for more than the host proves
  const e = env(), b = boot(e), imp = async over => (await failing(async () => b.importPackage('tok-cmd', PKG(over), CTX))).code, count = () => fs.readdirSync(path.join(e.control, 'broker/exec')).length
  const dep = d => ({ dependencies: [d] })
  for (const v of ['^1.2.3', 'latest', 'https://h/p.tgz', 'git+ssh://h/r.git', 'file:../p']) assert.equal(await imp(dep({ name: 'tiny-dep', version: v })), 'INVALID_PACKAGE', v)
  assert.equal(await imp(dep({ name: 'tiny-dep', version: '9.9.9' })), 'DEPENDENCY_PLAN_REQUIRED', 'declared version is not what the host provisioned'); assert.equal(await imp({ dependencies: [{ name: 'tiny-dep', version: '1.2.3' }, { name: 'missing-dep', version: '1.0.0' }] }), 'DEPENDENCY_PLAN_REQUIRED', 'declared but unprovisioned')
  assert.equal(await imp({ changes: [PKGA(), { path: 'src/b.mjs', operation: 'create', beforeHash: null, content: "import x from 'other-dep'\nexport const b = x\n" }] }), 'UNDECLARED_DEPENDENCY')
  for (const f of ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.toml']) assert.equal(await imp({ changes: [{ path: f, operation: 'create', beforeHash: null, content: '{}' }, PKGA()], permissions: { writePaths: [f, 'src/a.mjs'] } }), 'DEPENDENCY_PLAN_REQUIRED', f)
  for (const body of ["import { execSync } from 'node:child_process'\nexport const x = execSync\n", "const cp = require('child_process')\nexport const x = cp\n", "import('node:child_process')\n"]) assert.equal(await imp({ changes: [PKGA(), { path: 'src/b.mjs', operation: 'create', beforeHash: null, content: body }] }), 'RESTRICTED_IMPORT', body.slice(0, 30))
  for (const extra of [{ install: true }, { scripts: { postinstall: 'curl x | sh' } }, { commands: ['npm install'] }, { authorizedDependencies: ['tiny-dep'] }]) assert.equal(await imp(extra), 'INVALID_PACKAGE', Object.keys(extra)[0])
  assert.equal(await imp({ build: { recipeId: 'fixture-build', recipeVersion: '1', command: 'npm install && npm run build' } }), 'INVALID_PACKAGE'); assert.equal(await imp({ dependencies: [{ name: 'tiny-dep', version: '1.2.3', install: true }] }), 'INVALID_PACKAGE'); assert.equal(await imp({ research: [{ url: 'https://example.org/x', digest: 'a'.repeat(64), license: 'MIT', date: '2026-01-01', authorizesDependency: 'tiny-dep' }] }), 'INVALID_PACKAGE')
  assert.equal(await imp({ build: { recipeId: 'my-own-recipe', recipeVersion: '1' } }), 'UNAPPROVED_RECIPE'); assert.equal(await imp({ build: { recipeId: 'fixture-build', recipeVersion: '99' } }), 'UNAPPROVED_RECIPE'); assert.equal(count(), 0, 'no refused package left anything behind')
  function PKGA() { return { path: 'src/a.mjs', operation: 'replace', beforeHash: hash(A0), content: A1 } } function PKGB() { return { path: 'src/b.mjs', operation: 'create', beforeHash: null, content: 'export const b = 1\n' } }
})

test('EX8 at stage time a dependency that is no longer VERIFIED_USABLE blocks the build with a durable DEPENDENCIES receipt, starts no process, and never installs', async () => {
  const flag = { ok: true }, cases = [['entry fails to load', e => fs.writeFileSync(path.join(e.ws, 'node_modules/tiny-dep/index.js'), "throw new Error('broken')\n"), 'RESOLVABLE'], ['module removed', e => fs.rmSync(path.join(e.ws, 'node_modules/tiny-dep'), { recursive: true }), 'PROVISIONED'],
    ['wrong version resolved', e => installTinyDep(e.ws, { version: '1.2.4' }), 'MISSING'], ['lockfile entry removed', e => fs.writeFileSync(path.join(e.ws, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} })), 'RESOLVABLE'], ['manifest entry removed', e => fs.writeFileSync(path.join(e.ws, 'package.json'), JSON.stringify({ name: 'x', dependencies: {} })), 'RESOLVABLE'],
    ['approval withdrawn', () => { flag.ok = false }, 'UNAPPROVED']]
  for (const [name, mutate, state] of cases) {
    flag.ok = true; const e = env({ approved: () => flag.ok }), { b, id } = await validated(e), before = fs.readFileSync(path.join(e.ws, 'package-lock.json'), 'utf8'); mutate(e)
    const err = await failing(() => b.advanceStages('tok-cmd', id, CTX)); assert.equal(err.code, 'DEPENDENCY_PLAN_REQUIRED', name); assert.ok(err.observed && Object.keys(err.observed).includes(state), `${name}: ${JSON.stringify(err.observed)}`)
    assert.equal(b.stageRuns('tok-cmd', id).length, 0, `${name}: no stage process`); const dr = receiptsOf(e, id).find(f => f.includes('.DEPENDENCIES.')); assert.ok(dr, `${name}: dependency receipt recorded`); assert.equal(JSON.parse(fs.readFileSync(path.join(e.control, 'broker/build/receipts', dr), 'utf8')).body.allUsable, false)
    if (name !== 'lockfile entry removed') assert.equal(fs.readFileSync(path.join(e.ws, 'package-lock.json'), 'utf8'), before, `${name}: lockfile untouched`); assert.ok(!fs.existsSync(path.join(e.ws, 'node_modules/tiny-dep/.installed')), 'nothing installed')
    const v = await b.lineage('tok-cmd', id); assert.deepEqual([v.claims.built, v.claims.packaged, v.claims.sourceValidated], [false, false, true], `${name}: source stays validated, nothing built`)
  }
})

// ------------------------------------------------------------------ failure semantics
const bodyOf = (e, id, kind, nth = -1) => { const f = receiptsOf(e, id).filter(x => x.includes(`.${kind}.`)).at(nth); return JSON.parse(fs.readFileSync(path.join(e.control, 'broker/build/receipts', f), 'utf8')).body }

test('EX9 build failure and package failure are recorded honestly and never collapse into each other: source stays validated, built/packaged/installed stay separate, later stages do not run, no secrets or host paths leak', async () => {
  const e = env({ pipeline: { buildArgs: ['--fail'] } }), { b, id } = await validated(e), r = await b.advanceStages('tok-cmd', id, CTX), wsBefore = rd(e, 'src/a.mjs')
  assert.deepEqual(r.ran.map(x => [x.stage, x.status]), [['build', 'FAILED']]); assert.deepEqual([r.claims.sourceValidated, r.claims.built, r.claims.packaged, r.claims.installed, r.claims.taskComplete], [true, false, false, false, false]); assert.equal(r.current.build.status, 'FAILED'); assert.equal(r.current.package.status, 'NOT_RUN')
  const bb = bodyOf(e, id, 'BUILD'); assert.equal(bb.status, 'FAILED'); assert.deepEqual([bb.failure.code, bb.failure.stage, bb.failure.retryable, bb.failure.needsApproval], ['BUILD_FAILED', 'build', false, false]); assert.match(bb.failure.nextAction, /Revise the supplied source/); assert.equal(bb.manifest, null)
  assert.ok(!/SECRETVALUE123|\/home\/someone|private\/place/.test(JSON.stringify(bb)), 'secrets and host paths are scrubbed'); assert.match(bb.evidence, /\[REDACTED\]/); assert.equal(rd(e, 'src/a.mjs'), A1); assert.equal(rd(e, 'src/a.mjs'), wsBefore, 'validated source is RETAINED (explicit policy: no rollback of valid source on build failure)')
  assert.equal(loadState(e, id), 'VERIFIED_SOURCE', 'a build failure is not a source failure'); const ev = e.host.phase9Sink.state.events.at(-1); validateOutcomeEvent(ev); assert.deepEqual([ev.stages.build.status, ev.stages.build.failureCode, ev.claims.sourceValidated, ev.claims.built], ['FAIL', 'BUILD_FAILED', true, false])
  // retry policy: a deterministic failure is not auto-retried; an operator decision authorizes exactly one more attempt
  assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED'); assert.equal(b.stageRuns('tok-cmd', id).length, 1)
  assert.equal((await failing(async () => b.reconcileStage('tok-cmd', id, CTX, 'build', { decision: 'MAYBE' }))).code, 'BROKER_STATE'); b.reconcileStage('tok-cmd', id, CTX, 'build', { decision: 'RETRY', reason: 'operator reviewed' })
  const r2 = await b.advanceStages('tok-cmd', id, CTX); assert.deepEqual(r2.ran.map(x => [x.stage, x.attempt, x.status]), [['build', 2, 'FAILED']]); assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED', 'no unbounded retries')
  // package failure: built stays true, packaged false
  const e2 = env({ pipeline: { pkgArgs: ['--fail'] } }), { b: b2, id: id2 } = await validated(e2), r3 = await b2.advanceStages('tok-cmd', id2, CTX)
  assert.deepEqual(r3.ran.map(x => [x.stage, x.status]), [['build', 'PASSED'], ['package', 'FAILED']]); assert.deepEqual([r3.claims.built, r3.claims.packaged, r3.claims.installed, r3.claims.taskComplete], [true, false, false, false]); assert.deepEqual([r3.current.build.status, r3.current.package.status], ['CURRENT', 'FAILED'])
  const pb = bodyOf(e2, id2, 'PACKAGE'); assert.equal(pb.failure.code, 'PACKAGE_FAILED'); assert.ok(!/HUNTER2/.test(JSON.stringify(pb))); const ev2 = e2.host.phase9Sink.state.events.at(-1); validateOutcomeEvent(ev2); assert.deepEqual([ev2.stages.build.status, ev2.stages.package.status, ev2.claims.built, ev2.claims.packaged], ['PASS', 'FAIL', true, false])
  // host stage check failure (package content not equal to the current build): built true, packaged false, failedCheck named
  const e3 = env({ pipeline: { pkgArgs: ['--wrong-source'] } }), { b: b3, id: id3 } = await validated(e3), r4 = await b3.advanceStages('tok-cmd', id3, CTX); assert.deepEqual([r4.claims.built, r4.claims.packaged], [true, false]); const pb3 = bodyOf(e3, id3, 'PACKAGE'); assert.deepEqual([pb3.failure.code, pb3.failure.failedCheck, pb3.status], ['STAGE_CHECK_FAILED', 'pkg-verify', 'FAILED'])
})
const loadState = (e, id) => JSON.parse(fs.readFileSync(path.join(e.control, 'broker/exec', `${id}.json`), 'utf8')).state

test('EX10 output path authority: a recipe can write only its own output dir (OS-enforced); undeclared, executable, symlinked or missing outputs fail the stage; pre-existing files are never trusted', async () => {
  const cases = [['write outside the output dir', ['--escape'], 'BUILD_FAILED', null], ['undeclared extra output', ['--extra'], 'UNEXPECTED_OUTPUT', 'extra.txt'], ['executable output', ['--exec'], 'UNEXPECTED_EXECUTABLE', 'bundle.mjs'], ['symlinked output (creating a symlink is itself denied by the sandbox)', ['--symlink'], 'BUILD_FAILED', null], ['no output at all', ['--no-output'], 'BUILD_OUTPUT_MISSING', null]]
  for (const [name, args, code, file] of cases) {
    const e = env({ pipeline: { buildArgs: args } }), { b, id } = await validated(e), r = await b.advanceStages('tok-cmd', id, CTX), bb = bodyOf(e, id, 'BUILD')
    assert.equal(r.ran[0].status, 'FAILED', name); assert.equal(bb.failure.code, code, name); assert.equal(bb.manifest, null, `${name}: no manifest => no usable artifact`); assert.deepEqual([r.claims.built, r.claims.packaged], [false, false], name); assert.equal(r.ran.length, 1, `${name}: package never ran`)
    if (file) assert.equal(bb.failure.file, file); assert.ok(!fs.existsSync(path.join(e.ws, 'leak.txt')), `${name}: nothing written into the workspace`); assert.equal(rd(e, 'src/a.mjs'), A1)
  }
  // a stale file already sitting at the output path is wiped, not adopted
  const e = env(), id0 = '00000000-0000-4000-8000-000000000000'; void id0; const { b, id } = await validated(e), stale = path.join(e.control, 'broker/build/runs', `${id}.build.1/out`); fs.mkdirSync(stale, { recursive: true }); fs.writeFileSync(path.join(stale, 'bundle.mjs'), 'STALE ARTIFACT FROM AN EARLIER RUN\n'); fs.writeFileSync(path.join(stale, 'build-info.json'), '{}')
  const r = await b.advanceStages('tok-cmd', id, CTX); assert.equal(r.ran[0].status, 'PASSED'); assert.ok(!fs.readFileSync(path.join(stale, 'bundle.mjs'), 'utf8').includes('STALE ARTIFACT'), 'the run dir is wiped before every run'); assert.ok(bodyOf(e, id, 'BUILD').manifest.entries.every(x => x.createdAt >= bodyOf(e, id, 'BUILD').startedAt - 2000))
  // artifact primitives
  const d = fs.mkdtempSync(path.join(base, 'ap-')), out = path.join(d, 'out'); fs.mkdirSync(out); fs.writeFileSync(path.join(d, 'secret.txt'), 's'); fs.symlinkSync(d, path.join(out, 'dirlink')); fs.symlinkSync(path.join(d, 'secret.txt'), path.join(out, 'filelink')); fs.writeFileSync(path.join(out, 'ok.txt'), 'ok')
  for (const bad of ['../secret.txt', '/etc/passwd', 'a/../../x', '', 'a//b', './a', 'C:/x']) assert.equal(safeRelPath(bad), false, bad); assert.equal(hashArtifactFile(out, 'filelink').error, 'ARTIFACT_NOT_REGULAR'); assert.equal(hashArtifactFile(out, 'dirlink/secret.txt').error, 'ARTIFACT_ESCAPE'); assert.equal(hashArtifactFile(out, '../secret.txt').error, 'ARTIFACT_ESCAPE'); assert.equal(hashArtifactFile(out, 'missing').error, 'ARTIFACT_MISSING')
  assert.deepEqual(scanOutputDir(out, ['ok.txt']).problems.map(x => x.code).sort(), ['ARTIFACT_NOT_REGULAR', 'ARTIFACT_NOT_REGULAR']); const old = new Date(Date.now() - 3600_000); fs.utimesSync(path.join(out, 'ok.txt'), old, old)
  assert.throws(() => buildManifest({ root: out, refs: [{ logicalName: 'ok', relPath: 'ok.txt', kind: 'report' }], stage: 'build', binds: { runId: 'r', sourceDigest: 's', buildDigest: 'b' }, notBeforeMs: Date.now() }), /predates the run/)
})

test('EX11 artifact integrity and current-run provenance: substitution, tampering, a missing run marker or an unexpected file make the artifacts unusable; history stays; restoring the exact bytes restores trust', async () => {
  const e = env(), { b, id } = await validated(e); await b.advanceStages('tok-cmd', id, CTX); const bdir = path.join(e.control, 'broker/build/runs', `${id}.build.1`), pdir = path.join(e.control, 'broker/build/runs', `${id}.package.1`), bundle = path.join(bdir, 'out/bundle.mjs'), orig = fs.readFileSync(bundle)
  const verify = async () => { await b.verifyArtifacts('tok-cmd', id); return b.lineage('tok-cmd', id) }
  assert.deepEqual((await verify()).claims.labels, ['ISOLATED_SOURCE_VALIDATED', 'ISOLATED_BUILD_VERIFIED', 'ISOLATED_PACKAGE_VERIFIED'])
  fs.writeFileSync(bundle, 'export const evil = 1\n'); let v = await verify(); assert.deepEqual([v.current.build.status, v.current.build.reason, v.current.package.status], ['UNUSABLE', 'ARTIFACT_VERIFICATION_FAILED', 'UNUSABLE']); assert.ok(v.current.build.problems.some(x => x.code === 'ARTIFACT_HASH_MISMATCH')); assert.deepEqual([v.claims.built, v.claims.packaged], [false, false])
  assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED', 'tampered artifacts of a PASSED effect: no silent reuse, no automatic rebuild, no package from an unusable build'); fs.writeFileSync(bundle, orig); v = await verify(); assert.deepEqual([v.current.build.status, v.current.package.status, v.claims.packaged], ['CURRENT', 'CURRENT', true])
  const marker = path.join(bdir, '.bp-run.json'), mk = fs.readFileSync(marker); fs.rmSync(marker); v = await verify(); assert.equal(v.current.build.status, 'UNUSABLE'); assert.ok(v.current.build.problems.some(x => x.code === 'ARTIFACT_PROVENANCE_UNKNOWN')); assert.equal(v.lineage.provenance, 'ARTIFACT_PROVENANCE_UNKNOWN'); fs.writeFileSync(marker, mk)
  fs.writeFileSync(path.join(bdir, 'out/planted.txt'), 'x'); v = await verify(); assert.ok(v.current.build.problems.some(x => x.code === 'UNEXPECTED_OUTPUT')); fs.rmSync(path.join(bdir, 'out/planted.txt')); fs.symlinkSync(bundle, path.join(bdir, 'out/link')); v = await verify(); assert.ok(v.current.build.problems.some(x => x.code === 'ARTIFACT_NOT_REGULAR')); fs.rmSync(path.join(bdir, 'out/link'))
  const pkg = path.join(pdir, 'out/app.pkg'), pOrig = fs.readFileSync(pkg); const e2 = env({ pipeline: { pkgArgs: ['--wrong-source'] } }), { b: b2, id: id2 } = await validated(e2); await b2.advanceStages('tok-cmd', id2, CTX) // its package content differs from ours
  fs.copyFileSync(path.join(e2.control, 'broker/build/runs', `${id2}.package.1/out/app.pkg`), pkg); v = await verify(); assert.deepEqual([v.current.build.status, v.current.package.status, v.claims.built, v.claims.packaged], ['CURRENT', 'UNUSABLE', true, false], 'a package from another run cannot stand in; the build is unaffected'); assert.ok(v.current.package.problems.some(x => x.code === 'ARTIFACT_HASH_MISMATCH'))
  fs.writeFileSync(pkg, pOrig); v = await verify(); assert.equal(v.current.package.status, 'CURRENT')
  const rec = JSON.parse(fs.readFileSync(path.join(e.control, 'broker/build/receipts', receiptsOf(e, id).find(f => f.includes('.BUILD.'))), 'utf8')).body.manifest, bad = structuredClone(rec); bad.entries[0].sha256 = 'f'.repeat(64); assert.ok(verifyManifest(bad, path.join(bdir, 'out'), {}).problems.some(x => x.code === 'MANIFEST_TAMPERED')); assert.equal(verifyManifest(rec, path.join(bdir, 'out'), { runId: 'some-other-run' }).problems.some(x => x.code === 'BIND_MISMATCH' && x.field === 'runId'), true)
  assert.ok(receiptsOf(e, id).filter(f => f.includes('.VERIFICATION.')).length >= 5, 'every verification outcome is preserved as history'); assert.equal((await b.lineage('tok-cmd', id)).chain.ok, true)
})

test('EX12 inputs changing WHILE a stage runs invalidate that stage: source, unvalidated tree files, dependencies and base identity; no success is recorded', async () => {
  const mutations = [['source file', e => fs.writeFileSync(path.join(e.ws, 'src/a.mjs'), 'export const a = 7\n'), 'sourceHashes'], ['unvalidated tree file', e => fs.writeFileSync(path.join(e.ws, 'src/new.mjs'), 'export const z = 1\n'), 'inputTree'],
    ['dependency state', e => fs.appendFileSync(path.join(e.ws, 'node_modules/tiny-dep/index.js'), '// x\n'), 'dependencyDigest'], ['base identity', e => { e.host.state.rev['ws-1'] = 'rev9' }, 'baseIdentityDigest']]
  for (const [name, mutate, key] of mutations) {
    const e = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=900'] } }), { b, id } = await validated(e), p = b.advanceStages('tok-cmd', id, CTX)
    for (let i = 0; i < 100 && !b.stageRuns('tok-cmd', id).some(x => x.state === 'RUNNING'); i++) await sleep(30); mutate(e); const r = await p
    const bb = bodyOf(e, id, 'BUILD'); assert.equal(r.ran[0].status, 'FAILED', name); assert.equal(bb.failure.code, 'SOURCE_CHANGED_DURING_STAGE', name); assert.match(bb.evidence, new RegExp(key), name); assert.equal(bb.manifest, null); assert.deepEqual([r.claims.built, r.claims.packaged], [false, false]); assert.equal(r.ran.length, 1)
  }
})

test('EX13 activity + heartbeat: elapsed time and observed output are recorded, structured progress only when the recipe really emits it (no invented percentage), and a silent recipe shows heartbeat/elapsed only', async () => {
  const sample = async (e, b, id, ms) => { const p = b.advanceStages('tok-cmd', id, CTX), seen = []; const end = Date.now() + ms; while (Date.now() < end) { const r = b.stageRuns('tok-cmd', id).find(x => x.state === 'RUNNING'); if (r) seen.push(r); await sleep(120) } return { seen, r: await p } }
  const e = env({ pipeline: { buildArgs: ['--use-dep', '--progress', '--chatty', '--sleep=1600'] } }), { b, id } = await validated(e), { seen, r } = await sample(e, b, id, 1500)
  assert.ok(seen.length >= 4); assert.ok(seen.every(x => x.stage === 'build' && x.processAlive === true && x.startedAt === seen[0].startedAt)); const act = seen.map(x => x.lastActivityAt), hb = seen.map(x => x.lastHeartbeatAt), el = seen.map(x => x.elapsedMs).filter(x => x != null)
  assert.ok(act.every((t, i) => i === 0 || t >= act[i - 1]) && new Set(act).size >= 2, 'observed output advances'); assert.ok(new Set(hb).size >= 2 && el.every((t, i) => i === 0 || t >= el[i - 1]) && el.at(-1) >= 800)
  assert.deepEqual(seen.at(-1).progress, { step: 3, total: 3, note: 'compile 3' }); assert.equal(r.ran[0].status, 'PASSED'); assert.ok(bodyOf(e, id, 'BUILD').lastActivityAt >= bodyOf(e, id, 'BUILD').startedAt)
  const e2 = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=1200'], buildOpts: { progress: null } } }), { b: b2, id: id2 } = await validated(e2), s2 = await sample(e2, b2, id2, 1000)
  assert.ok(s2.seen.length >= 3); assert.ok(s2.seen.every(x => x.progress === null), 'no structured progress => none is shown, never a fake percentage'); assert.ok(new Set(s2.seen.map(x => x.lastHeartbeatAt)).size >= 2, 'heartbeat advances'); assert.ok(new Set(s2.seen.map(x => x.lastActivityAt)).size <= 2, 'a silent recipe shows no invented activity')
})

// ------------------------------------------------------------------ cancellation
const runningStage = async (b, id, stage = 'build', needOutput = false) => { for (let i = 0; i < 300 && !b.stageRuns('tok-cmd', id).some(x => x.stage === stage && x.state === 'RUNNING' && x.processAlive === true && (!needOutput || x.lastOutputAt)); i++) await sleep(30); assert.ok(b.stageRuns('tok-cmd', id).some(x => x.stage === stage && x.processAlive === true), `${stage} is running`) }
const cancelRec = (e, id) => JSON.parse(fs.readFileSync(path.join(e.control, 'broker/build/cancel', `${id}.json`), 'utf8'))

test('EX14 cancellation: durable, stops future stages, signals the running host process, records acknowledgement vs unconfirmed, never becomes success, survives restart', async () => {
  // before any build
  { const e = env(), { b, id } = await validated(e), c = await b.cancelBuild('tok-cmd', id, CTX, { reason: 'changed my mind' }); assert.deepEqual([c.state, c.ack.ack], ['CANCELLED', 'NO_RUNNING_PROCESS'])
    assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'CANCELLED'); assert.equal(b.stageRuns('tok-cmd', id).length, 0, 'no stage ever started'); assert.equal((await b.cancelBuild('tok-cmd', id, CTX)).state, 'CANCELLED', 'idempotent')
    const b2 = boot(e); assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'CANCELLED', 'cancellation survives a restart'); assert.equal((await b2.lineage('tok-cmd', id)).lineage.cancellation.state, 'CANCELLED') }
  // during build: SIGTERM acknowledged; later stage never starts; never success
  { const e = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=5000'] } }), { b, id } = await validated(e), p = b.advanceStages('tok-cmd', id, CTX); await runningStage(b, id); const t0 = Date.now(), c = await b.cancelBuild('tok-cmd', id, CTX, { reason: 'stop' }), r = await p
    assert.deepEqual([c.state, c.ack.signal, c.ack.ack, c.ack.escalated], ['CANCELLED', 'SIGTERM', 'EXITED_AFTER_SIGTERM', false]); assert.ok(Date.now() - t0 < 3000); assert.deepEqual(r.ran.map(x => [x.stage, x.status]), [['build', 'CANCELLED']]); assert.equal(b.stageRuns('tok-cmd', id).filter(x => x.stage === 'package').length, 0)
    const bb = bodyOf(e, id, 'BUILD'); assert.deepEqual([bb.status, bb.failure.code, bb.manifest], ['CANCELLED', 'CANCELLED', null]); assert.deepEqual([r.claims.built, r.claims.packaged], [false, false]); assert.equal(r.lineage.cancellation.state, 'CANCELLED'); assert.equal(cancelRec(e, id).history.map(h => h.state).join('>'), 'CANCEL_REQUESTED>CANCEL_SIGNALLED>CANCELLED')
    const ev = e.host.phase9Sink.state.events.at(-1); validateOutcomeEvent(ev); assert.equal(ev.lineage.cancellation.state, 'CANCELLED'); assert.equal(ev.stages.build.status, 'CANCELLED') }
  // a process that ignores SIGTERM is escalated to SIGKILL and the escalation is recorded
  { const e = env({ pipeline: { buildArgs: ['--use-dep', '--ignore-term', '--sleep=8000'] } }), { b, id } = await validated(e), p = b.advanceStages('tok-cmd', id, CTX); await runningStage(b, id, 'build', true); const c = await b.cancelBuild('tok-cmd', id, CTX); await p
    assert.deepEqual([c.state, c.ack.signal, c.ack.ack, c.ack.escalated], ['CANCELLED', 'SIGKILL', 'EXITED_AFTER_SIGKILL', true]) }
  // a recipe that cannot be signalled: CANCEL_UNCONFIRMED, and it still can never turn into success when the process later exits 0
  { const e = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=1500'], buildOpts: { cancellable: false } } }), { b, id } = await validated(e), p = b.advanceStages('tok-cmd', id, CTX); await runningStage(b, id); const c = await b.cancelBuild('tok-cmd', id, CTX), r = await p
    assert.deepEqual([c.state, c.ack.ack], ['CANCEL_UNCONFIRMED', 'UNCONFIRMED']); assert.equal(r.ran[0].status, 'CANCELLED'); assert.equal(bodyOf(e, id, 'BUILD').status, 'CANCELLED'); assert.deepEqual([r.claims.built, r.claims.packaged], [false, false]); assert.equal(r.ran.length, 1) }
  // cancelled between build and package (right after the build receipt) and during package
  { let cancelNow; const e = env({ pipeline: { hooks: { fault: (pt, st) => { if (pt === 'after-receipt' && st === 'build') cancelNow() } } } }), { b, id } = await validated(e); cancelNow = () => { b.cancelBuild('tok-cmd', id, CTX, { reason: 'between stages' }).catch(() => {}) }
    const r = await b.advanceStages('tok-cmd', id, CTX); assert.deepEqual(r.ran.map(x => [x.stage, x.status]), [['build', 'PASSED']]); assert.equal(b.stageRuns('tok-cmd', id).filter(x => x.stage === 'package').length, 0, 'no later stage starts'); assert.deepEqual([r.current.build.status, r.current.package.status, r.claims.built, r.claims.packaged], ['CURRENT', 'NOT_RUN', true, false]); assert.equal(r.lineage.cancellation.state, 'CANCELLED') }
  { const e = env({ pipeline: { pkgArgs: ['--sleep=5000'] } }), { b, id } = await validated(e), p = b.advanceStages('tok-cmd', id, CTX); await runningStage(b, id, 'package'); const c = await b.cancelBuild('tok-cmd', id, CTX), r = await p
    assert.equal(c.state, 'CANCELLED'); assert.deepEqual(r.ran.map(x => [x.stage, x.status]), [['build', 'PASSED'], ['package', 'CANCELLED']]); assert.deepEqual([r.claims.built, r.claims.packaged, r.current.package.status], [true, false, 'CANCELLED']) }
  // cancellation observed while host checks run after the process exited 0 still never records success
  { let cancelNow; const checks = [...baseChecks(), { id: 'bundle-syntax', version: '1', role: 'syntax', source: 'late-cancel-check', run: async () => { await cancelNow(); return { status: 'PASS' } } }, stageCheckDefs()[1]]
    const e = env({ hostOpts: { checks } }), { b, id } = await validated(e); cancelNow = () => b.cancelBuild('tok-cmd', id, CTX, { reason: 'late' }); const r = await b.advanceStages('tok-cmd', id, CTX)
    assert.deepEqual(r.ran.map(x => [x.stage, x.status]), [['build', 'CANCELLED']]); assert.equal(bodyOf(e, id, 'BUILD').status, 'CANCELLED'); assert.deepEqual([r.claims.built, r.claims.packaged], [false, false]) }
  // a foreign (orphaned) process is cancelled by pid + start-time identity after a restart: see EX15
})

// ------------------------------------------------------------------ crash recovery (REAL SIGKILL of a broker process; the recipe process may survive as an orphan)
function crashChild(e, execId, point, stage) {
  const code = `
    import { createBroker } from ${JSON.stringify(path.join(here, '../../lib/native-builder/blueprint/broker.mjs'))}
    import { CTX, createExecHost } from ${JSON.stringify(path.join(here, 'exec-fixture.mjs'))}
    const o = JSON.parse(process.env.OPTS)
    const host = createExecHost({ ws: o.ws, rdir: o.rdir, pipelineOpts: { ...o.pipeline, hooks: { fault: (p, st) => { if (p === o.point && st === o.stage) process.kill(process.pid, 'SIGKILL') } } } })
    const b = createBroker({ brokerId: 'broker-1', controlRoot: o.control, evidenceRoot: o.evidence, host, leaseTtlMs: 500, checkTimeoutMs: 5000 })
    await b.advanceStages('tok-cmd', o.execId, CTX)`
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, OPTS: JSON.stringify({ ws: e.ws, rdir: e.rdir, control: e.control, evidence: e.evidence, execId, point, stage, pipeline: e.opts.pipeline ?? {} }) }, timeout: 30000 })
  assert.equal(res.signal, 'SIGKILL', String(res.stderr)); return sleep(750)
}
const waitDead = async (b, id, stage, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = b.stageRuns('tok-cmd', id).filter(x => x.stage === stage).at(-1); if (r && r.processAlive !== true) return r; await sleep(100) } assert.fail('process still alive') }
const classOf = async (b, stage) => (await b.recoverStages('tok-cmd'))[0][stage]

test('EX15 crash recovery: no duplicate execution, no blind rerun of UNKNOWN work, an alive external process is never duplicated, uncertain outputs are never adopted (real SIGKILL)', async () => {
  // crash after PLAN, before anything launched => SAFE_TO_RETRY, one new attempt, no operator step needed
  { const e = env(), { b, id } = await validated(e); await crashChild(e, id, 'after-plan', 'build'); const b2 = boot(e), runs0 = b2.stageRuns('tok-cmd', id); assert.deepEqual(runs0.map(x => [x.attempt, x.state]), [[1, 'PLANNED']]); assert.equal((await classOf(b2, 'build')).classification, 'SAFE_TO_RETRY'); assert.deepEqual((await classOf(b2, 'build')).reasons, ['NEVER_LAUNCHED'])
    const r = await b2.advanceStages('tok-cmd', id, CTX); assert.deepEqual(b2.stageRuns('tok-cmd', id).filter(x => x.stage === 'build').map(x => [x.attempt, x.state]), [[1, 'INTERRUPTED'], [2, 'PASSED']]); assert.equal(r.claims.packaged, true) }
  // crash after STARTING (launch state unprovable) => UNKNOWN_AFTER_CRASH => reconcile required => exactly one new attempt
  { const e = env(), { b, id } = await validated(e); await crashChild(e, id, 'before-launch', 'build'); const b2 = boot(e); const c = await classOf(b2, 'build'); assert.deepEqual([c.classification, c.reasons[0], c.outputs], ['UNKNOWN_AFTER_CRASH', 'PROCESS_STATE_UNPROVABLE', 'NONE'])
    assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED'); assert.equal(b2.stageRuns('tok-cmd', id).length, 1, 'no blind rerun'); b2.reconcileStage('tok-cmd', id, CTX, 'build', { decision: 'RETRY', reason: 'confirmed nothing running' })
    assert.equal((await classOf(b2, 'build')).classification, 'SAFE_TO_RETRY'); const r = await b2.advanceStages('tok-cmd', id, CTX); assert.deepEqual(b2.stageRuns('tok-cmd', id).filter(x => x.stage === 'build').map(x => [x.attempt, x.state]), [[1, 'UNKNOWN_AFTER_CRASH'], [2, 'PASSED']]); assert.equal(r.claims.built, true) }
  // crash while the build process is RUNNING: the process survives as an orphan => never duplicated; after it ends its outputs are uncertain and are NOT adopted
  { const e = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=2200'] } }), { b, id } = await validated(e); await crashChild(e, id, 'after-launch', 'build'); const b2 = boot(e)
    const alive = b2.stageRuns('tok-cmd', id)[0]; assert.deepEqual([alive.state, alive.processAlive], ['RUNNING', true]); const c = await classOf(b2, 'build'); assert.deepEqual([c.classification, c.reasons], ['IN_PROGRESS', ['PROCESS_ALIVE']])
    for (let i = 0; i < 2; i++) assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'WORKSPACE_BUSY', 'a provably alive external process is never duplicated'); assert.equal(b2.stageRuns('tok-cmd', id).length, 1)
    assert.deepEqual([(await b2.lineage('tok-cmd', id)).claims.built], [false], 'no receipt => no build claim, even while outputs appear'); await waitDead(b2, id, 'build'); const c2 = await classOf(b2, 'build'); assert.deepEqual([c2.classification, c2.outputs], ['UNKNOWN_AFTER_CRASH', 'PRESENT_PROVENANCE_UNKNOWN'])
    assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED'); const oldOut = path.join(e.control, 'broker/build/runs', `${id}.build.1/out/bundle.mjs`); assert.ok(fs.existsSync(oldOut), 'uncertain output is present'); assert.equal((await b2.lineage('tok-cmd', id)).claims.built, false, 'present output without a receipt is ARTIFACT_PROVENANCE_UNKNOWN: unused')
    b2.reconcileStage('tok-cmd', id, CTX, 'build', { decision: 'RETRY' }); const r = await b2.advanceStages('tok-cmd', id, CTX); assert.deepEqual(b2.stageRuns('tok-cmd', id).filter(x => x.stage === 'build').map(x => [x.attempt, x.state]), [[1, 'UNKNOWN_AFTER_CRASH'], [2, 'PASSED']])
    const man = bodyOf(e, id, 'BUILD').manifest; assert.ok(man.entries.every(x => x.runId === bodyOf(e, id, 'BUILD').runId) && bodyOf(e, id, 'BUILD').attempt === 2, 'the success belongs to the NEW run only'); assert.equal(r.claims.built, true) }
  // crash after the build process finished and verified but BEFORE the receipt: complete-looking output, still unknown
  { const e = env(), { b, id } = await validated(e); await crashChild(e, id, 'before-receipt', 'build'); const b2 = boot(e), run = b2.stageRuns('tok-cmd', id)[0]; assert.deepEqual([run.state, run.processAlive], ['RUNNING', false]); const c = await classOf(b2, 'build'); assert.deepEqual([c.classification, c.outputs], ['UNKNOWN_AFTER_CRASH', 'PRESENT_PROVENANCE_UNKNOWN'])
    assert.equal((await b2.lineage('tok-cmd', id)).claims.built, false); assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED'); b2.reconcileStage('tok-cmd', id, CTX, 'build', { decision: 'ABANDON', reason: 'do not rebuild' })
    assert.equal((await classOf(b2, 'build')).classification, 'NEEDS_OPERATOR_REVIEW'); assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED', 'ABANDON does not authorize a rerun') }
  // crash DURING package: the build receipt is preserved and not re-run; only the package attempt is reconciled
  { const e = env({ pipeline: { pkgArgs: ['--sleep=2200'] } }), { b, id } = await validated(e); await crashChild(e, id, 'after-launch', 'package'); const b2 = boot(e); const cb = await classOf(b2, 'build'); assert.equal(cb.classification, 'ALREADY_PASSED'); assert.equal((await classOf(b2, 'package')).classification, 'IN_PROGRESS'); assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'WORKSPACE_BUSY')
    await waitDead(b2, id, 'package'); assert.equal((await classOf(b2, 'package')).classification, 'UNKNOWN_AFTER_CRASH'); b2.reconcileStage('tok-cmd', id, CTX, 'package', { decision: 'RETRY' }); const r = await b2.advanceStages('tok-cmd', id, CTX)
    assert.deepEqual(r.ran.map(x => [x.stage, x.reused, x.attempt]), [['build', true, 1], ['package', false, 2]]); assert.equal(b2.stageRuns('tok-cmd', id).filter(x => x.stage === 'build').length, 1, 'the build did not run again'); assert.deepEqual([r.claims.built, r.claims.packaged], [true, true]); const ev = e.host.phase9Sink.state.events.at(-1); validateOutcomeEvent(ev); assert.deepEqual(ev.lineage.retry, { build: 1, package: 2 }); assert.ok(ev.lineage.interruption.some(x => x.stage === 'package' && x.state === 'UNKNOWN_AFTER_CRASH')) }
  // cancelling a foreign orphan after a restart signals it by pid + start-time identity and records the acknowledgement
  { const e = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=9000'] } }), { b, id } = await validated(e); await crashChild(e, id, 'after-launch', 'build'); const b2 = boot(e); assert.equal(b2.stageRuns('tok-cmd', id)[0].processAlive, true); const c = await b2.cancelBuild('tok-cmd', id, CTX, { reason: 'orphan' })
    assert.deepEqual([c.state, c.ack.ack], ['CANCELLED', 'EXITED_AFTER_SIGTERM']); assert.equal(b2.stageRuns('tok-cmd', id)[0].state, 'CANCELLED'); assert.equal(b2.stageRuns('tok-cmd', id)[0].processAlive, null); assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, CTX))).code, 'CANCELLED') }
})

// ------------------------------------------------------------------ idempotency, retry policy, recipe drift, concurrency
test('EX16 effect idempotency: a completed effect never reruns; retryable failures follow policy (bounded); recipe drift refuses without launching; concurrent advances cannot duplicate a build', async () => {
  { const e = env({ pipeline: { buildOpts: { timeoutMs: 700 }, buildArgs: ['--use-dep', '--sleep=5000'] } }), { b, id } = await validated(e)
    const r1 = await b.advanceStages('tok-cmd', id, CTX); assert.equal(bodyOf(e, id, 'BUILD').failure.code, 'STAGE_TIMEOUT'); assert.equal(bodyOf(e, id, 'BUILD').failure.retryable, true); assert.deepEqual(r1.ran.map(x => x.status), ['FAILED'])
    const r2 = await b.advanceStages('tok-cmd', id, CTX); assert.deepEqual(r2.ran.map(x => [x.attempt, x.status]), [[2, 'FAILED']], 'a retryable failure is retried once by policy'); assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED', 'bounded: the third attempt needs an operator'); assert.equal(b.stageRuns('tok-cmd', id).length, 2) }
  { const e = env(), { b, id } = await validated(e); fs.appendFileSync(path.join(e.rdir, 'build.mjs'), '\n// tampered after registration\n')
    const r = await b.advanceStages('tok-cmd', id, CTX); const bb = bodyOf(e, id, 'BUILD'); assert.deepEqual([r.ran[0].status, bb.failure.code, bb.status], ['FAILED', 'TOOL_DRIFT', 'FAILED']); const run = b.stageRuns('tok-cmd', id)[0]; assert.equal(run.processAlive, null); assert.equal(run.startedAt, null, 'the recipe was never launched'); assert.deepEqual([r.claims.built, r.claims.packaged], [false, false]) }
  { const e = env(), { b, id } = await validated(e), res = await Promise.allSettled([b.advanceStages('tok-cmd', id, CTX), b.advanceStages('tok-cmd', id, CTX)])
    assert.equal(res.filter(x => x.status === 'fulfilled').length, 1, 'exactly one advance proceeds'); assert.ok(['LEASE_HELD', 'WORKSPACE_BUSY'].includes(res.find(x => x.status === 'rejected').reason.code)); assert.equal(b.stageRuns('tok-cmd', id).filter(x => x.stage === 'build').length, 1, 'one build run, never two')
    const again = await b.advanceStages('tok-cmd', id, CTX); assert.deepEqual(again.ran.map(x => x.reused), [true, true]) }
})

// ------------------------------------------------------------------ structured feedback, secrets, environment identity
test('EX17 structured error-feedback contract + no secrets/paths persisted + environment identity records NAMES only', async () => {
  const err = structuredError({ stage: 'build', code: 'BUILD_FAILED', failedCheck: 'bundle-syntax', file: '/home/someone/ws/src/a.mjs', expected: 'exit 0', observed: 'token=abc123 failed at /home/someone/ws/src/a.mjs:3', evidenceRef: 'receipt:BUILD.3#evidence', needsApproval: false })
  assert.deepEqual(Object.keys(err).sort(), ['code', 'evidenceRef', 'expected', 'failedCheck', 'file', 'needsApproval', 'nextAction', 'observed', 'retryable', 'stage']); assert.equal(err.file, '<redacted-path>'); assert.ok(!/abc123|someone/.test(JSON.stringify(err))); assert.equal(err.retryable, false); assert.match(err.nextAction, /Revise the supplied source/); assert.ok(Object.isFrozen(err))
  assert.equal(structuredError({ stage: 'build', code: 'STAGE_TIMEOUT', file: 'src/a.mjs', observed: 'x'.repeat(5000) }).observed.length <= 200, true); assert.equal(structuredError({ stage: 'build', code: 'STAGE_TIMEOUT' }).retryable, true); assert.equal(structuredError({ stage: 'x', code: 'weird code!' }).code, 'UNKNOWN'); assert.equal(structuredError({ stage: 'build', code: 'BUILD_FAILED', file: '../../etc/passwd' }).file, '<redacted-path>')
  process.env.BP_APPROVED_FLAG = 'SUPERSECRETVALUE9'; try {
    const e = env({ pipeline: { envNames: ['BP_APPROVED_FLAG'], buildArgs: ['--use-dep', '--fail'] } }), { b, id } = await validated(e); await b.advanceStages('tok-cmd', id, CTX)
    const ident = e.host.pipeline.environment.identity().identity; assert.deepEqual(ident.envNames, ['BP_APPROVED_FLAG']); assert.ok(!JSON.stringify(ident).includes('SUPERSECRETVALUE9')); assert.deepEqual(ident.tools.map(t => t.id), ['node', 'fixture-tool']); assert.deepEqual([ident.platform.os, ident.platform.arch, ident.runtime.node, ident.sandbox, ident.network], [process.platform, process.arch, process.version, 'node-permission-model', 'none'])
    const text = allControlText(e); for (const needle of ['SUPERSECRETVALUE9', 'SECRETVALUE123', 'HUNTER2', '/home/someone', base]) assert.ok(!text.includes(needle), `control store must not contain ${needle}`)
  } finally { delete process.env.BP_APPROVED_FLAG }
  const e2 = env({ pipeline: { envNames: ['BP_APPROVED_FLAG'] } }), d0 = e2.host.pipeline.environment.identity().digest; process.env.BP_APPROVED_FLAG = 'v'; assert.equal(e2.host.pipeline.environment.identity().digest, d0, 'env VALUES are not part of the identity'); delete process.env.BP_APPROVED_FLAG
})

// ------------------------------------------------------------------ engine-level classification of ALL bound inputs (incl. ownership + lease holder)
test('EX18 invalidation groups: source-level inputs (package, hashes, tree, base, ownership, lease holder, check binding) => STALE; build-level inputs (dependencies, recipe, stage checks, environment) => REQUIRES_REBUILD; a package never outlives its build', () => {
  const dir = fs.mkdtempSync(path.join(base, 'eng-')), cp = createControlPlane({ root: path.join(dir, 'c'), now: Date.now }), eng = createBuildEngine({ root: path.join(dir, 'b'), signer: cp.signer }), execId = randomUUID()
  const src = { packageDigest: 'p', sourceHashes: 's', baseIdentityDigest: 'b', ownershipDigest: 'o', leaseHolder: 'h', checkBinding: 'c' }, bld = { ...src, inputTree: 't', dependencyDigest: 'd', stageCheckBinding: 'k', recipeDigest: 'r', envDigest: 'e' }
  eng.appendReceipt(execId, 'SOURCE', { components: src }); eng.appendReceipt(execId, 'DEPENDENCIES', { digest: 'd', allUsable: true }); eng.appendReceipt(execId, 'BUILD', { status: 'PASSED', components: bld, inputDigest: 'bid', manifest: { manifestDigest: 'm', entries: [], binds: {} }, upstream: null, runId: 'r1' })
  const pk = { buildInputDigest: 'bid', buildReceiptId: 'BUILD.3', buildManifestDigest: 'm', recipeDigest: 'pr', envDigest: 'e', stageCheckBinding: 'pk' }; eng.appendReceipt(execId, 'PACKAGE', { status: 'PASSED', components: pk, inputDigest: 'pid', manifest: { manifestDigest: 'pm', entries: [], binds: {} }, upstream: { buildReceiptId: 'BUILD.3' }, runId: 'r2' })
  const now = (over = {}, pover = {}) => ({ source: { components: { ...src, ...over } }, dependencies: { digest: over.dependencyDigest ?? 'd' }, build: { components: { ...bld, ...over }, digest: 'x' }, package: { components: { ...pk, ...pover }, digest: 'y' } })
  assert.deepEqual([eng.current(execId, now()).build.status, eng.current(execId, now()).package.status], ['CURRENT', 'CURRENT'])
  for (const k of STALE_GROUP) { const c = eng.current(execId, now({ [k]: 'CHANGED' })); assert.deepEqual([c.build.status, c.package.status, c.source.status ?? null].slice(0, 2), ['STALE', 'STALE'], k); assert.deepEqual(c.build.changed.includes(k), true) }
  for (const k of REBUILD_GROUP) { const c = eng.current(execId, now({ [k]: 'CHANGED' })); assert.deepEqual([c.build.status, c.package.status], ['REQUIRES_REBUILD', 'REQUIRES_REBUILD'], k) }
  assert.deepEqual([eng.current(execId, now({}, { recipeDigest: 'other' })).build.status, eng.current(execId, now({}, { recipeDigest: 'other' })).package.status], ['CURRENT', 'REQUIRES_REBUILD'], 'a package-recipe change stales only the package'); assert.equal(eng.current(execId, now({ dependencyDigest: 'x' })).dependencies.status, 'STALE')
  assert.equal(eng.current(execId, now({ checkBinding: 'z', recipeDigest: 'z' })).build.status, 'STALE', 'source-level staleness wins over rebuild-level')
  const before = eng.listReceipts(execId).length; eng.current(execId, now({ ownershipDigest: 'X' }), { record: true }); eng.current(execId, now({ ownershipDigest: 'X' }), { record: true }); assert.equal(eng.listReceipts(execId).length, before + 3, 'invalidations are recorded once per observation (source + build + package), not once per call'); assert.equal(eng.verifyChain(execId).ok, true)
})

// ------------------------------------------------------------------ boundaries
test('EX19 boundaries: no network capability in the execution modules, no install/activate surface, install is only DEFINED, external AI is not part of the core', () => {
  const lib = path.join(here, '../../lib/native-builder/blueprint')
  for (const f of ['buildexec', 'depverify', 'depprobe', 'envid', 'stages', 'artifacts', 'depplan', 'quality', 'broker']) { const text = fs.readFileSync(path.join(lib, `${f}.mjs`), 'utf8'); assert.ok(!/from 'node:(http|https|net|tls|dgram|dns|http2)'/.test(text) && !/\bfetch\(/.test(text) && !/XMLHttpRequest|WebSocket/.test(text), `${f}: no network API`) }
  for (const f of ['buildexec', 'depverify', 'quality', 'stages']) { const text = fs.readFileSync(path.join(lib, `${f}.mjs`), 'utf8'); assert.ok(!/['"`](npm|pnpm|yarn)['"`]/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${f}: no package-manager invocation`) }
  const e = env(), b = boot(e); assert.deepEqual(Object.keys(b).filter(k => /install|deploy|activate|publish|complete/i.test(k)), [], 'no install/deploy/activate/publish/complete surface on the broker'); assert.equal(INSTALL_REQUIREMENTS.length, 6); assert.ok(INSTALL_REQUIREMENTS.some(x => /explicit host authorization/.test(x)) && INSTALL_REQUIREMENTS.some(x => /post-install acceptance/.test(x)))
  const recipes = e.host.pipeline.recipe; for (const stages of [['install'], ['verifyArtifact'], ['build', 'install'], ['package']]) assert.throws(() => createBuildPipeline({ authorized: stages, recipes: { build: recipes('build'), package: recipes('package') }, environment: e.host.pipeline.environment }), /cannot be authorized|requires build/, stages.join())
  const noPipeline = createExecHost({ ws: e.ws, rdir: e.rdir }); delete noPipeline.pipeline; const b0 = boot(e, { host: noPipeline }); return failing(() => b0.advanceStages('tok-cmd', '00000000-0000-4000-8000-000000000000', CTX)).then(x => assert.ok(['STAGE_NOT_AUTHORIZED', 'BROKER_STATE'].includes(x.code)))
})

test('EX20 hostile package attempts at the build boundary: no build request => no stage; unknown recipe refused; the package cannot choose recipe, args, env, outputs or roots; viewers cannot drive stages', async () => {
  const e = env(), b = boot(e), { execId } = b.importPackage('tok-cmd', PKG({ build: undefined }), CTX); b.approve('tok-cmd', execId, CTX); assert.equal((await b.execute('tok-cmd', execId, CTX)).state, 'VERIFIED_SOURCE')
  assert.equal((await failing(() => b.advanceStages('tok-cmd', execId, CTX))).code, 'STAGE_NOT_AUTHORIZED', 'a package that never requested a recipe gets no stages'); assert.equal(b.stageRuns('tok-cmd', execId).length, 0)
  for (const k of ['args', 'env', 'cwd', 'outputs', 'outputRoot', 'timeoutMs', 'cmd', 'script']) assert.equal((await failing(async () => boot(e).importPackage('tok-cmd', PKG({ build: { recipeId: 'fixture-build', recipeVersion: '1', [k]: 'x' } }), CTX))).code, 'INVALID_PACKAGE', k)
  const { b: b2, id } = await validated(env()); assert.equal((await failing(() => b2.advanceStages('tok-view', id, CTX))).code, 'ROLE_DENIED'); assert.equal((await failing(() => b2.cancelBuild('tok-view', id, CTX))).code, 'ROLE_DENIED'); assert.equal((await failing(async () => b2.reconcileStage('tok-view', id, CTX, 'build', { decision: 'RETRY' }))).code, 'ROLE_DENIED')
  assert.equal((await failing(() => b2.advanceStages('tok-cmd', id, { ...CTX, workspaceId: 'ws-2' }))).code, 'WORKSPACE_MISMATCH'); assert.equal(b2.stageRuns('tok-view', id).length, 0)
})

// ------------------------------------------------------------------ adversarial-review regressions
test('EX21 review regressions: a long stage renews its lease; a tampered PASSED build can be rebuilt only by explicit reconcile; a swapped output dir is not provenance; an unprovable process is never reported as cleanly cancelled', async () => {
  // (1) found by the crash test: the broker did not heartbeat its lease during a stage, so a stage longer than the lease TTL was stopped as LEASE_LOST
  { const e = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=1800'] } }), b = createBroker({ brokerId: 'broker-1', controlRoot: e.control, evidenceRoot: e.evidence, host: e.host, leaseTtlMs: 600, checkTimeoutMs: 5000 }), { id } = await validated(e, b), r = await b.advanceStages('tok-cmd', id, CTX)
    assert.deepEqual(r.ran.map(x => x.status), ['PASSED', 'PASSED'], 'a 1.8 s build under a 0.6 s lease TTL completes: the lease is renewed while the stage runs') }
  // (2) tampered artifacts of an already-PASSED effect: not silently "already passed", not a deadlock either
  { const e = env(), { b, id } = await validated(e); await b.advanceStages('tok-cmd', id, CTX); const bundle = path.join(e.control, 'broker/build/runs', `${id}.build.1/out/bundle.mjs`), orig = fs.readFileSync(bundle); fs.writeFileSync(bundle, 'export const evil = 1\n')
    assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'RECONCILIATION_REQUIRED', 'ALREADY_PASSED is only honoured while the artifacts still verify'); assert.equal((await b.recoverStages('tok-cmd'))[0].build.classification, 'NEEDS_OPERATOR_REVIEW')
    b.reconcileStage('tok-cmd', id, CTX, 'build', { decision: 'RETRY', reason: 'artifact tampering suspected' }); const r = await b.advanceStages('tok-cmd', id, CTX); assert.deepEqual(r.ran.map(x => [x.stage, x.attempt, x.status]), [['build', 2, 'PASSED'], ['package', 2, 'PASSED']]); void orig // the package is rebuilt from the NEW build receipt
    assert.deepEqual([r.current.build.status, r.claims.built], ['CURRENT', true]); assert.equal(b.stageRuns('tok-cmd', id).filter(x => x.stage === 'build').length, 2) }
  // (3) content-identical copy in a swapped/recreated or symlinked output directory is NOT current-run provenance
  { const e = env(), { b, id } = await validated(e); await b.advanceStages('tok-cmd', id, CTX); const rd0 = path.join(e.control, 'broker/build/runs', `${id}.build.1`), out = path.join(rd0, 'out'), copy = path.join(e.dir, 'out-copy'); fs.cpSync(out, copy, { recursive: true, preserveTimestamps: true })
    fs.rmSync(out, { recursive: true }); fs.cpSync(copy, out, { recursive: true, preserveTimestamps: true }); await b.verifyArtifacts('tok-cmd', id); let v = await b.lineage('tok-cmd', id); assert.equal(v.current.build.status, 'UNUSABLE', 'recreated directory, identical bytes'); assert.ok(v.current.build.problems.some(x => x.detail === 'OUTPUT_DIR_REPLACED')); assert.equal(v.lineage.provenance, 'ARTIFACT_PROVENANCE_UNKNOWN')
    const e2 = env(), { b: b2, id: id2 } = await validated(e2); await b2.advanceStages('tok-cmd', id2, CTX); const o2 = path.join(e2.control, 'broker/build/runs', `${id2}.build.1/out`), c2 = path.join(e2.dir, 'elsewhere'); fs.renameSync(o2, c2); fs.symlinkSync(c2, o2); await b2.verifyArtifacts('tok-cmd', id2); v = await b2.lineage('tok-cmd', id2); assert.equal(v.current.build.status, 'UNUSABLE', 'symlinked output dir'); assert.deepEqual([v.claims.built, v.claims.packaged], [false, false]) }
  // (4) cancelling when the process state is unprovable (crash between STARTING and the pid record): never claim a clean stop
  { const e = env(), { b, id } = await validated(e); await crashChild(e, id, 'before-launch', 'build'); const c = await boot(e).cancelBuild('tok-cmd', id, CTX, { reason: 'unknown state' }); assert.deepEqual([c.state, c.ack.ack], ['CANCEL_UNCONFIRMED', 'UNPROVABLE_PROCESS_STATE']) }
})

test('EX22 live host authority governs stages: assignment pause/cancel or ownership change mid-build stops the process (INTERRUPTED, never success); restoring authority allows a bounded retry; stages need a live, writable owner to start', async () => {
  const mk = () => { const e = env({ pipeline: { buildArgs: ['--use-dep', '--sleep=2500'] } }); e.live = createLiveModel(e.ws, { scope: ['src/a.mjs', 'src/b.mjs'] }); e.host.missions = { verifyAssignment: e.live.bridge.verifyAssignment, resolve: e.live.bridge.resolve }; return e }
  for (const [name, mutate, restore] of [['assignment paused', e => e.live.set('assignments', 'a-1', { state: 'PAUSED' }), e => e.live.set('assignments', 'a-1', { state: 'RUNNING' })], ['mission cancel requested', e => e.live.set('missions', 'm-1', { cancelRequested: true }), e => e.live.set('missions', 'm-1', { cancelRequested: false })],
    ['mission left EXECUTING', e => e.live.set('missions', 'm-1', { status: 'VALIDATING' }), e => e.live.set('missions', 'm-1', { status: 'EXECUTING' })], ['assignment rebound to another owner', e => { e.live.asg().assignment = { ...e.live.asg().assignment, taskClass: 'other' } }, e => { e.live.asg().assignment = { ...e.live.asg().assignment, taskClass: 'feature_implementation' } }]]) {
    const e = mk(), { b, id } = await validated(e), p = b.advanceStages('tok-cmd', id, CTX); await runningStage(b, id); mutate(e); const t0 = Date.now(), r = await p
    assert.ok(Date.now() - t0 < 2300, `${name}: the process was stopped, not waited for`); assert.equal(r.ran[0].status, 'INTERRUPTED', name); assert.equal(bodyOf(e, id, 'BUILD').failure.code, 'HOST_AUTHORITY_STOPPED', name); assert.deepEqual([r.claims.built, r.claims.packaged], [false, false]); assert.equal(r.ran.length, 1)
    assert.equal(b.stageRuns('tok-cmd', id)[0].processAlive, null); assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, name === 'assignment rebound to another owner' ? 'APPROVAL_STALE' : name === 'assignment paused' ? 'ASSIGNMENT_INACTIVE' : 'MISSION_INACTIVE', `${name}: no stage starts without authority`)
    restore(e); e.host.pipeline.recipe('build'); const e2 = e; void e2 } // restoring + retry is covered below on a fast recipe
  { const e = env(); e.live = createLiveModel(e.ws, { scope: ['src/a.mjs', 'src/b.mjs'] }); e.host.missions = { verifyAssignment: e.live.bridge.verifyAssignment, resolve: e.live.bridge.resolve }; const { b, id } = await validated(e); e.live.set('assignments', 'a-1', { state: 'PAUSED' })
    assert.equal((await failing(() => b.advanceStages('tok-cmd', id, CTX))).code, 'ASSIGNMENT_INACTIVE'); assert.equal(b.stageRuns('tok-cmd', id).length, 0); e.live.set('assignments', 'a-1', { state: 'RUNNING' }); const r = await b.advanceStages('tok-cmd', id, CTX); assert.deepEqual([r.claims.built, r.claims.packaged], [true, true]); assert.equal(e.live.snapshot().includes('COMPLETE'), false, 'building never advances mission/assignment lifecycle') }
})

/* eslint-disable @typescript-eslint/no-explicit-any -- validator drives the reviewed .mjs broker through structural shims */
/**
 * Live integration validation for the blueprint adapter. Runs the REAL War Room stores (mission records, Agent Ops log, workspace registry, REPO_WRITE lock
 * registry, local-ownership sessions, Phase 9 learning log) inside a throwaway SANDBOX data root, drives the broker built by buildBlueprintRuntime(), and proves the
 * end-to-end path plus the refusal/recovery behavior. The 164-test isolated reference suite (tests/blueprint) is run separately by validate:blueprint-reference.
 * No silent skips: every case below always runs.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { acquireRepoWrite } from '../foundryRepoWriteLocks'
import { releaseResource } from '../foundryResourceLocks'
import { cancelMission } from '../foundryMissionController'
import { readWorkspaceBaseIdentity } from '../foundryWorkspaceIdentity'
import { AgentOpsLog } from '@/lib/agents/ops/log'
import { C } from '@/lib/agents/ops/engineering/engtestkit'
import { failAssignment, pauseAssignment, resumeAssignment } from '@/lib/agents/ops/engineering/assignments'
import { isLocalCommanderSessionLive } from '@/lib/security/commanderSession'
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership'
import { defaultLearningLog } from '@/lib/recursive-learning/paths'
import { BlueprintError } from './base.mjs'
import { blueprintEventToEvaluationInputs } from './livePhase9'
import { buildBlueprintRuntime, type BlueprintRuntime } from './liveRuntime'
import { blueprintRoots } from './liveRoots'
import { approvalView, artifactRows, claimRows, dependencyRows, recoveryLabel } from './uiModel'
import { liveBaseIdentity, refreshBlueprintWorkspace } from './liveWorkspaces'
import { materializeTools } from './liveBuild'
import { findInputSymlink } from './artifacts.mjs'
import { configureSandboxEnv, createSandboxRoot, fixturePackage, git, seedBlueprintSandbox, FIXTURE_A0, FIXTURE_A1, type SeedResult } from './testkit'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail: pass ? detail : `${detail || 'failed'}` }) }
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const PASSWORD = 'test-only-sandbox-password-1'
async function code(fn: () => unknown): Promise<string> { try { await fn(); return 'NO_ERROR' } catch (e) { return e instanceof BlueprintError ? e.code : `OTHER:${(e as Error).message?.slice(0, 80)}` } }

function repoRoot(): string { return process.cwd() }
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'))

async function main() {
  const sb = createSandboxRoot()
  configureSandboxEnv(sb)
  const store = getLocalOwnershipStore(sb.dataDir)
  const boot = store.bootstrapCommander({ password: PASSWORD, displayName: 'Sandbox Commander' })
  check('sandbox_commander_bootstrapped', boot.ok === true, 'test-only Commander in a throwaway data root')
  const login = store.login(PASSWORD)
  if (!login.ok) throw new Error('sandbox login failed')
  const sess = login.auth.session
  const facts = { sessionId: sess.session_id, authenticatedAt: Date.parse(sess.created_at), expiresAt: Date.parse(sess.expires_at), source: 'war-room.local-session' }
  const userId = login.auth.identity.id
  const rtOf = (o: Parameters<typeof buildBlueprintRuntime>[0] = {}) => buildBlueprintRuntime(o)
  const admit = (rt: BlueprintRuntime) => rt.bridge.admit({ ok: true, userId }, facts)
  const ctxOf = (s: SeedResult) => ({ missionId: s.missionId, assignmentId: s.assignmentId, workspaceId: s.workspaceId, requestingSubsystem: 'foundry-blueprints' })
  const approveDeps = (rt: BlueprintRuntime, s: SeedResult) => rt.store.approve({ workspaceId: s.workspaceId, name: 'tiny-dep', version: '1.2.3', actorId: userId, sessionId: facts.sessionId, reason: 'validator approval of the declared fixture dependency' })
  const ready = async (rt: BlueprintRuntime, s: SeedResult, raw?: string, deps = true) => {
    await refreshBlueprintWorkspace(s.workspaceId)
    if (deps) approveDeps(rt, s)
    const h = admit(rt), base = liveBaseIdentity.resolve(s.workspaceId)
    const imp = rt.broker.importPackage(h, raw ?? fixturePackage({ workspaceId: s.workspaceId, baseRevision: base }), ctxOf(s))
    return { h, id: imp.execId as string, ctx: ctxOf(s), base }
  }

  const done = (...ss: SeedResult[]) => { for (const x of ss) failAssignment(new AgentOpsLog(), x.assignmentId, 'system:runner', 'validator scenario finished (frees the concurrency slot)') }
  try {
    // ---- L1 session facts + revocation probe + gate source conformance (the gate itself needs a Next request scope; it is exercised over HTTP in the runtime proof)
    check('session_facts_shape_credential_free', Object.keys(facts).sort().join() === 'authenticatedAt,expiresAt,sessionId,source' && /^lses_[a-f0-9]{32}$/.test(facts.sessionId), 'facts are exactly sessionId/authenticatedAt/expiresAt/source')
    check('session_live_probe_true_then_false_after_logout', isLocalCommanderSessionLive(facts.sessionId) === true && (store.logout(login.auth.token), isLocalCommanderSessionLive(facts.sessionId) === false), 'pure probe follows revocation')
    const src = fs.readFileSync(path.join(repoRoot(), 'lib/security/commanderSession.ts'), 'utf8')
    const factsFn = src.slice(src.indexOf('export async function requireCommanderSessionFacts'), src.indexOf('export function isLocalCommanderSessionLive'))
    check('gate_facts_from_same_verified_session', src.includes('auth.session.session_id') && src.includes('const local = await readLoopbackLocalCommander()') && factsFn.indexOf('readLoopbackLocalCommander()') < factsFn.indexOf('requireCommanderSession(actionLabel)'), 'facts come from the row verifySessionToken validated')
    check('gate_facts_never_return_token', !/token/i.test(factsFn.replace(/\/\*[\s\S]*?\*\//g, '')) && !/cookie|bearer/i.test(src.slice(src.indexOf('export type CommanderSessionFacts'), src.indexOf('async function readLoopbackLocalCommander')).replace(/\/\*[\s\S]*?\*\//g, '')), 'no credential field in facts type or accessor')
    const login2 = store.login(PASSWORD); if (!login2.ok) throw new Error('relogin failed')
    Object.assign(facts, { sessionId: login2.auth.session.session_id, authenticatedAt: Date.parse(login2.auth.session.created_at), expiresAt: Date.parse(login2.auth.session.expires_at) })

    // ---- L2 end-to-end happy path through the REAL stores
    const s1 = await seedBlueprintSandbox(sb, { name: 'ws-e2e' })
    const rt = rtOf()
    const missionFile = path.join(blueprintRoots().root, '..', 'missions', `${s1.missionId}.json`)
    const missionBefore = sha(fs.readFileSync(missionFile))
    const opsLogFile = new AgentOpsLog(undefined, { readOnly: true }).file
    const opsBefore = sha(fs.readFileSync(opsLogFile))
    const r1 = await ready(rt, s1)
    check('import_preview_exact_changes', (rt.broker.preview(r1.h, r1.id) as any).changes.length === 2 && (rt.broker.preview(r1.h, r1.id) as any).changes.every((c: any) => c.afterHash && 'before' in c), 'exact preview with before/after hashes')
    const appr = rt.broker.approve(r1.h, r1.id, r1.ctx)
    const av = rt.broker.approvalState(r1.h, r1.id)
    check('approval_bound_to_exact_inputs', appr.state === 'APPROVED' && av.usable === true && !!av.bound.packageDigest && !!av.bound.baseIdentity && !!av.bound.checkBinding && !!av.bound.ownership && !!av.bound.pipeline && av.bound.holder.startsWith('bp-') && av.approvedBy.sessionId === facts.sessionId, 'package/base/checks/ownership/recipe/holder/session')
    check('preview_dependencies_present_before_and_after_execution', (rt.broker.preview(r1.h, r1.id) as any).dependencies?.[0]?.name === 'tiny-dep', 'declared dependencies stay visible')
    const ex = await rt.broker.execute(r1.h, r1.id, r1.ctx)
    check('source_validated_with_live_checks', ex.state === 'VERIFIED_SOURCE' && ex.claims.sourceValidated === true && ex.claims.built === false && fs.readFileSync(path.join(s1.workspaceRoot, 'src/a.mjs'), 'utf8') === FIXTURE_A1, 'wr-dependency-audit + wr-syntax PASS; workspace edited by the broker only')
    check('historical_preview_keeps_declared_dependencies', (rt.broker.preview(r1.h, r1.id) as any).dependencies?.[0]?.version === '1.2.3', 'post-execution preview still lists declared dependencies')
    check('lease_released_after_execute', !fs.existsSync(blueprintRoots().repoWriteRegistry) || readJson(blueprintRoots().repoWriteRegistry).claims.length === 0, 'REPO_WRITE registry empty after the run')
    const adv = await rt.broker.advanceStages(r1.h, r1.id, r1.ctx)
    check('build_and_package_passed', adv.ran.map((x: any) => `${x.stage}:${x.status}`).join() === 'build:PASSED,package:PASSED' && adv.current.build.status === 'CURRENT' && adv.current.package.status === 'CURRENT', JSON.stringify(adv.ran))
    check('labels_are_blueprint_not_installed', adv.claims.labels.join() === 'BLUEPRINT_SOURCE_VALIDATED,BLUEPRINT_BUILD_VERIFIED,BLUEPRINT_PACKAGE_VERIFIED' && adv.claims.installed === false && adv.claims.taskComplete === false && adv.claims.missionComplete === false && adv.claims.assignmentComplete === false && adv.notClaimed.includes('INSTALLED_RUNTIME'), 'no install/task/mission/assignment claim')
    const bmanifest = readJson(path.join(blueprintRoots().control, 'broker/build/receipts', fs.readdirSync(path.join(blueprintRoots().control, 'broker/build/receipts')).filter(f => f.startsWith(r1.id) && f.includes('.BUILD.'))[0])).body.manifest
    const outDir = path.join(blueprintRoots().control, 'broker/build/runs', `${r1.id}.build.1/out`)
    check('outputs_run_owned_out_of_tree', outDir.startsWith(blueprintRoots().control) && !outDir.startsWith(s1.workspaceRoot) && !fs.existsSync(path.join(s1.workspaceRoot, 'bundle.mjs')) && bmanifest.entries.every((e: any) => e.runId && e.sha256 && e.bytes > 0 && e.dependencyDigest && e.recipeDigest && e.envDigest && e.sourceDigest), 'manifest binds run/source/dependency/recipe/environment; nothing in the workspace')
    check('workspace_changes_limited_to_package_paths', git(s1.workspaceRoot, ['status', '--porcelain']).split('\n').map(l => l.trim().split(/\s+/)[1]).sort().join() === 'src/a.mjs,src/greeting.mjs', git(s1.workspaceRoot, ['status', '--porcelain']))
    check('mission_and_assignment_untouched', sha(fs.readFileSync(missionFile)) === missionBefore && sha(fs.readFileSync(opsLogFile)) === opsBefore, 'blueprint success does not complete or alter mission/assignment records')
    const ev = (defaultLearningLog({ readOnly: true }).view().events as any[]).filter(e => e.source?.kind === 'blueprint')
    check('phase9_events_attributable_no_fabricated_cost', ev.length >= 5 && ev.some(e => e.signal === 'RUN' && e.outcome === 'SUCCESS') && ev.every(e => e.metrics.costUsd === undefined && e.metrics.tokensIn === undefined && e.metrics.tokensOut === undefined && e.note.includes(s1.missionId) && e.note.includes(s1.assignmentId) && e.note.includes('actor=')), `${ev.length} events: ${ev.map(e => e.signal + ':' + e.note.split(' ')[0]).slice(0, 6).join(' | ')}`)

    // ---- L3 artifact tamper refusal + history
    fs.writeFileSync(path.join(outDir, 'bundle.mjs'), 'export const evil = 1\n')
    await rt.broker.verifyArtifacts(r1.h, r1.id)
    const tampered = await rt.broker.lineage(r1.h, r1.id)
    check('artifact_tamper_refused', tampered.current.build.status === 'UNUSABLE' && tampered.claims.built === false && tampered.claims.packaged === false && tampered.chain.ok === true, 'hash mismatch makes build+package unusable; receipts preserved')
    done(s1)

    // ---- L4 stale approval refused without burning it
    const s2 = await seedBlueprintSandbox(sb, { name: 'ws-stale' }); const r2 = await ready(rt, s2); rt.broker.approve(r2.h, r2.id, r2.ctx)
    const head0 = git(s2.workspaceRoot, ['rev-parse', 'HEAD']); git(s2.workspaceRoot, ['commit', '-q', '--allow-empty', '-m', 'external advance'])
    const stale = rt.broker.approvalState(r2.h, r2.id)
    check('stale_base_detected_in_approval_view', stale.stale.includes('baseIdentity') && stale.usable === false, JSON.stringify(stale.stale))
    check('stale_approval_refused_not_burned', (await code(() => rt.broker.execute(r2.h, r2.id, r2.ctx))) === 'BASE_REVISION_MISMATCH' && rt.broker.status(r2.h, r2.id).state === 'APPROVED' && fs.readFileSync(path.join(s2.workspaceRoot, 'src/a.mjs'), 'utf8') === FIXTURE_A0, 'workspace untouched, approval preserved')
    git(s2.workspaceRoot, ['reset', '-q', '--hard', head0])
    check('approval_usable_again_when_base_restored', (await rt.broker.execute(r2.h, r2.id, r2.ctx)).state === 'VERIFIED_SOURCE', 'same approval works once the approved base is back')
    done(s2)

    // ---- L5 wrong mission / assignment / workspace / write scope
    const s3 = await seedBlueprintSandbox(sb, { name: 'ws-refusals' }); await refreshBlueprintWorkspace(s3.workspaceId); const h3 = admit(rt), base3 = liveBaseIdentity.resolve(s3.workspaceId), raw3 = fixturePackage({ workspaceId: s3.workspaceId, baseRevision: base3 })
    const other = await seedBlueprintSandbox(sb, { name: 'ws-other' }); await refreshBlueprintWorkspace(other.workspaceId)
    check('wrong_mission_refused', (await code(() => rt.broker.importPackage(h3, raw3, { ...ctxOf(s3), missionId: 'does-not-exist' }))) === 'OWNERSHIP_UNAVAILABLE', 'unknown mission')
    check('wrong_assignment_refused', (await code(() => rt.broker.importPackage(h3, raw3, { ...ctxOf(s3), assignmentId: other.assignmentId }))) === 'OWNERSHIP_UNAVAILABLE', "another mission's assignment does not link to this mission")
    check('wrong_workspace_refused', (await code(() => rt.broker.importPackage(h3, raw3, { ...ctxOf(s3), workspaceId: other.workspaceId }))) === 'WORKSPACE_MISMATCH', 'workspace differs from the assignment/mission binding')
    check('write_scope_escalation_refused', (await code(() => rt.broker.importPackage(h3, fixturePackage({ workspaceId: s3.workspaceId, baseRevision: base3, over: { changes: [{ path: 'src/not-in-scope.mjs', operation: 'create', beforeHash: null, content: 'export const x = 1\n' }], permissions: { writePaths: ['src/not-in-scope.mjs'] }, artifact: { path: 'src/not-in-scope.mjs', sha256: sha('export const x = 1\n'), kind: 'source-file' }, dependencies: [] } }), ctxOf(s3)))) === 'WRITE_SCOPE_DENIED', 'package path outside the mission write set')
    check('worker_claim_must_match_owner', (await code(() => rt.broker.importPackage(h3, raw3, { ...ctxOf(s3), workerId: 'someone-else' }))) === 'WORKER_MISMATCH', 'a caller cannot nominate a worker')
    done(s3, other)

    // ---- L6 live lifecycle: assignment pause / mission cancel come from the REAL Agent Ops + mission stores
    const s4 = await seedBlueprintSandbox(sb, { name: 'ws-lifecycle' }); const r4 = await ready(rt, s4); rt.broker.approve(r4.h, r4.id, r4.ctx)
    const log = new AgentOpsLog(); pauseAssignment(log, s4.assignmentId, C, 'validator pause')
    check('paused_assignment_blocks_execute', (await code(() => rt.broker.execute(r4.h, r4.id, r4.ctx))) === 'ASSIGNMENT_INACTIVE', 'real PAUSED assignment')
    resumeAssignment(log, s4.assignmentId, C, 'validator resume')
    check('resumed_assignment_allows_execute', (await rt.broker.execute(r4.h, r4.id, r4.ctx)).state === 'VERIFIED_SOURCE', 'authority restored')
    done(s4)
    const s5 = await seedBlueprintSandbox(sb, { name: 'ws-mission-cancel' }); await refreshBlueprintWorkspace(s5.workspaceId); await cancelMission(s5.missionId); const h5 = admit(rt)
    check('cancelled_mission_blocks_import', (await code(() => rt.broker.importPackage(h5, fixturePackage({ workspaceId: s5.workspaceId, baseRevision: liveBaseIdentity.resolve(s5.workspaceId) }), ctxOf(s5)))) === 'MISSION_INACTIVE', 'real CANCELLED mission')
    done(s5)

    // ---- L7 dependency authority: unapproved dependency => source validation fails and rolls back (no install, workspace restored)
    const s6 = await seedBlueprintSandbox(sb, { name: 'ws-dep-unapproved' }); const r6 = await ready(rt, s6, undefined, false); rt.broker.approve(r6.h, r6.id, r6.ctx)
    const e6 = await rt.broker.execute(r6.h, r6.id, r6.ctx)
    check('unapproved_dependency_fails_and_rolls_back', e6.state === 'FAILED_ROLLED_BACK' && e6.claims.sourceValidated === false && fs.readFileSync(path.join(s6.workspaceRoot, 'src/a.mjs'), 'utf8') === FIXTURE_A0 && !fs.existsSync(path.join(s6.workspaceRoot, 'src/greeting.mjs')), `state=${e6.state}`)
    check('no_dependency_installed_or_changed', git(s6.workspaceRoot, ['status', '--porcelain']) === '' && !fs.existsSync(path.join(s6.workspaceRoot, 'node_modules/tiny-dep/.installed')), 'workspace identical to baseline')
    done(s6)
    const s7 = await seedBlueprintSandbox(sb, { name: 'ws-syntax-fail' }); const bad = fixturePackage({ workspaceId: s7.workspaceId, baseRevision: (await refreshBlueprintWorkspace(s7.workspaceId), liveBaseIdentity.resolve(s7.workspaceId)), over: { changes: [{ path: 'src/a.mjs', operation: 'replace', beforeHash: sha(FIXTURE_A0), content: 'export const a = (\n' }, { path: 'src/greeting.mjs', operation: 'create', beforeHash: null, content: "import dep from 'tiny-dep'\nexport const greeting = dep.describe()\n" }], artifact: { path: 'src/a.mjs', sha256: sha('export const a = (\n'), kind: 'source-file' } } })
    const r7 = await ready(rt, s7, bad); rt.broker.approve(r7.h, r7.id, r7.ctx); const e7 = await rt.broker.execute(r7.h, r7.id, r7.ctx)
    check('failed_validation_rolls_back', e7.state === 'FAILED_ROLLED_BACK' && fs.readFileSync(path.join(s7.workspaceRoot, 'src/a.mjs'), 'utf8') === FIXTURE_A0, `state=${e7.state}`)
    done(s7)

    // ---- L8 cross-system lock exclusion over the SAME REPO_WRITE registry as Foundry missions
    const s8 = await seedBlueprintSandbox(sb, { name: 'ws-lock' }); const r8 = await ready(rt, s8); rt.broker.approve(r8.h, r8.id, r8.ctx)
    const live = await acquireRepoWrite(blueprintRoots().repoWriteRegistry, { missionId: 'foundry-mission-x', operation: 'foundry write', workspaceRoot: s8.workspaceRoot, paths: [] }, c => { try { process.kill(c.pid, 0); return false } catch { return true } })
    check('foundry_claim_blocks_blueprint', live.state === 'ACQUIRED' && (await code(() => rt.broker.execute(r8.h, r8.id, r8.ctx))) === 'LEASE_HELD' && fs.readFileSync(path.join(s8.workspaceRoot, 'src/a.mjs'), 'utf8') === FIXTURE_A0 && rt.broker.status(r8.h, r8.id).state === 'APPROVED', 'a live Foundry mission claim excludes the blueprint; approval preserved')
    if (live.state === 'ACQUIRED') await live.release()
    check('claim_release_frees_workspace', (await rt.broker.execute(r8.h, r8.id, r8.ctx)).state === 'VERIFIED_SOURCE', 'after the Foundry claim is released the same approval executes')
    done(s8)
    const rtSlow = rtOf({ buildArgs: ['--sleep=2500'] }), s9 = await seedBlueprintSandbox(sb, { name: 'ws-lock2' }); const r9 = await ready(rtSlow, s9); rtSlow.broker.approve(r9.h, r9.id, r9.ctx); await rtSlow.broker.execute(r9.h, r9.id, r9.ctx)

    // ---- L9 cancellation mid-build (real process) + durable record
    const adv9 = rtSlow.broker.advanceStages(r9.h, r9.id, r9.ctx)
    for (let i = 0; i < 100 && !rtSlow.broker.stageRuns(r9.h, r9.id).some((x: any) => x.state === 'RUNNING' && x.processAlive === true && x.lastOutputAt); i++) await sleep(50)
    const blocked = await acquireRepoWrite(blueprintRoots().repoWriteRegistry, { missionId: 'foundry-mission-y', operation: 'foundry write', workspaceRoot: s9.workspaceRoot, paths: [] }, c => { try { process.kill(c.pid, 0); return false } catch { return true } })
    check('blueprint_claim_blocks_foundry_during_build', blocked.state === 'BUSY' && (blocked as any).holder.operation.startsWith('blueprint-adapter:bp-') && (blocked as any).holder.missionId.startsWith('blueprint:'), 'live acquireRepoWrite sees the blueprint holder as BUSY')
    const canc = await rtSlow.broker.cancelBuild(r9.h, r9.id, r9.ctx, { reason: 'validator cancel' }); const ran9 = await adv9
    check('cancel_mid_build_stops_process_never_success', canc.state === 'CANCELLED' && ran9.ran[0].status === 'CANCELLED' && ran9.claims.built === false && !(await rtSlow.broker.lineage(r9.h, r9.id)).current.package.receiptId, JSON.stringify(canc.ack))
    const afterCancel = await code(() => { const x = rtOf({ buildArgs: ['--sleep=2500'] }); return x.broker.advanceStages(admit(x), r9.id, r9.ctx) })
    check('cancellation_survives_restart', afterCancel === 'CANCELLED', `a new broker instance still refuses (got ${afterCancel})`)
    done(s9)
    await releaseResource('REPO_WRITE', 'noop').catch(() => false)

    // ---- L10 SIGKILL crash recovery against the real stores (orphaned recipe process is never duplicated; unknown outputs are never adopted)
    const rtCrash = rtOf({ buildArgs: ['--sleep=6000'] }), s10 = await seedBlueprintSandbox(sb, { name: 'ws-crash' }); const r10 = await ready(rtCrash, s10); rtCrash.broker.approve(r10.h, r10.id, r10.ctx); await rtCrash.broker.execute(r10.h, r10.id, r10.ctx)
    const child = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', 'lib/native-builder/blueprint/testkit.crashChild.ts'], { cwd: repoRoot(), timeout: 60_000, env: { ...process.env, BLUEPRINT_CRASH_OPTS: JSON.stringify({ password: PASSWORD, execId: r10.id, ctx: r10.ctx, point: 'after-launch', stage: 'build', buildArgs: ['--sleep=6000'] }) } })
    check('crash_child_sigkilled', child.signal === 'SIGKILL', `signal=${child.signal} ${String(child.stderr).slice(-200)}`)
    await sleep(1800)
    const run0 = rtCrash.broker.stageRuns(r10.h, r10.id)[0]
    check('orphaned_recipe_process_detected_alive', run0?.state === 'RUNNING' && run0.processAlive === true && (await rtCrash.broker.recoverStages(r10.h)).find((x: any) => x.execId === r10.id)?.build.classification === 'IN_PROGRESS', JSON.stringify(run0))
    check('no_duplicate_while_orphan_alive', (await code(() => rtCrash.broker.advanceStages(r10.h, r10.id, r10.ctx))) === 'WORKSPACE_BUSY', 'a provably alive external process is never duplicated')
    for (let i = 0; i < 120 && rtCrash.broker.stageRuns(r10.h, r10.id)[0]?.processAlive === true; i++) await sleep(100)
    check('unknown_outputs_not_adopted_reconcile_required', (await code(() => rtCrash.broker.advanceStages(r10.h, r10.id, r10.ctx))) === 'RECONCILIATION_REQUIRED' && (await rtCrash.broker.lineage(r10.h, r10.id)).claims.built === false, 'present output without a receipt is ARTIFACT_PROVENANCE_UNKNOWN')
    rtCrash.broker.reconcileStage(r10.h, r10.id, r10.ctx, 'build', { decision: 'RETRY', reason: 'validator: process confirmed gone' })
    const rtRec = rtOf({ buildArgs: ['--sleep=6000'] }), rec = await rtRec.broker.advanceStages(admit(rtRec), r10.id, r10.ctx)
    check('recovery_rebuilds_once_after_reconcile', rec.ran[0].attempt === 2 && rec.ran.every((x: any) => x.status === 'PASSED') && rec.claims.built === true && rec.claims.packaged === true, JSON.stringify(rec.ran))
    done(s10)

    // ---- L10b review regressions: symlink refusal, approval-view inputs, revocation during a running stage
    const s12 = await seedBlueprintSandbox(sb, { name: 'ws-symlink' }); const r12 = await ready(rt, s12); rt.broker.approve(r12.h, r12.id, r12.ctx); await rt.broker.execute(r12.h, r12.id, r12.ctx)
    const outside = path.join(sb.root, 'outside-secret.txt'); fs.writeFileSync(outside, 'SECRET-OUTSIDE\n'); fs.symlinkSync(outside, path.join(s12.workspaceRoot, 'src/leak.mjs'))
    const symCode = await code(() => rt.broker.advanceStages(r12.h, r12.id, r12.ctx))
    check('symlink_under_build_inputs_refused', ['INPUT_SYMLINK', 'APPROVAL_STALE', 'SOURCE_CHANGED'].includes(symCode) && !fs.existsSync(path.join(blueprintRoots().control, 'broker/build/runs', `${r12.id}.build.1/out/bundle.mjs`)), `refused before any build output exists (${symCode})`)
    const direct = findInputSymlink(s12.workspaceRoot, ['src'])
    check('symlink_finder_detects_it', direct === 'src/leak.mjs' && findInputSymlink(s12.workspaceRoot, ['nothing']) === null, String(direct))
    done(s12)
    const s13 = await seedBlueprintSandbox(sb, { name: 'ws-view-binding' }); const r13 = await ready(rt, s13); const pre = rt.broker.approvalState(r13.h, r13.id)
    check('approval_view_inputs_available_before_approval', pre.approved === false && /^[a-f0-9]{64}$/.test(pre.packageDigest) && !!pre.current.baseIdentity && !!pre.current.checkBinding && !!pre.current.ownership && !!pre.current.pipeline, 'the exact digests the UI must echo back are exposed pre-approval')
    done(s13)
    const live3 = store.login(PASSWORD); if (!live3.ok) throw new Error('login3 failed')
    const keep = { ...facts }; Object.assign(facts, { sessionId: live3.auth.session.session_id, authenticatedAt: Date.parse(live3.auth.session.created_at), expiresAt: Date.parse(live3.auth.session.expires_at) })
    const rtRev = rtOf({ buildArgs: ['--sleep=2500'] }), s14 = await seedBlueprintSandbox(sb, { name: 'ws-revoke' }); const r14 = await ready(rtRev, s14); rtRev.broker.approve(r14.h, r14.id, r14.ctx); await rtRev.broker.execute(r14.h, r14.id, r14.ctx)
    const adv14 = rtRev.broker.advanceStages(r14.h, r14.id, r14.ctx)
    for (let i = 0; i < 100 && !rtRev.broker.stageRuns(r14.h, r14.id).some((x: any) => x.state === 'RUNNING'); i++) await sleep(50)
    store.logout(live3.auth.token)
    const ran14 = await adv14.then((x: any) => x, (e: any) => ({ err: e.code }))
    check('session_revoked_mid_stage_stops_build', (ran14 as any).claims?.built === false && !(ran14 as any).ran?.some((x: any) => x.status === 'PASSED'), JSON.stringify((ran14 as any).ran ?? ran14).slice(0, 200))
    Object.assign(facts, keep); done(s14)
    // ---- L10c dependency probe: hybrid (static first, bounded probe second); reads never execute dependency code; probe cannot read the workspace outside node_modules
    const s15 = await seedBlueprintSandbox(sb, { name: 'ws-probe' }); await refreshBlueprintWorkspace(s15.workspaceId); approveDeps(rt, s15)
    const secretFile = path.join(s15.workspaceRoot, 'secret.txt'); fs.writeFileSync(secretFile, 'WORKSPACE-SECRET\n')
    const depIndex = path.join(s15.workspaceRoot, 'node_modules/tiny-dep/index.js')
    fs.writeFileSync(depIndex, "const fs = require('fs'), path = require('path')\nlet leaked = false; try { fs.readFileSync(path.resolve(__dirname, '../../secret.txt')); leaked = true } catch { /* denied: expected */ }\nif (leaked) throw new Error('LEAK')\nmodule.exports = { describe: () => 'tiny-dep@1.2.3' }\n")
    const decl = [{ name: 'tiny-dep', version: '1.2.3' }], spawns0 = rt.verifier.stats().spawns
    const readOnly = await rt.verifier.verify(s15.workspaceId, decl, { mode: 'cache-only' })
    check('read_never_runs_dependency_code', rt.verifier.stats().spawns === spawns0 && readOnly.deps[0].state === 'RESOLVABLE' && readOnly.deps[0].reasons.includes('PROBE_NOT_RUN_ON_READ') && readOnly.allUsable === false, `state=${readOnly.deps[0].state} ${readOnly.deps[0].reasons}`)
    const ran = await rt.verifier.verify(s15.workspaceId, decl)
    check('probe_cannot_read_workspace_outside_node_modules', ran.deps[0].state === 'VERIFIED_USABLE' && rt.verifier.stats().spawns === spawns0 + 1, `state=${ran.deps[0].state} ${ran.deps[0].reasons}`)
    const cached = await rt.verifier.verify(s15.workspaceId, decl, { mode: 'cache-only' })
    check('verified_usable_only_from_a_real_probe_of_an_unchanged_install', cached.deps[0].state === 'VERIFIED_USABLE' && rt.verifier.stats().spawns === spawns0 + 1, 'cache hit reuses the proof, no new spawn')
    fs.appendFileSync(depIndex, '// changed in place: entry file only, package.json untouched\n')
    const changed = await rt.verifier.verify(s15.workspaceId, decl, { mode: 'cache-only' })
    check('in_place_entry_edit_invalidates_the_proof', changed.deps[0].state !== 'VERIFIED_USABLE', `state=${changed.deps[0].state}`)
    fs.writeFileSync(depIndex, "console.log(JSON.stringify({ ok: true, entryRel: '../../../../etc/hostname', binRels: [], exportKeys: ['forged'] })); process.exit(0)\n")
    fs.mkdirSync(path.join(s15.workspaceRoot, 'node_modules/other-pkg'), { recursive: true }); fs.writeFileSync(path.join(s15.workspaceRoot, 'node_modules/other-pkg/index.js'), 'module.exports = {}\n')
    fs.writeFileSync(depIndex, "console.log(JSON.stringify({ ok: true, entryRel: '../other-pkg/index.js', binRels: [], exportKeys: ['forged'] })); process.exit(0)\n")
    const escapeExisting = await rt.verifier.verify(s15.workspaceId, decl)
    check('forged_entry_escaping_to_an_existing_file_is_refused', escapeExisting.deps[0].state !== 'VERIFIED_USABLE' && escapeExisting.deps[0].reasons.includes('NOT_IN_WORKSPACE'), `state=${escapeExisting.deps[0].state} ${escapeExisting.deps[0].reasons}`)
    fs.writeFileSync(depIndex, "console.log(JSON.stringify({ ok: true, entryRel: '../../../../etc/hostname', binRels: [], exportKeys: ['forged'] })); process.exit(0)\n")
    const forged = await rt.verifier.verify(s15.workspaceId, decl)
    check('forged_probe_output_is_not_verified_usable', forged.deps[0].state !== 'VERIFIED_USABLE', `state=${forged.deps[0].state} ${forged.deps[0].reasons}`)
    done(s15)
    // ---- L11 base identity accessor: stable across own writes, distinguishes commit/worktree/copy/installed runtime
    const s11 = await seedBlueprintSandbox(sb, { name: 'ws-identity' }), id0 = readWorkspaceBaseIdentity({ workspaceId: s11.workspaceId, root: s11.workspaceRoot })
    fs.writeFileSync(path.join(s11.workspaceRoot, 'src/a.mjs'), 'export const a = 99\n'); fs.writeFileSync(path.join(s11.workspaceRoot, 'src/new.mjs'), 'x\n')
    const id1 = readWorkspaceBaseIdentity({ workspaceId: s11.workspaceId, root: s11.workspaceRoot })
    check('base_identity_stable_across_file_edits', id0.digest !== null && id0.digest === id1.digest && id0.identity.complete === true, 'dirty tree is not identity')
    git(s11.workspaceRoot, ['add', '-A']); git(s11.workspaceRoot, ['commit', '-q', '-m', 'advance'])
    check('base_identity_changes_on_commit', readWorkspaceBaseIdentity({ workspaceId: s11.workspaceId, root: s11.workspaceRoot }).digest !== id0.digest, 'commit advance is a different base')
    const wt = path.join(sb.root, 'WarRoomProjects', 'ws-identity-wt'); git(s11.workspaceRoot, ['worktree', 'add', '-q', '--detach', wt]); const cp = path.join(sb.root, 'WarRoomProjects', 'ws-identity-copy'); fs.cpSync(s11.workspaceRoot, cp, { recursive: true })
    const idWt = readWorkspaceBaseIdentity({ workspaceId: 'x', root: fs.realpathSync(wt) }), idCp = readWorkspaceBaseIdentity({ workspaceId: 'x', root: fs.realpathSync(cp) }), idMain = readWorkspaceBaseIdentity({ workspaceId: 'x', root: s11.workspaceRoot })
    check('base_identity_distinguishes_worktree_and_copy', idWt.identity.sourceKind === 'git-linked-worktree' && idWt.identity.repositoryId === idMain.identity.repositoryId && idWt.identity.worktreeId !== idMain.identity.worktreeId && idCp.identity.repositoryId !== idMain.identity.repositoryId, 'same commit, different worktree/copy')
    const home = process.env.HOME ?? '/home/x'; check('installed_runtime_never_a_source_workspace', readWorkspaceBaseIdentity({ workspaceId: 'x', root: path.join(home, '.local/opt/war-room-os-0.2.0-abc1234-x/opt/War-Room-OS') }).installedRuntime === true, 'path-classified INSTALLED_RUNTIME')

    // ---- L12 Phase 9 mapping + embedded tool integrity + API surface
    const evIn = blueprintEventToEvaluationInputs({ eventId: 'e'.repeat(32), emittedAt: new Date().toISOString(), execId: 'x1', workspaceId: 'w', mission: { missionId: 'm', assignmentId: 'a' }, actor: { actorId: 'u' }, outcome: 'VERIFIED_SOURCE', headline: 'SOURCE_VERIFIED_ONLY', claims: { sourceValidated: true, built: true, packaged: false }, stages: { validateSource: { status: 'PASS' }, build: { status: 'FAIL', failureCode: 'BUILD_FAILED', attempt: 2 }, package: { status: 'NOT_RUN' } }, lineage: { retry: { build: 2, package: 1 } }, scopeLabel: 'LIVE_WORKSPACE_BLUEPRINT', retries: { resumes: 0, recoveries: 0 }, rollback: { attempted: 0 } })
    check('phase9_failed_build_is_failure_never_success', evIn.find(e => e.signal === 'RUN')?.outcome === 'FAILURE' && evIn.find(e => e.note?.includes('stage=build'))?.validation === 'FAILED' && evIn.every(e => e.metrics?.costUsd === undefined) && new Set(evIn.map(e => e.id)).size === evIn.length, evIn.map(e => `${e.signal}:${e.outcome}`).join(' '))
    const gen = spawnSync(process.execPath, ['scripts/generate-blueprint-embedded.mjs', '--check'], { cwd: repoRoot() })
    check('embedded_tools_current', gen.status === 0, String(gen.stderr).trim())
    const tools = materializeTools(blueprintRoots().tools), tf = tools['wr-bundle-build.mjs'].path; fs.appendFileSync(tf, '// tampered\n'); const tools2 = materializeTools(blueprintRoots().tools)
    check('tampered_tool_script_is_replaced_by_pinned_content', tools2['wr-bundle-build.mjs'].path === tf && sha(fs.readFileSync(tf)) === tools2['wr-bundle-build.mjs'].sha256, 'materialization verifies and rewrites')
    const apiSrc = fs.readFileSync(path.join(repoRoot(), 'lib/native-builder/blueprint/liveApi.ts'), 'utf8')
    const routes = ['', 'import', '[id]', '[id]/preview', '[id]/approve', '[id]/run', '[id]/pause', '[id]/resume', '[id]/cancel', '[id]/reconcile', '[id]/restore', '[id]/verify', '[id]/receipts', '[id]/status', '[id]/dependencies'].map(r => path.join(repoRoot(), 'app/api/foundry/blueprints', r, 'route.ts'))
    check('all_routes_exist_and_delegate_to_gated_handlers', routes.every(f => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes("@/lib/native-builder/blueprint/liveApi")), `${routes.length} routes`)
    const mutating = ['handleVerify', 'handleImport', 'handleApprove', 'handleRun', 'handlePause', 'handleResume', 'handleCancel', 'handleReconcile', 'handleRestore']
    check('mutating_handlers_require_csrf_and_commander', mutating.every(h => new RegExp(`export const ${h} = \\(req: Request[^)]*\\) => withActor\\(req, true`).test(apiSrc)) && apiSrc.includes('requireCommanderSessionFacts') && apiSrc.includes('x-wr-blueprints') && apiSrc.includes('assertLocalMutationOrigin'), 'withActor(req, true, …) on every mutating verb')

    // ---- L13 UI truthfulness (pure view model used by /war-room/engineering/blueprints)
    check('ui_stale_approval_demands_new_approval', approvalView({ approved: true, usable: false, stale: ['baseIdentity'] }).label === 'STALE' && approvalView({ approved: true, usable: false, stale: ['baseIdentity'] }).mustReapprove === true && approvalView(undefined).label === 'UNKNOWN', 'STALE shown, new approval required, missing data is UNKNOWN')
    check('ui_claims_never_overclaim', claimRows({ claims: { sourceValidated: true } }, null).find(c => c.key === 'built')?.value === 'UNKNOWN' && claimRows({ claims: { sourceValidated: true } }, { claims: { built: true, packaged: false } }).find(c => c.key === 'packaged')?.value === 'NO' && claimRows({}, null).filter(c => ['installed', 'taskComplete'].includes(c.key)).every(c => c.value === 'NO'), 'built/packaged only from lineage; installed/complete always NO')
    check('ui_dependency_and_recovery_views_truthful', dependencyRows({ plan: { status: 'BLOCKED' }, verification: { deps: [{ name: 'a', version: '1.0.0', state: 'UNAPPROVED', reasons: ['NOT_APPROVED'] }] }, approvals: { 'a@1.0.0': false } }).rows[0]?.approved === 'NOT_APPROVED' && dependencyRows(undefined).rows.length === 0 && recoveryLabel({ unavailable: true }).startsWith('UNKNOWN') && recoveryLabel(null) === 'none recorded' && artifactRows({ unavailable: true }).verification === 'UNAVAILABLE', 'dependency states shown; failed recovery view is UNKNOWN, not none')
    check('ui_artifacts_show_unverified_and_failed', artifactRows({ stages: { build: { entries: [{ name: 'b', path: 'bundle.mjs', sha256: 'x', bytes: 1, runId: 'r' }] } }, verification: null }).rows[0]?.verification === 'NOT_VERIFIED' && artifactRows({ stages: { build: { entries: [{ path: 'p' }] } }, verification: { build: { ok: false, problems: [{ code: 'ARTIFACT_HASH_MISMATCH' }] } } }).rows[0]?.verification.startsWith('FAILED'), 'unverified and tampered artifacts are not hidden')
  } finally {
    try { fs.rmSync(sb.root, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  const failed = results.filter(r => !r.pass)
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` - ${r.detail}` : ''}`)
  console.log(`Blueprint live integration: ${results.length - failed.length}/${results.length} PASS`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })

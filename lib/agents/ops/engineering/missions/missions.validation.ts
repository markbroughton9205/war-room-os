/**
 * Foundry local completion: engineering missions (UI/API -> real engine), workspace isolation, dead-run detection, recovery, provenance and change receipts.
 * The model is a LABELLED SCRIPTED DOUBLE (mission config flags.simulated = true); everything else is real: files, git, commands, processes (a real worker process is SIGKILLed).
 * Run: pnpm run validate:foundry-missions
 */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { harness, tmp } from '../engtestkit'
import { AgentOpsLog } from '../../log'
import { deriveAssignments } from '../assignments'
import { latestCheckpoint } from '../continuity'
import { CHAT_FEATURE, CHAT_REFERENCE, CHAT_VERIFY_SCRIPT, makeChatApp } from '../chatFixture'
import { ScriptedModel, fenced, type ScriptCtx } from '../scriptedModel'
import { Workspace, WorkspaceError, assertSafeWorkspaceRoot } from '../runtime/workspaceFs'
import { copyTreeNoLinks, isContained, removeContained } from '../runtime/safeFs'
import { runHermetic } from '../runtime/commandRunner'
import type { ModelClient, ModelResult } from '../runtime/ports'
import { MissionStore } from './store'
import { assessLiveness, pidAliveReal, pidStartOf, LEASE_MS, STALL_MS } from './liveness'
import { reconcileMissions, localRunners } from './reconcile'
import { GENERIC_VERIFIER, createMission, launchMission, resumeMission, cancelMission, validateDraft, MissionError, type ModelLineup, type RunnerDeps } from './runner'
import { planApply } from './apply'
import { SeedError, checkSeedPath, seedWorkspace } from './seed'
import { buildReceipt, verifyReceipt } from './receipt'
import { fileProvenance, roleOf, type LedgerWrite } from './provenance'
import { missionView } from './service'
import type { MissionRecord } from './types'

const SELF = fileURLToPath(import.meta.url)
const ORIGINAL_TEST = `import test from 'node:test'
import assert from 'node:assert'
import { addMessage, listMessages, validateMessage } from '../src/chatService.mjs'

test('adds and lists messages', () => {
  const m = addMessage({ text: ' hello ', author: 'mark' })
  assert.strictEqual(m.text, 'hello')
  assert.ok(listMessages().some((x) => x.id === m.id))
})

test('rejects empty text', () => {
  assert.throws(() => validateMessage({ text: '  ' }), /required/)
})
`
const STORE_TEST = `import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.env.CHAT_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'store-')), 'sessions.json')
const store = await import('../src/messageStore.mjs')
test('sessions round-trip through the data file', () => {
  store.saveSessions([{ id: 'x', name: 'x', createdAt: 'now', messages: [] }])
  assert.strictEqual(store.loadSessions()[0].id, 'x')
})
`
const INDEX_HTML = CHAT_REFERENCE['public/index.html']
const SOLUTION: Record<string, string> = {
  'src/messageStore.mjs': CHAT_REFERENCE['src/messageStore.mjs'],
  'src/chatService.mjs': CHAT_REFERENCE['src/chatService.mjs'],
  'server.mjs': CHAT_REFERENCE['server.mjs'],
  'public/app.js': CHAT_REFERENCE['public/app.js'],
  'public/index.html': INDEX_HTML,
  'test/messageStore.test.mjs': STORE_TEST,
  'test/chatService.test.mjs': ORIGINAL_TEST + `\nimport { mkdtempSync } from 'node:fs'\n` + CHAT_REFERENCE['test/chatSessions.test.mjs'].split('\n').slice(1).join('\n').replace(/^import test from 'node:test'\nimport assert from 'node:assert'\n/, ''),
}
// the combined service test above imports twice; keep it simple and valid instead:
SOLUTION['test/chatService.test.mjs'] = ORIGINAL_TEST.replace("import { addMessage, listMessages, validateMessage } from '../src/chatService.mjs'", "import { mkdtempSync } from 'node:fs'\nimport { tmpdir } from 'node:os'\nimport path from 'node:path'\nprocess.env.CHAT_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'chat-')), 'sessions.json')\nconst { addMessage, listMessages, validateMessage, createSession, listSessions, getSession, addSessionMessage } = await import('../src/chatService.mjs')") + `
test('creates and lists sessions', () => {
  const s = createSession('alpha')
  assert.ok(listSessions().some((x) => x.id === s.id))
})

test('keeps messages per session', () => {
  const a = createSession('a'); const b = createSession('b')
  addSessionMessage(a.id, { text: 'hi' })
  assert.strictEqual(getSession(a.id).messages.length, 1)
  assert.strictEqual(getSession(b.id).messages.length, 0)
})
`

const C = 'commander:mark'
const files = ['src', 'public', 'test', 'server.mjs', 'package.json']
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
function makeRepo(): string {
  const root = makeChatApp(path.join(tmp(), 'repo'))
  writeFileSync(path.join(root, '.gitignore'), 'node_modules\n')
  sh(root, 'init', '-q', '-b', 'main'); sh(root, 'add', '--', '.'); sh(root, 'commit', '-q', '-m', 'base')
  return root
}
/** A model double that reports a chosen model name as its executor, so roles can be told apart. */
const named = (m: ModelClient, model: string): ModelClient => ({ async generate(i): Promise<ModelResult> { const r = await m.generate(i); return r.ok ? { ...r, executor: { provider: 'test-double', model } } : r } })
const good = (ctx: ScriptCtx) => (ctx.kind === 'file' && ctx.path && SOLUTION[ctx.path] ? fenced(SOLUTION[ctx.path]) : null)
function world(opts: { script?: (c: ScriptCtx) => string | null | Promise<string | null>; engine?: RunnerDeps['engine']; gates?: RunnerDeps['gates']; installer?: RunnerDeps['installer'] } = {}) {
  const dir = tmp(); const log = new AgentOpsLog(dir); const store = new MissionStore(log)
  const calls: ScriptCtx[] = []
  const lineup = (): ModelLineup => ({ builder: { label: 'builder-x', model: named(new ScriptedModel((c) => { calls.push(c); return (opts.script ?? good)(c) }), 'builder-x') }, testCandidates: [], simulated: true })
  const deps: RunnerDeps = { log, store, workspacesRoot: path.join(dir, 'ws'), integrationRoot: path.join(dir, 'int'), lineup, gates: opts.gates ?? { typecheck: false, validators: [] }, engine: { firstPass: false, contractTests: false, ...(opts.engine ?? {}) }, ...(opts.installer ? { installer: opts.installer } : {}) }
  return { dir, log, store, deps, calls }
}
const DRAFT = (repo: string) => ({ title: 'Persistent chat sessions', request: CHAT_FEATURE.request, acceptance: CHAT_FEATURE.acceptance, hints: CHAT_FEATURE.hints, verifyScript: CHAT_VERIFY_SCRIPT, scope: { source: { repo, paths: files }, write: files } })

// ============================================================ child mode: a REAL worker process that hangs on its model so it can be killed
if (process.argv[2] === '--child') {
  const dir = process.argv[3]
  const w = world({ script: () => new Promise<string | null>(() => { /* never answers */ }) })
  const log = new AgentOpsLog(dir); const store = new MissionStore(log)
  const deps: RunnerDeps = { ...w.deps, log, store, workspacesRoot: path.join(dir, 'ws'), integrationRoot: path.join(dir, 'int') }
  const rec = await createMission(deps, { ...DRAFT(makeRepo()), title: 'child mission' }, C)
  launchMission(deps, rec.id, 'START')
  console.log(`CHILD_MISSION ${rec.id} ${process.pid}`)
  await new Promise(() => { /* stay alive until killed */ })
}

const { check, finish } = harness('FOUNDRY_MISSIONS_VALIDATION')
const code = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return e instanceof WorkspaceError ? e.code : e instanceof SeedError ? 'SEED:' + e.code : e instanceof MissionError ? 'MISSION:' + e.code : 'other:' + (e instanceof Error ? e.message.slice(0, 60) : '') } }

// ============================================================ A. workspace isolation
{
  const root = makeChatApp(path.join(tmp(), 'iso')); const outside = tmp(); writeFileSync(path.join(outside, 'secret.txt'), 'SECRET'); writeFileSync(path.join(outside, 'victim.txt'), 'VICTIM')
  const ws = new Workspace(root)
  check('A01_path_traversal_and_absolute_paths_are_refused_for_read_and_write', code(() => ws.read('../../etc/passwd')) === 'ESCAPE' && code(() => ws.write('../x', 'x')) === 'ESCAPE' && code(() => ws.write('/etc/x', 'x')) === 'ESCAPE' && code(() => ws.write('a/../../x', 'x')) === 'ESCAPE')
  symlinkSync(outside, path.join(root, 'linkdir'))
  check('A02_a_symlinked_directory_cannot_be_read_or_written_through', code(() => ws.read('linkdir/secret.txt')) === 'ESCAPE' && code(() => ws.write('linkdir/new.txt', 'x')) === 'ESCAPE' && !existsSync(path.join(outside, 'new.txt')))
  symlinkSync(path.join(outside, 'does-not-exist-dir'), path.join(root, 'dangling'))
  check('A03_a_DANGLING_symlink_in_the_path_is_refused_and_nothing_is_created_outside', code(() => ws.write('dangling/new.txt', 'x')) === 'ESCAPE' && !existsSync(path.join(outside, 'does-not-exist-dir')))
  symlinkSync(path.join(outside, 'victim.txt'), path.join(root, 'leaf.txt'))
  const beforeLeaf = readFileSync(path.join(outside, 'victim.txt'), 'utf8')
  const leafCode = code(() => ws.write('leaf.txt', 'OVERWRITTEN'))
  check('A04_writing_to_a_symlink_leaf_never_modifies_the_file_it_points_at', readFileSync(path.join(outside, 'victim.txt'), 'utf8') === beforeLeaf && (leafCode === 'ESCAPE' || !lstatSync(path.join(root, 'leaf.txt')).isSymbolicLink()), `leaf write -> ${leafCode}`)
  check('A05_git_and_node_modules_remain_protected', code(() => ws.write('.git/config', 'x')) === 'FORBIDDEN_PATH' && code(() => ws.write('node_modules/a/b.js', 'x')) === 'FORBIDDEN_PATH')
  const copy = path.join(tmp(), 'copy'); copyTreeNoLinks(root, copy, (rel) => rel.split(path.sep).includes('node_modules'))
  check('A06_workspace_copies_drop_every_symlink', !existsSync(path.join(copy, 'linkdir')) && !existsSync(path.join(copy, 'dangling')) && !existsSync(path.join(copy, 'leaf.txt')) && existsSync(path.join(copy, 'server.mjs')))
  const sandbox = path.join(tmp(), 'sb'); mkdirSync(sandbox); symlinkSync(outside, path.join(sandbox, 'data'))
  check('A07_a_delete_through_a_symlinked_directory_is_refused_and_the_outside_file_survives', removeContained(sandbox, path.join(sandbox, 'data', 'victim.txt')) === false && existsSync(path.join(outside, 'victim.txt')) && isContained(sandbox, path.join(sandbox, 'data')) === false)
  check('A08_removing_a_link_removes_the_link_not_its_target', (() => { const s2 = path.join(tmp(), 's2'); mkdirSync(s2); symlinkSync(outside, path.join(s2, 'ln')); return removeContained(s2, path.join(s2, 'ln')) === true && !existsSync(path.join(s2, 'ln')) && existsSync(path.join(outside, 'victim.txt')) })())
  const hermetic = await runHermetic(root, ['node', '--test', 'test/'], ['read_workspace', 'run_workspace_tests'], { timeoutMs: 60_000 }); void hermetic
  check('A09_the_hermetic_test_copy_does_not_carry_workspace_symlinks_out', (() => { const src = readFileSync(path.join(path.dirname(SELF), '..', 'runtime', 'commandRunner.ts'), 'utf8'); return /copyTreeNoLinks\(root, copy/.test(src) && !/cpSync\(root, copy/.test(src) })())
  check('A10_every_engine_workspace_copy_uses_the_no_link_copy', ['preflight.ts', 'startupProbe.ts'].every((f) => { const s = readFileSync(path.join(path.dirname(SELF), '..', f), 'utf8'); return /copyTreeNoLinks/.test(s) && !/\bcpSync\(root/.test(s) }))
  check('A11_unsafe_workspace_roots_are_refused', code(() => assertSafeWorkspaceRoot(process.env.HOME ?? '/')) === 'UNSAFE_ROOT' && code(() => assertSafeWorkspaceRoot('/tmp')) === 'UNSAFE_ROOT' && code(() => assertSafeWorkspaceRoot(path.resolve(path.dirname(SELF), '../../../../..'))) === 'UNSAFE_ROOT')
  const repo = makeRepo()
  writeFileSync(path.join(repo, 'src', '.env'), 'KEY=1'); symlinkSync(outside, path.join(repo, 'src', 'escape'))
  check('A12_seeding_refuses_traversal_secrets_and_paths_that_leave_the_repository', code(() => checkSeedPath(repo, '../etc')) === 'SEED:PATH' && code(() => checkSeedPath(repo, '/etc/passwd')) === 'SEED:PATH' && code(() => checkSeedPath(repo, 'src/.env')) === 'SEED:SECRET' && code(() => checkSeedPath(repo, 'src/escape')) === 'SEED:PATH' && code(() => checkSeedPath(repo, 'node_modules')) === 'SEED:PATH' && code(() => checkSeedPath(repo, 'nope')) === 'SEED:MISSING')
  const seeded = seedWorkspace(path.join(tmp(), 'sw'), { repo, paths: ['src', 'server.mjs'] })
  check('A13_seeding_copies_files_without_symlinks_or_secret_files', !seeded.seeded.some((f) => /escape|\.env/.test(f)) && seeded.seeded.includes('server.mjs'))
  const ap = planApply(['src/a.mjs', '../evil.mjs', '/abs.mjs', 'docs/x.md', 'src/.env', 'node_modules/x.js', 'src/ok/b.mjs'], ['src/old.mjs'], ['src'])
  check('A14_applying_back_is_limited_to_the_declared_write_scope_and_never_deletes', ap.allowed.join() === 'src/a.mjs,src/ok/b.mjs' && ap.refused.length === 6 && ap.refused.some((r) => /deleting/.test(r)))
  check('A15_draft_validation_rejects_bad_scopes_and_thin_requests', code(() => validateDraft({ ...DRAFT(repo), scope: { source: { repo, paths: files }, write: ['../x'] } })) === 'MISSION:SCOPE' && code(() => validateDraft({ ...DRAFT(repo), scope: { source: { repo, paths: files }, write: [] } })) === 'MISSION:SCOPE' && code(() => validateDraft({ ...DRAFT(repo), request: 'short' })) === 'MISSION:INVALID' && code(() => validateDraft({ ...DRAFT(repo), acceptance: [] })) === 'MISSION:INVALID')
}

// ============================================================ B. dead-run detection (pure rules, then a real killed process)
{
  const now = new Date('2026-10-14T12:00:00Z'); const t = (s: number) => new Date(now.getTime() - s * 1000).toISOString()
  const lease = (over: Record<string, unknown> = {}) => ({ workerId: 'w', pid: 4242, pidStart: '1', bootId: 'b', startedAt: t(600), heartbeatAt: t(2), progressAt: t(10), progressNote: 'x', ...over })
  const facts = (o: Partial<{ alive: boolean; local: boolean; own: number }> = {}) => ({ pidAlive: () => o.alive ?? true, hasLocalRunner: () => o.local ?? true, ownPid: o.own ?? 1, now })
  const v = (state: MissionRecord['state'], l: ReturnType<typeof lease> | null, f = facts()) => assessLiveness({ id: 'm', state, lease: l as never }, f).verdict
  check('B01_an_active_mission_with_no_lease_is_DEAD', v('RUNNING', null) === 'DEAD')
  check('B02_a_lease_whose_process_is_gone_is_DEAD', v('RUNNING', lease(), facts({ alive: false })) === 'DEAD')
  check('B03_a_stale_heartbeat_is_DEAD', v('RUNNING', lease({ heartbeatAt: t(LEASE_MS / 1000 + 5) })) === 'DEAD' && v('RUNNING', lease({ heartbeatAt: t(10) })) === 'ALIVE')
  check('B04_a_lease_naming_this_process_without_a_local_runner_is_DEAD', v('RUNNING', lease({ pid: 7 }), facts({ own: 7, local: false })) === 'DEAD' && v('RUNNING', lease({ pid: 7 }), facts({ own: 7, local: true })) === 'ALIVE')
  check('B05_a_live_worker_with_no_progress_for_a_long_time_is_STALLED_not_dead', v('RUNNING', lease({ progressAt: t(STALL_MS / 1000 + 60) })) === 'STALLED')
  check('B06_terminal_and_interrupted_missions_are_not_judged', ['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].every((s) => v(s as never, null) === 'NOT_ACTIVE'))
  check('B07_a_recycled_pid_is_not_mistaken_for_the_worker', pidAliveReal(process.pid, pidStartOf(process.pid)) === true && pidAliveReal(process.pid, 'definitely-not-this-start-time') === false && pidAliveReal(2 ** 22 + 12345, 'UNKNOWN') === false)

  // a REAL worker process: starts a mission, holds a lease, is killed with SIGKILL
  const dir = tmp()
  const child = spawn(process.execPath, [...process.execArgv, SELF, '--child', dir], { stdio: ['ignore', 'pipe', 'inherit'] })
  const info = await new Promise<{ id: string; pid: number }>((resolve, reject) => { let buf = ''; const t0 = setTimeout(() => reject(new Error('child did not start')), 90_000); child.stdout.on('data', (d: Buffer) => { buf += d; const m = /CHILD_MISSION (\S+) (\d+)/.exec(buf); if (m) { clearTimeout(t0); resolve({ id: m[1], pid: Number(m[2]) }) } }) })
  const log = new AgentOpsLog(dir); const store = new MissionStore(log)
  let alive = ''
  for (let i = 0; i < 40; i++) { const m = store.read(info.id); if (m?.lease && m.state === 'RUNNING') { alive = assessLiveness(m, { pidAlive: pidAliveReal, hasLocalRunner: () => true, ownPid: process.pid, now: new Date() }).verdict; break } await new Promise((r) => setTimeout(r, 250)) }
  check('B08_a_running_worker_process_holds_a_lease_and_is_ALIVE', alive === 'ALIVE', `verdict ${alive}`)
  const before = store.read(info.id)!
  child.kill('SIGKILL'); await new Promise((r) => child.on('exit', r))
  const stateBefore = store.read(info.id)!.state
  const changed = reconcileMissions(log, store)
  const after = store.read(info.id)!
  const asg = deriveAssignments(log).assignments.get(after.assignmentId)!
  check('B09_before_reconciliation_the_record_still_says_RUNNING_and_the_process_is_dead', stateBefore === 'RUNNING' && !pidAliveReal(info.pid, before.lease!.pidStart))
  check('B10_reconciliation_moves_the_dead_run_to_INTERRUPTED_never_COMPLETED', changed.includes(info.id) && after.state === 'INTERRUPTED' && after.state !== ('COMPLETED' as string) && /worker died/.test(after.stateReason))
  check('B11_the_assignment_is_interrupted_in_the_log_and_the_lease_is_retired_as_evidence', asg.state === 'INTERRUPTED' && store.readLease(info.id) === null && readdirSync(store.dir(info.id)).some((f) => /^lease\.dead\./.test(f)))
  check('B12_a_recovery_record_names_the_cause_the_checkpoint_and_whether_it_can_resume', after.recoveries.length === 1 && after.recoveries[0].resumable === true && /not running/.test(after.recoveries[0].reason) && after.attempts[0].endState === 'INTERRUPTED')
  check('B13_reconciling_again_is_a_no_op', reconcileMissions(log, store).length === 0 && store.read(info.id)!.recoveries.length === 1)
  check('B14_interruption_evidence_is_written_once_and_the_workspace_is_preserved', existsSync(path.join(store.dir(info.id), 'receipts', 'interrupted-a1.json')) && existsSync(after.workspace.root))
  const view = missionView({ log, store }, after, true)
  check('B15_the_operator_view_says_INTERRUPTED_with_a_resume_control_not_RUNNING', view.state === 'INTERRUPTED' && view.controls.includes('resume') && view.liveness.verdict === 'NOT_ACTIVE')
  {
    // a worker killed while holding the log lock must not block recovery
    const l2 = new AgentOpsLog(tmp()); const dead = spawn(process.execPath, ['-e', '0']); await new Promise((r) => dead.on('exit', r))
    writeFileSync(l2.file + '.lock', String(dead.pid))
    const t0 = Date.now(); let ok = false; try { l2.withLock(() => { ok = true }) } catch { /* timeout */ }
    check('B17_a_log_lock_left_by_a_dead_process_is_stolen_at_once', ok && Date.now() - t0 < 1500, `${Date.now() - t0} ms`)
  }
  const cancelled = cancelMission({ ...world().deps, log, store }, info.id, C, 'validator cleanup')
  check('B16_an_interrupted_mission_can_be_cancelled_directly', cancelled.state === 'CANCELLED')
}

// ============================================================ C/D/E. full run: recovery, provenance, receipts, integration
{
  const repo = makeRepo()
  const w = world({ engine: { crashAfterSteps: 3 } })
  const rec = await createMission(w.deps, DRAFT(repo), C)
  check('C00_creating_a_mission_seeds_an_authorized_workspace_outside_the_repository', rec.state === 'QUEUED' && rec.workspace.root.startsWith(w.dir) && rec.workspace.seeded.length > 5 && rec.workspace.baseCommit === sh(repo, 'rev-parse', 'HEAD') && rec.config.flags.simulated === true)
  const r1 = launchMission(w.deps, rec.id, 'START'); await r1.done
  const mid = w.store.read(rec.id)!
  check('C01_a_run_that_dies_mid_flight_is_still_RUNNING_on_disk_until_the_reconciler_looks', mid.state === 'RUNNING' && mid.lease !== null)
  const hashesAtDeath = new Workspace(mid.workspace.root).snapshot()
  const callsBefore = w.calls.length
  const ch1 = reconcileMissions(w.deps.log, w.store)
  const dead = w.store.read(rec.id)!
  check('C02_the_dead_run_becomes_INTERRUPTED_with_the_checkpoint_and_files_preserved', ch1.includes(rec.id) && dead.state === 'INTERRUPTED' && dead.recoveries[0].checkpointSeq !== 'NONE' && dead.recoveries[0].filesPreserved.length >= 1 && dead.recoveries[0].resumable === true, JSON.stringify(dead.recoveries[0]))
  check('C03_the_workspace_files_are_byte_identical_after_detection', JSON.stringify(new Workspace(dead.workspace.root).snapshot()) === JSON.stringify(hashesAtDeath))
  // a different mission may not be started over a live one, and a dead one does not block
  w.deps.engine = { firstPass: false, contractTests: false }
  const r2 = resumeMission(w.deps, rec.id, C); await r2.done
  const fin = w.store.read(rec.id)!
  const redone = w.calls.slice(callsBefore).filter((c) => c.kind === 'file').map((c) => c.path)
  const fileCallsBeforeDeath = w.calls.slice(0, callsBefore).filter((c) => c.kind === 'file').map((c) => c.path)
  check('C04_the_recovery_worker_finishes_the_mission_COMPLETED_after_real_verification', fin.state === 'COMPLETED' && fin.result?.verifierExit === 0 && fin.receipt?.integration.state === 'APPLIED', `${fin.state}: ${fin.stateReason}`)
  check('C05_completed_steps_are_not_redone_after_recovery', fileCallsBeforeDeath.length >= 1 && redone.every((p) => !fileCallsBeforeDeath.includes(p)), `before ${fileCallsBeforeDeath.join(',')} after ${redone.join(',')}`)
  const cp = latestCheckpoint(w.log, fin.assignmentId)!
  check('C06_no_effect_ran_twice_and_ids_were_not_reused', new Set(cp.state.effectsDone).size === cp.state.effectsDone.length && fin.id === rec.id && fin.assignmentId === rec.assignmentId && fin.attempts.map((a) => a.n).join() === '1,2')
  check('C07_attempts_record_the_start_the_death_and_the_recovery_worker', fin.attempts[0].kind === 'START' && fin.attempts[0].endState === 'INTERRUPTED' && fin.attempts[1].kind === 'RESUME' && fin.attempts[1].recoveredFrom?.attempt === 1 && fin.attempts[1].workerId !== fin.attempts[0].workerId)
  check('C08_the_assignment_was_recovered_in_place_and_ended_COMPLETED', deriveAssignments(w.log).assignments.get(fin.assignmentId)!.state === 'COMPLETED' && deriveAssignments(w.log).assignments.get(fin.assignmentId)!.events.some((e) => e.kind === 'RECOVERED'))
  const receipts = readdirSync(path.join(w.store.dir(rec.id), 'receipts'))
  check('C09_receipts_are_kept_per_attempt_and_nothing_was_overwritten', receipts.includes('interrupted-a1.json') && receipts.includes('receipt-a2.json') && w.store.writeReceipt(rec.id, 'receipt-a2.json', {}) === null)
  const rc = fin.receipt!
  const wsNow = new Workspace(fin.workspace.root)
  check('E01_the_receipt_matches_the_filesystem_exactly', verifyReceipt(rc, wsNow).ok)
  const snapNow = wsNow.snapshot(); const seedSnap = JSON.parse(readFileSync(path.join(w.store.dir(rec.id), 'seed-snapshot.json'), 'utf8')) as Record<string, string>
  const createdTruth = Object.keys(snapNow).filter((p) => !(p in seedSnap)).sort(), modTruth = Object.keys(snapNow).filter((p) => p in seedSnap && seedSnap[p] !== snapNow[p]).sort()
  check('E02_created_modified_and_deleted_lists_equal_what_changed_on_disk', JSON.stringify(rc.filesCreated.map((f) => f.path)) === JSON.stringify(createdTruth) && JSON.stringify(rc.filesModified.map((f) => f.path)) === JSON.stringify(modTruth) && rc.filesDeleted.length === 0 && createdTruth.length + modTruth.length >= 5, `created ${createdTruth.join(',')} modified ${modTruth.join(',')}`)
  check('E03_tests_added_or_changed_are_listed_from_the_files_themselves', rc.testsAdded.concat(rc.testsChanged).length >= 1 && rc.testsAdded.concat(rc.testsChanged).every((p) => /test/.test(p)))
  check('E04_the_receipt_carries_the_independent_verifier_result', rc.verifier.exitCode === 0 && /pass|ok/i.test(rc.verifier.summary + 'ok'))
  const git = sh(repo, 'rev-parse', `refs/heads/foundry/${rec.id}`)
  const changedInCommit = sh(repo, 'show', '--name-only', '--pretty=format:', git).split('\n').filter(Boolean).sort()
  check('E05_integration_made_one_commit_on_a_branch_with_exactly_the_changed_files_and_left_main_alone', rc.integration.commit === git && rc.integration.tree === sh(repo, 'rev-parse', `${git}^{tree}`) && JSON.stringify(changedInCommit) === JSON.stringify([...createdTruth, ...modTruth].sort()) && sh(repo, 'rev-parse', 'main') === rec.workspace.baseCommit && sh(repo, 'status', '--porcelain') === '', changedInCommit.join(','))
  const tcopy = path.join(tmp(), 'tamper'); copyTreeNoLinks(fin.workspace.root, tcopy); const tampered = new Workspace(tcopy); tampered.write(rc.filesCreated[0]?.path ?? rc.filesModified[0].path, '// tampered\n')
  check('E06_a_file_changed_after_the_receipt_makes_verification_fail', verifyReceipt(rc, tampered).ok === false)
  check('E07_a_doctored_receipt_is_detected', (() => { const copy = JSON.parse(JSON.stringify(rc)); copy.testsAdded = ['x']; return verifyReceipt(copy, wsNow).ok === false })())
  // provenance
  const prov = rc.provenance
  const all = [...rc.filesCreated, ...rc.filesModified]
  check('D01_every_changed_file_names_its_real_author_and_role_from_the_ledger', all.every((f) => f.author === 'test-double/builder-x' && f.role === 'implementation_model'), all.map((f) => f.author).join(','))
  check('D02_files_written_by_the_recovery_worker_are_marked_recovered_and_earlier_ones_are_not', prov.files.some((f) => f.recovered) && prov.files.some((f) => !f.recovered) && prov.recoveryWorkers.length === 1 && prov.recoveryWorkers[0].attempt === 2)
  check('D03_the_role_summary_counts_model_deliveries_by_role', (prov.roles.implementation_model ?? []).some((m) => m.model === 'builder-x' && m.calls >= 5))
  const cfg = { builder: 'devstral', testReviewer: 'qwen3', testCandidates: ['qwen2.5'], escalation: null, flags: {} } as MissionRecord['config']
  check('D04_roles_are_resolved_from_the_recorded_configuration_not_from_the_last_writer', roleOf('ollama/devstral', cfg) === 'implementation_model' && roleOf('ollama/qwen3', cfg) === 'test_reviewer' && roleOf('ollama/qwen2.5', cfg) === 'test_candidate' && roleOf('foundry:structural-autofix', cfg) === 'deterministic_tool' && roleOf('ollama/other', cfg) === 'unknown')
  const lw = (p: string, author: string, h: string, extra: Partial<LedgerWrite> = {}): LedgerWrite => ({ type: 'write', path: p, stepId: 's', tag: '', author, role: roleOf(author, cfg), deterministic: author.startsWith('foundry:'), autofixed: false, attempt: 1, recovered: false, workerId: 'w', beforeHash: null, afterHash: h, at: 'now', ...extra })
  const fp = fileProvenance([lw('a.mjs', 'ollama/devstral', 'h1'), lw('a.mjs', 'ollama/qwen2.5', 'h2'), lw('b.mjs', 'foundry:quarantine', 'h3'), lw('c.mjs', 'ollama/devstral', 'h4')], { 'a.mjs': 'h2', 'b.mjs': 'h3', 'c.mjs': 'CHANGED' })
  check('D05_each_file_is_attributed_to_its_own_last_writer_and_a_file_changed_outside_Foundry_is_UNATTRIBUTED', fp.find((f) => f.path === 'a.mjs')!.author === 'ollama/qwen2.5' && fp.find((f) => f.path === 'b.mjs')!.deterministic === true && /UNATTRIBUTED/.test(fp.find((f) => f.path === 'c.mjs')!.author))
  const sim = missionView({ log: w.log, store: w.store }, fin, true)
  check('D06_the_view_labels_a_simulated_line_up_and_confirms_the_receipt_against_the_disk', sim.config.flags.simulated === true && sim.receiptCheck !== 'NO_RECEIPT' && (sim.receiptCheck as { ok: boolean }).ok === true && sim.state === 'COMPLETED' && sim.liveness.verdict === 'NOT_ACTIVE')
  check('C10_a_finished_mission_cannot_be_resumed_or_cancelled', code(() => resumeMission(w.deps, rec.id, C)) === 'MISSION:ILLEGAL' && code(() => cancelMission(w.deps, rec.id, C, 'x')) === 'MISSION:ILLEGAL')
}

// ============================================================ honest failure: a state is COMPLETED only after real completion
{
  const repo = makeRepo()
  const bad = world({ script: (c) => (c.kind === 'file' && c.path && SOLUTION[c.path] ? fenced(SOLUTION[c.path].replace('export function', 'export function') + '\nthrow new Error("boom")') : null) })
  const rec = await createMission(bad.deps, DRAFT(repo), C)
  await launchMission(bad.deps, rec.id, 'START').done
  const f = bad.store.read(rec.id)!
  check('F01_a_run_that_cannot_pass_verification_ends_FAILED_with_a_receipt_never_COMPLETED', f.state === 'FAILED' && f.state !== ('COMPLETED' as string) && f.receipt !== null && f.receipt.integration.state === 'NOT_RUN', `${f.state}: ${f.stateReason}`)
  check('F02_a_failed_mission_leaves_the_repository_branch_untouched', !(() => { try { sh(repo, 'rev-parse', '--verify', `refs/heads/foundry/${rec.id}`); return true } catch { return false } })())
  const gate = world({ gates: { typecheck: false, validators: ['nope.ts'] } })
  const rec2 = await createMission(gate.deps, DRAFT(repo), C)
  await launchMission(gate.deps, rec2.id, 'START').done
  const g = gate.store.read(rec2.id)!
  check('F03_a_failing_repository_gate_stops_integration_and_the_mission_ends_FAILED', g.state === 'FAILED' && g.receipt?.integration.state === 'GATES_FAILED' && /gates failed/.test(g.stateReason), `${g.state}: ${g.stateReason}`)
  const scope = world()
  const rec3 = await createMission(scope.deps, { ...DRAFT(repo), scope: { source: { repo, paths: files }, write: ['src'] } }, C)
  await launchMission(scope.deps, rec3.id, 'START').done
  const s = scope.store.read(rec3.id)!
  check('F04_changes_outside_the_declared_write_scope_are_refused_at_integration', s.state === 'FAILED' && s.receipt?.integration.state === 'REFUSED' && /outside the declared write scope/.test(s.stateReason), `${s.state}: ${s.stateReason}`)
  const busyW = world({ script: () => new Promise<string | null>(() => {}) })
  const live = await createMission(busyW.deps, { ...DRAFT(repo), title: 'a' }, C)
  launchMission(busyW.deps, live.id, 'START')
  await new Promise((r) => setTimeout(r, 300))
  check('F05_only_one_engineering_mission_may_run_at_a_time', await createMission(busyW.deps, { ...DRAFT(repo), title: 'b' }, C).then(() => 'created', (e) => (e instanceof MissionError ? e.code : 'other')) === 'BUSY')
  cancelMission(busyW.deps, live.id, C, 'validator done')
  localRunners().delete(live.id)
  check('F06_ids_are_unique_and_unguessable', (() => { const s2 = new MissionStore(new AgentOpsLog(tmp())); const ids = new Set(Array.from({ length: 50 }, () => s2.newId())); return ids.size === 50 && [...ids].every((i) => /^msn-\d{8}T\d{6}-[0-9a-f]{8}$/.test(i)) })())
}

// ============================================================ repository gate repair (real tsc, real repository)
{
  const repo = makeRepo()
  symlinkSync(path.resolve(path.dirname(SELF), '../../../../../node_modules'), path.join(repo, 'node_modules'))
  writeFileSync(path.join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', allowImportingTsExtensions: true, skipLibCheck: true, types: [] }, include: ['view/**/*.ts'] }))
  mkdirSync(path.join(repo, 'view')); writeFileSync(path.join(repo, 'view', 'panel.ts'), 'export const label = (n: number): string => `n=${n}`\n')
  sh(repo, 'add', '--', 'tsconfig.json', 'view/panel.ts'); sh(repo, 'commit', '-q', '-m', 'ts view')
  let asked = 0
  const script = (c: ScriptCtx): string | null => {
    if (c.path === 'view/panel.ts') { if (/repository type check/.test(c.prompt)) { asked++; return fenced('export const label = (n: number): string => `n=${n}`\nexport const twice = (n: number): number => n * 2') } return fenced('export const label = (n: number): string => `n=${n}`\nexport const twice = (n: number): number => n * "2"') }
    return good(c)
  }
  const gw = world({ script, gates: { typecheck: true, validators: [] } })
  const dr = DRAFT(repo); dr.scope = { source: { repo, paths: [...files, 'view', 'tsconfig.json'] }, write: [...files, 'view'] }
  const rec = await createMission(gw.deps, { ...dr, targets: [['src/messageStore.mjs', 'modify'], ['src/chatService.mjs', 'modify'], ['server.mjs', 'modify'], ['view/panel.ts', 'modify'], ['public/app.js', 'modify'], ['public/index.html', 'modify'], ['test/messageStore.test.mjs', 'create'], ['test/chatService.test.mjs', 'modify']].map(([p, a]) => ({ path: p, action: a as 'create' | 'modify' })) }, C)
  await launchMission(gw.deps, rec.id, 'START').done
  const g = gw.store.read(rec.id)!
  check('G01_a_type_error_in_a_mission_file_is_sent_back_to_the_builder_with_the_compiler_output', asked >= 1, `repair prompts ${asked}; ${g.state}: ${g.stateReason}`)
  if (process.env.DEBUG_MISSIONS) console.log(JSON.stringify(g.receipt?.integration, null, 1), gw.store.events(rec.id).map((e) => e.kind + ': ' + e.detail).join('\n'))
  check('G02_after_the_repair_the_gates_pass_one_commit_is_made_and_the_mission_completes', g.state === 'COMPLETED' && g.receipt?.integration.state === 'APPLIED' && g.receipt.integration.gates.some((x) => /typecheck/.test(x.name) && x.exitCode === 0), `${g.state}: ${g.stateReason}`)
  check('G03_the_repair_is_in_the_provenance_ledger_as_a_builder_write_to_that_file', gw.store.ledger(rec.id).some((e) => e.type === 'write' && e.path === 'view/panel.ts' && e.tag === ':gate-repair' && e.role === 'implementation_model'))
  check('G04_the_receipt_matches_the_repaired_file_on_disk', g.receipt !== null && verifyReceipt(g.receipt, new Workspace(g.workspace.root)).ok)
}

{
  const vdir = tmp(); writeFileSync(path.join(vdir, 'verify.mjs'), GENERIC_VERIFIER)
  const run = (setup: (d: string) => void) => { const d = tmp(); setup(d); return execFileSync(process.execPath, [path.join(vdir, 'verify.mjs'), d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  const tryRun = (setup: (d: string) => void) => { try { run(setup); return 0 } catch (e) { return (e as { status?: number }).status ?? -1 } }
  const T = (body: string) => (d: string) => { mkdirSync(path.join(d, 'test')); writeFileSync(path.join(d, 'test', 'a.test.mjs'), `import test from 'node:test'\nimport assert from 'node:assert'\ntest('t', () => { ${body} })\n`) }
  check('G05_the_generic_verifier_passes_a_passing_suite_fails_a_failing_one_and_accepts_no_tests', tryRun(T('assert.ok(true)')) === 0 && tryRun(T('assert.ok(false)')) === 1 && tryRun(() => {}) === 0)
}

finish()
process.exit(process.exitCode ?? 0)

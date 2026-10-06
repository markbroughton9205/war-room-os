/** Phase 10 continuation: complete-feature workflow MECHANICS (scripted model double; real files, real commands, real HTTP verifier). Run: pnpm run validate:agent-eng-workflow */
import path from 'node:path'
import { harness, engWorld, addAgent, draftFor, C, NOW, tmp } from './engtestkit'
import { AgentOpsLog } from '../log'
import { assign, deriveAssignments, pauseAssignment, requestCancel, resumeAssignment, startAssignment } from './assignments'
import { CHAT_FEATURE, CHAT_REFERENCE, CHAT_VERIFY_SCRIPT, makeChatApp } from './chatFixture'
import { runFeatureWorkflow, type WorkflowDeps } from './workflow'
import { Workspace } from './runtime/workspaceFs'
import { makeIndependentVerification } from './runtime/verifier'
import { ScriptedModel, fenced, type ScriptCtx } from './scriptedModel'
import { checkpointHistory, effectStatus, latestCheckpoint } from './continuity'
import { deriveLedger } from './debugLedger'
import { runCommand } from './runtime/commandRunner'
import type { EngineeringTool } from '../types'
import { AgentRegistry } from '../registry'
import { parseEditReply } from './prompts'
import { captureLessons, lessonsFor, measureLessonEffect, learningReport, classifyFailure } from './lessons'

const { check, finish } = harness('AGENT_ENG_WORKFLOW_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
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

type World = ReturnType<typeof makeWorld>
function makeWorld(over: { limits?: Partial<{ maxSteps: number; maxRuntimeMs: number; maxModelCalls: number; maxRetries: number }> } = {}) {
  const w = engWorld()
  const agent = addAgent(w, 'agent-feature', 'feature_implementation')
  const root = makeChatApp(path.join(tmp(), 'chat'))
  const asg = assign(w.log, draftFor(agent.id, 'mission-chat', CHAT_FEATURE.request, { workspace: { id: 'chat-ws', root, kind: 'sandbox' }, limits: { maxSteps: 30, maxRuntimeMs: 600_000, maxModelCalls: 40, maxRetries: 3, ...(over.limits ?? {}) } }), C, NOW).assignment
  startAssignment(w.log, asg.id, 'system:runner', NOW)
  const verifierDir = tmp()
  return { ...w, agent, root, asg, ws: new Workspace(root), verification: makeIndependentVerification('independent chat-session verification', verifierDir, 'verify.mjs', CHAT_VERIFY_SCRIPT, root) }
}
const deps = (x: World, model: ScriptedModel, over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({ log: x.log, assignmentId: x.asg.id, ws: x.ws, model, tools: TOOLS, finalVerification: x.verification, ...over })
const good = (ctx: ScriptCtx) => (ctx.kind === 'file' && ctx.path && SOLUTION[ctx.path] ? fenced(SOLUTION[ctx.path]) : null)
const REQ = { request: CHAT_FEATURE.request, acceptance: CHAT_FEATURE.acceptance, hints: CHAT_FEATURE.hints }
const view = (x: World) => deriveAssignments(new AgentOpsLog(x.dir)).assignments.get(x.asg.id)!

// ---- 1. success path
{
  const x = makeWorld(); const model = new ScriptedModel(good)
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  const v = view(x)
  check('N01_complete_cross_layer_feature_is_implemented_validated_and_the_assignment_COMPLETED', r.status === 'COMPLETED' && v.state === 'COMPLETED' && v.outcome!.validation === 'PASSED' && ['src/messageStore.mjs', 'src/chatService.mjs', 'server.mjs', 'public/app.js', 'public/index.html'].every((f) => r.filesChanged.includes(f)), r.reason)
  check('N02_the_independent_verifier_and_the_regression_suite_actually_pass_on_the_final_workspace', (await x.verification.run()).exitCode === 0 && (await runCommand(x.root, ['node', '--test', 'test/chatService.test.mjs', 'test/messageStore.test.mjs'], TOOLS)).exitCode === 0)
  check('N03_executor_is_recorded_honestly_as_the_test_double_and_tokens_stay_UNKNOWN', v.outcome!.executor !== 'UNKNOWN' && (v.outcome!.executor as { provider: string }).provider === 'test-double' && v.outcome!.tokens === 'UNKNOWN' && r.executor !== 'UNKNOWN')
  const cp = latestCheckpoint(x.log, x.asg.id)!
  check('N04_checkpoints_carry_objective_acceptance_steps_file_hashes_and_validations', checkpointHistory(x.log, x.asg.id).length >= 6 && cp.state.steps.every((s) => s.status === 'DONE' || s.status === 'SKIPPED') && cp.state.fileChanges.length >= 5 && cp.state.fileChanges.every((c) => c.afterHash.length === 64) && cp.state.validations.some((vv) => vv.command.includes('verify.mjs') && vv.status === 'PASSED') && cp.state.acceptanceCriteria.length === CHAT_FEATURE.acceptance.length)
  check('N05_every_file_write_is_a_recorded_consequential_effect_done_exactly_once', cp.state.effectsDone.length >= 5 && cp.state.effectsDone.every((k) => effectStatus(x.log, x.asg.id, k).state === 'DONE'))
  const firstPrompt = model.calls[0].prompt
  check('N06_model_context_contains_the_code_aware_plan_and_the_current_file_not_a_transcript', firstPrompt.includes('PLAN (from code evidence)') && firstPrompt.includes('CURRENT CONTENT OF') && firstPrompt.includes('ACCEPTANCE CRITERIA') && firstPrompt.length < 14_000)
  check('N07_steps_follow_the_layer_and_dependency_order', (() => { const order = model.calls.filter((c) => c.kind === 'file').map((c) => c.path); return order.indexOf('src/messageStore.mjs') < order.indexOf('src/chatService.mjs') && order.indexOf('src/chatService.mjs') < order.indexOf('server.mjs') && order.indexOf('server.mjs') < order.indexOf('public/app.js') })())
}

// ---- 2. NO_CHANGE, unusable reply, model failure
{
  const x = makeWorld(); const model = new ScriptedModel((c) => (c.path === 'public/index.html' ? 'NO_CHANGE' : good(c)))
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  check('N08_NO_CHANGE_is_respected_the_file_is_untouched_and_the_step_is_SKIPPED', !r.filesChanged.includes('public/index.html') && latestCheckpoint(x.log, x.asg.id)!.state.steps.find((s) => s.files[0] === 'public/index.html')!.status === 'SKIPPED' && r.status !== 'CRASHED')
  const y = makeWorld(); const m2 = new ScriptedModel((c) => (c.path === 'src/chatService.mjs' ? 'I think you should add sessions.' : good(c)))
  const r2 = await runFeatureWorkflow(deps(y, m2), REQ)
  check('N09_an_unusable_reply_fails_the_assignment_honestly_without_writing_garbage', r2.status === 'FAILED' && view(y).state === 'FAILED' && view(y).stopReason!.includes('unusable') && !r2.filesChanged.includes('src/chatService.mjs'))
  const z = makeWorld(); const r3 = await runFeatureWorkflow(deps(z, new ScriptedModel(good), { tools: ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck'] }), REQ)
  check('N10_without_the_model_grant_no_model_is_called_and_failure_is_honest', r3.status === 'FAILED' && r3.reason.includes('model') && z.log.view().records.filter((rec) => rec.t === 'assignmentEvent' && rec.kind === 'FAILED').length === 1)
}

// ---- 3. evidence-driven repair inside the workflow (real failing commands)
{
  const x = makeWorld()
  let broke = false
  const model = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/chatService.mjs' && !broke) { broke = true; return fenced(CHAT_REFERENCE['src/chatService.mjs'].replace('export function createSession(name) {', 'export function createSession(name) {{{')) }
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'createSession has a stray brace that makes the module fail to parse (see SyntaxError)', file: 'src/chatService.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(CHAT_REFERENCE['src/chatService.mjs'])
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  const led = deriveLedger(x.log, x.asg.id)
  check('N11_a_syntax_failure_is_repaired_through_the_ledger_and_the_feature_still_completes', r.status === 'COMPLETED' && r.repairs === 1 && led.failures.size === 1 && led.repairs.length === 1 && led.validations[0].outcome === 'ORIGINAL_FIXED' && [...led.hypotheses.values()][0].status === 'SUPPORTED', r.reason)
  const f = [...led.failures.values()][0]
  check('N12_the_recorded_failure_is_the_exact_command_that_really_ran', JSON.stringify(f.argv) === JSON.stringify(['node', '--check', 'src/chatService.mjs']) && f.exitCode !== 0 && /SyntaxError/.test(f.excerpt))
}
// behavioural bug found only by the independent verifier (own tests are fine); repair uses the NEW failure output as evidence
{
  const x = makeWorld(); let analyses = 0
  const model = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'server.mjs') return fenced(CHAT_REFERENCE['server.mjs'].replace("return s ? send(res, 200, s) : send(res, 404, { error: 'session not found' })", "return send(res, 200, s || {})"))
    if (c.kind === 'analyst') { analyses += 1; return JSON.stringify({ hypothesis: 'the session lookup never returns 404 for unknown ids (the verifier shows status 200)', file: 'server.mjs', differs: analyses > 1 ? 'targets the 404 branch' : 'first attempt' }) }
    if (c.kind === 'repair') return fenced(CHAT_REFERENCE['server.mjs'])
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  const led = deriveLedger(x.log, x.asg.id)
  const f = [...led.failures.values()][0]
  check('N13_a_bug_only_the_independent_verifier_can_see_is_debugged_from_its_real_output_and_fixed', r.status === 'COMPLETED' && r.repairs === 1 && f.argv[1].endsWith('verify.mjs') && f.failingTests.some((n) => /404/.test(n)) && led.validations[0].outcome === 'ORIGINAL_FIXED', `${r.status} ${r.reason}`)
}
// stubborn failure: identical repair, no new evidence => blocked / UNDETERMINED, no manufactured cause
{
  const x = makeWorld()
  const bad = CHAT_REFERENCE['server.mjs'].replace("if (m[2] && req.method === 'POST') { const msg = addSessionMessage(id, await readJson(req)); return msg ? send(res, 201, msg) : send(res, 404, { error: 'session not found' }) }", '')
  const model = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'server.mjs') return fenced(bad)
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'something is off in the server routes', file: 'server.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(bad) // keeps making the same wrong edit
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  const led = deriveLedger(x.log, x.asg.id)
  const v = view(x)
  check('N14_repeated_ineffective_repairs_end_UNDETERMINED_with_bounded_attempts_and_a_failed_assignment', r.status === 'FAILED' && v.state === 'FAILED' && v.stopReason!.includes('UNDETERMINED') && led.undetermined.size === 1 && led.repairs.length <= 3 && v.outcome!.validation === 'FAILED', `${r.reason} repairs=${led.repairs.length}`)
  check('N15_partial_results_and_failure_evidence_survive_for_the_successor', latestCheckpoint(x.log, x.asg.id)!.state.fileChanges.length >= 4 && latestCheckpoint(x.log, x.asg.id)!.state.doNotRepeat.length >= 1)
}

// ---- 4. controls: cancel, pause/resume, retire, budgets
{
  const x = makeWorld()
  const model = new ScriptedModel((c) => { if (c.callNumber === 3) requestCancel(x.log, x.asg.id, C, 'operator cancelled mid-feature', NOW); return good(c) })
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  const v = view(x)
  check('N16_cancellation_stops_at_the_next_safe_boundary_with_an_explicit_disposition_and_no_further_model_calls', r.status === 'CANCELLED' && v.state === 'CANCELLED' && v.disposition === 'STOPPED' && v.cancellation === 'STOPPED' && model.calls.length === 3 && v.stopReason === 'operator cancelled mid-feature')
  check('N17_work_completed_before_cancellation_is_preserved_and_checkpointed', r.filesChanged.length >= 2 && latestCheckpoint(x.log, x.asg.id)!.state.fileChanges.length === r.filesChanged.length)
}
{
  const x = makeWorld(); const m1 = new ScriptedModel((c) => { if (c.callNumber === 2) pauseAssignment(x.log, x.asg.id, C, 'pause for review', NOW); return good(c) })
  const r1 = await runFeatureWorkflow(deps(x, m1), REQ)
  const callsAtPause = m1.calls.length
  const again = await runFeatureWorkflow(deps(x, m1), REQ)
  check('N18_pause_prevents_any_further_execution_even_if_the_workflow_is_invoked_again', r1.status === 'PAUSED' && again.status === 'PAUSED' && m1.calls.length === callsAtPause && view(x).state === 'PAUSED')
  resumeAssignment(x.log, x.asg.id, C, 'review done', NOW)
  const m2 = new ScriptedModel(good)
  const r2 = await runFeatureWorkflow(deps(x, m2), REQ)
  const redone = m2.calls.filter((c) => c.kind === 'file').map((c) => c.path)
  check('N19_resume_continues_from_the_checkpoint_without_redoing_completed_steps', r2.status === 'COMPLETED' && !redone.includes('src/messageStore.mjs') && redone.length < 7 && view(x).state === 'COMPLETED', `redone=${redone.join(',')}`)
}
{
  const x = makeWorld(); const model = new ScriptedModel((c) => { if (c.callNumber === 2) new AgentRegistry(x.log).transition(x.agent.id, 'RETIRED', C, 'retired mid-run', NOW); return good(c) })
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  check('N20_retiring_the_agent_stops_further_work_at_the_next_boundary', r.status === 'FAILED' && view(x).state === 'FAILED' && view(x).stopReason!.includes('no longer ACTIVE') && model.calls.length === 2)
}
{
  const x = makeWorld({ limits: { maxModelCalls: 2 } }); const r = await runFeatureWorkflow(deps(x, new ScriptedModel(good)), REQ)
  check('N21_the_model_call_budget_is_a_hard_ceiling_and_partial_work_is_kept', r.status === 'FAILED' && r.modelCalls <= 2 && view(x).stopReason!.includes('budget') && latestCheckpoint(x.log, x.asg.id)!.state.fileChanges.length >= 1)
}

// ---- 5. crash/restart, drift, duplicate effects
{
  const x = makeWorld()
  const m1 = new ScriptedModel(good)
  const r1 = await runFeatureWorkflow(deps(x, m1, { crashAfterSteps: 3 }), REQ)
  const writes1 = [...(latestCheckpoint(x.log, x.asg.id)!.state.effectsDone)]
  const hashBefore = x.ws.snapshot()
  const m2 = new ScriptedModel(good)
  const r2 = await runFeatureWorkflow({ ...deps(x, m2), log: new AgentOpsLog(x.dir) }, REQ)
  const redone = m2.calls.filter((c) => c.kind === 'file').map((c) => c.path)
  check('N22_after_a_crash_a_restarted_runner_resumes_from_the_checkpoint_and_finishes', r1.status === 'CRASHED' && r2.status === 'COMPLETED' && view(x).state === 'COMPLETED')
  check('N23_completed_steps_are_not_redone_and_their_files_are_byte_identical', redone.length === 4 && !redone.includes('src/messageStore.mjs') && ['src/messageStore.mjs', 'src/chatService.mjs', 'server.mjs'].every((f) => hashBefore[f] === x.ws.hash(f)), `redone=${redone.join(',')}`)
  const keys = latestCheckpoint(x.log, x.asg.id)!.state.effectsDone
  check('N24_no_consequential_effect_is_executed_twice_across_the_restart', writes1.every((k) => keys.includes(k)) && new Set(keys).size === keys.length && keys.every((k) => effectStatus(x.log, x.asg.id, k).state === 'DONE'))
}
{
  const x = makeWorld(); await runFeatureWorkflow(deps(x, new ScriptedModel(good), { crashAfterSteps: 3 }), REQ)
  x.ws.write('src/messageStore.mjs', '// edited by someone else while Foundry was down\nexport function allMessages() { return [] }\n')
  x.ws.write('README.md', 'Mark was here')
  const m2 = new ScriptedModel(good)
  const r2 = await runFeatureWorkflow(deps(x, m2), REQ)
  check('N25_a_file_changed_by_someone_else_blocks_resume_as_a_CONFLICT_and_is_never_overwritten', r2.status === 'CONFLICT' && m2.calls.length === 0 && x.ws.read('src/messageStore.mjs').includes('edited by someone else') && x.ws.read('README.md') === 'Mark was here' && r2.reason.includes('src/messageStore.mjs'))
}

// ---- 6. prompts: lessons injected, secrets never persisted
{
  const x = makeWorld(); const model = new ScriptedModel(good)
  await runFeatureWorkflow(deps(x, model, { lessons: () => ['LESSON-XYZ: use the exact function names from RELATED CODE'] }), REQ)
  check('N26_retrieved_lessons_reach_the_model_prompt', model.calls.filter((c) => c.kind === 'file').every((c) => c.prompt.includes('LESSON-XYZ')))
}

// ---- 7. static API-compat gate and error-implicated repair candidates (found by the first real-model run)
{
  const x = makeWorld(); let tried = 0
  const gutted = `// store rewritten without the legacy exports\nexport function loadSessions() { return [] }\nexport function saveSessions(s) { return s }\n`
  const model = new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'src/messageStore.mjs' && tried++ === 0) return fenced(gutted); return good(c) })
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  check('N27_a_rewrite_that_deletes_an_export_other_files_import_is_rejected_before_it_is_written_and_the_model_is_told_why', r.status === 'COMPLETED' && model.calls.filter((c) => c.path === 'src/messageStore.mjs').length === 2 && model.calls.filter((c) => c.path === 'src/messageStore.mjs')[1].prompt.includes('REJECTED') && x.ws.read('src/messageStore.mjs').includes('allMessages') && latestCheckpoint(x.log, x.asg.id)!.state.doNotRepeat.some((d) => d.key.startsWith('reject:src/messageStore.mjs')))
  const y = makeWorld()
  const stubborn = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'src/messageStore.mjs' ? fenced(gutted) : good(c)))
  const r2 = await runFeatureWorkflow(deps(y, stubborn), REQ)
  check('N28_a_model_that_keeps_deleting_the_export_cannot_corrupt_the_workspace_the_step_fails_and_the_file_is_untouched', r2.status === 'FAILED' && y.ws.read('src/messageStore.mjs').includes('pushMessage') && view(y).state === 'FAILED' && view(y).stopReason!.includes('repeatedly produced') && !r2.filesChanged.includes('src/messageStore.mjs'))
  const z = makeWorld(); let analysed = 0
  const m3 = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/chatService.mjs') return 'NO_CHANGE' // wrong: the service needs the session functions
    if (c.kind === 'analyst') { analysed += 1; return JSON.stringify({ hypothesis: 'server.mjs imports createSession etc. from chatService.mjs, which does not export them (SyntaxError in the output names src/chatService.mjs)', file: 'src/chatService.mjs', differs: 'first attempt' }) }
    if (c.kind === 'repair') return fenced(CHAT_REFERENCE['src/chatService.mjs'])
    return good(c)
  })
  const r3 = await runFeatureWorkflow(deps(z, m3), REQ)
  check('N29_a_file_the_model_wrongly_skipped_is_offered_as_a_repair_candidate_because_the_error_output_names_it', r3.status === 'COMPLETED' && analysed >= 1 && r3.filesChanged.includes('src/chatService.mjs') && deriveLedger(z.log, z.asg.id).repairs[0].filesEdited[0].path === 'src/chatService.mjs', `${r3.status} ${r3.reason}`)
}

// ---- 8. edit protocol (append / search-replace) parsing
{
  const cur = 'export function a() {\n  return 1\n}\n\nexport function b() {\n  return 2\n}\n'
  const ap = parseEditReply('```append\nexport function c() { return 3 }\n```', cur)
  const sr = parseEditReply('<<<<<<< SEARCH\n  return 2\n=======\n  return 22\n>>>>>>> REPLACE', cur)
  const nf = parseEditReply('<<<<<<< SEARCH\nnot in the file\n=======\nx\n>>>>>>> REPLACE', cur)
  const amb = parseEditReply('<<<<<<< SEARCH\n  return\n=======\nx\n>>>>>>> REPLACE', cur)
  const nothing = parseEditReply('<<<<<<< SEARCH\n  return 2\n=======\n  return 2\n>>>>>>> REPLACE', cur)
  const rewrite = parseEditReply('```js\nexport const z = 1\n```', cur)
  const fresh = parseEditReply('```js\nexport const z = 1\n```', null)
  check('N30_append_and_search_replace_edits_are_applied_to_the_current_file_and_everything_else_is_kept', ap.kind === 'code' && ap.mode === 'edits' && ap.content.includes('export function a()') && ap.content.includes('export function c()') && sr.kind === 'code' && sr.content.includes('return 22') && sr.content.includes('return 1'))
  check('N31_unmatched_ambiguous_or_no_op_edits_are_refused_with_a_reason_never_guessed', nf.kind === 'invalid' && nf.reason.includes('not found') && amb.kind === 'invalid' && amb.reason.includes('times') && nothing.kind === 'invalid')
  check('N32_full_rewrites_are_still_parsed_as_rewrites_for_the_compat_gate_and_new_files_as_new', rewrite.kind === 'code' && rewrite.mode === 'rewrite' && fresh.kind === 'code' && fresh.mode === 'new' && parseEditReply('NO_CHANGE', cur).kind === 'no_change')
}

// ---- 8. measurable learning: lesson captured from a real fixed failure -> retrieved on a later similar task -> effect measured
{
  const x = makeWorld(); let broke = false
  const dup = CHAT_REFERENCE['src/chatService.mjs'].replace('export function createSession(name) {', 'export function createSession(name) {{{')
  const m1 = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/chatService.mjs' && !broke) { broke = true; return fenced(dup) }
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'createSession has a stray brace so chatService.mjs fails to parse (SyntaxError)', file: 'src/chatService.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(CHAT_REFERENCE['src/chatService.mjs'])
    return good(c)
  })
  const r1 = await runFeatureWorkflow(deps(x, m1), REQ)
  const made = captureLessons(x.log, x.asg.id, { taskClass: 'feature_implementation', executor: 'test-double' })
  check('N33_a_really_fixed_failure_becomes_a_lesson_with_evidence_pointing_at_the_assignment_and_failure', r1.status === 'COMPLETED' && made.length >= 1 && made[0].cls === 'SYNTAX' && made[0].evidence.kind === 'FIXED_FAILURE' && !!made[0].evidence.failureId && made[0].evidence.assignmentId === x.asg.id)
  check('N34_capture_is_idempotent_and_an_unfixed_or_unverified_failure_is_not_a_lesson', captureLessons(x.log, x.asg.id, { taskClass: 'feature_implementation', executor: 'test-double' }).length === 0 && classifyFailure('SyntaxError: Identifier \'x\' has already been declared') === 'DUPLICATE_DECLARATION')
  // later similar task in the SAME durable log
  const root2 = makeChatApp(path.join(tmp(), 'chat2'))
  const asg2 = assign(x.log, draftFor(x.agent.id, 'mission-chat-2', CHAT_FEATURE.request + ' (second project)', { workspace: { id: 'chat-ws2', root: root2, kind: 'sandbox' }, limits: { maxSteps: 30, maxRuntimeMs: 600_000, maxModelCalls: 40, maxRetries: 3 } }), C, NOW).assignment
  startAssignment(x.log, asg2.id, 'system:runner', NOW)
  const got = lessonsFor(x.log, asg2.id, 'feature_implementation')
  const m2 = new ScriptedModel(good)
  const r2 = await runFeatureWorkflow({ ...deps(x, m2), assignmentId: asg2.id, ws: new Workspace(root2), finalVerification: makeIndependentVerification('v2', tmp(), 'verify.mjs', CHAT_VERIFY_SCRIPT, root2), lessons: () => got.texts }, REQ)
  check('N35_the_lesson_is_retrieved_for_a_similar_later_task_and_reaches_the_model_prompt', got.ids.length >= 1 && got.texts.some((t) => t.includes('[SYNTAX]')) && m2.calls.filter((c) => c.kind === 'file').every((c) => c.prompt.includes('[SYNTAX]')) && r2.status === 'COMPLETED')
  const eff = measureLessonEffect(x.log, asg2.id)
  const rep = learningReport(x.log)
  check('N36_effect_is_measured_per_class_the_class_did_not_recur_in_the_later_task_and_the_first_task_is_not_counted_as_a_use', eff.avoided >= 1 && eff.repeated === 0 && rep.byClass.SYNTAX.retrieved === 1 && rep.byClass.SYNTAX.avoided === 1 && measureLessonEffect(x.log, asg2.id).avoided === 0)
  check('N37_a_lesson_is_never_retrieved_for_the_assignment_that_produced_it', lessonsFor(x.log, x.asg.id, 'feature_implementation').ids.length === 0)
}
// ---- 9. duplicate-declaration gate: a reply that redeclares a name is rejected BEFORE it is written, and the rejection becomes a lesson
{
  const x = makeWorld(); let first = true
  const dup = CHAT_REFERENCE['src/chatService.mjs'] + '\nexport function validateMessage() { return 1 }\n'
  const model = new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'src/chatService.mjs' && first) { first = false; return fenced(dup) } return good(c) })
  const r = await runFeatureWorkflow(deps(x, model), REQ)
  const les = captureLessons(x.log, x.asg.id, { taskClass: 'feature_implementation', executor: 'test-double' })
  check('N38_a_reply_declaring_a_name_twice_is_rejected_before_writing_with_a_reason_and_the_rejection_becomes_a_lesson', r.status === 'COMPLETED' && r.repairs === 0 && model.calls.filter((c) => c.path === 'src/chatService.mjs')[1].prompt.includes('more than once') && les.some((l) => l.cls === 'DUPLICATE_DECLARATION' && l.evidence.kind === 'GATE_REJECTION'))
}
// ---- 10. progress-aware repair: a repair that strictly reduces the failing checks opens a fresh failure record; bounded by the assignment ceiling
{
  const x = makeWorld({ limits: { maxRetries: 5 } })
  const TOKENS = ['TOKEN_A', 'TOKEN_B', 'TOKEN_C', 'TOKEN_D']
  const SCRIPT = `import { readFileSync } from 'node:fs'\nconst t = readFileSync(process.argv[2] + '/server.mjs', 'utf8'); const toks = ${JSON.stringify(TOKENS)}\nlet fail = 0\ntoks.forEach((k, i) => { const ok = t.includes(k); if (!ok) fail++; console.log((ok ? 'ok ' : 'not ok ') + (i + 1) + ' - has ' + k) })\nconsole.log('# tests ' + toks.length + '\\n# pass ' + (toks.length - fail) + '\\n# fail ' + fail); process.exit(fail ? 1 : 0)`
  const ver = makeIndependentVerification('multi-check acceptance', tmp(), 'multi.mjs', SCRIPT, x.root)
  let n = 0
  const model = new ScriptedModel((c) => {
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: `server.mjs is missing ${TOKENS[Math.min(n, 3)]} (the verifier prints "not ok ... has ${TOKENS[Math.min(n, 3)]}")`, file: 'server.mjs', differs: 'targets the next missing token reported by the verifier' })
    if (c.kind === 'repair') { n += 1; return fenced(CHAT_REFERENCE['server.mjs'] + '\n' + TOKENS.slice(0, n).map((k) => `// ${k}`).join('\n') + '\n') }
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, model, { finalVerification: ver }), REQ)
  const led = deriveLedger(x.log, x.asg.id)
  check('N39_four_failing_checks_fixed_one_per_repair_complete_because_each_repair_strictly_reduced_failures_and_each_remainder_got_its_own_failure_record', r.status === 'COMPLETED' && r.repairs === 4 && led.failures.size === 4 && led.repairs.length === 4, `${r.status} ${r.reason} repairs=${r.repairs} failures=${led.failures.size}`)
  const y = makeWorld({ limits: { maxRetries: 3 } })
  const ver2 = makeIndependentVerification('multi-check acceptance', tmp(), 'multi.mjs', SCRIPT, y.root)
  let m = 0
  const model2 = new ScriptedModel((c) => {
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: `server.mjs is missing ${TOKENS[Math.min(m, 3)]}`, file: 'server.mjs', differs: 'next token' })
    if (c.kind === 'repair') { m += 1; return fenced(CHAT_REFERENCE['server.mjs'] + '\n' + TOKENS.slice(0, m).map((k) => `// ${k}`).join('\n') + '\n') }
    return good(c)
  })
  const r2 = await runFeatureWorkflow(deps(y, model2, { finalVerification: ver2 }), REQ)
  check('N40_progress_never_exceeds_the_assignment_retry_ceiling_the_same_scenario_with_maxRetries_3_stops_UNDETERMINED', r2.status === 'FAILED' && r2.repairs === 3 && view(y).state === 'FAILED')
}
// ---- 11. test-stage blame: after verified acceptance a failure that implicates ONLY the new test is repaired in the test; one whose output implicates src/ is not confined
{
  const LATENT = "\nexport function describeStore() { throw new Error('latent defect: describeStore is unfinished') }\n"
  const mkTest = (body: string) => `import test from 'node:test'\nimport assert from 'node:assert'\nimport { describeStore } from '../src/messageStore.mjs'\ntest('describes the store', () => { ${body} })\n`
  const x = makeWorld({ limits: { maxRetries: 5 } })
  const m1 = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/messageStore.mjs') return fenced(SOLUTION['src/messageStore.mjs'] + LATENT)
    if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(mkTest("assert.strictEqual(describeStore(), 'store')"))
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'describeStore throws an unfinished-implementation error (stack points into src/messageStore.mjs)', file: 'src/messageStore.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(SOLUTION['src/messageStore.mjs'] + "\nexport function describeStore() { return 'store' }\n")
    return good(c)
  })
  const r1 = await runFeatureWorkflow(deps(x, m1, { finalVerification: x.verification }), REQ)
  const an1 = m1.calls.find((c) => c.kind === 'analyst')
  check('N41_when_the_failing_output_implicates_an_implementation_file_the_repair_is_not_confined_to_the_new_test', r1.status === 'COMPLETED' && !!an1 && an1.prompt.includes('--- src/messageStore.mjs ---') && x.ws.read('src/messageStore.mjs').includes("return 'store'"), `${r1.status} ${r1.reason}`)
  const y = makeWorld({ limits: { maxRetries: 5 } })
  const m2 = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/messageStore.mjs') return fenced(SOLUTION['src/messageStore.mjs'] + "\nexport function describeStore() { return 'store' }\n")
    if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(mkTest("assert.strictEqual(describeStore(), 'a different store')"))
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'the test expects the wrong string; the implementation passed acceptance', file: 'test/messageStore.test.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(mkTest("assert.strictEqual(describeStore(), 'store')"))
    return good(c)
  })
  const r2 = await runFeatureWorkflow(deps(y, m2, { finalVerification: y.verification }), REQ)
  const an2 = m2.calls.find((c) => c.kind === 'analyst')
  check('N42_a_failure_that_only_implicates_the_new_test_after_verified_acceptance_is_repaired_in_the_test_and_never_touches_implementation', r2.status === 'COMPLETED' && !!an2 && !an2.prompt.includes('--- src/messageStore.mjs ---') && an2.prompt.includes('The failing test is the suspect') && y.ws.read('src/messageStore.mjs').includes("return 'store'"), `${r2.status} ${r2.reason}`)
}
// ---- 12. repeated hypotheses: acting twice on the same cause is refused; one different hypothesis is requested, else UNDETERMINED early
{
  const brk = CHAT_REFERENCE['src/chatService.mjs'].replace('export function createSession(name) {', 'export function createSession(name) {{{')
  const x = makeWorld({ limits: { maxRetries: 5 } }); let analysed = 0, repairsAsked = 0
  const m1 = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/chatService.mjs') return fenced(brk)
    if (c.kind === 'analyst') { analysed += 1; return JSON.stringify({ hypothesis: 'createSession has a stray brace that makes chatService.mjs fail to parse', file: 'src/chatService.mjs', differs: 'another look' }) }
    if (c.kind === 'repair') { repairsAsked += 1; return fenced(brk) }
    return good(c)
  })
  const r1 = await runFeatureWorkflow(deps(x, m1), REQ)
  const led1 = deriveLedger(x.log, x.asg.id)
  check('N43_a_re_proposed_hypothesis_is_challenged_once_and_then_ends_UNDETERMINED_without_spending_another_repair', r1.status === 'FAILED' && repairsAsked === 1 && led1.repairs.length === 1 && led1.undetermined.size === 1 && analysed === 3 && m1.calls.filter((c) => c.kind === 'analyst')[2].prompt.includes('REPEATED HYPOTHESIS REJECTED'), `${r1.status} repairs=${repairsAsked} analysed=${analysed}`)
  const y = makeWorld({ limits: { maxRetries: 5 } }); let an = 0, rp = 0
  const m2 = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/chatService.mjs') return fenced(brk)
    if (c.kind === 'analyst') { an += 1; return JSON.stringify({ hypothesis: an <= 2 ? 'createSession has a stray brace that makes chatService.mjs fail to parse' : 'the second function body opens two braces where one is needed (SyntaxError at createSession)', file: 'src/chatService.mjs', differs: 'another look' }) }
    if (c.kind === 'repair') { rp += 1; return fenced(rp === 1 ? brk : CHAT_REFERENCE['src/chatService.mjs']) }
    return good(c)
  })
  const r2 = await runFeatureWorkflow(deps(y, m2), REQ)
  check('N44_when_the_analyst_does_offer_a_different_hypothesis_the_loop_continues_and_can_fix_the_failure', r2.status === 'COMPLETED' && rp === 2 && an === 3, `${r2.status} ${r2.reason} rp=${rp} an=${an}`)
}
// ---- 13. hermetic test runs: state a model-written test leaves behind never persists into the next run or the workspace
{
  const LEAKY = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { appendFileSync, mkdirSync, readFileSync } from 'node:fs'\ntest('leaves state behind', () => {\n  mkdirSync('data', { recursive: true })\n  appendFileSync('data/leak.txt', 'x\\n')\n  assert.strictEqual(readFileSync('data/leak.txt', 'utf8').split('\\n').filter(Boolean).length, 1)\n})\n`
  const x = makeWorld({ limits: { maxRetries: 5 } })
  const model = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(LEAKY) : good(c)))
  const r = await runFeatureWorkflow(deps(x, model, { finalVerification: x.verification }), REQ)
  check('N45_a_test_that_writes_state_passes_on_every_re_run_because_runs_are_hermetic_and_the_workspace_stays_clean', r.status === 'COMPLETED' && r.repairs === 0 && !x.ws.exists('data/leak.txt'), `${r.status} ${r.reason} repairs=${r.repairs} leaked=${x.ws.exists('data/leak.txt')}`)
}
// ---- 14. credential-LIKE text in a model-written file or in command output must not abort real work, and must never be persisted
{
  const FAKE = 'abcd1234efgh5678ijkl'
  const T = `import test from 'node:test'\nimport assert from 'node:assert'\n// fixture: token = "${FAKE}"\ntest('fails on purpose so the file is read as evidence', () => { assert.strictEqual(1, 2) })\n`
  const x = makeWorld({ limits: { maxRetries: 3 } })
  const model = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(T)
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: `the fixture line token = "${FAKE}" is irrelevant; the new test asserts 1 equals 2 which can never hold`, file: 'test/messageStore.test.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(T.replace('assert.strictEqual(1, 2)', 'assert.strictEqual(1, 1)'))
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, model, { finalVerification: x.verification }), REQ)
  const raw = (await import('node:fs')).readFileSync(x.log.file, 'utf8')
  check('N46_credential_like_text_is_redacted_before_it_is_persisted_and_the_assignment_is_not_aborted_by_it', r.status === 'COMPLETED' && !raw.includes(FAKE) && raw.includes('[REDACTED]'), `${r.status} ${r.reason} persisted=${raw.includes(FAKE)}`)
}
void deriveAssignments; void AgentRegistry
finish()

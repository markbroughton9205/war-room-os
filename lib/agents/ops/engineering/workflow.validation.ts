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
import { correctContractAssertions, testNames } from './testContract'
import { completionClass } from './completionClass'
import type { FrontierProvider } from './frontierBridge'
import { existsSync, readFileSync } from 'node:fs'
import type { ModelClient, ModelResult } from './runtime/ports'
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
const deps = (x: World, model: ScriptedModel, over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({ log: x.log, assignmentId: x.asg.id, ws: x.ws, model, tools: TOOLS, finalVerification: x.verification, generatedTests: false, ...over })
const good = (ctx: ScriptCtx) => (ctx.kind === 'file' && ctx.path && SOLUTION[ctx.path] ? fenced(SOLUTION[ctx.path]) : null)
process.env.ENGINE_NODE_PARSE = '0' // these scenarios inject syntax breaks that must reach the repair ledger; the node-parse gate has its own validator (reliability R41)
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
    if (c.kind === 'file' && c.path === 'src/chatService.mjs' && !broke) { broke = true; return fenced(CHAT_REFERENCE['src/chatService.mjs'] + '\nreturn 1\n') } // an illegal top-level return: the static syntax gate accepts it, node --check does not
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'createSession declares dup twice which makes the module fail to parse (see SyntaxError)', file: 'src/chatService.mjs', differs: 'first attempt' })
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
  check('N29_a_file_the_model_wrongly_skipped_is_offered_as_a_repair_candidate_because_the_error_output_names_it', r3.status === 'COMPLETED' && analysed === 0 /* the structured evidence names the module; no analyst guess is needed */ && r3.filesChanged.includes('src/chatService.mjs') && deriveLedger(z.log, z.asg.id).repairs[0].filesEdited[0].path === 'src/chatService.mjs', `${r3.status} ${r3.reason}`)
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
  const dup = CHAT_REFERENCE['src/chatService.mjs'] + '\nreturn 1\n'
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
  check('N42_a_failure_that_only_implicates_the_new_test_after_verified_acceptance_is_repaired_in_the_test_and_never_touches_implementation', r2.status === 'COMPLETED' && !an2 /* the structured evidence needs no analyst guess */ && m2.calls.some((c) => c.kind === 'repair' && c.prompt.includes('test:expectation') && c.prompt.includes('Do not change implementation files')) && y.ws.read('src/messageStore.mjs').includes("return 'store'"), `${r2.status} ${r2.reason}`)
}
// ---- 12. repeated hypotheses: acting twice on the same cause is refused; one different hypothesis is requested, else UNDETERMINED early
{
  const brk = CHAT_REFERENCE['src/chatService.mjs'] + '\nreturn 1\n'
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
  const T = `import test from 'node:test'\nimport assert from 'node:assert'\n// fixture: token = "${FAKE}"\ntest('fails on purpose so the file is read as evidence', () => { assert.strictEqual(1, 2, 'token = "${FAKE}"') })\n`
  const x = makeWorld({ limits: { maxRetries: 3 } })
  const model = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(T)
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: `the fixture line token = "${FAKE}" is irrelevant; the new test asserts 1 equals 2 which can never hold`, file: 'test/messageStore.test.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(T.replace(/assert\.strictEqual\(1, 2, [^)]*\)/, 'assert.strictEqual(1, 1)'))
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, model, { finalVerification: x.verification }), REQ)
  const raw = (await import('node:fs')).readFileSync(x.log.file, 'utf8')
  check('N46_credential_like_text_is_redacted_before_it_is_persisted_and_the_assignment_is_not_aborted_by_it', r.status === 'COMPLETED' && !raw.includes(FAKE) && raw.includes('[REDACTED]'), `${r.status} ${r.reason} persisted=${raw.includes(FAKE)}`)
}

// ---- 13. contract-subordinate tests: an invented expectation that fails against a verified implementation is quarantined, not allowed to block it
{
  const mk = (extra: string) => `import test from 'node:test'\nimport assert from 'node:assert'\nimport { describeStore } from '../src/messageStore.mjs'\ntest('sessions round-trip through the data file', () => { assert.strictEqual(describeStore(), 'store') })\n${extra}`
  const impl = SOLUTION['src/messageStore.mjs'] + "\nexport function describeStore() { return 'store' }\n"
  const mkModel = (testBody: string) => new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/messageStore.mjs') return fenced(impl)
    if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(testBody)
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'the test expects another string', file: 'test/messageStore.test.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(testBody) // the model insists on its invented expectation
    return good(c)
  })
  const x = makeWorld({ limits: { maxRetries: 3 } })
  const m = mkModel(mk("test('wording of the store label', () => { assert.strictEqual(describeStore(), 'STORE (primary, v2)') })\n"))
  const r = await runFeatureWorkflow(deps(x, m, { finalVerification: x.verification }), REQ)
  const kept = x.ws.read('test/messageStore.test.mjs')
  check('N47_an_invented_test_expectation_that_fails_against_the_verified_implementation_is_quarantined_and_the_workflow_completes', r.status === 'COMPLETED' && r.quarantinedTests === 1 && kept.includes('QUARANTINED') && kept.includes('sessions round-trip') && x.ws.read('src/messageStore.mjs') === impl, `${r.status} ${r.reason} q=${r.quarantinedTests}`)
  const y = makeWorld({ limits: { maxRetries: 3 } })
  const only = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { describeStore } from '../src/messageStore.mjs'\ntest('wording of the store label', () => { assert.strictEqual(describeStore(), 'STORE (primary, v2)') })\n`
  const r2 = await runFeatureWorkflow(deps(y, mkModel(only), { finalVerification: y.verification }), REQ)
  check('N48_a_test_file_whose_only_test_is_ungrounded_is_not_quarantined_into_nothing_the_step_fails_honestly', r2.status === 'FAILED' && !(r2.quarantinedTests ?? 0), `${r2.status} ${r2.reason}`)
  const tm = new ScriptedModel(good); const z = makeWorld()
  await runFeatureWorkflow(deps(z, tm, { finalVerification: z.verification }), REQ)
  const tp = tm.calls.find((c) => c.kind === 'file' && c.path?.startsWith('test/'))
  check('N49_the_test_prompt_carries_the_acceptance_contract_as_obligations_and_forbids_inventing_expectations', !!tp && tp.prompt.includes('TEST OBLIGATIONS') && tp.prompt.includes(CHAT_FEATURE.acceptance[0]) && /Do NOT assert exact error-message wording/.test(tp.prompt))
}
// ---- 14. declaration/import collisions: the targeted retry is fed the real import facts; a third rejection is still recoverable
{
  const base = SOLUTION['src/chatService.mjs']
  const colliding = base + "\nexport function loadSessions() { return loadSessions() }\n"
  let n = 0
  const x = makeWorld({ limits: { maxRetries: 3 } })
  const m = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/chatService.mjs') { n += 1; return fenced(n <= 3 ? colliding : base) }
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, m, { finalVerification: x.verification }), REQ)
  const retry = m.calls.filter((c) => c.kind === 'file' && c.path === 'src/chatService.mjs')[1]
  check('N50_a_declaration_that_collides_with_an_import_gets_three_targeted_retries_with_the_real_import_facts', r.status === 'COMPLETED' && n === 4 && !!retry && retry.prompt.includes('really exports:') && retry.prompt.includes('recurses forever') && retry.prompt.includes('collides with a declaration'), `${r.status} ${r.reason} n=${n}`)
  let k = 0
  const y = makeWorld({ limits: { maxRetries: 3 } })
  const m2 = new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'src/chatService.mjs') { k += 1; return fenced(colliding) } return good(c) })
  const r2 = await runFeatureWorkflow(deps(y, m2, { finalVerification: y.verification }), REQ)
  check('N51_the_collision_retry_is_bounded_and_nothing_is_renamed_mechanically', r2.status === 'FAILED' && k === 4 && !y.ws.read('src/chatService.mjs').includes('loadSessions() { return loadSessions() }'), `${r2.status} k=${k}`)
}

// ---- 15. static cross-reference gates in the write path
{
  const base = SOLUTION['src/chatService.mjs']
  let n = 0
  const x = makeWorld({ limits: { maxRetries: 3 } })
  const m = new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'src/chatService.mjs') { n += 1; return fenced(n === 1 ? base + "\nexport function zzz() { return saveEverything() }\n" : base) } return good(c) })
  const r = await runFeatureWorkflow(deps(x, m, { finalVerification: x.verification }), REQ)
  const second = m.calls.filter((c) => c.kind === 'file' && c.path === 'src/chatService.mjs')[1]
  check('N52_a_reply_that_uses_an_undeclared_name_is_rejected_before_it_is_written_and_the_retry_is_told_which_names', r.status === 'COMPLETED' && n === 2 && !!second && /never declared or imported/.test(second.prompt) && second.prompt.includes('saveEverything'), `${r.status} n=${n}`)
  let k = 0
  const y = makeWorld({ limits: { maxRetries: 3 } })
  const m2 = new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'public/index.html') { k += 1; return fenced(k === 1 ? '<!doctype html><html><body><p>nothing here</p><script src="/app.js"></script></body></html>' : INDEX_HTML) } return good(c) })
  const r2 = await runFeatureWorkflow(deps(y, m2, { finalVerification: y.verification }), REQ)
  const retry = m2.calls.filter((c) => c.kind === 'file' && c.path === 'public/index.html')[1]
  check('N53_a_page_that_lacks_the_element_ids_its_client_scripts_read_is_rejected_and_the_retry_names_the_ids', r2.status === 'COMPLETED' && k === 2 && !!retry && /missing elements that its client scripts read/.test(retry.prompt), `${r2.status} k=${k}`)
}
void deriveAssignments; void AgentRegistry
// ---- 16. structured-evidence repair: failed check -> implicated route/symbol -> explicit hypothesis -> before/after comparison; refuted hypotheses are never repeated; two refutations escalate
{
  const buggyServer = CHAT_REFERENCE['server.mjs'].replaceAll("send(res, 404, { error: 'session not found' })", "send(res, 400, { error: 'session not found' })")
  const noop = (c: ScriptCtx) => { const m = /CURRENT CONTENT:\n```\n([\s\S]*?)\n```/.exec(c.prompt); return m ? fenced(m[1]) : null }
  const fixes = (c: ScriptCtx) => (c.path === 'server.mjs' ? fenced(CHAT_REFERENCE['server.mjs']) : noop(c))
  const filePhase = (c: ScriptCtx) => (c.kind === 'file' && c.path === 'server.mjs' ? fenced(buggyServer) : good(c))
  const x = makeWorld(); const ev: string[] = []
  const primary = new ScriptedModel((c) => (c.kind === 'repair' ? noop(c) : filePhase(c)))
  const esc = new ScriptedModel((c) => (c.kind === 'repair' ? fixes(c) : null))
  const r = await runFeatureWorkflow(deps(x, primary, { escalation: { label: 'esc-model', model: esc }, onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }), REQ)
  const refuted = r.repairTrace!.filter((t) => t.outcome === 'REFUTED' || t.outcome === 'NO_EDIT')
  check('N54_the_failing_check_is_mapped_to_explicit_hypotheses_and_each_attempt_acts_on_a_different_one', r.repairTrace!.length >= 3 && new Set(r.repairTrace!.map((t) => t.key)).size === r.repairTrace!.length && r.repairTrace![0].key.startsWith('status:') && /unknown session ids/.test(r.repairTrace![0].checkName), JSON.stringify(r.repairTrace!.map((t) => `${t.key}:${t.outcome}`)))
  check('N55_a_repair_that_leaves_the_same_check_failure_unchanged_is_recorded_REFUTED_with_before_and_after_signatures', refuted.length === 2 && refuted.every((t) => t.before === t.after && t.before.length > 0), JSON.stringify(refuted.map((t) => t.outcome)))
  check('N56_after_two_refuted_hypotheses_the_context_depth_and_the_model_escalate_and_the_switch_is_recorded_not_silent', r.escalations!.length === 1 && r.escalations![0].modelBefore !== r.escalations![0].modelAfter && r.escalations![0].modelAfter === 'esc-model' && r.escalations![0].contextDepth === 1 && ev.some((e) => e.startsWith('ESCALATE') && e.includes('esc-model')), JSON.stringify(r.escalations))
  const last = r.repairTrace!.at(-1)!
  check('N57_the_escalated_attempt_fixes_the_target_check_and_the_outcome_difference_is_recorded', r.status === 'COMPLETED' && last.model === 'esc-model' && last.contextDepth === 1 && last.outcome === 'TARGET_FIXED' && /TARGET_FIXED/.test(r.escalations![0].outcomeAfter ?? '') && refuted.every((t) => t.model !== 'esc-model'), `${r.status} ${r.reason}`)
  check('N58_the_escalated_prompt_carries_the_deterministic_evidence_and_the_refuted_list', esc.calls.some((c) => c.kind === 'repair' && c.prompt.includes('ENGINE EVIDENCE') && c.prompt.includes('REFUTED HYPOTHESES') && /status:map|status:raise/.test(c.prompt)))
  const y = makeWorld(); const ev2: string[] = []
  const solo = new ScriptedModel((c) => (c.kind === 'repair' ? (c.prompt.includes('HYPOTHESIS TO ACT ON NOW (status:inline') ? fixes(c) : noop(c)) : filePhase(c)))
  const r2 = await runFeatureWorkflow(deps(y, solo, { onEvent: (e) => ev2.push(`${e.kind} ${e.detail}`) }), REQ)
  check('N59_without_an_escalation_model_the_context_still_escalates_and_the_model_is_never_switched_silently', r2.status === 'COMPLETED' && r2.escalations!.length === 1 && r2.escalations![0].modelBefore === r2.escalations![0].modelAfter && ev2.some((e) => /no escalation model configured/.test(e)), JSON.stringify(r2.escalations))
}

// ---- 17. test-stage reliability: an ungrounded assertion inside the only test case is disabled (the case stays); route/contract problems get the bounded third retry
{
  const SINGLE = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { mkdtempSync } from 'node:fs'\nimport { tmpdir } from 'node:os'\nimport path from 'node:path'\nprocess.env.CHAT_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'chat-')), 'sessions.json')\nconst { createSession, listSessions, getSession, addSessionMessage } = await import('../src/chatService.mjs')\ntest('session service functions', () => {\n  const s = createSession('alpha')\n  assert.ok(listSessions().some((x) => x.id === s.id))\n  assert.strictEqual(listSessions().length, 99)\n  addSessionMessage(s.id, { text: 'hi' })\n  assert.strictEqual(getSession(s.id).messages.length, 1)\n})\n`
  const x = makeWorld(); const ev: string[] = []
  const m = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'test/chatService.test.mjs') return fenced(SINGLE)
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'the expectation of 99 sessions is wrong', file: 'test/chatService.test.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') { const k = /CURRENT CONTENT:\n```\n([\s\S]*?)\n```/.exec(c.prompt); return k ? fenced(k[1]) : null }
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, m, { onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }), REQ)
  const body = x.ws.read('test/chatService.test.mjs')
  check('N60_an_ungrounded_assertion_in_the_only_test_case_is_disabled_by_line_the_case_and_its_grounded_assertions_stay_and_the_feature_completes', r.status === 'COMPLETED' && r.quarantinedTests === 1 && body.includes('QUARANTINED ASSERTION') && body.includes('assert.ok(listSessions()') && body.includes("getSession(s.id).messages.length, 1") && ev.some((e) => e.startsWith('QUARANTINE_ASSERTION')), `${r.status} ${r.reason}`)
  const y = makeWorld(); let asks = 0
  const noSessions = CHAT_REFERENCE['server.mjs'].split('\n').filter((l) => !l.includes("url.pathname === '/api/sessions'")).join('\n')
  const m2 = new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'server.mjs') { asks += 1; return fenced(asks <= 3 ? noSessions : CHAT_REFERENCE['server.mjs']) } return good(c) })
  const r2 = await runFeatureWorkflow(deps(y, m2), REQ)
  check('N61_a_server_that_omits_routes_the_contract_names_is_rejected_with_the_exact_routes_and_gets_a_bounded_third_retry', r2.status === 'COMPLETED' && asks === 4 && m2.calls.filter((c) => c.path === 'server.mjs')[1].prompt.includes('does not serve what the acceptance contract requires'), `${r2.status} asks=${asks} ${r2.reason}`)
}

// ---- 18. the verifier is the arbiter: an implementation edit made at the test stage that regresses the independent acceptance is reverted, and the test side is quarantined instead
{
  const LATENT = "\nexport function describeStore() { throw new Error('latent defect: describeStore is unfinished') }\n"
  const T = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { describeStore } from '../src/messageStore.mjs'\ntest('describes the store', () => { assert.strictEqual(describeStore(), 'store') })\ntest('an unrelated case', () => { assert.ok(true) })\n`
  const x = makeWorld({ limits: { maxRetries: 5 } }); const ev: string[] = []
  const breaking = SOLUTION['src/messageStore.mjs'].replace('export function saveSessions', 'export function saveSessionsOLD') + "\nexport function saveSessions(s) { return s }\nexport function describeStore() { return 'store' }\n"
  const m = new ScriptedModel((c) => {
    if (c.kind === 'file' && c.path === 'src/messageStore.mjs') return fenced(SOLUTION['src/messageStore.mjs'] + LATENT)
    if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(T)
    if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'describeStore throws an unfinished-implementation error (stack points into src/messageStore.mjs)', file: 'src/messageStore.mjs', differs: 'first attempt' })
    if (c.kind === 'repair') return fenced(breaking)
    return good(c)
  })
  const r = await runFeatureWorkflow(deps(x, m, { finalVerification: x.verification, onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }), REQ)
  check('N62_an_implementation_edit_at_the_test_stage_that_breaks_the_independent_acceptance_is_reverted_and_the_ungrounded_test_case_is_quarantined', r.status === 'COMPLETED' && ev.some((e) => e.startsWith('REVERT_REGRESSION')) && ev.some((e) => e.startsWith('QUARANTINE ')) && x.ws.read('src/messageStore.mjs').includes('saveSessions') && !x.ws.read('src/messageStore.mjs').includes('saveSessionsOLD') && (await x.verification.run()).exitCode === 0, `${r.status} ${r.reason} ${ev.filter((e) => /REVERT|QUARANT/.test(e)).join('|')}`)
}

// ---- 14. structural route repair: a prefix-first server is reordered by the engine, not rewritten by the model
{
  const srv = SOLUTION['server.mjs']
  const hider = "    if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') return send(res, 404, { error: 'not found' })\n"
  const at = srv.indexOf('    const m = ')
  const prefixFirst = at > 0 ? srv.slice(0, at) + hider + srv.slice(at) : srv
  const x = makeWorld(); const ev: string[] = []
  const m = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'server.mjs' ? fenced(prefixFirst) : good(c)))
  const r = await runFeatureWorkflow(deps(x, m, { onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }), REQ)
  check('N63_a_prefix_first_server_is_fixed_by_a_structural_route_move_with_one_model_call_for_that_file', at > 0 && r.status === 'COMPLETED' && m.calls.filter((c) => c.kind === 'file' && c.path === 'server.mjs').length === 1 && (r.routeEdits ?? []).length === 1 && r.routeEdits![0].mode === 'ENGINE_DETERMINISTIC_REPAIR' && r.routeEdits![0].ops[0].op === 'MOVE_ROUTE_BEFORE' && ev.some((e) => e.startsWith('ROUTE_EDIT')), `${r.status} ${r.reason} calls=${m.calls.filter((c) => c.path === 'server.mjs').length} edits=${(r.routeEdits ?? []).length}`)
  check('N64_the_structural_edit_is_recorded_with_before_and_after_spans_and_the_original_finding', !!r.routeEdits?.[0] && /route conflict/.test(r.routeEdits[0].finding) && r.routeEdits[0].spanBefore !== r.routeEdits[0].spanAfter && /all static gates pass|remaining gate problem/.test(r.routeEdits[0].resultAfter))
  check('N65_the_handler_body_the_model_wrote_survives_the_structural_move_unchanged', x.ws.read('server.mjs').includes("return send(res, 404, { error: 'not found' })") && x.ws.read('server.mjs').split('\n').sort().join('\n') === prefixFirst.split('\n').sort().join('\n'))
}

// ---- 15. bounded model-call timeout retry (no lost state, no duplicate side effects, recorded evidence)
{
  const TIMEOUT: ModelResult = { ok: false, detail: 'timeout or cancelled', executor: 'UNKNOWN' }
  const flaky = (inner: ScriptedModel, fail: (path: string | null, seen: number) => boolean) => { const seen = new Map<string, number>(); const prompts: string[] = []; const model: ModelClient = { async generate(input) { const p = /FILE TO (?:EDIT|CREATE): (\S+)/.exec(input.prompt)?.[1] ?? null; const n = (seen.get(String(p)) ?? 0) + 1; seen.set(String(p), n); if (fail(p, n)) { prompts.push(input.prompt); return TIMEOUT } return inner.generate(input) } }; return { model, prompts, seen } }
  const base = makeWorld(); const rb = await runFeatureWorkflow(deps(base, new ScriptedModel(good)), REQ)
  const x = makeWorld(); const ev: string[] = []
  const inner = new ScriptedModel(good); const f = flaky(inner, (p, n) => p === 'server.mjs' && n <= 2)
  const r = await runFeatureWorkflow({ ...deps(x, inner), model: f.model, onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }, REQ)
  const cpBase = latestCheckpoint(base.log, base.asg.id)!, cpX = latestCheckpoint(x.log, x.asg.id)!
  check('N66_a_timed_out_model_call_is_retried_and_the_workflow_completes_instead_of_failing', r.status === 'COMPLETED' && r.completionClass === 'CLEAN' && (r.modelTimeouts ?? []).map((t) => t.outcome).join(',') === 'RETRIED,RETRIED,RECOVERED', `${r.status} ${r.reason} ${JSON.stringify(r.modelTimeouts?.map((t) => t.outcome))}`)
  check('N67_a_retry_preserves_prior_state_and_duplicates_no_side_effect_same_files_same_effects_each_done_once_and_the_retry_prompt_is_the_one_that_timed_out', r.modelCalls === rb.modelCalls + 2 && JSON.stringify([...r.filesChanged].sort()) === JSON.stringify([...rb.filesChanged].sort()) && cpX.state.effectsDone.length === cpBase.state.effectsDone.length && new Set(cpX.state.effectsDone).size === cpX.state.effectsDone.length && inner.calls.filter((c) => c.path === 'server.mjs')[0].prompt === f.prompts[0] && Object.entries(base.ws.snapshot()).every(([k, h]) => x.ws.snapshot()[k] === h), `${r.modelCalls} vs ${rb.modelCalls}`)
  check('N68_timeout_and_retry_evidence_is_recorded_per_attempt_and_emitted_as_events_never_silent', ev.filter((e) => e.startsWith('MODEL_TIMEOUT_RETRY')).length === 2 && ev.some((e) => e.startsWith('MODEL_TIMEOUT_RECOVERED')) && (r.modelTimeouts ?? []).every((t) => t.purpose === 'server.mjs' && t.waitedMs >= 0))
  const y = makeWorld(); const ev2: string[] = []
  const inner2 = new ScriptedModel(good); const f2 = flaky(inner2, (p) => p === 'server.mjs')
  const r2 = await runFeatureWorkflow({ ...deps(y, inner2), model: f2.model, onEvent: (e) => ev2.push(`${e.kind} ${e.detail}`) }, REQ)
  const cp2 = latestCheckpoint(y.log, y.asg.id)!
  check('N69_retry_exhaustion_fails_honestly_after_exactly_three_attempts_with_the_exhaustion_recorded', r2.status === 'FAILED' && f2.seen.get('server.mjs') === 3 && /retries exhausted after 3 attempts/.test(r2.reason) && (r2.modelTimeouts ?? []).map((t) => t.outcome).join(',') === 'RETRIED,RETRIED,EXHAUSTED' && ev2.some((e) => e.startsWith('MODEL_TIMEOUT_EXHAUSTED')) && r2.completionClass === 'FAILED', `${r2.status} ${r2.reason} seen=${f2.seen.get('server.mjs')}`)
  check('N70_after_exhaustion_the_work_already_done_is_preserved_in_the_checkpoint_not_discarded', cp2.state.fileChanges.length >= 1 && cp2.state.steps.some((st) => st.status === 'DONE') && cp2.state.steps.some((st) => st.status === 'FAILED') && r2.filesChanged.length >= 1)
  const z = makeWorld(); const r3 = await runFeatureWorkflow({ ...deps(z, new ScriptedModel(good)), model: { async generate() { return { ok: false, detail: 'connection refused', executor: 'UNKNOWN' } as ModelResult } } }, REQ)
  check('N71_a_non_timeout_model_failure_is_not_retried', r3.status === 'FAILED' && (r3.modelTimeouts ?? []).length === 0 && r3.modelCalls === 1, `${r3.status} calls=${r3.modelCalls}`)
}

// ---- 16. deterministic contract correction before quarantine; ambiguity fails closed; acceptance is never weakened
{
  // criterion 2 of CHAT_FEATURE names exactly one status (404); criterion 1 names 201 and 400
  const caseOf = (name: string, expr: string, code: number) => `import test from 'node:test'\nimport assert from 'node:assert'\nimport { mkdtempSync } from 'node:fs'\nimport { tmpdir } from 'node:os'\nimport path from 'node:path'\nprocess.env.CHAT_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'chat-')), 'sessions.json')\nconst { createSession, listSessions, getSession } = await import('../src/chatService.mjs')\ntest('${name}', () => {\n  const s = createSession('alpha')\n  assert.ok(listSessions().some((x) => x.id === s.id))\n  const res = { status: ${expr} }\n  assert.strictEqual(res.status, ${code})\n})\ntest('creates and lists sessions', () => {\n  const s = createSession('beta')\n  assert.ok(listSessions().some((x) => x.id === s.id))\n})\n`
  const unknownName = 'GET sessions lists one session with its messages and unknown ids return not found'
  const unknownExpr = "(getSession('nope') ? 200 : 404)"
  const run = async (testBody: string) => {
    const x = makeWorld({ limits: { maxRetries: 3 } }); const ev: string[] = []
    const m = new ScriptedModel((c) => {
      if (c.kind === 'file' && c.path === 'test/chatService.test.mjs') return fenced(testBody)
      if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'the status expectation is wrong', file: 'test/chatService.test.mjs', differs: 'first attempt' })
      if (c.kind === 'repair') return fenced(testBody) // the model insists
      return good(c)
    })
    const r = await runFeatureWorkflow(deps(x, m, { onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }), REQ)
    return { x, r, ev }
  }
  const bad = caseOf(unknownName, unknownExpr, 410)
  const a = await run(bad)
  const fixed = a.x.ws.read('test/chatService.test.mjs')
  check('N72_a_status_assertion_that_clearly_contradicts_the_acceptance_contract_is_corrected_deterministically_not_quarantined', a.r.status === 'COMPLETED' && a.r.correctedTests === 1 && !(a.r.quarantinedTests ?? 0) && a.r.contractCorrections![0].from === 410 && a.r.contractCorrections![0].to === 404 && a.r.contractCorrections![0].criterion === 2 && a.ev.some((e) => e.startsWith('CONTRACT_CORRECTION ')) && !fixed.includes('QUARANTINED'), `${a.r.status} ${a.r.reason} ${JSON.stringify(a.r.contractCorrections)} q=${a.r.quarantinedTests} ${a.ev.filter((e) => /CORRECT|QUARANT/.test(e)).join('|')}`)
  check('N73_a_contract_corrected_completion_is_CLEAN_and_the_correction_stays_visible_separately_from_quarantine', a.r.completionClass === 'CLEAN' && (a.r.contractCorrections ?? []).length === 1)
  check('N74_no_silent_weakening_the_correction_changes_one_literal_only_and_assertion_and_test_counts_and_the_acceptance_list_are_unchanged', fixed === bad.replace('res.status, 410', 'res.status, 404') && (fixed.match(/assert\./g) ?? []).length === (bad.match(/assert\./g) ?? []).length && (fixed.match(/^test\(/gm) ?? []).length === (bad.match(/^test\(/gm) ?? []).length && JSON.stringify(latestCheckpoint(a.x.log, a.x.asg.id)!.state.acceptanceCriteria) === JSON.stringify(REQ.acceptance))
  // ambiguous: 201 is a status the contract itself names (criterion 1), so a test expecting 201 where 404 was observed is NOT auto-fixed
  const amb = caseOf(unknownName, unknownExpr, 201)
  const b = await run(amb)
  check('N75_a_test_whose_expected_status_is_named_by_the_contract_is_ambiguous_and_is_not_auto_fixed_it_falls_through_to_quarantine', b.r.status === 'COMPLETED' && !(b.r.correctedTests ?? 0) && b.r.quarantinedTests === 1 && b.r.completionClass === 'WITH_QUARANTINE' && b.ev.some((e) => e.startsWith('CONTRACT_CORRECTION_REFUSED')) && /QUARANTINED/.test(b.x.ws.read('test/chatService.test.mjs')) && !b.x.ws.read('test/chatService.test.mjs').includes('res.status, 404'), `${b.r.status} ${b.r.reason} c=${b.r.correctedTests} q=${b.r.quarantinedTests} ${b.r.completionClass}`)
  const F = (line: number, actual: string, expected: string) => [{ line, actual, expected }]
  const T1 = caseOf(unknownName, unknownExpr, 410)
  const lineOf = (t: string) => t.split('\n').findIndex((l) => l.includes('res.status,')) + 1
  const ok = correctContractAssertions('test/c.test.mjs', T1, F(lineOf(T1), '404', '410'), REQ.acceptance)
  check('N76_unit_clear_contradiction_is_corrected', !!ok && ok.corrections.length === 1 && ok.content.includes('res.status, 404'))
  const twoCodes = correctContractAssertions('test/c.test.mjs', caseOf('POST sessions with a name creates a session and rejects an empty name', '(400)', 410), F(lineOf(caseOf('POST sessions with a name creates a session and rejects an empty name', '(400)', 410)), '400', '410'), REQ.acceptance)
  check('N77_unit_a_criterion_naming_two_statuses_is_ambiguous_and_refused', !twoCodes || (twoCodes.corrections.length === 0 && twoCodes.refused.some((x) => /exactly the observed status/.test(x))))
  const nonStatus = "import test from 'node:test'\nimport assert from 'node:assert'\ntest('GET sessions lists one session with its messages and unknown ids return not found', () => {\n  const res = { body: 'x' }\n  assert.strictEqual(res.body, 'y')\n})\n"
  const ns = correctContractAssertions('test/c.test.mjs', nonStatus, F(5, 'x', 'y'), REQ.acceptance)
  check('N78_unit_a_non_status_assertion_is_never_touched', !ns || (ns.corrections.length === 0 && ns.content === nonStatus))
  const unmapped = correctContractAssertions('test/c.test.mjs', caseOf('zebra quartz', unknownExpr, 410), F(lineOf(caseOf('zebra quartz', unknownExpr, 410)), '404', '410'), REQ.acceptance)
  check('N79_unit_a_test_that_maps_to_no_single_criterion_is_refused', !unmapped || (unmapped.corrections.length === 0 && unmapped.refused.some((x) => /exactly one acceptance criterion/.test(x))))
  const unseen = correctContractAssertions('test/c.test.mjs', T1, F(lineOf(T1), '500', '999'), REQ.acceptance)
  check('N80_unit_a_failure_report_that_does_not_carry_the_literal_is_refused', !unseen || unseen.corrections.length === 0)
  check('N81_the_four_completion_classes_stay_separate_and_a_quarantined_completion_is_never_CLEAN', completionClass({ status: 'COMPLETED', quarantinedTests: 0 }, true) === 'CLEAN' && completionClass({ status: 'COMPLETED', quarantinedTests: 2 }, true) === 'WITH_QUARANTINE' && completionClass({ status: 'COMPLETED', quarantinedTests: 0 }, false) === 'UNVERIFIED' && completionClass({ status: 'COMPLETED', quarantinedTests: 0 }, null) === 'UNVERIFIED' && completionClass({ status: 'FAILED' }, true) === 'FAILED' && completionClass({ status: 'COMPLETED', quarantinedTests: 3 }, false) === 'UNVERIFIED')
}
// ---- 17. Sovereign Build Law in the workflow: local-first, bounded + isolated frontier assist, Foundry ingestion, independent test writer, competing candidates
{
  const buggyServer = CHAT_REFERENCE['server.mjs'].replaceAll("send(res, 404, { error: 'session not found' })", "send(res, 400, { error: 'session not found' })")
  const noop = (c: ScriptCtx) => { const m = /CURRENT CONTENT:\n```\n([\s\S]*?)\n```/.exec(c.prompt); return m ? fenced(m[1]) : null }
  const filePhase = (c: ScriptCtx) => (c.kind === 'file' && c.path === 'server.mjs' ? fenced(buggyServer) : good(c))
  const localOnly = () => new ScriptedModel((c) => (c.kind === 'repair' ? noop(c) : filePhase(c)))
  // a LABELLED TEST DOUBLE standing in for a hosted provider; it can only return text (the bridge gives it no workspace access)
  const fakeProvider = (reply: (prompt: string) => string | null, available = true) => { const asked: string[] = []; const p: FrontierProvider = { family: 'claude', model: 'hosted:claude', available: () => available, ask: async (i) => { asked.push(i.prompt); const t = reply(i.prompt); return t === null ? { ok: false, detail: 'no reply' } : { ok: true, text: t } } }; return { p, asked } }
  const reviewDir = path.join(tmp(), 'frontier-review')
  const x = makeWorld({ limits: { maxRetries: 5 } }); const ev: string[] = []
  const fp = fakeProvider(() => fenced(CHAT_REFERENCE['server.mjs']))
  const r = await runFeatureWorkflow(deps(x, localOnly(), { frontier: { provider: fp.p, reviewDir }, onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }), REQ)
  const rec = r.frontier!.records[0]
  check('S20_after_two_local_hypotheses_are_refuted_a_bounded_frontier_assist_is_requested_for_the_one_file_and_foundry_integrates_it', r.status === 'COMPLETED' && fp.asked.length === 1 && !!rec && rec.decision === 'ACCEPTED' && rec.contextScope.files.join() === 'server.mjs' && ev.some((e) => e.startsWith('FRONTIER_ASSIST_REQUEST')) && ev.some((e) => /^FRONTIER_ASSIST_RESULT .*ACCEPTED/.test(e)), `${r.status} ${r.reason} ${JSON.stringify(rec?.steps)} asked=${fp.asked.length}`)
  check('S21_the_request_is_bounded_it_names_the_mission_build_subtask_allowed_file_forbidden_actions_and_is_not_the_whole_project', fp.asked[0].includes(r.build!.missionId) && fp.asked[0].includes(r.build!.buildId) && fp.asked[0].includes('ALLOWED FILES (you may only return content for these): server.mjs') && fp.asked[0].includes('FORBIDDEN') && fp.asked[0].length < 12_000 && !fp.asked[0].includes(x.ws.read('public/app.js').slice(0, 300)) && !fp.asked[0].includes(x.ws.read('public/index.html').slice(0, 300)), `len=${fp.asked[0].length} app.js=${fp.asked[0].includes('public/app.js')} mission=${fp.asked[0].includes(r.build!.missionId)} build=${fp.asked[0].includes(r.build!.buildId)} allowed=${fp.asked[0].includes('ALLOWED FILES (you may only return content for these): server.mjs')}`)
  check('S22_the_frontier_reply_lands_in_the_isolated_review_area_outside_the_workspace_with_provenance_and_hash', !!rec.artifactPath && existsSync(rec.artifactPath) && !rec.artifactPath.startsWith(x.root) && JSON.parse(readFileSync(rec.artifactPath, 'utf8')).provider === 'claude' && rec.artifactHash.length === 16 && rec.provider === 'claude' && rec.model === 'hosted:claude' && rec.steps.map((st) => st.stage).join() === 'RECEIVE,PROVENANCE,SCOPE,STATIC_VALIDATION,LOCAL_REVIEW,INTEGRATION_CANDIDATE,TESTS,INDEPENDENT_VERIFICATION' && rec.steps.every((st) => st.ok))
  check('S23_acceptance_is_still_decided_by_foundrys_own_independent_verification_not_by_the_frontier', (await x.verification.run()).exitCode === 0 && r.frontier!.usage.accepted_contributions === 1 && r.frontier!.usage.frontier_calls === 1 && r.frontier!.usage.rejected_contributions === 0)
  check('S24_a_clean_build_that_integrated_a_frontier_contribution_is_reported_as_CLEAN_WITH_FRONTIER_ASSIST_distinct_from_local_only', r.completionClass === 'CLEAN' && r.cleanKind === 'CLEAN_WITH_FRONTIER_ASSIST' && r.frontier!.usage.clean_outcome_delta === 1 && r.subtasks!.some((st) => st.kind === 'FRONTIER_ASSIST_SUBTASK' && st.status === 'ACCEPTED' && st.owner === 'frontier:claude') && r.subtasks!.filter((st) => st.kind === 'MAIN_BUILD').length === 1)
  // local-first: when local resources fix it, the frontier is never asked
  const y = makeWorld({ limits: { maxRetries: 5 } })
  const fp2 = fakeProvider(() => fenced(CHAT_REFERENCE['server.mjs']))
  const fixesLocally = new ScriptedModel((c) => (c.kind === 'repair' ? (c.path === 'server.mjs' ? fenced(CHAT_REFERENCE['server.mjs']) : noop(c)) : filePhase(c)))
  const r2 = await runFeatureWorkflow(deps(y, fixesLocally, { frontier: { provider: fp2.p, reviewDir } }), REQ)
  check('S25_local_first_when_a_local_repair_succeeds_the_frontier_is_never_consulted_and_the_clean_build_is_CLEAN_LOCAL_ONLY', r2.status === 'COMPLETED' && fp2.asked.length === 0 && r2.frontier!.usage.frontier_calls === 0 && r2.cleanKind === 'CLEAN_LOCAL_ONLY', `${r2.status} asked=${fp2.asked.length} ${r2.cleanKind}`)
  // an unhelpful frontier patch is rejected and reverted
  const z = makeWorld({ limits: { maxRetries: 5 } }); const evz: string[] = []
  const fp3 = fakeProvider(() => fenced(buggyServer))
  const r3 = await runFeatureWorkflow(deps(z, localOnly(), { frontier: { provider: fp3.p, reviewDir }, onEvent: (e) => evz.push(`${e.kind} ${e.detail}`) }), REQ)
  const rec3 = r3.frontier!.records[0]
  check('S26_a_frontier_patch_with_no_measurable_benefit_is_rejected_and_the_file_is_restored_and_the_build_is_not_clean', !!rec3 && rec3.decision === 'REJECTED' && rec3.measuredBenefit.length > 0 && r3.frontier!.usage.rejected_contributions === 1 && r3.cleanKind === null && r3.completionClass !== 'CLEAN' && z.ws.read('server.mjs') === buggyServer, `${r3.status} ${rec3?.decision} ${rec3?.measuredBenefit}`)
  // unavailable provider: honest, local-only
  const u = makeWorld({ limits: { maxRetries: 5 } }); const evu: string[] = []
  const fp4 = fakeProvider(() => fenced(CHAT_REFERENCE['server.mjs']), false)
  const r4 = await runFeatureWorkflow(deps(u, localOnly(), { frontier: { provider: fp4.p, reviewDir }, onEvent: (e) => evu.push(`${e.kind} ${e.detail}`) }), REQ)
  check('S27_an_unconfigured_provider_is_reported_FRONTIER_UNAVAILABLE_and_is_never_called_or_faked', fp4.asked.length === 0 && r4.frontier!.usage.unavailable !== null && /FRONTIER_UNAVAILABLE/.test(r4.frontier!.usage.unavailable!) && evu.some((e) => e.startsWith('FRONTIER_UNAVAILABLE')) && r4.frontier!.usage.frontier_calls === 0 && r4.status !== 'COMPLETED')
  const bz = makeWorld({ limits: { maxRetries: 5 } })
  const fp5 = fakeProvider(() => fenced(CHAT_REFERENCE['server.mjs']))
  const r5 = await runFeatureWorkflow(deps(bz, localOnly(), { frontier: { provider: fp5.p, reviewDir, maxCalls: 0 } }), REQ)
  check('S28_a_zero_frontier_budget_forces_a_local_only_build', fp5.asked.length === 0 && r5.frontier!.usage.frontier_calls === 0 && r5.status !== 'COMPLETED')

  // independent test writer: the builder never authors the test file; the writer authors only it
  const w = makeWorld(); const evw: string[] = []
  const builder = new ScriptedModel(good), writer = new ScriptedModel(good)
  const r6 = await runFeatureWorkflow(deps(w, builder, { testWriter: { label: 'writer-model', model: writer }, onEvent: (e) => evw.push(`${e.kind} ${e.detail}`) }), REQ)
  check('S29_the_independent_test_writer_authors_only_the_tests_layer_files_and_the_builder_never_does', r6.status === 'COMPLETED' && builder.calls.filter((c) => c.kind === 'file').every((c) => !c.path?.startsWith('test/')) && writer.calls.length > 0 && writer.calls.every((c) => c.path?.startsWith('test/')) && r6.testAuthoring!.writer === 'writer-model', `${r6.status} builderTests=${builder.calls.filter((c) => c.path?.startsWith('test/')).length} writer=${writer.calls.map((c) => c.path).join()}`)
  // contract-grounding challenge before execution
  const g = makeWorld(); const evg: string[] = []
  const ungrounded = `import test from 'node:test'\nimport assert from 'node:assert'\ntest('wording of an internal helper label', () => { assert.strictEqual(1, 1) })\n`
  let asks = 0
  const writer2 = new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'test/chatService.test.mjs') { asks += 1; return /TEST REVIEWER/.test(c.prompt) ? fenced(SOLUTION['test/chatService.test.mjs'].replace(/^test\('/gm, "test('[C1] ")) : fenced(ungrounded) } return good(c) })
  const r7 = await runFeatureWorkflow(deps(g, new ScriptedModel(good), { testWriter: { label: 'writer-2', model: writer2 }, onEvent: (e) => evg.push(`${e.kind} ${e.detail}`) }), REQ)
  const grounds = r7.testGrounding!['test/chatService.test.mjs'] ?? []
  check('S30_a_test_that_maps_to_no_criterion_is_challenged_before_it_runs_and_the_rewrite_replaces_it_with_no_quarantine', r7.status === 'COMPLETED' && asks === 2 && evg.some((e) => e.startsWith('REJECT') && e.includes('TEST REVIEWER')) && !(r7.quarantinedTests ?? 0) && !grounds.some((x) => x.name.includes('wording of an internal helper label')), `${r7.status} asks=${asks} q=${r7.quarantinedTests} ${evg.filter((e) => /REJECT/.test(e)).join('|').slice(0, 200)}`)
  check('S31_every_generated_test_has_a_grounding_record_with_source_and_confidence', grounds.length > 0 && grounds.every((x) => x.source === 'writer-2' && ['TAGGED', 'INFERRED', 'NONE'].includes(x.confidence) && x.behavior.length > 0))

  // competing local candidates: the invented-expectation test is replaced by a passing competing candidate BEFORE any quarantine
  const mk = (extra: string) => `import test from 'node:test'\nimport assert from 'node:assert'\nimport { describeStore } from '../src/messageStore.mjs'\ntest('sessions round-trip through the data file', () => { assert.strictEqual(describeStore(), 'store') })\n${extra}`
  const impl = SOLUTION['src/messageStore.mjs'] + "\nexport function describeStore() { return 'store' }\n"
  const invented = mk("test('wording of the store label', () => { assert.strictEqual(describeStore(), 'STORE (primary, v2)') })\n")
  const sane = mk("test('the store label is a string', () => { assert.strictEqual(typeof describeStore(), 'string') })\n")
  const mkBuilder = () => new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'src/messageStore.mjs') return fenced(impl); if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(invented); if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'the test expects another string', file: 'test/messageStore.test.mjs', differs: 'first attempt' }); if (c.kind === 'repair') return fenced(invented); return good(c) })
  const c1 = makeWorld({ limits: { maxRetries: 3 } }); const evc: string[] = []
  const cand = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(sane) : null))
  const r8 = await runFeatureWorkflow(deps(c1, mkBuilder(), { testCandidates: [{ label: 'cand-a', model: cand }], onEvent: (e) => evc.push(`${e.kind} ${e.detail}`) }), REQ)
  check('S32_a_passing_competing_local_candidate_replaces_the_failing_test_file_with_no_quarantine_and_the_build_is_CLEAN_LOCAL_ONLY', r8.status === 'COMPLETED' && !(r8.quarantinedTests ?? 0) && c1.ws.read('test/messageStore.test.mjs') === sane && r8.testAuthoring!.candidates.some((k) => k.label === 'cand-a' && k.passed && k.kept) && evc.some((e) => e.startsWith('TEST_CANDIDATE_CHOSEN')) && r8.completionClass === 'CLEAN' && r8.cleanKind === 'CLEAN_LOCAL_ONLY', `${r8.status} ${r8.reason} q=${r8.quarantinedTests} ${JSON.stringify(r8.testAuthoring)}`)
  const c2 = makeWorld({ limits: { maxRetries: 3 } })
  const candBad = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(invented) : null))
  const r9 = await runFeatureWorkflow(deps(c2, mkBuilder(), { testCandidates: [{ label: 'cand-bad', model: candBad }] }), REQ)
  check('S33_when_no_competing_candidate_passes_the_existing_quarantine_still_applies_and_the_build_is_WITH_QUARANTINE_never_CLEAN', r9.status === 'COMPLETED' && (r9.quarantinedTests ?? 0) >= 1 && r9.completionClass === 'WITH_QUARANTINE' && r9.cleanKind === null && r9.testAuthoring!.candidates.every((k) => !k.passed), `${r9.status} ${r9.completionClass} q=${r9.quarantinedTests}`)
  // independent-writer fallback: a writer that only produces unusable (syntactically broken) test files must not fail the step; the builder gets bounded tries
  const fbW = makeWorld(); const evf: string[] = []
  const broken = "import test from 'node:test'\ntest('[C1] broken', () => {\n  const s = 'unterminated\n"
  const brokenWriter = new ScriptedModel((c) => (c.kind === 'file' && c.path?.startsWith('test/') ? fenced(broken) : null))
  const fbBuilder = new ScriptedModel(good)
  const r10 = await runFeatureWorkflow(deps(fbW, fbBuilder, { testWriter: { label: 'broken-writer', model: brokenWriter }, onEvent: (e) => evf.push(`${e.kind} ${e.detail}`) }), REQ)
  check('S35_when_the_independent_writer_only_produces_unusable_files_the_builder_gets_bounded_tries_and_the_step_does_not_fail', r10.status === 'COMPLETED' && evf.some((e) => e.startsWith('TEST_WRITER_FALLBACK')) && fbBuilder.calls.some((c) => c.path?.startsWith('test/')) && brokenWriter.calls.length >= 1 && ['test/messageStore.test.mjs', 'test/chatService.test.mjs'].every((f) => brokenWriter.calls.filter((c) => c.path === f).length <= 4), `${r10.status} ${r10.reason} writerCalls=${brokenWriter.calls.map((c) => c.path).join()} builderTestCalls=${fbBuilder.calls.filter((c) => c.path?.startsWith('test/')).map((c) => c.path).join()}`)
  // ---- selective helpers: bounded share, protected reserve, one candidate per file by default, evidence of unmet escalation, governance fields
  const c3 = makeWorld({ limits: { maxRetries: 3 } }); const evh: string[] = []
  const candR = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(sane) : null))
  const r11 = await runFeatureWorkflow(deps(c3, mkBuilder(), { testCandidates: [{ label: 'cand-r', model: candR }], helperPolicy: { reserveCalls: 39 }, onEvent: (e) => evh.push(`${e.kind} ${e.detail}`) }), REQ)
  check('S40w_the_reserve_for_the_main_build_and_final_verifier_blocks_helpers_candidates_are_never_asked_and_quarantine_still_applies', candR.calls.length === 0 && evh.some((e) => e.startsWith('HELPER_BUDGET_EXHAUSTED')) && r11.status === 'COMPLETED' && (r11.quarantinedTests ?? 0) >= 1 && r11.completionClass === 'WITH_QUARANTINE', `${r11.status} calls=${candR.calls.length} q=${r11.quarantinedTests} ${evh.filter((e) => /HELPER/.test(e)).join('|').slice(0, 160)}`)
  const c4 = makeWorld({ limits: { maxRetries: 3 } })
  const first = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(invented) : null)), second = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(sane) : null))
  await runFeatureWorkflow(deps(c4, mkBuilder(), { testCandidates: [{ label: 'first', model: first }, { label: 'second', model: second }] }), REQ)
  check('S41w_helpers_are_selective_only_one_candidate_per_test_file_by_default', first.calls.length === 1 && second.calls.length === 0)
  const c5 = makeWorld({ limits: { maxRetries: 3 } })
  const first2 = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(invented) : null)), second2 = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(sane) : null))
  const r12 = await runFeatureWorkflow(deps(c5, mkBuilder(), { testCandidates: [{ label: 'first', model: first2 }, { label: 'second', model: second2 }], maxCandidatesPerFile: 2 }), REQ)
  check('S42w_the_per_file_candidate_cap_is_configurable_and_a_later_passing_candidate_then_wins', second2.calls.length === 1 && r12.testAuthoring!.candidates.some((k) => k.label === 'second' && k.passed && k.kept) && !(r12.quarantinedTests ?? 0), `${r12.status} q=${r12.quarantinedTests}`)
  const base2 = makeWorld(); const rb2 = await runFeatureWorkflow(deps(base2, new ScriptedModel(good)), REQ)
  const c6 = makeWorld(); const cand0 = new ScriptedModel(() => null)
  const r13 = await runFeatureWorkflow(deps(c6, new ScriptedModel(good), { testCandidates: [{ label: 'idle', model: cand0 }], testWriter: undefined }), REQ)
  check('S43w_helpers_configured_but_not_needed_cost_nothing_a_clean_first_pass_never_calls_them', r13.status === 'COMPLETED' && cand0.calls.length === 0 && r13.cleanKind === 'CLEAN_LOCAL_ONLY' && r13.modelCalls === rb2.modelCalls, `${r13.status} ${r13.modelCalls} vs ${rb2.modelCalls}`)
  // escalation criteria met but nothing to serve them: recorded as evidence, never faked
  const un = makeWorld({ limits: { maxRetries: 5 } }); const evu2: string[] = []
  const r14 = await runFeatureWorkflow(deps(un, localOnly(), { onEvent: (e) => evu2.push(`${e.kind} ${e.detail}`) }), REQ)
  const um = r14.frontier!.usage.escalation_needed_unmet
  check('S44w_a_met_escalation_trigger_in_a_local_only_build_is_recorded_as_unmet_evidence_with_its_trigger_file_and_reason', um.length === 1 && um[0].trigger === 'ACCEPTANCE_FAILED_SAME_COMPONENT' && um[0].file === 'server.mjs' && /no frontier provider is configured/.test(um[0].reason) && evu2.some((e) => e.startsWith('ESCALATION_NEEDED_UNMET')) && r14.frontier!.usage.frontier_calls === 0, JSON.stringify(um))
  check('S45w_an_accepted_assist_carries_full_governance_fields_reason_local_attempts_files_tokens_cost_and_clean_impact', rec.reasonForEscalation.trigger === 'ACCEPTANCE_FAILED_SAME_COMPONENT' && rec.reasonForEscalation.basis.length > 10 && rec.localAttemptsBefore >= 2 && rec.sharedFiles.join() === 'server.mjs' && rec.tokensEstimated.in > 0 && rec.tokensEstimated.out > 0 && rec.cost === 'UNKNOWN' && rec.artifactHash.length === 16 && rec.cleanOutcomeImpact === 'CLEAN_AFTER_ACCEPTED_ASSIST' && r.frontier!.usage.escalation_needed_unmet.length === 0, JSON.stringify({ a: rec.reasonForEscalation, l: rec.localAttemptsBefore, i: rec.cleanOutcomeImpact }))
  check('S46w_a_rejected_assist_is_marked_ASSIST_REJECTED', rec3.cleanOutcomeImpact === 'ASSIST_REJECTED')
  check('S34_acceptance_criteria_are_untouched_by_candidates_assist_or_grounding', [r, r6, r7, r8].every((rr, i) => rr.status === 'COMPLETED' && rr.build!.assignmentId.length > 0 && i >= 0) && JSON.stringify(latestCheckpoint(c1.log, c1.asg.id)!.state.acceptanceCriteria) === JSON.stringify(REQ.acceptance) && JSON.stringify(latestCheckpoint(x.log, x.asg.id)!.state.acceptanceCriteria) === JSON.stringify(REQ.acceptance))
}
// ---- 18. test-authoring escalation (grounded, local-first, isolated, Foundry-integrated) and transient local-model 5xx retry
{
  const impl = SOLUTION['src/messageStore.mjs'] + "\nexport function describeStore() { return 'store' }\n"
  const head = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { describeStore } from '../src/messageStore.mjs'\n`
  const base = `test('[C4] sessions round-trip through the data file', () => { assert.strictEqual(describeStore(), 'store') })\n`
  const groundedBad = head + base + `test('[C4] sessions and their messages are persisted to disk and survive a server restart', () => { assert.strictEqual(describeStore(), 'STORE (primary, v2)') })\n`
  const groundedGood = head + base + `test('[C4] sessions and their messages are persisted to disk and survive a server restart', () => { assert.strictEqual(typeof describeStore(), 'string') })\n`
  const ungroundedBad = head + base + `test('wording of the store label', () => { assert.strictEqual(describeStore(), 'STORE (primary, v2)') })\n`
  const lostCoverage = head + `test('[C5] the data file path comes from the CHAT_DATA_FILE environment variable', () => { assert.strictEqual(typeof describeStore(), 'string') })\n`
  const mkBuilder = (body: string) => new ScriptedModel((c) => { if (c.kind === 'file' && c.path === 'src/messageStore.mjs') return fenced(impl); if (c.kind === 'file' && c.path === 'test/messageStore.test.mjs') return fenced(body); if (c.kind === 'analyst') return JSON.stringify({ hypothesis: 'the test expects another string', file: 'test/messageStore.test.mjs', differs: 'first attempt' }); if (c.kind === 'repair') return fenced(body); return good(c) })
  const failingCandidate = (body: string) => new ScriptedModel((c) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(body) : null))
  const fakeProv = (reply: (prompt: string) => string | null, available = true, onAsk?: () => void) => { const asked: string[] = []; const p: FrontierProvider = { family: 'claude', model: 'hosted:claude', available: () => available, ask: async (i) => { asked.push(i.prompt); onAsk?.(); const t = reply(i.prompt); return t === null ? { ok: false, detail: 'no reply' } : { ok: true, text: t } } }; return { p, asked } }
  const reviewDir = path.join(tmp(), 'ta-review')
  const run = async (body: string, prov: ReturnType<typeof fakeProv> | null, extra: Partial<WorkflowDeps> = {}) => {
    const x = makeWorld({ limits: { maxRetries: 3 } }); const ev: string[] = []
    const cand = failingCandidate(body)
    const r = await runFeatureWorkflow(deps(x, mkBuilder(body), { testCandidates: [{ label: 'local-cand', model: cand }], ...(prov ? { frontier: { provider: prov.p, reviewDir } } : {}), onEvent: (e) => ev.push(`${e.kind} ${e.detail}`), ...extra }), REQ)
    return { x, r, ev, cand }
  }
  // 1. grounded, candidate failed, assist accepted
  let seenInAsk = ''
  const x1 = makeWorld({ limits: { maxRetries: 3 } })
  const p1 = fakeProv(() => fenced(groundedGood), true, () => { seenInAsk = x1.ws.read('test/messageStore.test.mjs') })
  const ev1: string[] = []
  const r1 = await runFeatureWorkflow(deps(x1, mkBuilder(groundedBad), { testCandidates: [{ label: 'local-cand', model: failingCandidate(groundedBad) }], frontier: { provider: p1.p, reviewDir }, onEvent: (e) => ev1.push(`${e.kind} ${e.detail}`) }), REQ)
  const rec1 = r1.frontier!.records.find((k) => k.returnType === 'TEST_PATCH_PROPOSAL')
  check('T01_a_grounded_failing_test_on_a_verified_implementation_triggers_the_test_authoring_assist_and_Foundry_integrates_it_with_no_quarantine', r1.status === 'COMPLETED' && p1.asked.length === 1 && !!rec1 && rec1.decision === 'ACCEPTED' && !(r1.quarantinedTests ?? 0) && x1.ws.read('test/messageStore.test.mjs') === groundedGood && rec1.reasonForEscalation.trigger === 'TEST_CANDIDATES_EXHAUSTED', `${r1.status} ${r1.reason} asked=${p1.asked.length} q=${r1.quarantinedTests} ${rec1?.decision} ${rec1?.reason}`)
  check('T02_a_local_candidate_is_tried_before_any_assist', ev1.findIndex((e) => e.startsWith('TEST_CANDIDATE ')) >= 0 && ev1.findIndex((e) => e.startsWith('TEST_CANDIDATE ')) < ev1.findIndex((e) => e.startsWith('FRONTIER_ASSIST_REQUEST')) && r1.testAuthoring!.candidates.some((k) => k.label === 'local-cand' && !k.passed))
  check('T03_the_assist_request_carries_only_the_bounded_test_context_criteria_failing_file_assertions_observed_values_implementation_and_candidate_results', p1.asked[0].includes('SUBTASK') && p1.asked[0].includes('FAILING TEST FILE test/messageStore.test.mjs') && p1.asked[0].includes('FAILING ASSERTIONS') && p1.asked[0].includes('IMPLEMENTATION THAT ALREADY PASSES') && p1.asked[0].includes('LOCAL CANDIDATE RESULTS') && p1.asked[0].includes('ACCEPTANCE CRITERIA') && p1.asked[0].includes('FORBIDDEN') && p1.asked[0].includes('TEST_PATCH_PROPOSAL') && !p1.asked[0].includes('public/app.js') && p1.asked[0].length < 16_000)
  check('T04_the_assist_output_stays_isolated_the_workspace_test_file_is_unchanged_while_the_request_is_outstanding_and_the_artifact_is_outside_the_workspace', seenInAsk.includes('STORE (primary, v2)') && !!rec1!.artifactPath && existsSync(rec1!.artifactPath) && !rec1!.artifactPath.startsWith(x1.root) && rec1!.steps.map((st) => st.stage).join() === 'RECEIVE,PROVENANCE,SCOPE,STATIC_VALIDATION,LOCAL_REVIEW,INTEGRATION_CANDIDATE,TESTS,INDEPENDENT_VERIFICATION' && rec1!.steps.every((st) => st.ok))
  check('T05_an_accepted_test_assist_is_CLEAN_WITH_FRONTIER_ASSIST_acceptance_criteria_are_unchanged_and_the_verifier_still_passes', r1.completionClass === 'CLEAN' && r1.cleanKind === 'CLEAN_WITH_FRONTIER_ASSIST' && JSON.stringify(latestCheckpoint(x1.log, x1.asg.id)!.state.acceptanceCriteria) === JSON.stringify(REQ.acceptance) && (await x1.verification.run()).exitCode === 0 && rec1!.cleanOutcomeImpact === 'CLEAN_AFTER_ACCEPTED_ASSIST')
  // 2. ungrounded weak test: no assist
  const p2 = fakeProv(() => fenced(groundedGood))
  const a2 = await run(ungroundedBad, p2)
  check('T06_an_ungrounded_weak_test_does_not_trigger_any_assist_and_is_quarantined_as_before', p2.asked.length === 0 && a2.r.frontier!.usage.escalation_needed_unmet.length === 0 && a2.r.completionClass === 'WITH_QUARANTINE' && (a2.r.quarantinedTests ?? 0) >= 1, `${a2.r.status} asked=${p2.asked.length} unmet=${a2.r.frontier!.usage.escalation_needed_unmet.length}`)
  // 3. assist must not lose criterion coverage / is rejected and the workspace is left as it was
  const p3 = fakeProv(() => fenced(lostCoverage))
  const a3 = await run(groundedBad, p3)
  const rec3 = a3.r.frontier!.records.find((k) => k.returnType === 'TEST_PATCH_PROPOSAL')
  check('T07_an_assist_that_drops_a_covered_criterion_is_rejected_at_the_grounding_check_and_nothing_is_written', !!rec3 && rec3.decision === 'REJECTED' && rec3.steps.some((st) => st.stage === 'LOCAL_REVIEW' && !st.ok && /lose coverage/.test(st.note)) && !a3.x.ws.read('test/messageStore.test.mjs').includes('[C5] the data file path') && a3.r.completionClass === 'WITH_QUARANTINE' && JSON.stringify(latestCheckpoint(a3.x.log, a3.x.asg.id)!.state.acceptanceCriteria) === JSON.stringify(REQ.acceptance), `${rec3?.decision} ${rec3?.reason}`)
  const p4 = fakeProv(() => fenced(groundedBad))
  const a4 = await run(groundedBad, p4)
  const rec4 = a4.r.frontier!.records.find((k) => k.returnType === 'TEST_PATCH_PROPOSAL')
  check('T08_an_assist_whose_tests_still_fail_locally_is_rejected_and_the_workspace_is_restored_then_quarantine_applies', !!rec4 && rec4.decision === 'REJECTED' && rec4.steps.some((st) => st.stage === 'TESTS' && !st.ok) && rec4.cleanOutcomeImpact === 'ASSIST_REJECTED' && a4.r.completionClass === 'WITH_QUARANTINE' && a4.r.cleanKind === null, `${rec4?.decision} ${rec4?.reason} ${a4.r.completionClass}`)
  const p5 = fakeProv(() => fenced(groundedGood.replace('import { describeStore } from', 'import { describeStore, nothingHere } from') + '\nconst x = (\n'))
  const a5 = await run(groundedBad, p5)
  const rec5 = a5.r.frontier!.records.find((k) => k.returnType === 'TEST_PATCH_PROPOSAL')
  check('T09_an_assist_with_a_syntax_error_fails_Foundrys_static_validation_and_is_never_written', !!rec5 && rec5.decision === 'REJECTED' && rec5.steps.some((st) => st.stage === 'STATIC_VALIDATION' && !st.ok) && !a5.x.ws.read('test/messageStore.test.mjs').includes('const x = ('))
  // 4. no provider / unavailable provider: honest, unserved opportunity, not a failure of the bridge
  const a6 = await run(groundedBad, null)
  const um6 = a6.r.frontier!.usage.escalation_needed_unmet
  check('T10_with_no_provider_the_met_trigger_is_recorded_as_an_unserved_opportunity_and_no_assist_is_simulated', um6.length === 1 && um6[0].trigger === 'TEST_CANDIDATES_EXHAUSTED' && um6[0].file === 'test/messageStore.test.mjs' && /no frontier provider is configured/.test(um6[0].reason) && a6.r.frontier!.usage.frontier_calls === 0 && a6.r.frontier!.records.length === 0 && a6.r.completionClass === 'WITH_QUARANTINE' && a6.ev.some((e) => e.startsWith('ESCALATION_NEEDED_UNMET')))
  const p7 = fakeProv(() => fenced(groundedGood), false)
  const a7 = await run(groundedBad, p7)
  check('T11_an_unconfigured_provider_reports_FRONTIER_UNAVAILABLE_and_is_never_called', p7.asked.length === 0 && a7.ev.some((e) => e.startsWith('FRONTIER_UNAVAILABLE')) && /FRONTIER_UNAVAILABLE/.test(a7.r.frontier!.usage.unavailable ?? '') && a7.r.frontier!.usage.escalation_needed_unmet.length === 1)
  check('T12_the_unserved_opportunity_is_attributable_the_implementation_was_independently_verified', a7.r.completionClass === 'WITH_QUARANTINE' && (await a7.x.verification.run()).exitCode === 0)
  check('T13_budget_accounting_assist_calls_never_consume_model_call_budget_and_the_local_flow_is_identical', a7.r.modelCalls === r1.modelCalls && a6.r.modelCalls === r1.modelCalls && r1.frontier!.usage.frontier_calls === 1 && a7.r.frontier!.usage.frontier_calls === 0, `${a7.r.modelCalls}/${a6.r.modelCalls}/${r1.modelCalls}`)

  // ---- transient local-model errors
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const failing = (inner: ScriptedModel, failFor: (path: string | null, n: number) => string | null) => { const seen = new Map<string, number>(); const inputs: { prompt: string; temperature?: number; seed?: number }[] = []; const model: ModelClient = { async generate(input) { const p = /FILE TO (?:EDIT|CREATE): (\S+)/.exec(input.prompt)?.[1] ?? null; const n = (seen.get(String(p)) ?? 0) + 1; seen.set(String(p), n); const d = failFor(p, n); if (d) { inputs.push({ prompt: input.prompt, temperature: input.temperature, seed: input.seed }); return { ok: false, detail: d, executor: 'UNKNOWN' } as ModelResult } return inner.generate(input) } }; return { model, seen, inputs } }
  const bw = makeWorld(); const rbase = await runFeatureWorkflow(deps(bw, new ScriptedModel(good)), REQ)
  for (const code of [500, 503]) {
    const w = makeWorld(); const ev: string[] = []
    const inner = new ScriptedModel(good); const f = failing(inner, (p, n) => (p === 'server.mjs' && n <= (code === 500 ? 2 : 1) ? `HTTP ${code}` : null))
    const r = await runFeatureWorkflow({ ...deps(w, inner), model: f.model, onEvent: (e) => ev.push(`${e.kind} ${e.detail}`) }, REQ)
    const exp = code === 500 ? 'RETRIED,RETRIED,RECOVERED' : 'RETRIED,RECOVERED'
    check(`T20_http_${code}_is_retried_and_the_workflow_completes`, r.status === 'COMPLETED' && (r.modelTransients ?? []).map((t) => t.outcome).join() === exp && (r.modelTransients ?? []).every((t) => t.kind === 'TRANSIENT') && ev.some((e) => e.startsWith('MODEL_TRANSIENT_RETRY')) && ev.some((e) => e.startsWith('MODEL_TRANSIENT_RECOVERED')) && (r.modelTimeouts ?? []).length === 0, `${r.status} ${JSON.stringify(r.modelTransients?.map((t) => t.outcome))}`)
    check(`T21_http_${code}_retries_preserve_state_repeat_the_same_prompt_and_sampling_and_count_honestly_against_the_budget`, r.modelCalls === rbase.modelCalls + (code === 500 ? 2 : 1) && f.inputs.every((i) => i.prompt === f.inputs[0].prompt && i.temperature === f.inputs[0].temperature && i.seed === f.inputs[0].seed) && JSON.stringify([...r.filesChanged].sort()) === JSON.stringify([...rbase.filesChanged].sort()) && Object.entries(bw.ws.snapshot()).every(([k, h]) => w.ws.snapshot()[k] === h))
  }
  const ex = makeWorld(); const evx: string[] = []
  const innerX = new ScriptedModel(good); const fx = failing(innerX, (p) => (p === 'server.mjs' ? 'HTTP 502' : null))
  const rx = await runFeatureWorkflow({ ...deps(ex, innerX), model: fx.model, onEvent: (e) => evx.push(`${e.kind} ${e.detail}`) }, REQ)
  check('T22_transient_retry_exhaustion_fails_honestly_after_exactly_three_attempts', rx.status === 'FAILED' && fx.seen.get('server.mjs') === 3 && /retries exhausted after 3 attempts/.test(rx.reason) && (rx.modelTransients ?? []).map((t) => t.outcome).join() === 'RETRIED,RETRIED,EXHAUSTED' && evx.some((e) => e.startsWith('MODEL_TRANSIENT_EXHAUSTED')) && rx.completionClass === 'FAILED')
  const bad400 = makeWorld(); const innerB = new ScriptedModel(good); const fb = failing(innerB, (p) => (p === 'server.mjs' ? 'HTTP 400' : null))
  const rb4 = await runFeatureWorkflow({ ...deps(bad400, innerB), model: fb.model }, REQ)
  check('T23_http_400_is_a_request_error_and_is_not_retried', rb4.status === 'FAILED' && fb.seen.get('server.mjs') === 1 && (rb4.modelTransients ?? []).length === 0 && (rb4.modelTimeouts ?? []).length === 0)
  const nm = makeWorld(); const innerN = new ScriptedModel(good); const fn = failing(innerN, (p) => (p === 'server.mjs' ? 'HTTP 404' : null))
  const rn = await runFeatureWorkflow({ ...deps(nm, innerN), model: fn.model }, REQ)
  check('T24_an_invalid_model_name_http_404_is_not_retried', rn.status === 'FAILED' && fn.seen.get('server.mjs') === 1 && (rn.modelTransients ?? []).length === 0)
  for (const mode of ['pause', 'cancel'] as const) {
    const gw = makeWorld(); let calls = 0
    const gm: ModelClient = { async generate() { calls += 1; if (mode === 'pause') pauseAssignment(gw.log, gw.asg.id, C, 'operator pause'); else requestCancel(gw.log, gw.asg.id, C, 'operator cancel'); await sleep(900); return { ok: false, detail: 'HTTP 503', executor: 'UNKNOWN' } as ModelResult } }
    const rg = await runFeatureWorkflow({ ...deps(gw, new ScriptedModel(good)), model: gm }, REQ)
    check(`T25_${mode}_is_never_retried_even_when_the_model_error_looks_transient`, calls === 1 && (rg.modelTransients ?? []).length === 0 && (rg.modelTimeouts ?? []).length === 0 && rg.status !== 'COMPLETED', `${mode} calls=${calls} ${rg.status} ${rg.reason}`)
  }
}

// ---- 6. contract-first test authoring (Phase 10): plan -> writer -> reviewer -> static -> execute; quarantine last
{
  const { harnessSource, HARNESS_PATH } = await import('./testPlan')
  const head = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { existsSync } from 'node:fs'\nimport { withApp } from './support/harness.mjs'\n`
  const C1 = `test('[C1] creates a named session and rejects an empty name', () => withApp(async (app) => {\n  const r = await app.post('/api/sessions', { name: 'alpha' })\n  assert.strictEqual(r.status, 201)\n  assert.strictEqual(r.body.name, 'alpha')\n  assert.strictEqual((await app.post('/api/sessions', { name: '' })).status, 400)\n}))\n`
  const C2 = `test('[C2] lists sessions, returns one with its messages and answers 404 for unknown ids', () => withApp(async (app) => {\n  const a = await app.post('/api/sessions', { name: 'a' })\n  const list = await app.get('/api/sessions')\n  assert.strictEqual(list.status, 200)\n  assert.ok(list.body.some((s) => s.id === a.body.id))\n  const one = await app.get('/api/sessions/' + a.body.id)\n  assert.strictEqual(one.status, 200)\n  assert.deepStrictEqual(one.body.messages, [])\n  assert.strictEqual((await app.get('/api/sessions/nope')).status, 404)\n}))\n`
  const C3 = `test('[C3] stores a message in that session only', () => withApp(async (app) => {\n  const a = await app.post('/api/sessions', { name: 'a' }), b = await app.post('/api/sessions', { name: 'b' })\n  const m = await app.post('/api/sessions/' + a.body.id + '/messages', { text: 'hi', author: 'x' })\n  assert.strictEqual(m.status, 201)\n  assert.strictEqual((await app.get('/api/sessions/' + a.body.id)).body.messages.length, 1)\n  assert.strictEqual((await app.get('/api/sessions/' + b.body.id)).body.messages.length, 0)\n}))\n`
  const C4 = `test('[C4] PERSISTENCE: sessions and messages survive a restart', () => withApp(async (app) => {\n  const a = await app.post('/api/sessions', { name: 'keep' })\n  await app.post('/api/sessions/' + a.body.id + '/messages', { text: 'still here', author: 'x' })\n  await app.restart()\n  const after = await app.get('/api/sessions/' + a.body.id)\n  assert.strictEqual(after.status, 200)\n  assert.strictEqual(after.body.messages.length, 1)\n}))\n`
  const C5 = `test('[C5] CUSTOM_PATH: the data file comes from CHAT_DATA_FILE', () => withApp(async (app) => {\n  await app.post('/api/sessions', { name: 'x' })\n  assert.ok(existsSync(app.storageFile('CHAT_DATA_FILE')))\n}))\ntest('[C5] DEFAULT_PATH: the default data file is under the working directory', () => withApp(async (app) => {\n  await app.post('/api/sessions', { name: 'x' })\n  assert.ok(existsSync(app.cwd + '/data/sessions.json'))\n}, { defaultStorage: true }))\n`
  const C6 = `test('[C6] the legacy messages endpoints keep working', () => withApp(async (app) => {\n  const p = await app.post('/api/messages', { text: 'legacy' })\n  assert.strictEqual(p.status, 201)\n  assert.strictEqual((await app.get('/api/messages')).body.length, 1)\n}))\n`
  const F1 = 'test/contract.api-1.test.mjs', F2 = 'test/contract.api-2.test.mjs'
  const FILE1 = head + C1 + C2 + C3 + C4, FILE2 = head + C5 + C6
  const mkWriter = (over: Record<string, (n: number) => string> = {}) => { const seen = new Map<string, number>(); return new ScriptedModel((c) => { if (c.kind === 'file' && c.path && /^test\/contract\./.test(c.path)) { const n = (seen.get(c.path) ?? 0) + 1; seen.set(c.path, n); if (over[c.path]) return fenced(over[c.path](n)); return fenced(c.path === F1 ? FILE1 : FILE2) } return good(c) }) }
  const ev = (list: string[]) => (e: { kind: string; detail: string }) => { list.push(`${e.kind} ${e.detail}`) }

  // P30: the success path
  const x = makeWorld(); const evs: string[] = []; const w = mkWriter()
  const r = await runFeatureWorkflow(deps(x, w, { contractTests: true, onEvent: ev(evs) }), REQ)
  check('P30_contract_mode_builds_the_implementation_then_authors_planned_contract_tests_and_the_run_is_CLEAN_LOCAL_ONLY', r.status === 'COMPLETED' && r.completionClass === 'CLEAN' && r.cleanKind === 'CLEAN_LOCAL_ONLY' && (r.quarantinedTests ?? 0) === 0 && (r.cleanBlockers ?? []).length === 0, `${r.status} ${r.reason} ${r.completionClass} blockers=${(r.cleanBlockers ?? []).join('|')} q=${r.quarantinedTests}`)
  check('P31_the_plan_is_in_the_result_unit_style_test_files_are_not_created_and_the_harness_is_Foundry_text_exactly', r.testPlan!.files.length === 2 && !r.filesChanged.includes('test/messageStore.test.mjs') && !x.ws.exists('test/messageStore.test.mjs') && x.ws.exists(F1) && x.ws.exists(F2) && x.ws.read(HARNESS_PATH) === harnessSource('server.mjs', ['CHAT_DATA_FILE']) && evs.some((e) => e.startsWith('HARNESS_WRITTEN')))
  check('P32_every_generated_test_is_traceable_to_a_criterion_with_generator_reviewer_and_confidence', r.testTraceability!.length === 7 && r.testTraceability!.every((t) => t.criterion_ids.length === 1 && t.generated_by && t.reviewed_by.includes('foundry:deterministic-review') && t.confidence === 'TAGGED') && r.testTraceability!.map((t) => t.criterion_ids[0]).sort().join() === '1,2,3,4,5,5,6')
  check('P33_the_writer_prompt_carries_only_the_rows_of_its_own_file_and_the_harness_api', (() => { const p1 = w.calls.find((c) => c.path === F1)!.prompt, p2 = w.calls.find((c) => c.path === F2)!.prompt; return p1.includes('APPROVED TEST PLAN FOR ' + F1) && p1.includes('[C4]') && !p1.includes('[C5] the data file') && p2.includes('[C5]') && p2.includes('[C6]') && p1.includes('withApp') && !p1.includes('TEST OBLIGATIONS') })())
  check('P34_the_reverse_order_run_agrees_with_the_forward_run_so_no_hidden_shared_state_is_recorded', evs.some((e) => /^ORDER_CHECK .*passes like the forward run/.test(e)) && !(r.cleanBlockers ?? []).some((b) => /order/.test(b)))
  check('P35_the_independent_verifier_passed_before_the_tests_were_authored_so_the_implementation_is_verified_ground_truth', x.ws.exists(F1) && (await x.verification.run()).exitCode === 0 && evs.findIndex((e) => e.startsWith('WRITE ' + F1)) > evs.findIndex((e) => e.startsWith('WRITE public/index.html')))

  // P36: rejected before execution when the file breaks the plan (imports the implementation); the second try is the one that runs
  const y = makeWorld(); const evy: string[] = []
  const wy = mkWriter({ [F1]: (n) => (n === 1 ? FILE1.replace("import { withApp }", "import { allMessages } from '../src/messageStore.mjs'\nimport { withApp }") : FILE1) })
  const ry = await runFeatureWorkflow(deps(y, wy, { contractTests: true, onEvent: ev(evy) }), REQ)
  check('P36_a_test_file_that_breaks_the_plan_is_rejected_by_the_reviewer_BEFORE_it_runs_and_the_corrected_file_completes_CLEAN', ry.completionClass === 'CLEAN' && evy.some((e) => e.startsWith('REJECT ' + F1) && /TEST REVIEWER: IMPORTS_IMPLEMENTATION/.test(e)) && wy.calls.filter((c) => c.path === F1).length === 2, `${ry.status} ${ry.completionClass} ${evy.filter((e) => e.startsWith('REJECT')).join('|').slice(0, 300)}`)

  // P37: ungrounded tests are removed BEFORE execution (recorded; not a quarantine because they never ran)
  const z = makeWorld(); const evz: string[] = []
  const extra = `test('internal helper label wording', () => withApp(async (app) => { assert.strictEqual((await app.get('/')).status, 200) }))\n`
  const rz = await runFeatureWorkflow(deps(z, mkWriter({ [F1]: () => FILE1 + extra }), { contractTests: true, onEvent: ev(evz) }), REQ)
  check('P37_an_ungrounded_test_is_rejected_before_execution_and_recorded_while_every_grounded_test_stays', rz.status === 'COMPLETED' && evz.some((e) => e.startsWith('TEST_REJECTED_BEFORE_EXECUTION')) && (rz.testReviews ?? []).some((t) => t.verdict === 'REJECTED_UNGROUNDED' && t.findings.includes('internal helper label wording')) && !z.ws.read(F1).includes("test('internal helper label wording'") && z.ws.read(F1).includes('REJECTED BEFORE EXECUTION') && rz.completionClass === 'CLEAN' && (rz.quarantinedTests ?? 0) === 0, `${rz.status} ${rz.completionClass} ${evz.filter((e) => /REJECT|QUAR/.test(e)).join('|').slice(0, 300)}`)

  // P38/P39/P40: a SEPARATE local reviewer judges the file before it runs; one bounded revision, accepted only if it still passes the static and plan checks
  const rv1 = makeWorld(); const reviewer = new ScriptedModel(() => JSON.stringify({ verdict: 'REVISE', problems: ['C2 should also assert the list contains the new session'] }))
  const w3 = mkWriter({ [F1]: (n) => (n === 1 ? FILE1 : FILE1 + '// revised after review\n') })
  const r3 = await runFeatureWorkflow(deps(rv1, w3, { contractTests: true, testReviewer: { label: 'reviewer-model', model: reviewer } }), REQ)
  check('P38_the_reviewer_is_a_different_model_than_the_writer_and_an_accepted_revision_is_recorded_with_its_reviewer', r3.status === 'COMPLETED' && reviewer.calls.length === 2 && r3.testReviews!.some((t) => t.reviewer === 'reviewer-model' && t.verdict === 'REVISE' && t.findings[0].includes('C2')) && r3.testReviews!.some((t) => t.verdict === 'REVISION_ACCEPTED') && rv1.ws.read(F1).includes('revised after review') && r3.testTraceability!.every((t) => t.reviewed_by.includes('reviewer-model')), `${r3.status} ${r3.reason} reviewerCalls=${reviewer.calls.length}`)
  const rv2 = makeWorld()
  const w4 = mkWriter({ [F1]: (n) => (n === 1 ? FILE1 : FILE1.replace("import { withApp }", "import { allMessages } from '../src/messageStore.mjs'\nimport { withApp }")) })
  const r4 = await runFeatureWorkflow(deps(rv2, w4, { contractTests: true, testReviewer: { label: 'reviewer-model', model: new ScriptedModel(() => JSON.stringify({ verdict: 'REVISE', problems: ['rewrite it'] })) } }), REQ)
  check('P39_a_reviewer_driven_revision_that_breaks_the_plan_is_rejected_and_the_already_reviewed_file_is_kept', r4.status === 'COMPLETED' && r4.testReviews!.some((t) => t.verdict === 'REVISION_REJECTED') && !rv2.ws.read(F1).includes('../src/messageStore.mjs') && r4.completionClass === 'CLEAN', `${r4.status} ${r4.reason}`)
  const rv3 = makeWorld(); const quiet = new ScriptedModel(() => JSON.stringify({ verdict: 'OK' })); const w5 = mkWriter()
  const r5 = await runFeatureWorkflow(deps(rv3, w5, { contractTests: true, testReviewer: { label: 'reviewer-model', model: quiet } }), REQ)
  check('P40_an_OK_verdict_costs_one_review_call_per_file_and_no_extra_writer_call', r5.completionClass === 'CLEAN' && quiet.calls.length === 2 && w5.calls.filter((c) => c.path === F1).length === 1 && w5.calls.filter((c) => c.path === F2).length === 1, `${r5.completionClass} reviewerCalls=${quiet.calls.length}`)

  // P41: a status literal that contradicts the contract is CORRECTED deterministically (coverage kept, not a quarantine) and classified TEST_DEFECT
  const cx = makeWorld(); const evc: string[] = []
  const wrong = FILE1.replace("assert.strictEqual((await app.get('/api/sessions/nope')).status, 404)", "assert.strictEqual((await app.get('/api/sessions/nope')).status, 410)")
  const rc = await runFeatureWorkflow(deps(cx, mkWriter({ [F1]: () => wrong }), { contractTests: true, onEvent: ev(evc) }), REQ)
  check('P41_a_contract_contradicting_status_assertion_is_corrected_not_quarantined_and_the_defect_is_classified_TEST_DEFECT', rc.status === 'COMPLETED' && (rc.correctedTests ?? 0) >= 1 && (rc.quarantinedTests ?? 0) === 0 && rc.completionClass === 'CLEAN' && (rc.testDefects ?? []).some((d) => d.kind === 'TEST_DEFECT' && d.file === F1) && cx.ws.read(F1).includes("'/api/sessions/nope')).status, 404)"), `${rc.status} ${rc.completionClass} corr=${rc.correctedTests} q=${rc.quarantinedTests} defects=${JSON.stringify(rc.testDefects)} ${evc.filter((e) => /CORRECT|QUAR/.test(e)).join('|').slice(0, 300)}`)

  // P42: an invented expectation the contract does not state: ONE alternate candidate is tried AFTER the writer's own retries and the correction attempt; the better candidate wins and nothing is quarantined
  const order: string[] = []
  const invented = FILE1.replace('assert.deepStrictEqual(one.body.messages, [])', "assert.strictEqual(one.body.nickname, 'alpha')")
  const w6 = mkWriter({ [F1]: () => invented }); const origGen = w6.generate.bind(w6); w6.generate = async (i) => { order.push(/debugging analyst/.test(i.system) ? 'analyst' : 'writer'); return origGen(i) }
  const alt = mkWriter(); const altGen = alt.generate.bind(alt); alt.generate = async (i) => { order.push('candidate'); return altGen(i) }
  const cd = makeWorld(); const evd: string[] = []
  const rd = await runFeatureWorkflow(deps(cd, w6, { contractTests: true, testCandidates: [{ label: 'alt-local', model: alt }], onEvent: ev(evd) }), REQ)
  const candAt = order.indexOf('candidate')
  check('P42_the_alternate_local_candidate_is_the_LAST_local_step_before_quarantine_and_a_passing_candidate_avoids_quarantine_entirely', rd.status === 'COMPLETED' && candAt > 0 && order.slice(0, candAt).includes('analyst') && alt.calls.length === 1 && (rd.quarantinedTests ?? 0) === 0 && rd.completionClass === 'CLEAN' && (rd.testAuthoring?.candidates ?? []).some((k) => k.label === 'alt-local' && k.passed && k.kept) && (rd.testDefects ?? []).some((d) => d.file === F1), `${rd.status} ${rd.completionClass} order=${order.join(',')} q=${rd.quarantinedTests} ${evd.filter((e) => /CANDID|QUAR/.test(e)).join('|').slice(0, 300)}`)

  // P43: when the candidate also fails, QUARANTINE is the final fallback; the lost coverage keeps the run out of CLEAN
  const qx = makeWorld(); const evq: string[] = []
  const rq = await runFeatureWorkflow(deps(qx, mkWriter({ [F1]: () => invented }), { contractTests: true, testCandidates: [{ label: 'alt-bad', model: mkWriter({ [F1]: () => invented }) }], onEvent: ev(evq) }), REQ)
  check('P43_quarantine_comes_last_after_the_candidate_failed_and_the_run_is_not_CLEAN', rq.status === 'COMPLETED' && (rq.quarantinedTests ?? 0) >= 1 && rq.completionClass === 'WITH_QUARANTINE' && rq.cleanKind === null && evq.findIndex((e) => e.startsWith('TEST_CANDIDATE ')) >= 0 && evq.findIndex((e) => e.startsWith('QUARANTINE')) > evq.findIndex((e) => e.startsWith('TEST_CANDIDATE ')), `${rq.status} ${rq.completionClass} q=${rq.quarantinedTests} ${evq.filter((e) => /CANDID|QUAR/.test(e)).join('|').slice(0, 300)}`)

  // P80..P89: short test names and the reserved test-rescue budget
  {
    const LONG = 'POST /api/sessions with a name creates a session and answers 201 with the name and a numeric id and an empty messages list; an empty name is rejected with 400; repeating the request never reuses an id'
    const longNamed = FILE1.replace(/test\('\[C1\] [^']*'/, `test('[C1] ${LONG}'`)
    const nm = makeWorld(); const evn: string[] = []
    const rn = await runFeatureWorkflow(deps(nm, mkWriter({ [F1]: () => longNamed }), { contractTests: true, onEvent: ev(evn) }), REQ)
    const finalNames = testNames(F1, nm.ws.read(F1))
    check('P80_an_overlong_test_name_is_shortened_before_the_review_to_a_tagged_short_label', rn.status === 'COMPLETED' && finalNames.every((n) => n.length <= 80) && finalNames.some((n) => /^\[C1\] POST \/api\/sessions/.test(n)) && (rn.testAuthoring?.nameRewrites ?? []).length >= 1 && evn.some((e) => e.startsWith('TEST_NAMES_SHORTENED')), `${rn.status} ${rn.reason} names=${finalNames.join('|').slice(0, 300)}`)
    const blank = (t: string) => t.replace(/^test\('[^']*'/gm, "test(''")
    const restored = blank(nm.ws.read(F1))
    check('P81_only_the_name_literal_changes_the_test_body_and_every_assertion_are_byte_identical', restored === blank(FILE1), `bodies differ (${restored.length} vs ${blank(FILE1).length})`)
    check('P82_criterion_traceability_survives_the_rename_the_rewrite_records_criterion_old_and_new_name_and_the_test_still_grounds_to_C1', (rn.testAuthoring?.nameRewrites ?? []).some((w) => w.criterion === 1 && w.from.includes(LONG.slice(0, 40)) && w.to.length <= 80) && (rn.testTraceability ?? []).some((t) => t.file === F1 && t.criterion_ids.includes(1)) && rn.completionClass === 'CLEAN', `${rn.completionClass}`)

    // rescue: the normal helper threshold (runtime share 0 = "already past 70%") no longer starves the final candidate
    const rs1 = makeWorld(); const evr: string[] = []
    const w7 = mkWriter({ [F1]: () => invented }); const alt7 = mkWriter()
    const rr1 = await runFeatureWorkflow(deps(rs1, w7, { contractTests: true, helperPolicy: { runtimeShare: 0 }, testCandidates: [{ label: 'alt-local', model: alt7 }], onEvent: ev(evr) }), REQ)
    const rsv = rr1.testAuthoring?.rescue
    check('P83_one_final_candidate_rescue_still_runs_after_the_normal_runtime_threshold_and_avoids_quarantine', rr1.status === 'COMPLETED' && alt7.calls.length === 1 && rr1.completionClass === 'CLEAN' && (rr1.quarantinedTests ?? 0) === 0 && !!rsv && rsv.rescue_attempted && rsv.used_calls === 1 && rsv.rescue_skipped_reason === null && !evr.some((e) => e.startsWith('HELPER_BUDGET_EXHAUSTED') && /competing/.test(e)), `${rr1.status} ${rr1.completionClass} ${JSON.stringify(rsv)} ${evr.filter((e) => /HELPER|RESCUE/.test(e)).join('|')}`)
    check('P84_the_rescue_ledger_reports_reserved_and_used_calls_and_time', !!rsv && rsv.reserved_calls >= 1 && rsv.reserved_time_ms > 0 && rsv.used_time_ms >= 0 && rsv.used_calls <= rsv.reserved_calls, JSON.stringify(rsv))
    const rs2 = makeWorld()
    const rr2 = await runFeatureWorkflow(deps(rs2, mkWriter({ [F1]: () => invented }), { contractTests: true, rescueReserve: { calls: 10_000, ms: 10 ** 12 }, testCandidates: [{ label: 'alt-local', model: mkWriter() }] }), REQ)
    check('P85_the_reserve_can_never_exceed_the_global_hard_budget', !!rr2.testAuthoring?.rescue && rr2.testAuthoring.rescue.reserved_calls <= Math.floor(40 * 0.2) && rr2.testAuthoring.rescue.reserved_time_ms <= Math.floor(600_000 * 0.2), JSON.stringify(rr2.testAuthoring?.rescue))
    // quarantine still happens when the rescue fails, and the rescue stays bounded to one candidate
    const rs3 = makeWorld(); const bad3 = mkWriter({ [F1]: () => invented })
    const rr3 = await runFeatureWorkflow(deps(rs3, mkWriter({ [F1]: () => invented }), { contractTests: true, helperPolicy: { runtimeShare: 0 }, testCandidates: [{ label: 'alt-bad', model: bad3 }] }), REQ)
    check('P86_a_failed_rescue_is_bounded_to_one_candidate_and_quarantine_still_follows_never_CLEAN', rr3.status === 'COMPLETED' && bad3.calls.length === 1 && (rr3.quarantinedTests ?? 0) >= 1 && rr3.completionClass === 'WITH_QUARANTINE' && rr3.cleanKind === null && (rr3.testAuthoring?.rescue?.used_calls ?? 0) === 1, `${rr3.completionClass} cand=${bad3.calls.length} ${JSON.stringify(rr3.testAuthoring?.rescue)}`)
    check('P87_no_acceptance_criterion_is_weakened_by_the_rescue_or_the_rename_every_criterion_is_still_covered', [rn, rr1].every((r) => (r.cleanBlockers ?? []).length === 0) && [1, 2, 3, 4].every((c) => (rn.testTraceability ?? []).some((t) => t.criterion_ids.includes(c))), JSON.stringify((rn.testTraceability ?? []).map((t) => t.criterion_ids)))
    // hard stops: the rescue never overrides the call ceiling
    const rs4 = makeWorld({ limits: { maxModelCalls: 30 } }); const alt4 = mkWriter()
    const rr4 = await runFeatureWorkflow(deps(rs4, mkWriter({ [F1]: () => invented }), { contractTests: true, rescueReserve: { calls: 0, ms: 0 }, helperPolicy: { runtimeShare: 0 }, testCandidates: [{ label: 'alt', model: alt4 }] }), REQ)
    check('P88_with_no_reserve_configured_the_old_threshold_still_applies_and_the_skip_reason_is_recorded', alt4.calls.length === 0 && rr4.testAuthoring?.rescue?.rescue_skipped_reason === 'NO_RESERVE' && rr4.testAuthoring.rescue.rescue_attempted === false, JSON.stringify(rr4.testAuthoring?.rescue))
  }

  {
    // P89: earlier repair activity cannot spend the reserve. Each earlier test-writer call advances a virtual clock by 45s of a 120s assignment: without the reserve the repairs run the clock out and the
    // candidate is blocked by the global hard timeout; with it the repairs stop early and the candidate still gets its one bounded attempt.
    let f1Calls = 0, skew = 0
    const slow = async (reserve: { calls: number; ms: number } | undefined) => {
      f1Calls = 0
      const wx = makeWorld({ limits: { maxRuntimeMs: 120_000 } }); const altx = mkWriter(); const evx: string[] = []
      const wr = mkWriter({ [F1]: () => invented }); const og = wr.generate.bind(wr)
      wr.generate = async (i) => { if (/FILE TO (?:CREATE|FIX): test\/contract\.api-1/.test(i.prompt)) { f1Calls += 1; skew += 45_000 } return og(i) }
      const realNow = Date.now; skew = 0; Date.now = () => realNow() + skew
      let r: Awaited<ReturnType<typeof runFeatureWorkflow>>
      try { r = await runFeatureWorkflow(deps(wx, wr, { contractTests: true, ...(reserve ? { rescueReserve: reserve } : {}), testCandidates: [{ label: 'alt-local', model: altx }], onEvent: ev(evx) }), REQ) } finally { Date.now = realNow }
      return { r, alt: altx.calls.length, f1: f1Calls }
    }
    const held = await slow(undefined), none = await slow({ calls: 0, ms: 0 })
    console.log('P89TRY', held.r.reason, '|', none.r.reason, held.f1, none.f1, held.alt, held.r.status, JSON.stringify(held.r.testAuthoring?.rescue), '|', none.alt, none.r.status, JSON.stringify(none.r.testAuthoring?.rescue))
    check('P89_the_reserved_candidate_allowance_survives_earlier_repairs_that_would_otherwise_run_the_clock_out', held.alt === 1 && held.r.testAuthoring?.rescue?.rescue_attempted === true && held.r.testAuthoring.rescue.used_calls === 1 && none.alt === 0, `held=${held.alt} none=${none.alt} ${JSON.stringify(held.r.testAuthoring?.rescue)}`)
    // P90: a pause or cancel stops the work: the rescue is never started once the Commander has stopped the assignment
    for (const mode of ['pause', 'cancel'] as const) {
      const wx = makeWorld(); const altx = mkWriter(); let fileCalls = 0
      const wr = mkWriter({ [F1]: () => invented }); const og = wr.generate.bind(wr)
      wr.generate = async (i) => { if (/test\/contract\.api-1/.test(i.prompt)) { fileCalls += 1; if (fileCalls === 3) { if (mode === 'pause') pauseAssignment(wx.log, wx.asg.id, C, 'operator pause', NOW); else requestCancel(wx.log, wx.asg.id, C, 'operator cancel', NOW) } } return og(i) }
      const r = await runFeatureWorkflow(deps(wx, wr, { contractTests: true, testCandidates: [{ label: 'alt-local', model: altx }] }), REQ)
      check(`P90_${mode}_stops_the_work_immediately_and_the_reserved_rescue_is_never_started`, altx.calls.length === 0 && r.status === (mode === 'pause' ? 'PAUSED' : 'CANCELLED'), `${r.status} alt=${altx.calls.length} ${JSON.stringify(r.testAuthoring?.rescue)}`)
    }
  }

  // P44: omitting a required criterion cannot produce CLEAN (weakening by omission)
  const om = makeWorld()
  const rm = await runFeatureWorkflow(deps(om, mkWriter({ [F1]: () => head + C1 + C2 + C3 }), { contractTests: true }), REQ)
  check('P44_a_file_that_still_omits_a_required_criterion_after_the_bounded_rewrites_is_never_CLEAN', rm.status === 'COMPLETED' && rm.completionClass !== 'CLEAN' && (rm.cleanBlockers ?? []).some((b) => /C4/.test(b)) && rm.cleanKind === null, `${rm.status} ${rm.completionClass} ${(rm.cleanBlockers ?? []).join('|')}`)

  // P45: replay reuses the independently verified implementation: no implementation file is regenerated and only the contract test files cost model calls
  const rp = makeWorld()
  for (const [f, t] of Object.entries(SOLUTION)) if (!f.startsWith('test/')) rp.ws.write(f, t)
  const wp = mkWriter()
  const rrp = await runFeatureWorkflow(deps(rp, wp, { contractTests: true, reuseImplementation: true }), REQ)
  check('P45_replay_reuses_the_verified_implementation_regenerates_nothing_and_only_authors_the_contract_tests', rrp.status === 'COMPLETED' && wp.calls.length === 2 && wp.calls.every((c) => /^test\/contract\./.test(c.path ?? '')) && !rrp.filesChanged.some((f) => /^(src|public)\//.test(f) || f === 'server.mjs') && rrp.completionClass === 'CLEAN', `${rrp.status} ${rrp.reason} calls=${wp.calls.map((c) => c.path).join(',')}`)

  // P47: a per-clause test that asserts the wrong status for ITS clause is corrected deterministically in the workflow (criterion reported as the parent), classified TEST_DEFECT, and the run stays CLEAN
  const pc = makeWorld(); const evp: string[] = []
  const C1split = `test('[C1] POST /api/sessions with a name creates a session (201)', () => withApp(async (app) => {\n  const r = await app.post('/api/sessions', { name: 'alpha' })\n  assert.strictEqual(r.status, 201)\n  assert.strictEqual(r.body.name, 'alpha')\n}))\ntest('[C1] rejects an empty name (400)', () => withApp(async (app) => {\n  const r = await app.post('/api/sessions', { name: '' })\n  assert.strictEqual(r.status, 200)\n}))\n`
  const rpc = await runFeatureWorkflow(deps(pc, mkWriter({ [F1]: () => head + C1split + C2 + C3 + C4 }), { contractTests: true, onEvent: ev(evp) }), REQ)
  check('P47_a_wrong_status_in_a_per_clause_test_is_corrected_against_its_own_clause_and_reported_under_the_parent_criterion', rpc.status === 'COMPLETED' && (rpc.correctedTests ?? 0) === 1 && rpc.contractCorrections![0].criterion === 1 && rpc.contractCorrections![0].from === 200 && rpc.contractCorrections![0].to === 400 && (rpc.quarantinedTests ?? 0) === 0 && rpc.completionClass === 'CLEAN' && pc.ws.read(F1).includes('assert.strictEqual(r.status, 400)'), `${rpc.status} ${rpc.completionClass} corr=${rpc.correctedTests} q=${rpc.quarantinedTests} ${evp.filter((e) => /CORREC|QUAR/.test(e)).join('|').slice(0, 300)}`)

  // P46: the legacy flow (no contractTests) is unchanged: unit-style test files, no plan, no harness
  const lg = makeWorld()
  const rl = await runFeatureWorkflow(deps(lg, new ScriptedModel(good)), REQ)
  check('P46_without_contractTests_the_legacy_flow_is_unchanged_no_plan_no_harness_no_contract_files', rl.status === 'COMPLETED' && rl.testPlan === null && !lg.ws.exists(HARNESS_PATH) && !lg.ws.exists(F1) && (rl.cleanBlockers ?? []).length === 0)
}

finish()

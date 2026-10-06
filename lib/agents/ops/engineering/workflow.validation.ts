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
const SESSIONS_TEST = CHAT_REFERENCE['test/chatSessions.test.mjs'].replace(/^import test[\s\S]*?\n\n/, '')
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
  check('N04_checkpoints_carry_objective_acceptance_steps_file_hashes_and_validations', checkpointHistory(x.log, x.asg.id).length >= 6 && cp.state.steps.every((s) => s.status === 'DONE' || s.status === 'SKIPPED') && cp.state.fileChanges.length >= 5 && cp.state.fileChanges.every((c) => c.afterHash.length === 64) && cp.state.validations.some((vv) => vv.command.includes('verify.mjs') && vv.status === 'PASSED') && cp.state.acceptanceCriteria.length === 7)
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
void deriveAssignments; void AgentRegistry
finish()

/**
 * REAL-MODEL specialist lifecycle proof (not a validator; nothing here is scripted). Every model call goes to the local Ollama model.
 *   need detected -> capability evidence -> reuse/create decision -> specialist proposed -> Commander approves/activates -> assignment -> real model execution
 *   -> independent validation -> failure (resource limit) -> successor continues from the checkpoint -> result -> evaluation recorded (Phase 9 event) -> final lifecycle state
 * plus, on real runs: mid-call cancellation, pause/resume, resource-limit enforcement and duplicate prevention.
 * The missions use a SMALL cross-layer task so the lifecycle can be exercised repeatedly; capability evidence for hard features lives in the Forge benchmarks.
 * Usage: node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/ops/engineering/e2eLifecycleReal.ts <outDir> <model>
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { AgentOpsLog } from '../log'
import { AgentRegistry, deriveAgents } from '../registry'
import { detectNeed } from '../need'
import { NEED_CRITERIA, type EngineeringTool } from '../types'
import { assign, deriveAssignments, keyFor, pauseAssignment, requestCancel, resumeAssignment, startAssignment, type AssignDraft } from './assignments'
import { makeAlertApp } from './alertFixture'
import { capabilityEvidence, decideSpecialist, proposeSpecialist } from './engineeringNeed'
import { continueAssignment, latestCheckpoint } from './continuity'
import { OllamaModelClient } from './runtime/ollamaModel'
import { makeIndependentVerification } from './runtime/verifier'
import { Workspace } from './runtime/workspaceFs'
import { runFeatureWorkflow, type WorkflowResult } from './workflow'
import { evaluateAgent } from '../evaluation'
import { LearningLog } from '@/lib/recursive-learning/store'
import { emitEngineeringRun } from '@/lib/agents/forge/phase9'
import type { BenchmarkRecord } from '@/lib/agents/forge/types'
import { classifyRun } from '@/lib/agents/forge/failureClass'

const outDir = process.argv[2]
const modelName = process.argv[3]
if (!outDir || !modelName) { console.error('usage: e2eLifecycleReal.ts <outDir> <model>'); process.exit(2) }
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const engineSha = process.env.ENGINE_SHA || (() => { try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD']).toString().trim() } catch { return 'UNKNOWN' } })()
const wsBase = path.join(process.env.HOME ?? '.', 'WarRoomProjects', 'p10-lifecycle', stamp)
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const C = 'commander:acceptance'

// ---- the small mission: independent contract + verifier (distinct from the benchmark fixtures)
const MINI = {
  request: 'Add an event counter: the API reports how many events have been recorded and the page shows it.',
  acceptance: [
    'GET /api/events/count returns {"count":n} where n is the number of recorded events (0 when there are none)',
    'the page shows the count in an element with id event-count, filled from /api/events/count',
    'the existing GET/POST /api/events endpoints keep working',
    'node tests cover the new counting function',
  ],
  hints: ['event', 'count'],
}
const MINI_VERIFY = `import { spawn } from 'node:child_process'
const root = process.argv[2]
let n = 0, pass = 0, fail = 0
const report = (ok, name, detail = '') => { n += 1; if (ok) pass += 1; else fail += 1; console.log((ok ? 'ok ' : 'not ok ') + n + ' - ' + name + (ok || !detail ? '' : '\\n  message: ' + String(detail).slice(0, 240))) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 21000 + Math.floor(Math.random() * 15000)
const child = spawn('node', ['server.mjs'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port) }, stdio: 'ignore' })
const base = 'http://127.0.0.1:' + port
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) { if (child.exitCode !== null) break; try { await fetch(base + '/', { signal: AbortSignal.timeout(300) }); up = true } catch { await sleep(100) } }
  if (!up) throw new Error('server did not start')
  const j = async (p, o) => { const r = await fetch(base + p, o); let b = null; try { b = await r.json() } catch {} return { s: r.status, b } }
  const c0 = await j('/api/events/count')
  report(c0.s === 200 && c0.b && c0.b.count === 0, 'count is 0 before any event', JSON.stringify(c0))
  await j('/api/events', { method: 'POST', body: JSON.stringify({ message: 'one' }) }); const p2 = await j('/api/events', { method: 'POST', body: JSON.stringify({ message: 'two' }) })
  const c2 = await j('/api/events/count')
  report(p2.s === 201 && c2.s === 200 && c2.b && c2.b.count === 2, 'count reflects recorded events', JSON.stringify(c2))
  const l = await j('/api/events')
  report(Array.isArray(l.b) && l.b.length === 2, 'the existing events list keeps working', JSON.stringify(l))
  const html = await (await fetch(base + '/')).text(); const js = await (await fetch(base + '/client.js')).text()
  report(/id="event-count"/.test(html) && /\\/api\\/events\\/count/.test(js), 'the page has event-count and the client calls /api/events/count', 'html=' + /id="event-count"/.test(html))
} catch (e) { report(false, 'verification could not complete', String(e.message || e)) } finally { child.kill('SIGKILL') }
console.log('# tests ' + n); console.log('# pass ' + pass); console.log('# fail ' + fail)
process.exit(fail === 0 && n >= 4 ? 0 : 1)
`

const log = new AgentOpsLog(path.join(outDir, `agent-ops-${stamp}`))
const reg = new AgentRegistry(log)
const p9 = new LearningLog(path.join(outDir, `phase9-${stamp}`))
const real = new OllamaModelClient(modelName)
const trace = path.join(outDir, `lifecycle-trace-${stamp}.jsonl`)
const evidence: Record<string, unknown> = { stamp, engineSha, model: modelName }
const say = (k: string, v: unknown) => { evidence[k] = v; console.log(`## ${k}: ${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 600)}`) }
let modelCalls = 0
const traced = { async generate(input: Parameters<OllamaModelClient['generate']>[0]) { const t0 = Date.now(); const r = await real.generate(input); modelCalls += 1; appendFileSync(trace, JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - t0, ok: r.ok, promptChars: input.prompt.length }) + '\n'); return r } }

const verifier = (root: string, tag: string) => makeIndependentVerification(`independent mini verification (${tag})`, path.join(outDir, `verifier-${stamp}-${tag}`), 'verify.mjs', MINI_VERIFY, root)
const limitsOk = { maxSteps: 30, maxRuntimeMs: 900_000, maxModelCalls: 60, maxRetries: 3 }
function newMission(id: string, agentId: string, limits = limitsOk, objective = MINI.request) {
  const root = makeAlertApp(path.join(wsBase, id))
  const d: AssignDraft = { idempotencyKey: keyFor(id, 'feature_implementation', objective), agentId, parentMission: { id, title: `lifecycle ${id}` }, taskClass: 'feature_implementation', capabilities: ['feature_implementation'], objective, expectedOutputs: ['working feature', 'passing tests'], completionConditions: ['independent verification passes', 'tests pass'], workspace: { id, root, kind: 'sandbox' }, tools: TOOLS.filter((t) => t !== 'read_runtime_output') as AssignDraft['tools'], limits, dependencies: [] }
  const { assignment, created } = assign(log, d, C)
  return { assignment, created, root }
}
async function run(asgId: string, root: string, tag: string, onEvent?: (e: { kind: string; detail: string }) => void): Promise<WorkflowResult> {
  return runFeatureWorkflow({ log, assignmentId: asgId, ws: new Workspace(root), model: traced, tools: TOOLS, finalVerification: verifier(root, tag), onEvent: (e) => { console.log(`  [${e.kind}] ${e.detail}`); onEvent?.(e) } }, { request: MINI.request, acceptance: MINI.acceptance, hints: MINI.hints })
}
const state = (id: string) => deriveAssignments(log).assignments.get(id)!
const score = async (root: string, tag: string) => { const r = await verifier(root, tag).run(); const m = (re: RegExp) => Number(re.exec(r.stdout)?.[1]); return { pass: m(/# pass (\d+)/), total: m(/# tests (\d+)/), exit: r.exitCode } }
function recordEval(label: string, asgId: string, res: WorkflowResult, sc: { pass: number; total: number }, wallMs: number) {
  const b: BenchmarkRecord = { modelRef: modelName, executor: `ollama:${modelName}`, fixture: 'lifecycle-mini (event counter)', engineSha, at: new Date().toISOString(), taskClass: 'complete_feature', verifierScore: sc, completion: res.status === 'COMPLETED' && sc.pass === sc.total ? 'COMPLETED' : sc.pass > 1 ? 'PARTIAL' : 'FAILED', modelCalls: res.modelCalls, repairs: res.repairs, retries: 'UNKNOWN', regressions: 'UNKNOWN', elapsedMs: wallMs, manualIntervention: false, contextTokens: 8192, ramMiB: 'UNKNOWN', vramMiB: 'UNKNOWN', workflowCompleted: res.status === 'COMPLETED', verifierPass: sc.pass === sc.total, failureClass: classifyRun({ status: res.status, reason: res.reason, verifierSummary: '' }), rootCause: res.status === 'COMPLETED' ? undefined : res.reason, evidencePath: label }
  return emitEngineeringRun(p9, b, { trial: `${label}:${asgId}` })
}

// ===== 1. need detected -> generalist created through the need gate and Commander lifecycle
const need = detectNeed({ title: 'Engineering executor for mission-driven features', evidence: NEED_CRITERIA.map((criterion) => ({ criterion, summary: `bootstrap evidence for ${criterion}: baseline engineering executor required`, evidenceRefs: [`bootstrap:${criterion}`] })) })
reg.recordNeed(need)
const gen = reg.propose(need.id, { id: 'agent-eng-generalist', name: 'Foundry engineering generalist', purpose: 'implement bounded multi-layer features', specialization: 'feature_implementation', riskCeiling: 'moderate', permissionScope: ['read_repo', 'write_own_reports'], memoryScope: ['project_knowledge', 'agent_operational'], ioContract: { input: 'assignment', output: 'validated changes' }, escalationPath: 'commander', reviewProcess: 'Commander reviews outcomes', toolScope: TOOLS })
reg.transition(gen.id, 'APPROVED', C, 'lifecycle proof approval'); reg.transition(gen.id, 'ACTIVE', C, 'lifecycle proof activation')
say('1_need_and_generalist', { needId: need.id, agent: gen.id, state: deriveAgents(log).agents.get(gen.id)!.state })
const d0 = decideSpecialist(log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] })
say('2_decision_with_no_history', { action: d0.action, agent: d0.agentId, creationAllowed: d0.creation?.allowed, missing: d0.creation?.missingCriteria })

// ===== 2. two real missions by the generalist (recurring work becomes evidence)
const results: Record<string, unknown>[] = []
async function realMission(id: string, agentId: string, tag: string) {
  const m = newMission(id, agentId); startAssignment(log, m.assignment.id, 'system:runner')
  const t0 = Date.now(); const res = await run(m.assignment.id, m.root, tag); const wall = Date.now() - t0
  const sc = await score(m.root, `${tag}-final`)
  const ev = recordEval(id, m.assignment.id, res, sc, wall)
  const row = { id, assignment: m.assignment.id, status: res.status, reason: res.reason.slice(0, 160), state: state(m.assignment.id).state, verifier: `${sc.pass}/${sc.total}`, wallS: Math.round(wall / 1000), modelCalls: res.modelCalls, repairs: res.repairs, phase9: ev }
  results.push(row); say(`mission_${id}`, row); return { m, res, sc }
}
const MAX_TRIES = 4
let completed = 0
const gm: Awaited<ReturnType<typeof realMission>>[] = []
for (let i = 1; i <= MAX_TRIES && completed < 2; i++) { const r = await realMission(`gen-${i}`, gen.id, `g${i}`); gm.push(r); if (r.res.status === 'COMPLETED') completed += 1 }
say('3_generalist_attempts', { attempts: gm.length, completed })
const cap = capabilityEvidence(log, deriveAgents(log).agents.get(gen.id)!, 'feature_implementation')
say('4_capability_evidence', { type: cap.type, evidence: JSON.stringify(cap).slice(0, 300) })

// ===== 3. specialist creation, justified by evidence, proposed (not active) until the Commander activates it
const busy = newMission('busy-holder', gen.id, limitsOk, 'hold the generalist busy for the decision'); startAssignment(log, busy.assignment.id, 'system:runner')
const d1 = decideSpecialist(log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] })
say('5_decision_after_evidence', { action: d1.action, allowed: d1.creation?.allowed, missing: d1.creation?.missingCriteria, reasons: d1.reasons.slice(0, 3) })
let spec: { agentId: string; created: boolean } | null = null
if (d1.action === 'CREATE_PROPOSAL' && d1.creation?.allowed) {
  spec = proposeSpecialist(log, { taskClass: 'feature_implementation', capability: 'feature_implementation', name: 'Feature specialist', purpose: 'implement persistent cross-layer features', workspaceNote: 'sandbox workspaces' })
  const preState = deriveAgents(log).agents.get(spec.agentId)!.state
  let blocked = false; try { newMission('too-early', spec.agentId) } catch { blocked = true }
  reg.transition(spec.agentId, 'APPROVED', C, 'recurring work evidenced'); reg.transition(spec.agentId, 'ACTIVE', C, 'activate')
  say('6_specialist', { agent: spec.agentId, stateBeforeCommander: preState, assignmentBlockedBeforeApproval: blocked, stateAfter: deriveAgents(log).agents.get(spec.agentId)!.state })
} else say('6_specialist', { created: false, why: 'the evidence-based gate did not allow creation (recorded honestly)', decision: d1.action })

// ===== 4. duplicate prevention (same mission + objective -> the existing assignment, no second run)
const dup = newMission('gen-1', gen.id)
say('7_duplicate_prevention', { created: dup.created, sameAssignment: dup.assignment.id === gm[0].m.assignment.id })

// ===== 5. resource limit enforced on a real run -> honest FAILED with a checkpoint; the specialist (or generalist) continues as successor
const holder = spec?.agentId ?? gen.id
const lim = newMission('limited', holder, { ...limitsOk, maxModelCalls: 5 }); startAssignment(log, lim.assignment.id, 'system:runner')
const limRes = await run(lim.assignment.id, lim.root, 'lim')
say('8_limit_enforcement', { status: limRes.status, reason: limRes.reason, modelCalls: limRes.modelCalls, ceiling: 5, state: state(lim.assignment.id).state, ceilingUnchanged: state(lim.assignment.id).assignment.limits.maxModelCalls === 5, checkpoint: latestCheckpoint(log, lim.assignment.id)?.state.steps.map((s) => `${s.id}:${s.status}`) })
// free the generalist, then the successor (a different agent when a specialist exists) continues with real work
const { completeAssignment } = await import('./assignments')
completeAssignment(log, busy.assignment.id, 'system:runner', { validation: 'PASSED', summary: 'holder released', artifacts: [], executor: 'UNKNOWN', tokens: 'UNKNOWN', latencyMs: 'UNKNOWN', retries: 0 })
let succ: ReturnType<typeof continueAssignment> | null = null
try { succ = continueAssignment(log, lim.assignment.id, gen.id, C, 'the predecessor hit its model-call ceiling; continue from its checkpoint with a normal budget') } catch (e) { say('9_successor_error', String((e as Error).message)) }
if (succ) {
  startAssignment(log, succ.assignmentId, 'system:runner')
  const t0 = Date.now(); const sres = await run(succ.assignmentId, lim.root, 'succ'); const wall = Date.now() - t0
  const sc = await score(lim.root, 'succ-final')
  say('9_successor', { created: succ.created, status: sres.status, reason: sres.reason.slice(0, 160), state: state(succ.assignmentId).state, verifier: `${sc.pass}/${sc.total}`, modelCalls: sres.modelCalls, wallS: Math.round(wall / 1000), handoffCarried: !!succ.packet, phase9: recordEval('successor', succ.assignmentId, sres, sc, wall) })
}

// ===== 6. REAL cancellation: cancel requested while the real model is generating (mid-call), measured
{
  const m = newMission('cancel-mid-call', holder); startAssignment(log, m.assignment.id, 'system:runner')
  const t0 = Date.now(); let reqAt = 0
  setTimeout(() => { reqAt = Date.now(); requestCancel(log, m.assignment.id, C, 'real mid-call cancellation test') }, 12_000)
  const res = await run(m.assignment.id, m.root, 'cancel')
  const done = Date.now()
  const st = state(m.assignment.id)
  say('10_real_cancellation', { status: res.status, state: st.state, cancellation: st.cancellation, requestedAfterMs: reqAt - t0, stoppedAfterRequestMs: done - reqAt, modelCallsStarted: res.modelCalls, filesWritten: res.filesChanged.length, checkpointExists: !!latestCheckpoint(log, m.assignment.id) })
}

// ===== 7. REAL pause/resume: pause after the first file is written; no further model calls while paused; resume continues from the checkpoint
{
  const m = newMission('pause-resume', holder); startAssignment(log, m.assignment.id, 'system:runner')
  let paused = false
  const first = await run(m.assignment.id, m.root, 'pause1', (e) => { if (e.kind === 'WRITE' && !paused) { paused = true; pauseAssignment(log, m.assignment.id, C, 'real pause test') } })
  const callsAtPause = modelCalls
  await new Promise((r) => setTimeout(r, 5000))
  const idle = modelCalls === callsAtPause
  const stPaused = state(m.assignment.id).state
  resumeAssignment(log, m.assignment.id, C, 'resume')
  const t0 = Date.now(); const second = await run(m.assignment.id, m.root, 'pause2'); const wall = Date.now() - t0
  const sc = await score(m.root, 'pause-final')
  say('11_real_pause_resume', { firstStatus: first.status, stateWhilePaused: stPaused, noModelCallsWhilePaused: idle, resumedStatus: second.status, resumedReason: second.reason.slice(0, 120), finalState: state(m.assignment.id).state, verifier: `${sc.pass}/${sc.total}`, stepsDoneFirst: first.stepsDone, stepsDoneAfterResume: second.stepsDone, phase9: recordEval('pause-resume', m.assignment.id, second, sc, wall) })
}

// ===== 8. evaluation recorded + lifecycle final states
const ev = evaluateAgent(log, gen.id)
say('12_evaluation', { generalist: JSON.stringify(ev).slice(0, 500), phase9Events: p9.view().events.length })
const final = [...deriveAssignments(log).assignments.values()].map((a) => ({ id: a.assignment.id, agent: a.assignment.agentId, state: a.state, cancellation: a.cancellation ?? null }))
say('13_final_lifecycle_states', final)
if (spec) { reg.transition(spec.agentId, 'RETIRED', C, 'lifecycle proof complete'); say('14_specialist_retired', deriveAgents(log).agents.get(spec.agentId)!.state) }
const reopened = new AgentOpsLog(path.join(outDir, `agent-ops-${stamp}`))
say('15_restart_reproduces_state', [...deriveAssignments(reopened).assignments.values()].map((a) => `${a.assignment.id}:${a.state}`).sort().join() === final.map((a) => `${a.id}:${a.state}`).sort().join())
writeFileSync(path.join(outDir, `lifecycle-${stamp}.json`), JSON.stringify(evidence, null, 1))
void readFileSync; void results

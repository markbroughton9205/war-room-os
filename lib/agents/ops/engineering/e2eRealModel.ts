/**
 * Real-model engineering run (NOT a validator). Drives the complete-feature workflow against the REAL local Ollama model in an
 * isolated chat-app workspace, with an independent verifier. Records every attempt honestly (success or failure).
 * Usage: node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/ops/engineering/e2eRealModel.ts <outDir> [model]
 */
import { appendFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentOpsLog } from '../log'
import { AgentRegistry } from '../registry'
import { detectNeed } from '../need'
import { NEED_CRITERIA, type EngineeringTool } from '../types'
import { assign, deriveAssignments, keyFor, startAssignment } from './assignments'
import { CHAT_FEATURE, CHAT_VERIFY_SCRIPT, makeChatApp } from './chatFixture'
import { TASK_FEATURE, TASK_VERIFY_SCRIPT, makeTaskApp } from './taskFixture'
import { ALERT_FEATURE, ALERT_VERIFY_SCRIPT, makeAlertApp } from './alertFixture'
import { TICKET_FEATURE, TICKET_VERIFY_SCRIPT, makeTicketApp } from './ticketFixture'
import { classifyRun } from '../../forge/failureClass'
import { completionClass } from './completionClass'
import { defaultFrontierProvider } from './frontierBridge'
import { frontierBudgetFromHistory } from './sovereign'
import type { DirectProviderFamily } from '@/lib/council/providerDirectCall'
import { execFileSync } from 'node:child_process'
import { latestCheckpoint } from './continuity'
import { deriveLedger, debugSummary } from './debugLedger'
import { OllamaModelClient } from './runtime/ollamaModel'
import { ForgeStore } from '@/lib/agents/forge/store'
import { NodeRegistry } from '@/lib/agents/forge/node'
import { ResidencyGovernor } from '@/lib/agents/forge/governor'
import { governedClientForRef } from '@/lib/agents/forge/poolRuntime'
import { probeLocalNode } from '@/lib/agents/forge/localNode'
import { shadowDecisions } from '@/lib/agents/forge/computeShadow'
import { FIRST_POOL } from '@/lib/agents/forge/registry'
import { HybridContextPhase } from '@/lib/agents/forge/contextRetriever'
import { makeResearcher } from '@/lib/agents/forge/researchBrief'
import { embed as embedBatch } from '@/lib/agents/forge/roleBench/retrieval'
import { padWorkspace } from './paddedWorkspace'
import { readFileSync, existsSync } from 'node:fs'
import { gpuUsedMiB, ramUsedMiB } from '@/lib/agents/forge/profile'
import { makeIndependentVerification } from './runtime/verifier'
import { allLessons, lessonsFor, measureLessonEffect } from './lessons'
import { Workspace } from './runtime/workspaceFs'
import { runFeatureWorkflow } from './workflow'
import type { ModelClient, ModelResult } from './runtime/ports'

// Fixture selection (identical engine, policy and verifier semantics for both): FIXTURE=chat (default) | task
const FIXTURE = process.env.FIXTURE === 'task' ? 'task' : process.env.FIXTURE === 'alert' ? 'alert' : process.env.FIXTURE === 'ticket' ? 'ticket' : 'chat'
const FX = FIXTURE === 'ticket'
  ? { id: 'ticket-desk', label: 'ticket-desk (TICKET_FEATURE, independent 12-check verifier)', feature: TICKET_FEATURE, verify: TICKET_VERIFY_SCRIPT, make: makeTicketApp, mission: 'mission-ticket-desk', title: 'Persistent ticket desk' }
  : FIXTURE === 'alert'
  ? { id: 'alert-center', label: 'alert-center (ALERT_FEATURE, independent 12-check verifier)', feature: ALERT_FEATURE, verify: ALERT_VERIFY_SCRIPT, make: makeAlertApp, mission: 'mission-alert-center', title: 'Persistent alert center' }
  : FIXTURE === 'task'
  ? { id: 'task-board', label: 'task-board (TASK_FEATURE, independent 12-check verifier)', feature: TASK_FEATURE, verify: TASK_VERIFY_SCRIPT, make: makeTaskApp, mission: 'mission-task-board', title: 'Persistent task board' }
  : { id: 'chat-sessions', label: 'chat-sessions (CHAT_FEATURE, independent 12-check verifier)', feature: CHAT_FEATURE, verify: CHAT_VERIFY_SCRIPT, make: makeChatApp, mission: 'mission-chat-sessions', title: 'Persistent chat sessions' }
const engineSha = process.env.ENGINE_SHA || (() => { try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: process.cwd() }).toString().trim() } catch { return 'UNKNOWN' } })()
const outDir = process.argv[2]
const modelName = process.argv[3] ?? 'qwen2.5-coder:14b'
if (!outDir) throw new Error('usage: e2eRealModel.ts <outDir> [model]')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const wsRoot = path.join(os.homedir(), 'WarRoomProjects', 'p10-acceptance', `${FX.id}-${stamp}`)
mkdirSync(wsRoot, { recursive: true })
// REPLAY_FROM=<finished workspace>: the independently verified implementation in that workspace is REUSED (its test/ directory and data are dropped); only test authoring runs again.
const replayFrom = process.env.REPLAY_FROM
if (replayFrom) { cpSync(replayFrom, wsRoot, { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(src) }); rmSync(path.join(wsRoot, 'test'), { recursive: true, force: true }); rmSync(path.join(wsRoot, 'data'), { recursive: true, force: true })
  // the fixture's ORIGINAL test files come back (the model-written ones from the first run are dropped): existing tests must keep passing
  const pristine = path.join(os.tmpdir(), `replay-base-${Date.now()}`); FX.make(pristine); cpSync(path.join(pristine, 'test'), path.join(wsRoot, 'test'), { recursive: true }); rmSync(pristine, { recursive: true, force: true })
} else FX.make(wsRoot)
// PAD_WORKSPACE=1 (opt-in): a larger existing codebase around the fixture app (reusable helpers + conventions doc + unrelated modules), for measuring context retrieval
const padded = process.env.PAD_WORKSPACE === '1' ? padWorkspace(wsRoot) : null
const dataDir = path.join(outDir, `agent-ops-${stamp}`)
const log = new AgentOpsLog(dataDir)
const reg = new AgentRegistry(log)
const C = 'commander:acceptance'
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const need = detectNeed({ title: 'Bootstrap engineering executor', evidence: NEED_CRITERIA.map((criterion) => ({ criterion, summary: `bootstrap evidence for ${criterion}: baseline engineering executor required for mission-driven work`, evidenceRefs: [`bootstrap:${criterion}`] })) })
reg.recordNeed(need)
const spec = reg.propose(need.id, { id: 'agent-eng-generalist', name: 'Foundry engineering generalist', purpose: 'implement bounded multi-layer features', specialization: 'feature_implementation', riskCeiling: 'moderate', permissionScope: ['read_repo', 'write_own_reports'], memoryScope: ['project_knowledge', 'agent_operational'], ioContract: { input: 'assignment', output: 'validated changes' }, escalationPath: 'commander', reviewProcess: 'Commander reviews outcomes', toolScope: TOOLS })
reg.transition(spec.id, 'APPROVED', C, 'acceptance bootstrap approval'); reg.transition(spec.id, 'ACTIVE', C, 'acceptance bootstrap activation')
const { assignment } = assign(log, { idempotencyKey: keyFor(FX.mission, 'feature_implementation', FX.feature.request), agentId: spec.id, parentMission: { id: FX.mission, title: FX.title }, taskClass: 'feature_implementation', capabilities: ['feature_implementation'], objective: FX.feature.request, expectedOutputs: ['working persistent sessions across storage, service, API and UI', 'passing tests'], completionConditions: ['independent verification passes', 'existing tests pass'], workspace: { id: 'chat-acceptance', root: wsRoot, kind: 'sandbox' }, tools: TOOLS, limits: { maxSteps: 40, maxRuntimeMs: Number(process.env.MAX_RUNTIME_MIN ?? 25) * 60_000, maxModelCalls: 60, maxRetries: Number(process.env.MAX_RETRIES ?? 5) }, dependencies: [] }, C)
startAssignment(log, assignment.id, 'system:engineering-runner')

// SPECIALIST_POOL=1 (opt-in): every call of the builder and the helpers runs inside the node's residency governor (one generation at a time, helpers unload after use)
const poolGov = process.env.SPECIALIST_POOL === '1' ? (() => { const r = new NodeRegistry().registerLocal(); return r.ok ? new ResidencyGovernor(r.node) : null })() : null
// FOUNDRY_COMPUTE=1 (opt-in, SHADOW ONLY): the compute scheduler says what it would place for the roles this run uses; the harness still runs its own models.
const computeShadow = process.env.FOUNDRY_COMPUTE === '1' ? await (async () => {
  try {
    const store = new ForgeStore(); const probe = await probeLocalNode(); const models = store.models().length ? store.models() : FIRST_POOL
    const harness = [{ role: 'PRIMARY_BUILDER' as const, modelRef: modelName }, ...(process.env.TEST_REVIEWER_MODEL ? [{ role: 'ARCHITECT_REVIEWER' as const, modelRef: process.env.TEST_REVIEWER_MODEL }] : []), ...(process.env.TEST_WRITER_MODEL ? [{ role: 'DEBUGGER_TEST_SPECIALIST' as const, modelRef: process.env.TEST_WRITER_MODEL }] : [])]
    return { enabled: true, mode: 'SHADOW', node: probe.record.nodeId, decisions: shadowDecisions({ node: probe.record, models, benchmarks: store.benchmarks(), profiles: store.resourceProfiles(), harness }) }
  } catch (e) { return { enabled: true, mode: 'SHADOW', error: e instanceof Error ? e.message : String(e), decisions: [] } }
})() : { enabled: false }
const real: ModelClient = poolGov ? governedClientForRef(poolGov, modelName, 'BUILDER', 'RESIDENT', '10m', [modelName]) : new OllamaModelClient(modelName)
const trace = path.join(outDir, `trace-${stamp}.jsonl`)
const traced: ModelClient = {
  async generate(input): Promise<ModelResult> {
    const t0 = Date.now(); const r = await real.generate(input)
    appendFileSync(trace, JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - t0, system: input.system.slice(0, 80), promptChars: input.prompt.length, prompt: input.prompt, ok: r.ok, ...(r.ok ? { reply: r.text, outputTokens: r.outputTokens, promptTokens: r.promptTokens } : { detail: r.detail }) }) + '\n')
    console.log(`  model call: ${Date.now() - t0}ms ${r.ok ? `out=${r.outputTokens} tok` : 'FAILED ' + r.detail}`)
    return r
  },
}
// Optional escalation model (ESCALATION_MODEL=<installed ollama model>): used only after two refuted repair hypotheses; every switch is recorded in result.escalations.
const escalationName = process.env.ESCALATION_MODEL
const escalation = escalationName ? { label: escalationName, model: ((): ModelClient => { const e = new OllamaModelClient(escalationName); return { async generate(input) { const t1 = Date.now(); const r = await e.generate(input); appendFileSync(trace, JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - t1, escalation: escalationName, promptChars: input.prompt.length, ok: r.ok, ...(r.ok ? { reply: r.text } : { detail: r.detail }) }) + '\n'); return r } } })() } : undefined
// SOVEREIGN BUILD LAW wiring (all optional, local-first by default):
//   (Round 16 evidence: helpers on every run made results worse, so they are all OFF unless asked for, and bounded + reserve-protected when on)
//   TEST_WRITER_MODEL=<ollama model>        independent local test writer (builder != test writer); GROUND_TESTS=1 adds the contract-grounding reviewer
//   TEST_CANDIDATE_MODELS=<m1,m2>           competing local test candidates, tried only after the first test file fails against the verified implementation
//   FRONTIER_FAMILY=<claude|chatgpt|grok|gemini>  bounded outside assist; unavailable (reported, never faked) unless that provider is configured in this process
const localClient = (name: string): ModelClient => { const c: ModelClient = poolGov ? governedClientForRef(poolGov, name, 'HELPER', 'TRANSIENT', '0', [modelName]) : new OllamaModelClient(name, undefined, '0'); return { async generate(input) { const t1 = Date.now(); const r = await c.generate(input); appendFileSync(trace, JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - t1, model: name, promptChars: input.prompt.length, ok: r.ok, ...(r.ok ? { reply: r.text } : { detail: r.detail }) }) + '\n'); return r } } }
const testWriter = process.env.TEST_WRITER_MODEL ? { label: process.env.TEST_WRITER_MODEL, model: localClient(process.env.TEST_WRITER_MODEL) } : undefined
const testReviewer = process.env.TEST_REVIEWER_MODEL ? { label: process.env.TEST_REVIEWER_MODEL, model: localClient(process.env.TEST_REVIEWER_MODEL) } : undefined
// FAST_REPAIR_MODEL=<ollama model> (opt-in): a local specialist takes the FIRST retry of an implementation file rejected for a bounded syntax/import/undeclared-name problem; the builder takes any further retry
const fastRepair = process.env.FAST_REPAIR_MODEL ? { label: process.env.FAST_REPAIR_MODEL, model: localClient(process.env.FAST_REPAIR_MODEL) } : undefined
// RETRIEVAL=1 (opt-in): ONE batched hybrid-retrieval pass before the builder's first call (exact/definition search first, embeddings for the rest; context only).
// The embedding model runs under the Residency Governor as a transient helper (keep-alive 0), so it is unloaded before the builder loads. RESEARCH_MODEL=<ref> adds a bounded
// research brief, but only when Foundry's deterministic trigger fires. COLD_START=1 unloads every model first so no configuration starts with a warm builder.
const retrievalOn = process.env.RETRIEVAL === '1'
const embedModel = process.env.EMBED_MODEL || 'qwen3-embedding:0.6b'
const cacheFile = process.env.RETRIEVAL_CACHE
const embedCache = new Map<string, number[]>(cacheFile && existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as [string, number[]][]) : [])
const embedderFn = async (inputs: string[]) => {
  const base = poolGov ? poolGov.node.endpoint : 'http://127.0.0.1:11434'
  const run = () => embedBatch(base, embedModel, inputs, 0)
  return poolGov ? poolGov.lease({ ref: embedModel, role: 'CODE_RETRIEVAL', residency: 'TRANSIENT', artifactBytes: 640 * 1048576 }, [modelName], run) : run()
}
const researchFn = process.env.RESEARCH_MODEL ? makeResearcher(localClient(process.env.RESEARCH_MODEL), process.env.RESEARCH_MODEL) : null
const contextPhase = retrievalOn ? new HybridContextPhase({ embed: embedderFn, research: researchFn, cache: embedCache }) : undefined
const testCandidates = (process.env.TEST_CANDIDATE_MODELS ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((label) => ({ label, model: localClient(label) }))
const frontierFamily = process.env.FRONTIER_FAMILY as DirectProviderFamily | undefined
const frontierDeps = frontierFamily ? { provider: await defaultFrontierProvider(frontierFamily), reviewDir: path.join(outDir, `frontier-review-${stamp}`), maxCalls: frontierBudgetFromHistory([]).maxCalls } : undefined
const verification = makeIndependentVerification(`independent ${FX.id} verification`, path.join(outDir, `verifier-${stamp}`), 'verify.mjs', FX.verify, wsRoot)
console.log(`workspace: ${wsRoot}\nmodel: ${modelName}\nassignment: ${assignment.id}`)
// Optional lesson retrieval (LESSON_STORE=<dir> of previously harvested lessons). Off by default; control runs never see lessons.
const lessonStoreDir = process.env.LESSON_STORE
let lessonTexts: string[] = []
let lessonIds: string[] = []
if (lessonStoreDir) {
  const src = new AgentOpsLog(lessonStoreDir, { readOnly: true })
  for (const l of allLessons(src)) { try { log.append({ t: 'lesson', lesson: l }) } catch { /* already present */ } }
  const got = lessonsFor(log, assignment.id, 'feature_implementation')
  lessonTexts = got.texts; lessonIds = got.ids
  console.log(`lessons retrieved: ${lessonIds.length}`)
}
if (process.env.COLD_START === '1') {
  const ps = (await (await fetch('http://127.0.0.1:11434/api/ps')).json()) as { models?: { name: string }[] }
  for (const m of ps.models ?? []) await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.name, keep_alive: 0 }) }).catch(() => undefined)
  await new Promise((r) => setTimeout(r, 4000))
}
const t0 = Date.now()
let peakGpu: number | 'UNKNOWN' = 'UNKNOWN', peakRam: number | 'UNKNOWN' = 'UNKNOWN'
const sampler = setInterval(() => { const g = gpuUsedMiB(), r = ramUsedMiB(); if (typeof g === 'number' && (peakGpu === 'UNKNOWN' || g > peakGpu)) peakGpu = g; if (typeof r === 'number' && (peakRam === 'UNKNOWN' || r > peakRam)) peakRam = r }, 3000)
const evCount: Record<string, number> = {}
const result = await runFeatureWorkflow({ log, assignmentId: assignment.id, ws: new Workspace(wsRoot), model: traced, tools: TOOLS, finalVerification: verification, ...(escalation ? { escalation } : {}), ...(testWriter ? { testWriter } : {}), ...(testCandidates.length ? { testCandidates } : {}), ...(frontierDeps ? { frontier: frontierDeps } : {}), missionId: FX.mission, ...(process.env.CONTRACT_TESTS === '1' ? { contractTests: true } : {}), ...(process.env.FIRST_PASS === '1' ? { firstPass: { runtime: process.env.FIRST_PASS_RUNTIME !== '0' } } : {}), ...(testReviewer ? { testReviewer } : {}), ...(fastRepair ? { fastRepair } : {}), ...(contextPhase ? { contextPhase } : {}), ...(replayFrom ? { reuseImplementation: true } : {}), groundTests: process.env.GROUND_TESTS === '1', ...(process.env.MAX_CANDIDATES_PER_FILE ? { maxCandidatesPerFile: Number(process.env.MAX_CANDIDATES_PER_FILE) } : {}), ...(lessonStoreDir ? { lessons: () => lessonTexts } : {}), onEvent: (e) => { evCount[e.kind] = (evCount[e.kind] ?? 0) + 1; console.log(`[${e.kind}] ${e.detail}`) } }, { request: FX.feature.request, acceptance: FX.feature.acceptance, hints: FX.feature.hints })
const v = deriveAssignments(log).assignments.get(assignment.id)!
const finalVerify = await verification.run()
const lessonEffect = lessonStoreDir ? measureLessonEffect(log, assignment.id) : null
const report = {
  stamp, fixture: FX.id, replayFrom: replayFrom ?? null, engineSha, model: modelName, workspace: wsRoot, assignmentId: assignment.id, wallMs: Date.now() - t0,
  completionClass: completionClass(result, finalVerify.exitCode === 0), // CLEAN | WITH_QUARANTINE | UNVERIFIED | FAILED; the independent verifier run now decides UNVERIFIED
  result, assignmentState: v.state, outcome: v.outcome, stopReason: v.stopReason ?? null,
  independentVerificationNow: { exitCode: finalVerify.exitCode, summary: finalVerify.stdout.split('\n').filter((l) => /^(not ok|# )/.test(l)).join(' | ') },
  checkpoint: latestCheckpoint(log, assignment.id)?.state.steps.map((s) => `${s.id} ${s.status} ${s.files[0] ?? ''}${s.note ? ' — ' + s.note : ''}`),
  lessons: { storeDir: lessonStoreDir ?? null, retrievedIds: lessonIds, retrievedTexts: lessonTexts, effect: lessonEffect },
  resources: { peakGpuMiB: peakGpu as number | 'UNKNOWN', peakRamMiB: peakRam as number | 'UNKNOWN', swapUsedMiB: (() => { try { const m = readFileSync('/proc/meminfo', 'utf8'); const g = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(m)?.[1] ?? 0); return Math.round((g('SwapTotal') - g('SwapFree')) / 1024) } catch { return 'UNKNOWN' } })() },
  padded: padded ? { files: padded.added.length, relevant: padded.relevant } : null,
  compute: computeShadow,
  specialistPool: poolGov ? { enabled: true, node: poolGov.node.id, decisions: poolGov.decisions() } : { enabled: false },
  eventCounts: evCount,
  debug: debugSummary(log, assignment.id), ledgerFailures: deriveLedger(log, assignment.id).failures.size,
}
clearInterval(sampler)
writeFileSync(path.join(outDir, `report-${stamp}.json`), JSON.stringify(report, null, 1))
if (cacheFile && embedCache.size) writeFileSync(cacheFile, JSON.stringify([...embedCache.entries()]))
{
  // Forge benchmark record: score parsed from the independent verifier's own TAP totals; nothing here is estimated
  const pass = Number(/# pass (\d+)/.exec(report.independentVerificationNow.summary)?.[1]), total = Number(/# tests (\d+)/.exec(report.independentVerificationNow.summary)?.[1])
  const CHAT_CHECKS = 12 // the independent verifier's check count; "verification could not complete" means none of them could pass
  const score = /could not complete/.test(report.independentVerificationNow.summary) ? { pass: 0, total: CHAT_CHECKS } : Number.isFinite(pass) && Number.isFinite(total) && total > 0 ? { pass, total } : ('UNKNOWN' as const)
  new ForgeStore().recordBenchmark({ modelRef: modelName, executor: `ollama:${modelName}`, fixture: FX.label, engineSha, at: new Date().toISOString(), taskClass: 'complete_feature', verifierScore: score, completion: result.status === 'COMPLETED' && score !== 'UNKNOWN' && score.pass === score.total ? 'COMPLETED' : result.status === 'BLOCKED' ? 'BLOCKED' : score !== 'UNKNOWN' && score.pass > 2 ? 'PARTIAL' : 'FAILED', modelCalls: result.modelCalls, repairs: result.repairs, retries: 'UNKNOWN', regressions: 'UNKNOWN', elapsedMs: report.wallMs, manualIntervention: false, workflowCompleted: result.status === 'COMPLETED', verifierPass: score !== 'UNKNOWN' && score.pass === score.total, failureClass: classifyRun({ status: result.status, reason: result.reason, verifierSummary: report.independentVerificationNow.summary }), editRejections: evCount.REJECT ?? 0, quarantinedTests: result.quarantinedTests ?? 0, frontier: { frontier_calls: result.frontier?.usage.frontier_calls ?? 0, accepted_contributions: result.frontier?.usage.accepted_contributions ?? 0, rejected_contributions: result.frontier?.usage.rejected_contributions ?? 0, frontier_tasks: result.frontier?.usage.frontier_tasks ?? [] }, cleanKind: report.completionClass === 'CLEAN' ? result.cleanKind ?? null : null, completionClass: report.completionClass, contextTokens: 8192, ramMiB: peakRam, vramMiB: peakGpu, rootCause: result.status === 'COMPLETED' ? undefined : result.reason, evidencePath: path.join(outDir, `report-${stamp}.json`), historicalBaseline: process.argv[4] === 'baseline' })
}
console.log(JSON.stringify({ status: result.status, reason: result.reason, modelCalls: result.modelCalls, repairs: result.repairs, routeEdits: (result.routeEdits ?? []).map((e) => `${e.stage}:${e.mode}:${e.ops.map((o) => o.op).join('+')}`), tokens: result.tokens, files: result.filesChanged, verify: report.independentVerificationNow, wallS: Math.round(report.wallMs / 1000) }, null, 1))

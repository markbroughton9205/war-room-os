/**
 * Real-model engineering run (NOT a validator). Drives the complete-feature workflow against the REAL local Ollama model in an
 * isolated chat-app workspace, with an independent verifier. Records every attempt honestly (success or failure).
 * Usage: node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/ops/engineering/e2eRealModel.ts <outDir> [model]
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentOpsLog } from '../log'
import { AgentRegistry } from '../registry'
import { detectNeed } from '../need'
import { NEED_CRITERIA, type EngineeringTool } from '../types'
import { assign, deriveAssignments, keyFor, startAssignment } from './assignments'
import { CHAT_FEATURE, CHAT_VERIFY_SCRIPT, makeChatApp } from './chatFixture'
import { TASK_FEATURE, TASK_VERIFY_SCRIPT, makeTaskApp } from './taskFixture'
import { execFileSync } from 'node:child_process'
import { latestCheckpoint } from './continuity'
import { deriveLedger, debugSummary } from './debugLedger'
import { OllamaModelClient } from './runtime/ollamaModel'
import { ForgeStore } from '@/lib/agents/forge/store'
import { gpuUsedMiB, ramUsedMiB } from '@/lib/agents/forge/profile'
import { makeIndependentVerification } from './runtime/verifier'
import { Workspace } from './runtime/workspaceFs'
import { runFeatureWorkflow } from './workflow'
import type { ModelClient, ModelResult } from './runtime/ports'

// Fixture selection (identical engine, policy and verifier semantics for both): FIXTURE=chat (default) | task
const FIXTURE = process.env.FIXTURE === 'task' ? 'task' : 'chat'
const FX = FIXTURE === 'task'
  ? { id: 'task-board', label: 'task-board (TASK_FEATURE, independent 12-check verifier)', feature: TASK_FEATURE, verify: TASK_VERIFY_SCRIPT, make: makeTaskApp, mission: 'mission-task-board', title: 'Persistent task board' }
  : { id: 'chat-sessions', label: 'chat-sessions (CHAT_FEATURE, independent 12-check verifier)', feature: CHAT_FEATURE, verify: CHAT_VERIFY_SCRIPT, make: makeChatApp, mission: 'mission-chat-sessions', title: 'Persistent chat sessions' }
const engineSha = (() => { try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: process.cwd() }).toString().trim() } catch { return 'UNKNOWN' } })()
const outDir = process.argv[2]
const modelName = process.argv[3] ?? 'qwen2.5-coder:14b'
if (!outDir) throw new Error('usage: e2eRealModel.ts <outDir> [model]')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const wsRoot = path.join(os.homedir(), 'WarRoomProjects', 'p10-acceptance', `${FX.id}-${stamp}`)
mkdirSync(wsRoot, { recursive: true })
FX.make(wsRoot)
const dataDir = path.join(outDir, `agent-ops-${stamp}`)
const log = new AgentOpsLog(dataDir)
const reg = new AgentRegistry(log)
const C = 'commander:acceptance'
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const need = detectNeed({ title: 'Bootstrap engineering executor', evidence: NEED_CRITERIA.map((criterion) => ({ criterion, summary: `bootstrap evidence for ${criterion}: baseline engineering executor required for mission-driven work`, evidenceRefs: [`bootstrap:${criterion}`] })) })
reg.recordNeed(need)
const spec = reg.propose(need.id, { id: 'agent-eng-generalist', name: 'Foundry engineering generalist', purpose: 'implement bounded multi-layer features', specialization: 'feature_implementation', riskCeiling: 'moderate', permissionScope: ['read_repo', 'write_own_reports'], memoryScope: ['project_knowledge', 'agent_operational'], ioContract: { input: 'assignment', output: 'validated changes' }, escalationPath: 'commander', reviewProcess: 'Commander reviews outcomes', toolScope: TOOLS })
reg.transition(spec.id, 'APPROVED', C, 'acceptance bootstrap approval'); reg.transition(spec.id, 'ACTIVE', C, 'acceptance bootstrap activation')
const { assignment } = assign(log, { idempotencyKey: keyFor(FX.mission, 'feature_implementation', FX.feature.request), agentId: spec.id, parentMission: { id: FX.mission, title: FX.title }, taskClass: 'feature_implementation', capabilities: ['feature_implementation'], objective: FX.feature.request, expectedOutputs: ['working persistent sessions across storage, service, API and UI', 'passing tests'], completionConditions: ['independent verification passes', 'existing tests pass'], workspace: { id: 'chat-acceptance', root: wsRoot, kind: 'sandbox' }, tools: TOOLS, limits: { maxSteps: 40, maxRuntimeMs: 25 * 60_000, maxModelCalls: 60, maxRetries: 5 }, dependencies: [] }, C)
startAssignment(log, assignment.id, 'system:engineering-runner')

const real = new OllamaModelClient(modelName)
const trace = path.join(outDir, `trace-${stamp}.jsonl`)
const traced: ModelClient = {
  async generate(input): Promise<ModelResult> {
    const t0 = Date.now(); const r = await real.generate(input)
    appendFileSync(trace, JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - t0, system: input.system.slice(0, 80), promptChars: input.prompt.length, prompt: input.prompt, ok: r.ok, ...(r.ok ? { reply: r.text, outputTokens: r.outputTokens, promptTokens: r.promptTokens } : { detail: r.detail }) }) + '\n')
    console.log(`  model call: ${Date.now() - t0}ms ${r.ok ? `out=${r.outputTokens} tok` : 'FAILED ' + r.detail}`)
    return r
  },
}
const verification = makeIndependentVerification(`independent ${FX.id} verification`, path.join(outDir, `verifier-${stamp}`), 'verify.mjs', FX.verify, wsRoot)
console.log(`workspace: ${wsRoot}\nmodel: ${modelName}\nassignment: ${assignment.id}`)
const t0 = Date.now()
let peakGpu: number | 'UNKNOWN' = 'UNKNOWN', peakRam: number | 'UNKNOWN' = 'UNKNOWN'
const sampler = setInterval(() => { const g = gpuUsedMiB(), r = ramUsedMiB(); if (typeof g === 'number' && (peakGpu === 'UNKNOWN' || g > peakGpu)) peakGpu = g; if (typeof r === 'number' && (peakRam === 'UNKNOWN' || r > peakRam)) peakRam = r }, 3000)
const result = await runFeatureWorkflow({ log, assignmentId: assignment.id, ws: new Workspace(wsRoot), model: traced, tools: TOOLS, finalVerification: verification, onEvent: (e) => console.log(`[${e.kind}] ${e.detail}`) }, { request: FX.feature.request, acceptance: FX.feature.acceptance, hints: FX.feature.hints })
const v = deriveAssignments(log).assignments.get(assignment.id)!
const finalVerify = await verification.run()
const report = {
  stamp, fixture: FX.id, engineSha, model: modelName, workspace: wsRoot, assignmentId: assignment.id, wallMs: Date.now() - t0,
  result, assignmentState: v.state, outcome: v.outcome, stopReason: v.stopReason ?? null,
  independentVerificationNow: { exitCode: finalVerify.exitCode, summary: finalVerify.stdout.split('\n').filter((l) => /^(not ok|# )/.test(l)).join(' | ') },
  checkpoint: latestCheckpoint(log, assignment.id)?.state.steps.map((s) => `${s.id} ${s.status} ${s.files[0] ?? ''}${s.note ? ' — ' + s.note : ''}`),
  debug: debugSummary(log, assignment.id), ledgerFailures: deriveLedger(log, assignment.id).failures.size,
}
clearInterval(sampler)
writeFileSync(path.join(outDir, `report-${stamp}.json`), JSON.stringify(report, null, 1))
{
  // Forge benchmark record: score parsed from the independent verifier's own TAP totals; nothing here is estimated
  const pass = Number(/# pass (\d+)/.exec(report.independentVerificationNow.summary)?.[1]), total = Number(/# tests (\d+)/.exec(report.independentVerificationNow.summary)?.[1])
  const CHAT_CHECKS = 12 // the independent verifier's check count; "verification could not complete" means none of them could pass
  const score = /could not complete/.test(report.independentVerificationNow.summary) ? { pass: 0, total: CHAT_CHECKS } : Number.isFinite(pass) && Number.isFinite(total) && total > 0 ? { pass, total } : ('UNKNOWN' as const)
  new ForgeStore().recordBenchmark({ modelRef: modelName, executor: `ollama:${modelName}`, fixture: FX.label, engineSha, at: new Date().toISOString(), taskClass: 'complete_feature', verifierScore: score, completion: result.status === 'COMPLETED' && score !== 'UNKNOWN' && score.pass === score.total ? 'COMPLETED' : result.status === 'BLOCKED' ? 'BLOCKED' : score !== 'UNKNOWN' && score.pass > 2 ? 'PARTIAL' : 'FAILED', modelCalls: result.modelCalls, repairs: result.repairs, retries: 'UNKNOWN', regressions: 'UNKNOWN', elapsedMs: report.wallMs, manualIntervention: false, contextTokens: 8192, ramMiB: peakRam, vramMiB: peakGpu, rootCause: result.status === 'COMPLETED' ? undefined : result.reason, evidencePath: path.join(outDir, `report-${stamp}.json`), historicalBaseline: process.argv[4] === 'baseline' })
}
console.log(JSON.stringify({ status: result.status, reason: result.reason, modelCalls: result.modelCalls, repairs: result.repairs, tokens: result.tokens, files: result.filesChanged, verify: report.independentVerificationNow, wallS: Math.round(report.wallMs / 1000) }, null, 1))

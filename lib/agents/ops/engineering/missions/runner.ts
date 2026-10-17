import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentOpsLog } from '../../log'
import { AgentRegistry, deriveAgents } from '../../registry'
import { detectNeed } from '../../need'
import { NEED_CRITERIA, type Actor, type EngineeringTool } from '../../types'
import { assign, deriveAssignments, keyFor, pauseAssignment, recoverAssignment, requestCancel, resumeAssignment, startAssignment } from '../assignments'
import { latestCheckpoint } from '../continuity'
import { makeIndependentVerification } from '../runtime/verifier'
import { runHermetic } from '../runtime/commandRunner'
import { storageEnvVars } from '../persistenceContract'
import { Workspace } from '../runtime/workspaceFs'
import { runFeatureWorkflow, type FinalVerification, type WorkflowResult } from '../workflow'
import type { ModelClient } from '../runtime/ports'
import { integrate, planApply, type GateSpec, DEFAULT_GATES } from './apply'
import { findSsrHazards } from '../autonomy/ssr'
import { GATE_REPAIR_ROUNDS, GATE_REPAIR_SYSTEM, extractCorrected, gateRepairPrompt, splitErrors, tscErrorsByFile } from './gateRepair'
import { fileProvenance, roleOf, type LedgerDelivery, type LedgerWrite } from './provenance'
import { buildReceipt, verifyReceipt } from './receipt'
import { localRunners, realFacts, reconcileMissions, resumability } from './reconcile'
import { SeedError, checkSeedPath, isSensitiveWrite, materializeRef, resolveRef, seedWorkspace } from './seed'
import { assessLiveness, HEARTBEAT_MS, pidStartOf } from './liveness'
import { resolveBin, runTool } from './toolchain'
import type { MissionStore } from './store'
import { ACTIVE_STATES, type Attempt, type ChangeReceipt, type MissionRecord, type MissionState, type ScopeSpec } from './types'

export const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
export class MissionError extends Error { constructor(public readonly code: 'INVALID' | 'BUSY' | 'NOT_FOUND' | 'ILLEGAL' | 'NO_BUILDER' | 'SCOPE', msg: string) { super(msg) } }

/** The model line-up for a mission. The default factory resolves it from Forge evidence (the same pool assignment the gold rounds used) and talks to loopback Ollama only. */
export type ModelLineup = { builder: { label: string; model: ModelClient }; testReviewer?: { label: string; model: ModelClient }; testCandidates: { label: string; model: ModelClient }[]; escalation?: { label: string; model: ModelClient }; simulated: boolean }
export type RunnerDeps = {
  log: AgentOpsLog
  store: MissionStore
  workspacesRoot: string
  integrationRoot: string
  lineup: () => Promise<ModelLineup> | ModelLineup
  /** the line-up when a specific (escalation) builder is requested; absent = escalation is not available in this deployment */
  lineupFor?: (builder: string) => Promise<ModelLineup> | ModelLineup
  gates?: GateSpec
  /** the install stage (Commander approval was recorded on the mission at creation); absent means installs are not available in this deployment */
  installer?: (m: MissionRecord, integration: ChangeReceipt['integration'], onLog: (s: string) => void) => Promise<ChangeReceipt['install']>
  engine?: { crashAfterSteps?: number; firstPass?: boolean; contractTests?: boolean }
  /** Commander authority gate: a non-null reason refuses to create, start or resume any mission (Emergency Stop, Pause). Enforced here so every entry point is bound by it. */
  guard?: () => string | null
  now?: () => Date
}
export type MissionDraft = { /** escalation: build this mission with this installed, qualified local model instead of the default builder */ builder?: string; title: string; request: string; acceptance: string[]; hints?: string[]; targets?: { path: string; action: 'create' | 'modify' }[]; scope?: Partial<ScopeSpec>; install?: boolean; verifyScript?: string; analysisId?: string }

const C_SYSTEM: Actor = 'system:engineering-runner'
const clip = (s: string, n: number) => s.trim().slice(0, n)

/** Validation of everything the operator typed. Fails closed with a precise reason. */
export function validateDraft(d: MissionDraft): { title: string; request: string; acceptance: string[]; hints: string[]; targets: { path: string; action: 'create' | 'modify' }[]; scope: ScopeSpec; install: boolean; verifyScript: string | null } {
  const title = clip(String(d.title ?? ''), 120), request = clip(String(d.request ?? ''), 2000)
  if (!title) throw new MissionError('INVALID', 'a title is required')
  if (request.length < 20) throw new MissionError('INVALID', 'the request must describe the feature (at least 20 characters)')
  const acceptance = (Array.isArray(d.acceptance) ? d.acceptance : []).map((a) => clip(String(a), 500)).filter(Boolean)
  if (acceptance.length < 1 || acceptance.length > 20) throw new MissionError('INVALID', 'between 1 and 20 acceptance criteria are required (each a testable statement)')
  const hints = (Array.isArray(d.hints) ? d.hints : []).map((h) => clip(String(h), 60)).filter(Boolean).slice(0, 8)
  const write = (d.scope?.write ?? []).map((w) => String(w).replace(/\\/g, '/').replace(/\/+$/, ''))
  for (const w of write) {
    if (!w || w.startsWith('/') || w.split('/').includes('..') || /^\.git(\/|$)/i.test(w) || w.includes('\0')) throw new MissionError('SCOPE', `invalid write scope: ${w}`)
    if (isSensitiveWrite(w) || isSensitiveWrite(w + '/')) throw new MissionError('SCOPE', `${w} is a security, build or configuration surface; a mission may not write there`)
  }
  let source: ScopeSpec['source']
  if (d.scope?.source) {
    const repo = String(d.scope.source.repo ?? '')
    if (!path.isAbsolute(repo) || !existsSync(path.join(repo, '.git'))) throw new MissionError('SCOPE', 'the source repository must be an absolute path to a git checkout')
    const paths = (d.scope.source.paths ?? []).map(String)
    if (paths.length < 1 || paths.length > 40) throw new MissionError('SCOPE', 'between 1 and 40 seed paths are required')
    try {
      if (d.scope.source.ref) {
        // a chained subtask: the seed is the previous subtask's integrated commit, so its paths are checked there, not in the working tree
        const ref = resolveRef(repo, String(d.scope.source.ref))
        const tmp = materializeRef(repo, ref, paths.map((p) => p.replace(/\\/g, '/')))
        try { source = { repo, ref, paths: paths.map((p) => checkSeedPath(tmp, p)) } } finally { rmSync(tmp, { recursive: true, force: true }) }
      } else source = { repo, paths: paths.map((p) => checkSeedPath(repo, p)) }
    } catch (e) { throw new MissionError('SCOPE', e instanceof SeedError ? e.message : String(e)) }
    if (write.length === 0) throw new MissionError('SCOPE', 'a mission that works on a repository must declare where its changes may be applied (write scope)')
  }
  const targets = (Array.isArray(d.targets) ? d.targets : []).map((t) => ({ path: String(t?.path ?? '').replace(/\\/g, '/'), action: t?.action === 'create' ? ('create' as const) : ('modify' as const) }))
  if (targets.length > 12) throw new MissionError('SCOPE', 'at most 12 target files')
  for (const t of targets) {
    if (!t.path || t.path.startsWith('/') || t.path.split('/').includes('..') || !write.some((w) => t.path === w || t.path.startsWith(w + '/'))) throw new MissionError('SCOPE', `target ${t.path || '(empty)'} is outside the declared write scope`)
    if (t.action === 'modify' && source && !(source.ref ? source.paths.some((sp) => t.path === sp || t.path.startsWith(sp + '/')) : existsSync(path.join(source.repo, t.path)))) throw new MissionError('SCOPE', `target ${t.path} is to be modified but does not exist in the repository`)
  }
  const verifyScript = d.verifyScript ? String(d.verifyScript) : null
  if (verifyScript && verifyScript.length > 40_000) throw new MissionError('INVALID', 'the independent verifier script is too large')
  return { title, request, acceptance, hints, targets, scope: { ...(source ? { source } : {}), write }, install: d.install === true, verifyScript }
}

function ensureAgent(log: AgentOpsLog, by: Actor): string {
  const id = 'agent-eng-generalist'
  const reg = new AgentRegistry(log)
  const cur = deriveAgents(log).agents.get(id)
  if (cur?.state === 'ACTIVE') return id
  if (cur) throw new MissionError('INVALID', `the engineering agent exists but is ${cur.state}; a Commander must activate it first`)
  const need = detectNeed({ title: 'Engineering executor for Foundry missions', evidence: NEED_CRITERIA.map((criterion) => ({ criterion, summary: `evidence for ${criterion}: Foundry needs a bounded engineering executor for Commander-issued missions`, evidenceRefs: [`foundry-missions:${criterion}`] })) })
  reg.recordNeed(need)
  const spec = reg.propose(need.id, { id, name: 'Foundry engineering generalist', purpose: 'implement bounded multi-layer features', specialization: 'feature_implementation', riskCeiling: 'moderate', permissionScope: ['read_repo', 'write_own_reports'], memoryScope: ['project_knowledge', 'agent_operational'], ioContract: { input: 'assignment', output: 'validated changes' }, escalationPath: 'commander', reviewProcess: 'Commander reviews outcomes', toolScope: TOOLS })
  reg.transition(spec.id, 'APPROVED', by, 'engineering mission bootstrap approval'); reg.transition(spec.id, 'ACTIVE', by, 'engineering mission bootstrap activation')
  return spec.id
}

export const GENERIC_VERIFIER = `// Foundry generic verifier: runs the workspace test suite in a fresh copy and requires every file to parse.
import { cpSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
const root = process.argv[2]
const tmp = mkdtempSync(path.join(tmpdir(), 'wr-verify-'))
let bad = 0
try {
  cpSync(root, tmp, { recursive: true, dereference: false, filter: (s) => !/node_modules|\\.git(\\/|$)/.test(s) })
  const found = []
const walk = (d) => { for (const n of readdirSync(path.join(tmp, d))) { const r = d ? d + '/' + n : n; if (statSync(path.join(tmp, r)).isDirectory()) { if (n !== 'node_modules') walk(r) } else if (/\\.(test|spec)\\.[cm]?js$/.test(n)) found.push(r) } }
walk('')
const r = found.length ? spawnSync(process.execPath, ['--test', ...found], { cwd: tmp, encoding: 'utf8', timeout: 100000 }) : { status: 0, stdout: 'no test files\\n', stderr: '' }
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '')
  if (r.status !== 0) bad++
} finally { rmSync(tmp, { recursive: true, force: true }) }
process.exit(bad ? 1 : 0)
`

export function missionPaths(deps: Pick<RunnerDeps, 'store'>, id: string) { const d = deps.store.dir(id); return { dir: d, seed: path.join(d, 'seed-snapshot.json'), verifier: path.join(d, 'verifier') } }

/** Create a mission: validates the request, seeds the authorized workspace, binds an assignment, records QUEUED. Does not start work. */
export async function createMission(deps: RunnerDeps, draft: MissionDraft, by: Actor): Promise<MissionRecord> {
  { const g = deps.guard?.(); if (g) throw new MissionError('ILLEGAL', g) }
  const v = validateDraft(draft)
  const now = (deps.now ?? (() => new Date()))()
  reconcileMissions(deps.log, deps.store)
  if (draft.builder && !deps.lineupFor) throw new MissionError('NO_BUILDER', 'escalation to another local model is not available in this deployment')
  const lineup = await (draft.builder ? deps.lineupFor!(draft.builder) : deps.lineup())
  const id = deps.store.newId(now)
  const root = path.join(deps.workspacesRoot, id)
  let baseCommit: string | undefined
  if (v.scope.source) { const r = await runTool([resolveBin('git'), '-C', v.scope.source.repo, 'rev-parse', v.scope.source.ref ?? 'HEAD'], v.scope.source.repo, { timeoutMs: 20_000 }); if (r.exitCode === 0) baseCommit = r.stdout.trim() }
  const agentId = ensureAgent(deps.log, by)
  const rec: MissionRecord = {
    schema: 1, id, title: v.title, request: v.request, acceptance: v.acceptance, hints: v.hints, targets: v.targets, scope: v.scope, install: v.install, createdAt: now.toISOString(), createdBy: by,
    state: 'QUEUED', stateReason: 'creating the workspace', stateAt: now.toISOString(), workspace: { root, seeded: [], seedTreeSha256: 'PENDING', ...(baseCommit ? { baseCommit } : {}) },
    assignmentId: 'PENDING', agentId, lease: null, attempts: [], recoveries: [],
    config: { builder: lineup.builder.label, testReviewer: lineup.testReviewer?.label ?? null, testCandidates: lineup.testCandidates.map((c) => c.label), escalation: lineup.escalation?.label ?? null, flags: { simulated: lineup.simulated, escalated: !!draft.builder, chaos: !draft.builder && process.env.WAR_ROOM_CHAOS_BUILDER === 'garbage', ssrCheckOff: process.env.WAR_ROOM_ENG_SSR_CHECK === 'off', firstPass: deps.engine?.firstPass !== false, contractTests: deps.engine?.contractTests !== false && !v.targets.length, retrieval: false, research: false, fastRepair: false } },
    progress: { stepsDone: 0, stepsTotal: 0, modelCalls: 0, repairs: 0, filesChanged: [], lastEvent: 'queued' }, result: null, receipt: null,
    ...(draft.analysisId && /^rev-[0-9]{8}T[0-9]{6}-[0-9a-f]{8}$/.test(draft.analysisId) ? { analysisId: draft.analysisId } : {}),
  }
  // the reservation is the record itself, created under the cross-process lock together with the "one mission at a time" check
  try { deps.store.createExclusive(rec, (all) => all.find((m) => ACTIVE_STATES.includes(m.state) && assessLiveness(m, realFacts(now)).verdict !== 'DEAD')?.id ?? null) } catch (e) {
    const busyId = (e as { busyId?: string }).busyId
    if (busyId) throw new MissionError('BUSY', `mission ${busyId} is active; one engineering mission runs at a time (one GPU, one resident builder)`)
    throw e
  }
  try {
    let seeded
    try { seeded = seedWorkspace(root, v.scope.source) } catch (e) { throw new MissionError('SCOPE', e instanceof SeedError ? e.message : String(e)) }
    const { assignment } = assign(deps.log, {
      idempotencyKey: keyFor(id, 'feature_implementation', v.request), agentId, parentMission: { id, title: v.title }, taskClass: 'feature_implementation', capabilities: ['feature_implementation'], objective: v.request,
      expectedOutputs: ['working feature with tests', 'change receipt'], completionConditions: ['independent verification passes', 'integration gates pass'], workspace: { id: `ws-${id}`, root, kind: 'sandbox' }, tools: TOOLS,
      limits: { maxSteps: 40, maxRuntimeMs: 30 * 60_000, maxModelCalls: 60, maxRetries: 5 }, dependencies: [],
    }, by)
    const p = missionPaths(deps, id)
    writeFileSync(p.seed, JSON.stringify(seeded.snapshot))
    mkdirSync(p.verifier, { recursive: true }); writeFileSync(path.join(p.verifier, 'verify.mjs'), v.verifyScript ?? GENERIC_VERIFIER)
    const out = deps.store.update(id, (m) => { m.workspace = { ...m.workspace, seeded: seeded.seeded, seedTreeSha256: seeded.treeSha256 }; m.assignmentId = assignment.id; m.stateReason = 'queued'; return m })
    deps.store.event(id, { kind: 'CREATED', detail: `${v.title}; workspace ${root}; ${seeded.seeded.length} seeded file(s); builder ${lineup.builder.label}${lineup.simulated ? ' (SIMULATED)' : ''}${rec.analysisId ? `; seeded from Reverse Engineer analysis ${rec.analysisId}` : ''}`, attempt: 0 })
    return out
  } catch (e) {
    deps.store.update(id, (m) => { m.state = 'FAILED'; m.stateAt = new Date().toISOString(); m.stateReason = `could not create the mission: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300); return m })
    throw e
  }
}

const setState = (deps: RunnerDeps, id: string, workerId: string | null, state: MissionState, reason: string, patch: (m: MissionRecord) => void = () => {}) => {
  const now = (deps.now ?? (() => new Date()))().toISOString()
  return deps.store.update(id, (m) => {
    if (workerId !== null && (m.lease?.workerId !== workerId || !ACTIVE_STATES.includes(m.state))) return null // this worker no longer holds the mission (it was declared dead): its late result is discarded
    m.state = state; m.stateAt = now; m.stateReason = reason; patch(m); return m
  })
}

/** Start (or restart after recovery) the worker for a mission. The runner executes inside this process; its lease is renewed by a heartbeat and checked by the reconciler. */
export function launchMission(deps: RunnerDeps, id: string, kind: 'START' | 'RESUME', recoveredFrom?: Attempt['recoveredFrom']): { workerId: string; done: Promise<void> } {
  { const g = deps.guard?.(); if (g) throw new MissionError('ILLEGAL', g) }
  const now = deps.now ?? (() => new Date())
  const other = deps.store.list().find((x) => x.id !== id && ACTIVE_STATES.includes(x.state) && assessLiveness(x, realFacts(now())).verdict !== 'DEAD')
  if (other) throw new MissionError('BUSY', `mission ${other.id} is active; one engineering mission runs at a time`)
  const workerId = `eng-${process.pid}-${randomUUID().slice(0, 6)}`
  const t = now().toISOString()
  const lease = { workerId, pid: process.pid, pidStart: pidStartOf(process.pid), bootId: (() => { try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() } catch { return 'UNKNOWN' } })(), startedAt: t, heartbeatAt: t, progressAt: t, progressNote: kind === 'START' ? 'starting' : 'resuming' }
  deps.store.update(id, (m) => {
    m.state = 'RUNNING'; m.stateAt = t; m.stateReason = kind === 'START' ? 'engine started' : 'engine resumed from the checkpoint of the interrupted attempt'
    m.attempts.push({ n: m.attempts.length + 1, kind, workerId, pid: process.pid, startedAt: t, ...(recoveredFrom ? { recoveredFrom } : {}) })
    return m
  })
  deps.store.writeLease(id, lease)
  localRunners().set(id, { workerId, startedAt: t })
  const done = execute(deps, id, workerId, kind).catch((e) => {
    try { setState(deps, id, workerId, 'FAILED', `the runner crashed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400)) } catch { /* record gone */ }
  }).finally(() => { localRunners().delete(id) })
  return { workerId, done }
}

async function execute(deps: RunnerDeps, id: string, workerId: string, kind: 'START' | 'RESUME'): Promise<void> {
  const { store, log } = deps
  const clock = deps.now ?? (() => new Date())
  const m0 = store.read(id)!
  const attemptNo = m0.attempts.length
  const recovered = kind === 'RESUME'
  const ws = new Workspace(m0.workspace.root)
  const seed = JSON.parse(readFileSync(missionPaths(deps, id).seed, 'utf8')) as Record<string, string>
  const prior = store.ledger(id)
  const writes: LedgerWrite[] = prior.filter((e) => e.type === 'write') as unknown as LedgerWrite[]
  const deliveries: LedgerDelivery[] = prior.filter((e) => e.type === 'delivery') as unknown as LedgerDelivery[]
  let progressNote = kind === 'START' ? 'starting' : 'resuming'
  let progressAt = clock().toISOString()
  /** True only while this worker still holds the mission. A worker the reconciler declared dead keeps running its code, but every effect below is fenced on this. */
  const owns = () => { const l = store.readLease(id); const m = store.read(id); return !!l && l.workerId === workerId && !!m && ACTIVE_STATES.includes(m.state) }
  const beat = (note?: string, progress = false) => {
    if (progress) { progressAt = clock().toISOString(); if (note) progressNote = note }
    const cur = store.readLease(id)
    if (!cur || cur.workerId !== workerId) return // never rewrite or resurrect a lease this worker no longer holds
    try { store.writeLease(id, { ...cur, workerId, pid: process.pid, pidStart: pidStartOf(process.pid), heartbeatAt: clock().toISOString(), progressAt, progressNote } as never) } catch { /* the lease is best effort; a missed beat is what the reconciler reads */ }
  }
  const hb = setInterval(() => beat(), HEARTBEAT_MS); hb.unref?.()
  let lastProg = 0
  const progress = () => {
    const a = deriveAssignments(log).assignments.get(m0.assignmentId); void a
    const cp = latestCheckpoint(log, m0.assignmentId)
    const steps = cp?.state.steps ?? []
    store.update(id, (m) => { if (m.lease?.workerId !== workerId) return null; m.progress = { stepsDone: steps.filter((s) => s.status === 'DONE' || s.status === 'SKIPPED').length, stepsTotal: steps.length, modelCalls: deliveries.filter((d) => d.provider !== 'foundry').length, repairs: m.progress.repairs, filesChanged: [...new Set((cp?.state.fileChanges ?? []).map((c) => c.path))], lastEvent: progressNote }; return m })
  }
  try {
    const lineup = await (m0.config.flags.escalated && deps.lineupFor ? deps.lineupFor(m0.config.builder) : deps.lineup())
    const cfg = m0.config
    const verifierDir = missionPaths(deps, id).verifier
    const verification: FinalVerification = makeIndependentVerification(`independent verification (${m0.title})`, verifierDir, 'verify.mjs', readFileSync(path.join(verifierDir, 'verify.mjs'), 'utf8'), ws.root)
    const asg = deriveAssignments(log).assignments.get(m0.assignmentId)
    if (kind === 'START' && asg?.state === 'QUEUED') startAssignment(log, m0.assignmentId, C_SYSTEM)
    const result: WorkflowResult = await runFeatureWorkflow({
      log, assignmentId: m0.assignmentId, ws, model: lineup.builder.model, tools: TOOLS, finalVerification: verification, missionId: id,
      ...(lineup.testReviewer ? { testReviewer: lineup.testReviewer } : {}), ...(lineup.testCandidates.length ? { testCandidates: lineup.testCandidates } : {}), ...(lineup.escalation ? { escalation: lineup.escalation } : {}),
      ...(deps.engine?.contractTests !== false && !m0.targets?.length ? { contractTests: true } : {}), ...(deps.engine?.firstPass !== false ? { firstPass: { runtime: true } } : {}),
      ...(deps.engine?.crashAfterSteps !== undefined ? { crashAfterSteps: deps.engine.crashAfterSteps } : {}), groundTests: false,
      onWrite: (w) => {
        const role = roleOf(w.author, cfg)
        const e: LedgerWrite = { type: 'write', path: w.path, stepId: w.stepId, tag: w.tag, author: w.author, role, deterministic: w.deterministic || role === 'deterministic_tool', autofixed: w.autofixed, ...(w.editedBy ? { editedBy: w.editedBy } : {}), attempt: attemptNo, recovered, workerId, beforeHash: w.beforeHash, afterHash: w.afterHash, at: w.at }
        writes.push(e); store.ledgerAppend(id, e); beat(`wrote ${w.path}`, true)
      },
      onDelivery: (d) => {
        const author = d.executor === 'UNKNOWN' ? 'UNKNOWN' : `${d.executor.provider}/${d.executor.model}`
        const e: LedgerDelivery = { type: 'delivery', model: d.executor === 'UNKNOWN' ? 'UNKNOWN' : d.executor.model, provider: d.executor === 'UNKNOWN' ? 'UNKNOWN' : d.executor.provider, role: roleOf(author, cfg), attempt: attemptNo, recovered, latencyMs: d.latencyMs, outputTokens: d.outputTokens, at: d.at }
        deliveries.push(e); store.ledgerAppend(id, e); beat(`model reply (${author})`, true)
      },
      onEvent: (ev) => {
        store.event(id, { at: ev.at, kind: ev.kind, detail: ev.detail, attempt: attemptNo }); progressNote = `${ev.kind}: ${ev.detail}`.slice(0, 160); beat(progressNote, true)
        if (Date.now() - lastProg > 1500) { lastProg = Date.now(); try { progress() } catch { /* progress is a view; never fatal */ } }
      },
    }, { request: m0.request, acceptance: m0.acceptance, hints: m0.hints, ...(m0.targets?.length ? { targets: m0.targets } : {}) })
    try { progress() } catch { /* view only */ }
    if (result.status === 'CRASHED') return // simulated process death (tests only): the lease is left to expire and the reconciler must notice
    const finishAs = async (state: MissionState, reason: string, integration: ChangeReceipt['integration'], install: ChangeReceipt['install'], verifier: ChangeReceipt['verifier']) => {
      if (!owns()) { store.event(id, { kind: 'LATE_RESULT_DISCARDED', detail: `worker ${workerId} no longer holds the mission; its ${state} result was not recorded`, attempt: attemptNo }); return }
      const receipt = buildReceipt({ mission: store.read(id)!, ws, seed, writes, deliveries, result, verifier, integration, install, now: clock() })
      const check = verifyReceipt(receipt, ws)
      if (state === 'COMPLETED' && !check.ok) { state = 'FAILED'; reason = `the change receipt does not match the filesystem: ${check.mismatches.slice(0, 3).join('; ')}` }
      store.writeReceipt(id, `receipt-a${attemptNo}.json`, receipt)
      setState(deps, id, workerId, state, reason, (m) => {
        m.receipt = receipt; m.result = { status: result.status, reason: result.reason, ...(result.completionClass ? { completionClass: result.completionClass } : {}), verifierExit: verifier.exitCode }
        const last = m.attempts[m.attempts.length - 1]; if (last && !last.endedAt) { last.endedAt = clock().toISOString(); last.endState = state; last.endReason = reason }
        m.progress = { ...m.progress, repairs: result.repairs, modelCalls: deliveries.filter((d) => d.provider !== 'foundry').length }
      })
      store.retireLease(id, state.toLowerCase())
      store.event(id, { kind: `MISSION_${state}`, detail: reason, attempt: attemptNo })
    }
    const notRun: ChangeReceipt['verifier'] = { label: 'independent verification', exitCode: 'NOT_RUN', summary: 'the workflow ended before final verification', at: clock().toISOString() }
    const noInt: ChangeReceipt['integration'] = { state: 'NOT_RUN', gates: [], refused: [] }
    const noInst: ChangeReceipt['install'] = { state: m0.install ? 'NOT_RUN' : 'NOT_REQUESTED' }
    if (result.status === 'PAUSED') { setState(deps, id, workerId, 'INTERRUPTED', 'paused by the Commander; resume the assignment and the mission to continue', (m) => { const last = m.attempts[m.attempts.length - 1]; if (last && !last.endedAt) { last.endedAt = clock().toISOString(); last.endState = 'INTERRUPTED'; last.endReason = 'paused' } }); store.retireLease(id, 'paused'); return }
    if (result.status === 'CANCELLED') { await finishAs('CANCELLED', result.reason, noInt, noInst, notRun); return }
    if (result.status !== 'COMPLETED') { await finishAs('FAILED', `${result.status}: ${result.reason}`, noInt, noInst, notRun); return }
    // ---- independent verification, run now against the final workspace
    if (!owns()) { store.event(id, { kind: 'LATE_RESULT_DISCARDED', detail: `worker ${workerId} lost the mission before verification`, attempt: attemptNo }); return }
    setState(deps, id, workerId, 'VERIFYING', 'running the independent verifier against the final workspace'); beat('independent verification', true)
    const fv = await verification.run()
    let verifier: ChangeReceipt['verifier'] = { label: verification.label, exitCode: fv.exitCode ?? -1, summary: (fv.stdout + '\n' + fv.stderr).trim().split('\n').filter((l) => /^(not ok|# )/.test(l)).join(' | ').slice(0, 400) || 'no summary', at: clock().toISOString() }
    if (fv.exitCode !== 0) { await finishAs('FAILED', 'the independent verifier failed on the final workspace', noInt, noInst, verifier); return }
    // ---- server-render hazards (application code that will be built into an installation): the type checker cannot see them and `next build` would fail minutes later, so they are repaired now, naming the exact lines
    if (m0.install && process.env.WAR_ROOM_ENG_SSR_CHECK === 'off') store.event(id, { kind: 'SSR_CHECK_DISABLED', detail: 'the pre-integration server-render check is switched off by WAR_ROOM_ENG_SSR_CHECK=off (acceptance testing)', attempt: attemptNo })
    if (m0.install && process.env.WAR_ROOM_ENG_SSR_CHECK !== 'off') {
      for (let round = 1; round <= 2; round++) {
        if (!owns()) { store.event(id, { kind: 'LATE_RESULT_DISCARDED', detail: `worker ${workerId} lost the mission during the server-render check`, attempt: attemptNo }); return }
        const fin0 = ws.snapshot()
        const inScope = (p: string) => m0.scope.write.some((w) => p === w || p.startsWith(w.replace(/\/$/, '') + '/'))
        // every client component the mission may write, not only the ones changed in this run: a repair mission starts from a seed that already contains the hazard
        const changedUi = Object.keys(fin0).filter((p) => /\.(tsx|jsx)$/.test(p) && inScope(p))
        const hz = findSsrHazards(changedUi.map((p) => ({ path: p, text: ws.read(p) })))
        if (!hz.length) { if (round > 1) store.event(id, { kind: 'SSR_CHECK', detail: 'no server-render hazards remain', attempt: attemptNo }); break }
        setState(deps, id, workerId, 'RUNNING', `repairing server-render hazards (round ${round}) in ${[...new Set(hz.map((h) => h.path))].join(', ')}`); beat('server-render repair', true)
        store.event(id, { kind: 'SSR_HAZARD', detail: hz.slice(0, 4).map((h) => `${h.path}:${h.line} ${h.text}`).join(' | ').slice(0, 500), attempt: attemptNo })
        let wrote = 0
        for (const file of new Set(hz.map((h) => h.path))) {
          const errs = hz.filter((h) => h.path === file).map((h) => `line ${h.line}: \`${h.text}\` — ${h.why}. Use a safe server value as the initial state and read the browser global inside useEffect (then set state).`)
          const cur = ws.read(file)
          const r = await lineup.builder.model.generate({ system: GATE_REPAIR_SYSTEM.replace('compile errors reported by the repository\'s own TypeScript check', 'server-render hazards found by static analysis (the production build prerenders this component on the server, where window, document, localStorage and matchMedia do not exist)'), prompt: gateRepairPrompt(file, cur, errs, [], 'Static analysis found these server-render hazards in this file:'), maxTokens: 6000, timeoutMs: 300_000 })
          if (!r.ok) { store.event(id, { kind: 'SSR_REPAIR_FAILED', detail: `${file}: ${r.detail}`, attempt: attemptNo }); continue }
          const author = `${r.executor.provider}/${r.executor.model}`
          deliveries.push({ type: 'delivery', model: r.executor.model, provider: r.executor.provider, role: roleOf(author, cfg), attempt: attemptNo, recovered, latencyMs: r.latencyMs, outputTokens: r.outputTokens, at: clock().toISOString() }); store.ledgerAppend(id, deliveries[deliveries.length - 1])
          const fixed = extractCorrected(r.text, cur)
          if (!fixed || fixed === cur) { store.event(id, { kind: 'SSR_REPAIR_NOOP', detail: `${file}: the reply changed nothing usable`, attempt: attemptNo }); continue }
          const w = ws.write(file, fixed)
          const e: LedgerWrite = { type: 'write', path: file, stepId: `ssr-repair-${round}`, tag: ':ssr-repair', author, role: roleOf(author, cfg), deterministic: false, autofixed: false, attempt: attemptNo, recovered, workerId, beforeHash: w.beforeHash, afterHash: w.afterHash, at: clock().toISOString() }
          writes.push(e); store.ledgerAppend(id, e); wrote++
          store.event(id, { kind: 'SSR_REPAIR', detail: `round ${round}: ${file} rewritten against ${errs.length} server-render hazard(s)`, attempt: attemptNo })
        }
        if (!wrote) break
        const re = await verification.run()
        verifier = { ...verifier, exitCode: re.exitCode ?? -1, at: clock().toISOString(), summary: `after server-render repair: ${(re.stdout + '\n' + re.stderr).trim().split('\n').filter((l) => /^(not ok|# )/.test(l)).join(' | ').slice(0, 300)}` }
        if (re.exitCode !== 0) { await finishAs('FAILED', 'the independent verifier failed after the server-render repair', noInt, noInst, verifier); return }
      }
    }
    // ---- integration into the repository branch (only for repository missions)
    let integration = noInt
    if (m0.scope.source) {
      if (!owns()) { store.event(id, { kind: 'LATE_RESULT_DISCARDED', detail: `worker ${workerId} lost the mission before integration; nothing was applied`, attempt: attemptNo }); return }
      setState(deps, id, workerId, 'APPLYING', 'applying the verified changes to the integration branch and running the repository gates'); beat('integration gates', true)
      const final = ws.snapshot()
      const created = Object.keys(final).filter((p) => !(p in seed)); const modified = Object.keys(final).filter((p) => p in seed && seed[p] !== final[p]); const deleted = Object.keys(seed).filter((p) => !(p in final))
      integration = await integrate(store.read(id)!, ws, created, modified, deleted, { integrationRoot: deps.integrationRoot, now: clock }, deps.gates ?? DEFAULT_GATES)
      // A repository gate that fails on the mission's own files gets a bounded repair: the compiler's errors go back to the builder for exactly those files, then the
      // independent verifier and the workspace tests run again before the gates do. Errors outside the mission's files are not the mission's to fix.
      for (let round = 1; round <= GATE_REPAIR_ROUNDS && integration.state === 'GATES_FAILED'; round++) {
        if (!owns()) { store.event(id, { kind: 'LATE_RESULT_DISCARDED', detail: `worker ${workerId} lost the mission during gate repair`, attempt: attemptNo }); return }
        const tsc = integration.gates.find((g) => g.name.startsWith('typecheck') && g.exitCode !== 0)
        if (!tsc?.detail || integration.gates.some((g) => g.exitCode !== 0 && g !== tsc)) break
        const missionFiles = [...created, ...modified]
        const { mine, others } = splitErrors(tscErrorsByFile(tsc.detail), missionFiles)
        if (!mine.size || others.length) { store.event(id, { kind: 'GATE_REPAIR_SKIPPED', detail: mine.size ? `errors outside the mission's files: ${others.slice(0, 2).join('; ')}` : 'no error is in a file the mission wrote', attempt: attemptNo }); break }
        setState(deps, id, workerId, 'RUNNING', `repairing repository gate failures (round ${round}) in ${[...mine.keys()].join(', ')}`); beat('gate repair', true)
        let wrote = 0
        for (const [file, errs] of mine) {
          const related = missionFiles.filter((f) => f !== file && /\.(m?js|ts)$/.test(f) && ws.exists(f)).map((f) => ({ path: f, text: ws.read(f) }))
          const cur = ws.read(file)
          const r = await lineup.builder.model.generate({ system: GATE_REPAIR_SYSTEM, prompt: gateRepairPrompt(file, cur, errs, related), maxTokens: 6000, timeoutMs: 300_000 })
          if (!r.ok) { store.event(id, { kind: 'GATE_REPAIR_FAILED', detail: `${file}: ${r.detail}`, attempt: attemptNo }); continue }
          const author = `${r.executor.provider}/${r.executor.model}`
          deliveries.push({ type: 'delivery', model: r.executor.model, provider: r.executor.provider, role: roleOf(author, cfg), attempt: attemptNo, recovered, latencyMs: r.latencyMs, outputTokens: r.outputTokens, at: clock().toISOString() }); store.ledgerAppend(id, deliveries[deliveries.length - 1])
          const fixed = extractCorrected(r.text, cur)
          if (!fixed || fixed === cur) { store.event(id, { kind: 'GATE_REPAIR_NOOP', detail: `${file}: the reply changed nothing usable`, attempt: attemptNo }); continue }
          const w = ws.write(file, fixed)
          const e: LedgerWrite = { type: 'write', path: file, stepId: `gate-repair-${round}`, tag: ':gate-repair', author, role: roleOf(author, cfg), deterministic: false, autofixed: false, attempt: attemptNo, recovered, workerId, beforeHash: w.beforeHash, afterHash: w.afterHash, at: clock().toISOString() }
          writes.push(e); store.ledgerAppend(id, e); wrote++
          store.event(id, { kind: 'GATE_REPAIR', detail: `round ${round}: ${file} rewritten against ${errs.length} compiler error(s)`, attempt: attemptNo })
        }
        if (!wrote) break
        const re = await verification.run()
        const unitFiles = ws.list().filter((f) => /(^|\/)test\/.*\.(test|spec)\.[cm]?js$/.test(f))
        const unit = unitFiles.length ? await runHermetic(ws.root, ['node', '--test', ...unitFiles], TOOLS, { timeoutMs: 90_000, isolateEnv: storageEnvVars(m0.acceptance) }) : { exitCode: 0, stdout: '', stderr: '' }
        verifier = { ...verifier, exitCode: re.exitCode ?? -1, at: clock().toISOString(), summary: `after gate repair: ${(re.stdout + '\n' + re.stderr).trim().split('\n').filter((l) => /^(not ok|# )/.test(l)).join(' | ').slice(0, 300)}` }
        if (re.exitCode !== 0 || unit.exitCode !== 0) { store.event(id, { kind: 'GATE_REPAIR_REGRESSED', detail: `after the repair the ${re.exitCode !== 0 ? 'independent verifier' : 'workspace tests'} failed; the mission stops here${unit.exitCode !== 0 ? ` (${(unit.stdout + unit.stderr).split('\n').filter((l) => /^not ok|Error|# fail/.test(l.trim())).slice(0, 4).join(' | ').slice(0, 300)})` : ''}`, attempt: attemptNo }); break }
        const fin2 = ws.snapshot()
        const cr2 = Object.keys(fin2).filter((p) => !(p in seed)), mo2 = Object.keys(fin2).filter((p) => p in seed && seed[p] !== fin2[p]), de2 = Object.keys(seed).filter((p) => !(p in fin2))
        created.splice(0, created.length, ...cr2); modified.splice(0, modified.length, ...mo2)
        setState(deps, id, workerId, 'APPLYING', `re-running the repository gates after repair round ${round}`)
        integration = await integrate(store.read(id)!, ws, cr2, mo2, de2, { integrationRoot: deps.integrationRoot, now: clock }, deps.gates ?? DEFAULT_GATES)
      }
      if (integration.state !== 'APPLIED') { await finishAs('FAILED', integration.state === 'REFUSED' ? `integration refused: ${integration.refused.join('; ')}` : `integration gates failed: ${integration.gates.filter((g) => g.exitCode !== 0).map((g) => g.name).join(', ')}`, integration, noInst, verifier); return }
    }
    // ---- install (only when the Commander asked for it at creation)
    let install = noInst
    if (m0.install) {
      if (!owns()) { store.event(id, { kind: 'LATE_RESULT_DISCARDED', detail: `worker ${workerId} lost the mission before install; nothing was merged or built`, attempt: attemptNo }); return }
      if (!deps.installer) { await finishAs('FAILED', 'an install was requested but this deployment has no installer', integration, { state: 'NOT_RUN', detail: 'no installer configured' }, verifier); return }
      setState(deps, id, workerId, 'INSTALLING', 'building and installing a new versioned runtime from the integrated commit'); beat('installing', true)
      install = await deps.installer(store.read(id)!, integration, (s) => { store.event(id, { kind: 'INSTALL', detail: s, attempt: attemptNo }); beat(`install: ${s}`.slice(0, 160), true) })
      if (install.state !== 'INSTALLED') { await finishAs('FAILED', `install failed: ${install.detail ?? install.state}`, integration, install, verifier); return }
    }
    await finishAs('COMPLETED', `${result.completionClass ?? 'COMPLETED'}: verified, ${m0.scope.source ? 'integrated' : 'workspace result'}${m0.install ? ', installed' : ''}`, integration, install, verifier)
  } finally { clearInterval(hb) }
}

/** Resume an INTERRUPTED mission from its checkpoint (the recovery worker). Completed work is not redone; ids, assignment and prior receipts are kept. */
export function resumeMission(deps: RunnerDeps, id: string, by: Actor): { workerId: string; done: Promise<void> } {
  { const g = deps.guard?.(); if (g) throw new MissionError('ILLEGAL', g) }
  reconcileMissions(deps.log, deps.store)
  const m = deps.store.read(id)
  if (!m) throw new MissionError('NOT_FOUND', 'unknown mission')
  if (m.state !== 'INTERRUPTED') throw new MissionError('ILLEGAL', `only an INTERRUPTED mission can be resumed (this one is ${m.state})`)
  const busy = deps.store.list().find((x) => x.id !== id && ACTIVE_STATES.includes(x.state) && assessLiveness(x, realFacts()).verdict !== 'DEAD')
  if (busy) throw new MissionError('BUSY', `mission ${busy.id} is ${busy.state}; one engineering mission runs at a time`)
  const rec = m.recoveries[m.recoveries.length - 1]
  const can = resumability(deps.log, m)
  if (!can.resumable) throw new MissionError('ILLEGAL', `this mission cannot be resumed safely: ${can.why}`)
  const asg = deriveAssignments(deps.log).assignments.get(m.assignmentId)
  if (asg?.state === 'PAUSED') resumeAssignment(deps.log, m.assignmentId, by, 'mission resumed by the Commander')
  else if (asg?.state === 'INTERRUPTED') recoverAssignment(deps.log, m.assignmentId, C_SYSTEM, `recovery worker takes the mission up from checkpoint ${rec?.checkpointSeq ?? 'NONE'}`)
  else if (asg?.state !== 'RUNNING') throw new MissionError('ILLEGAL', `the assignment is ${asg?.state ?? 'missing'} and cannot be resumed`)
  const cp = latestCheckpoint(deps.log, m.assignmentId)
  deps.store.event(id, { kind: 'RESUME_REQUESTED', detail: `by ${by}; checkpoint ${cp ? cp.seq : 'NONE'}`, attempt: m.attempts.length })
  return launchMission(deps, id, 'RESUME', { attempt: m.attempts.length, checkpointSeq: cp ? cp.seq : 'NONE', filesPreserved: new Set((cp?.state.fileChanges ?? []).map((c) => c.path)).size })
}

/** Cancel: a live run stops at its next safe boundary (assignment cancel); a mission with no live worker is cancelled directly. */
export function cancelMission(deps: RunnerDeps, id: string, by: Actor, reason: string): MissionRecord {
  const m = deps.store.read(id)
  if (!m) throw new MissionError('NOT_FOUND', 'unknown mission')
  if (!ACTIVE_STATES.includes(m.state) && m.state !== 'INTERRUPTED') throw new MissionError('ILLEGAL', `mission is already ${m.state}`)
  const now = (deps.now ?? (() => new Date()))().toISOString()
  const live = ACTIVE_STATES.includes(m.state) && assessLiveness(m, realFacts()).verdict !== 'DEAD'
  if (live) {
    const a = deriveAssignments(deps.log).assignments.get(m.assignmentId)
    if (a && ['RUNNING', 'PAUSED', 'BLOCKED', 'QUEUED'].includes(a.state)) requestCancel(deps.log, m.assignmentId, by, reason || 'Commander cancelled')
    deps.store.event(id, { kind: 'CANCEL_REQUESTED', detail: `${by}: ${reason}`, attempt: m.attempts.length })
    return deps.store.update(id, (x) => { x.cancelRequestedAt = now; return x })
  }
  deps.store.event(id, { kind: 'MISSION_CANCELLED', detail: `${by}: ${reason} (no live worker)`, attempt: m.attempts.length })
  return deps.store.update(id, (x) => { x.state = 'CANCELLED'; x.stateAt = now; x.stateReason = `cancelled by the Commander: ${reason || 'no reason given'}`; x.cancelRequestedAt = now; return x })
}

export { pauseAssignment, planApply, fileProvenance }

import type { AgentOpsLog } from '../log'
import type { Actor, CheckpointState, CheckpointStep, EngineeringTool, FileChange, ValidationRecord } from '../types'
import { acknowledgeCancel, completeAssignment, deriveAssignments, executionGate, failAssignment, finalizeCancel } from './assignments'
import { type EngineeringCodePlan, planFromCode } from './codePlanner'
import { latestCheckpoint, planResume, runEffectOnce, saveCheckpoint, sha256 } from './continuity'
import { MAX_REPAIR_ATTEMPTS, addEvidence, deriveLedger, markUndetermined, proposeHypothesis, recordFailure, recordRepair, recordValidation, authorizeRepair, parseToolOutput } from './debugLedger'
import { ANALYST_SYSTEM, ENGINEER_REWRITE_SYSTEM, ENGINEER_SYSTEM, ENGINEER_STRUCT_SYSTEM, analystPrompt, chooseMode, featurePrompt, parseEditReply, repairPrompt, type FileJob } from './prompts'
import type { CommandRecord, ModelClient, ModelResult } from './runtime/ports'
import { runCommand, runHermetic } from './runtime/commandRunner'
import { Workspace, treeHash } from './runtime/workspaceFs'
import { buildWorkspaceIndex, indexSource, topLevelDuplicates } from './workspaceIndex'
import { collisionFacts, isCollisionProblem } from './collision'
import { quarantineTests, quarantineAssertions, correctContractAssertions, type ContractCorrection } from './testContract'
import { completionClass, type CompletionClass } from './completionClass'
import { classifyModelFailure, MODEL_MAX_ATTEMPTS } from './modelFailure'
import { testAssistJustified, buildIdentityFor, buildFrontierRequest, renderFrontierRequest, assistJustified, ASSIST_MIN_REFUTED, helperBudgetLeft, type EscalationTrigger, type HelperPolicy, checkProvenanceAndScope, classifySteps, FrontierLedger, sha, type BuildIdentity, type FrontierUsage, type IngestionRecord, type SubtaskRecord } from './sovereign'
import type { FrontierProvider } from './frontierBridge'
import { groundTests, ungroundedChallenge, type TestGrounding } from './testGrounding'
import { attachContractStatuses, mapCatchStatus } from './errorStatus'
import { REVIEWER_SYSTEM, buildTestPlan, normalizeTestNames, type NameRewrite, criteriaForFailures, HARNESS_PATH, repairDefaultStoragePath, repairMissingStorageDir, correctionAcceptance, classifyTestDefect, dropUngrounded, harnessSource, parseReviewerVerdict, planPromptFor, reviewProblem, reviewTestFile, reviewerPrompt, uncoveredCriteria, type DefectVerdict, type TestPlan } from './testPlan'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import { repairRouteOrder, statusDiagnosis } from './routeEdit'
import type { RouteEditMode, RouteOp } from './routeEdit'
import { undefinedNames, routeFindings, routeTable, routeRegion, contractRouteProblems, statusReachability, syntaxProblems, legacyStateDrift, domIds, missingDomIds } from './staticGates'
import { persistenceProblems, persistenceProbe, wantsPersistence, type PersistenceProbe } from './persistenceContract'
import { buildEvidence, renderEvidence, parseTestFailures } from './failureEvidence'
import { startupProbe } from './startupProbe'
import { deriveImplementationContract, inheritConventions, resolveContract, unresolvedAmbiguities, renderContract, type ImplementationContract } from './implContract'
import { matchRecipes, renderRecipes, buildImplStep, renderImplStep, runRecipeChecks, stripManifest, checkManifest, autofix, type Recipe, type Manifest, type ImplStep, type RecipeFinding } from './recipes'
import { runPreflight, preflightTap, preflightHypotheses, type PreflightReport } from './preflight'
import { newFirstPassState, buildFirstPassReport, type FirstPassOptions, type FirstPassReport } from './firstPass'
import { storageEnvVars } from './persistenceContract'
import { seedFromHandoff } from './successor'

export type FeatureRequest = { request: string; acceptance: string[]; hints?: string[] }
export type WorkflowEvent = { at: string; kind: string; detail: string }
export type FinalVerification = { label: string; argv: string[]; run: () => Promise<CommandRecord> }
export type WorkflowDeps = {
  log: AgentOpsLog
  assignmentId: string
  ws: Workspace
  model: ModelClient
  tools: EngineeringTool[]
  actor?: Actor
  lessons?: (ctx: { plan: EngineeringCodePlan; request: string }) => string[]
  finalVerification?: FinalVerification
  clock?: () => Date
  onEvent?: (e: WorkflowEvent) => void
  /** Stop after N completed steps (used by crash/restart tests and acceptance to simulate process death). */
  crashAfterSteps?: number
  /** Model to escalate to (already installed, permissive) after two materially distinct repair hypotheses were refuted. Never switched silently: every switch is an ESCALATE event and a result record. */
  escalation?: { label: string; model: ModelClient }
  /** Sovereign Build Law: an OPTIONAL bounded outside specialist. Local-first: it is consulted only after local hypotheses are exhausted on one file, its reply lands in `reviewDir` (never the workspace) and goes through the ingestion gate. */
  frontier?: { provider: FrontierProvider; reviewDir: string; maxCalls?: number }
  /** Independent test writer: the model that authors the tests-layer files (builder != test writer). */
  testWriter?: { label: string; model: ModelClient }
  /** Competing local test candidates, tried (in order) only when the first test file fails against the independently verified implementation. */
  testCandidates?: { label: string; model: ModelClient }[]
  /** The controlling mission id (defaults to the assignment's parent mission). */
  missionId?: string
  /** Enable the contract-grounding reviewer for generated tests (implied by `testWriter`). Off by default so pre-existing flows are unchanged. */
  groundTests?: boolean
  /** Helpers (candidates, writer fallback, frontier) are selective and bounded: a slice of the assignment, never the reserve for the main build and the final verifier. */
  helperPolicy?: HelperPolicy
  /** Competing candidates per test file (default 1: helpers are selective, not exhaustive). */
  maxCandidatesPerFile?: number
  /** calls and time held back for the final competing-candidate rescue of a failing contract test (defaults: one call per contract file, 5 minutes; both capped at 20% of the assignment limits) */
  rescueReserve?: { calls?: number; ms?: number }
  /** Contract-first test authoring: a structured test plan, a Foundry-owned isolation harness, a pre-execution review, and quarantine only as the last fallback. */
  contractTests?: boolean
  /** contract tests Foundry can generate from the contract (filters, counts, transitions, storage) are generated, not model-written; false keeps every criterion model-written (fallback path) */
  generatedTests?: boolean
  /** A separate local model that reviews each generated test file against its plan row BEFORE it runs (builder and reviewer are different roles). */
  testReviewer?: { label: string; model: ModelClient }
  /** Replay: the implementation already in the workspace is independently verified and reused; only the test-authoring steps run. */
  reuseImplementation?: boolean
  /** First-pass correctness: implementation contract, proven recipes, per-step plan, structural edits, manifest self-check, implementation preflight before any test. Off by default. */
  firstPass?: FirstPassOptions
}
/** The test-rescue allowance kept apart for the final competing-candidate step: earlier repair activity cannot spend it. */
export const RESCUE_MAX_SHARE = 0.2
export const RESCUE_DEFAULT_MS = 5 * 60_000
export type RescueBudget = { reserved_calls: number; reserved_time_ms: number; used_calls: number; used_time_ms: number; rescue_attempted: boolean; rescue_skipped_reason: string | null }
export type RepairTraceEntry = { step: string; label: string; attempt: number; check: number | null; checkName: string; key: string; hypothesis: string; files: string[]; model: string; contextDepth: 0 | 1; before: string; after: string; outcome: 'TARGET_FIXED' | 'CHANGED' | 'REFUTED' | 'NO_EDIT' }
export type RouteEditRecord = { step: string; stage: 'EDIT_REJECTION' | 'DEBUG_REPAIR'; file: string; mode: RouteEditMode; ops: RouteOp[]; notes: string[]; finding: string; spanBefore: string; spanAfter: string; originalCheck: string; resultAfter: string }
export type EscalationRecord = { step: string; attempt: number; reason: string; modelBefore: string; modelAfter: string; contextDepth: 1; outcomeAfter?: string }
export type ModelTimeoutRecord = { kind?: 'TIMEOUT' | 'TRANSIENT'; call: number; attempt: number; outcome: 'RETRIED' | 'RECOVERED' | 'EXHAUSTED' | 'NOT_RETRIED'; waitedMs: number; detail: string; purpose: string }
export type WorkflowResult = {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'PAUSED' | 'CONFLICT' | 'BLOCKED' | 'CRASHED'
  reason: string
  modelCalls: number
  quarantinedTests?: number
  /** deterministic contract corrections of model-written status assertions (not quarantines; coverage is kept) */
  correctedTests?: number
  contractCorrections?: ContractCorrection[]
  /** every model-call timeout, retry and outcome (bounded, recorded, never silent) */
  modelTimeouts?: ModelTimeoutRecord[]
  /** transient local-model errors (HTTP 500/502/503/504): same bounded retry, same evidence */
  modelTransients?: ModelTimeoutRecord[]
  /** CLEAN / WITH_QUARANTINE / UNVERIFIED / FAILED, derived from the workflow's own evidence; the independent verifier decides UNVERIFIED */
  completionClass?: CompletionClass
  /** Sovereign identity: every record of this build carries mission_id / build_id / workspace_id / assignment_id */
  build?: BuildIdentity
  subtasks?: SubtaskRecord[]
  frontier?: { usage: FrontierUsage; records: IngestionRecord[] }
  /** CLEAN split: CLEAN_LOCAL_ONLY (no accepted frontier contribution) vs CLEAN_WITH_FRONTIER_ASSIST (Foundry accepted and integrated one); null unless CLEAN */
  cleanKind?: 'CLEAN_LOCAL_ONLY' | 'CLEAN_WITH_FRONTIER_ASSIST' | null
  testGrounding?: Record<string, TestGrounding[]>
  testAuthoring?: { writer: string; candidates: { label: string; file: string; failing: number; passed: boolean; kept: boolean }[]; rescue?: RescueBudget; nameRewrites?: NameRewrite[] }
  /** the structured plan the tests were written from, the per-test traceability and review record, the defect classification of every failing test, and what kept a run from CLEAN */
  testPlan?: { entry: string; files: { path: string; criteria: number[] }[]; tests: TestPlan['tests'] } | null
  testTraceability?: { test_id: string; file: string; criterion_ids: number[]; behavior: string; generated_by: string; reviewed_by: string[]; confidence: string }[]
  testReviews?: { file: string; reviewer: string; verdict: string; findings: string[] }[]
  testDefects?: { file: string; test: string; kind: string; basis: string; resolved: boolean }[]
  cleanBlockers?: string[]
  firstPass?: FirstPassReport
  repairTrace?: RepairTraceEntry[]
  escalations?: EscalationRecord[]
  routeEdits?: RouteEditRecord[]
  repairs: number
  filesChanged: string[]
  stepsDone: number
  tokens: number | 'UNKNOWN'
  latencyMs: number
  executor: { provider: string; model: string } | 'UNKNOWN'
}
const FACT_BEARING = /route conflict|does not serve what the acceptance contract|nothing in the code can ever respond|existing exports changed|persistence contract|syntax error|never declared or imported|recipe check failed/
const LAYER_ORDER = ['storage', 'domain', 'api', 'ui', 'tests']

export async function runFeatureWorkflow(deps: WorkflowDeps, req: FeatureRequest): Promise<WorkflowResult> {
  const { log, assignmentId, ws } = deps
  const actor = deps.actor ?? 'system:engineering-runner'
  const clock = deps.clock ?? (() => new Date())
  const asg = deriveAssignments(log).assignments.get(assignmentId)
  if (!asg) throw new Error(`unknown assignment: ${assignmentId}`)
  const limits = asg.assignment.limits
  const t0 = Date.now()
  let modelCalls = 0
  let tokens: number | 'UNKNOWN' = 0
  let executor: WorkflowResult['executor'] = 'UNKNOWN'
  let repairs = 0
  let quarantined = 0
  const corrections: ContractCorrection[] = []
  const timeouts: ModelTimeoutRecord[] = []
  const transients: ModelTimeoutRecord[] = []
  let lastKind: 'TIMEOUT' | 'TRANSIENT' = 'TIMEOUT'
  const trace: RepairTraceEntry[] = []
  const escalations: EscalationRecord[] = []
  const routeEdits: RouteEditRecord[] = []
  let activeModel: ModelClient = deps.model
  let stepsDone = 0
  const changed = new Set<string>()
  const emit = (kind: string, detail: string) => deps.onEvent?.({ at: clock().toISOString(), kind, detail })
  let verifiedAtEnd: boolean | null = null
  const build = buildIdentityFor(deps.missionId ?? asg.assignment.parentMission.id, assignmentId, asg.assignment.workspace?.id ?? 'UNKNOWN')
  const ledger = new FrontierLedger(deps.frontier?.maxCalls ?? 3)
  const groundingByFile: Record<string, TestGrounding[]> = {}
  const candidateLog: NonNullable<WorkflowResult['testAuthoring']>['candidates'] = []
  const testReviews: NonNullable<WorkflowResult['testReviews']> = []
  const testDefects: NonNullable<WorkflowResult['testDefects']> = []
  let orderIndependent: boolean | null = null
  const tplan: TestPlan | null = deps.contractTests ? buildTestPlan(req.acceptance, ws.exists('package.json') ? ws.read('package.json') : null, { generate: deps.generatedTests !== false }) : null
  // reserved test-rescue budget (contract mode with a candidate model only): held back from all other activity, capped well inside the global hard limits
  const rescue: RescueBudget = { reserved_calls: 0, reserved_time_ms: 0, used_calls: 0, used_time_ms: 0, rescue_attempted: false, rescue_skipped_reason: null }
  if (tplan && deps.testCandidates?.length) {
    rescue.reserved_calls = Math.max(0, Math.min(deps.rescueReserve?.calls ?? tplan.files.filter((f) => !f.generated).length * Math.max(1, deps.maxCandidatesPerFile ?? 1), Math.floor(limits.maxModelCalls * RESCUE_MAX_SHARE)))
    rescue.reserved_time_ms = Math.max(0, Math.min(deps.rescueReserve?.ms ?? RESCUE_DEFAULT_MS, Math.floor(limits.maxRuntimeMs * RESCUE_MAX_SHARE)))
  }
  let rescueReleased = false
  const rescueFilesDone = new Set<string>()
  const rescueHeld = () => (rescueReleased ? { calls: 0, ms: 0 } : { calls: Math.max(0, rescue.reserved_calls - rescue.used_calls), ms: Math.max(0, rescue.reserved_time_ms - rescue.used_time_ms) })
  function traceability(): NonNullable<WorkflowResult['testTraceability']> {
    return Object.entries(groundingByFile).flatMap(([file, gs]) => gs.map((g, i) => ({ test_id: `${file}#${i + 1}`, file, criterion_ids: g.criterion_id ? [g.criterion_id] : [], behavior: g.behavior, generated_by: g.source, reviewed_by: tplan ? ['foundry:deterministic-review', ...testReviews.filter((r) => r.file === file && r.reviewer !== 'foundry:deterministic-review').map((r) => r.reviewer)] : [], confidence: g.confidence })))
  }
  /** Deterministic status correction judges each assertion against the clause it proves: criteria that name several statuses are also offered as single-status clauses (contract-mode only; the whole criterion stays in the list, so an assertion that spans clauses is still refused). */
  const correctionList = tplan ? correctionAcceptance(req.acceptance) : { list: req.acceptance, parent: req.acceptance.map((_, i) => i) }
  const correctToContract = (path: string, text: string, fails: { line: number | null; actual: string | null; expected: string | null }[]) => {
    const r = correctContractAssertions(path, text, fails, correctionList.list)
    if (r) for (const c of r.corrections) c.criterion = (correctionList.parent[c.criterion - 1] ?? c.criterion - 1) + 1
    return r
  }
  /** Everything besides quarantine that keeps a verified run from CLEAN: required criteria without a grounded test, ungrounded tests, unresolved ambiguity, order dependence. */
  const cleanBlockersNow = (): string[] => {
    if (!tplan) return []
    const b: string[] = []
    const files = Object.fromEntries(tplan.files.filter((f) => ws.exists(f.path)).map((f) => [f.path, ws.read(f.path)]))
    const missing = uncoveredCriteria(tplan, files, req.acceptance)
    if (missing.length) b.push(`required criteria without a grounded passing test: ${missing.map((n) => 'C' + n).join(', ')}`)
    const ungrounded = Object.values(groundingByFile).flat().filter((g) => g.confidence === 'NONE')
    if (ungrounded.length) b.push(`${ungrounded.length} ungrounded test(s)`)
    if (testDefects.some((d) => d.kind === 'AMBIGUOUS' && !d.resolved)) b.push('unresolved ambiguity between a test and the contract')
    if (orderIndependent === false) b.push('test results depend on test order (hidden shared state)')
    return b
  }
  const writerLabel = deps.testWriter?.label ?? 'builder'
  // ---- first-pass correctness state (everything below is inert unless deps.firstPass is set)
  const fpOn = !!deps.firstPass
  const fpm = newFirstPassState()
  let fpContract: ImplementationContract | null = null
  let fpUnresolved: string[] = []
  let fpRecipes: Recipe[] = []
  const fpSteps: ImplStep[] = []
  let fpExtra: { check: string; statement: string; files: string[] }[] = []
  const fpLast: { v: { path: string; manifest: Manifest | null } | null } = { v: null }
  if (fpOn) { const raw = deriveImplementationContract(req.acceptance, req.request); fpUnresolved = unresolvedAmbiguities(raw).map((a) => `C${a.criterion}: ${a.question}`); fpContract = resolveContract(raw); fpRecipes = matchRecipes(fpContract) }
  const fpReport = (): FirstPassReport | undefined => {
    if (!fpOn || !fpContract) return undefined
    const sv = (typeof state !== 'undefined' ? state : undefined) as CheckpointState | undefined
    const testsPassed = tplan ? (quarantined === 0 && !!sv?.validations.some((v) => v.stepId === 'verify' && v.status === 'PASSED' && /--test/.test(v.command))) : null
    return buildFirstPassReport({ contract: fpContract, recipes: fpRecipes, steps: fpSteps.map((x) => ({ target_file: x.TARGET_FILE, recipes: x.recipes, behaviors: x.REQUIRED_BEHAVIOR.map((b) => b.id) })), st: fpm, repairs, quarantined, testDefects: testDefects.map((d) => ({ kind: d.kind, test: d.test })), acceptance: req.acceptance, testsPassed, verifierPassed: verifiedAtEnd })
  }
  const result = (status: WorkflowResult['status'], reason: string): WorkflowResult => { const blockers = status === 'COMPLETED' ? cleanBlockersNow() : []; const clean = status === 'COMPLETED' && quarantined === 0 && verifiedAtEnd === true && blockers.length === 0; const isClean = clean; for (const r of ledger.records) r.cleanOutcomeImpact = r.decision === 'ACCEPTED' ? (isClean ? 'CLEAN_AFTER_ACCEPTED_ASSIST' : 'NOT_CLEAN') : r.decision === 'REJECTED' ? 'ASSIST_REJECTED' : 'PENDING'; return {  build, subtasks: classifySteps(((state as CheckpointState | undefined)?.steps ?? []) as never, build, ledger.records.map((r) => ({ subtaskId: r.subtaskId, file: r.contextScope.files[0] ?? '', accepted: r.decision === 'PENDING' ? null : r.decision === 'ACCEPTED', family: r.provider }))), frontier: { usage: ledger.usage(status === 'COMPLETED' ? clean : null), records: ledger.records }, cleanKind: clean ? (ledger.records.some((r) => r.decision === 'ACCEPTED') ? 'CLEAN_WITH_FRONTIER_ASSIST' : 'CLEAN_LOCAL_ONLY') : null, testGrounding: groundingByFile, testAuthoring: { writer: writerLabel, candidates: candidateLog, ...(tplan ? { rescue: { ...rescue }, nameRewrites } : {}) }, testPlan: tplan ? { entry: tplan.entry, files: tplan.files, tests: tplan.tests } : null, testTraceability: traceability(), testReviews, testDefects, cleanBlockers: blockers, ...(fpOn ? { firstPass: fpReport() } : {}), status, reason, modelCalls, repairs, filesChanged: [...changed], quarantinedTests: quarantined, correctedTests: corrections.length, contractCorrections: corrections, modelTimeouts: timeouts, modelTransients: transients, completionClass: completionClass({ status, quarantinedTests: quarantined, cleanBlockers: blockers }, status === 'COMPLETED' ? verifiedAtEnd : null), repairTrace: trace, escalations, routeEdits, stepsDone, tokens, latencyMs: Date.now() - t0, executor } }

  let state: CheckpointState
  let plan: EngineeringCodePlan
  // ---- first-pass: an ambiguous contract is resolved before any code is written; what cannot be resolved stops the build
  if (fpOn && fpContract) {
    emit('IMPLEMENTATION_CONTRACT', `${fpContract.routes.length} route(s), ${fpContract.fields.length} field rule(s), ${fpContract.flags.length} flag action(s), ${fpContract.filters.length} filter(s); recipes: ${fpRecipes.map((r) => r.id).join(', ') || 'none'}${fpContract.ambiguities.some((a) => a.assumption) ? `; ${fpContract.ambiguities.filter((a) => a.assumption).map((a) => a.assumption).join(' ')}` : ''}`)
    if (fpUnresolved.length) { emit('CONTRACT_AMBIGUOUS', fpUnresolved.join('; ')); failAssignment(log, assignmentId, actor, `the implementation contract is ambiguous and cannot be resolved by a recorded rule, so no code was written: ${fpUnresolved.join('; ')}`, undefined, clock()); return result('BLOCKED', `ambiguous implementation contract: ${fpUnresolved.join('; ')}`) }
  }
  // ---- state: resume from the latest checkpoint when one exists
  const baselineSnap = ws.snapshot()
  const baselineText: Record<string, string> = {}
  for (const p of Object.keys(baselineSnap).filter((x) => /\.(m?js|html?)$/.test(x) && !/node_modules/.test(x)).slice(0, 80)) baselineText[p] = ws.read(p)
  if (fpOn && fpContract) { fpContract = inheritConventions(fpContract, baselineText); fpRecipes = matchRecipes(fpContract) }
  const prior = latestCheckpoint(log, assignmentId)
  const index0 = buildWorkspaceIndex(ws.root)
  if (prior) {
    const rp = planResume(log, assignmentId, { fileHash: (p) => ws.hash(p), allFileHashes: ws.snapshot() })
    if (!rp.safeToResume) return result('CONFLICT', `cannot resume safely: ${rp.conflicts.join('; ')}`)
    state = prior.state
    for (const r of rp.redo) { const s = state.steps.find((x) => x.id === r.stepId); if (s) { s.status = 'PENDING'; s.note = `redo: ${r.reason}` } }
    plan = planFromCode(index0, { request: req.request, acceptance: req.acceptance, hints: req.hints, kind: 'feature' })
    for (const f of state.fileChanges) changed.add(f.path)
    emit('RESUME', `resuming from checkpoint ${prior.seq}; skipping ${rp.skip.join(',') || 'none'}; redo ${rp.redo.map((r) => r.stepId).join(',') || 'none'}`)
  } else if (seedFromHandoff(log, assignmentId, ws).seeded) {
    // successor: start from the PREDECESSOR's structured checkpoint (done steps kept, the rest retried), never from scratch
    const seed = seedFromHandoff(log, assignmentId, ws)
    if (!seed.seeded) throw new Error('unreachable')
    if (!seed.safe) return result('CONFLICT', `cannot continue the predecessor's work safely: ${seed.conflicts.join('; ')}`)
    state = seed.state
    plan = planFromCode(index0, { request: req.request, acceptance: req.acceptance, hints: req.hints, kind: 'feature' })
    for (const f of state.fileChanges) changed.add(f.path)
    saveCheckpoint(log, assignmentId, state, actor, clock())
    emit('SUCCESSOR', `continuing ${seed.fromAssignment}: keeping ${seed.skip.join(',') || 'no'} done step(s), retrying ${state.steps.filter((x) => x.status === 'PENDING').map((x) => x.id).join(',')}; ${seed.carriedDoNotRepeat} doNotRepeat carried`)
  } else {
    plan = planFromCode(index0, { request: req.request, acceptance: req.acceptance, hints: req.hints, kind: 'feature' })
    const fileSteps: CheckpointStep[] = []
    let n = 0
    for (const layer of LAYER_ORDER) {
      if (layer === 'tests' && tplan) { for (const f of tplan.files) { n += 1; fileSteps.push({ id: `s${n}`, title: `tests: create ${f.path}`, status: 'PENDING', layer: 'tests', files: [f.path], note: `contract tests for ${f.criteria.map((c) => 'C' + c).join(', ')}` }) } continue }
      const sl = plan.slices.find((s) => s.layer === layer)
      if (!sl) continue
      // the page that loads a changed client script is part of the UI surface: it must be a step even when the planner ranking missed it
      const uiHosts = layer === 'ui' ? sl.files.flatMap((f) => (index0.dependents[f.path] ?? []).filter((h) => index0.files[h]?.isHtml && !sl.files.some((x) => x.path === h)).map((h) => ({ path: h, action: 'modify' as const, rationale: `loads ${f.path}` }))).filter((h, i, a) => a.findIndex((x) => x.path === h.path) === i) : []
      for (const f of [...sl.files, ...uiHosts]) { n += 1; fileSteps.push({ id: `s${n}`, title: `${layer}: ${f.action} ${f.path}`, status: 'PENDING', layer, files: [f.path], note: f.rationale.slice(0, 120) }) }
    }
    if (deps.reuseImplementation) for (const st of fileSteps) if (st.layer !== 'tests') { st.status = 'DONE'; st.note = 'implementation reused (replay); verified by the independent verifier below' }
    if (!fileSteps.length) { failAssignment(log, assignmentId, actor, 'the code-aware plan found no files to change: ' + (plan.uncertainties[0] ?? 'UNDETERMINED'), undefined, clock()); return result('FAILED', 'no plan: ' + (plan.uncertainties[0] ?? 'UNDETERMINED')) }
    // Acceptance runs BEFORE model-written tests: the independent verifier is ground truth for the implementation, so implementation defects are repaired against it first.
    if (fpOn) { const at0 = fileSteps.findIndex((x) => x.layer === 'tests'); fileSteps.splice(at0 < 0 ? fileSteps.length : at0, 0, { id: 'preflight', title: 'implementation preflight (static + runtime, before any test)', status: 'PENDING', files: [] }) }
    if (deps.finalVerification) { const at = fileSteps.findIndex((x) => x.layer === 'tests'); fileSteps.splice(at < 0 ? fileSteps.length : at, 0, { id: 'accept', title: 'acceptance: independent verification', status: 'PENDING', files: [] }) }
    fileSteps.push({ id: 'verify', title: 'end-to-end validation', status: 'PENDING', files: [] })
    const treeBefore = treeHash(baselineSnap)
    state = {
      objective: req.request, acceptanceCriteria: req.acceptance, steps: fileSteps, currentStepId: fileSteps[0].id, fileChanges: [], artifacts: ['plan'], validations: [], blockers: [], effectsDone: [], doNotRepeat: [], dependencies: asg.assignment.dependencies,
      workspace: { id: asg.assignment.workspace?.id ?? 'UNKNOWN', root: ws.root, kind: asg.assignment.workspace?.kind ?? 'sandbox', gitHead: 'UNKNOWN', baselineTreeHash: treeBefore, baselineFileHashes: Object.keys(baselineSnap).length <= 400 ? baselineSnap : 'UNKNOWN' },
    }
    saveCheckpoint(log, assignmentId, state, actor, clock())
    emit('PLAN', `${fileSteps.filter((s) => s.files.length).length} file step(s): ${fileSteps.filter((s) => s.files.length).map((s) => s.files[0]).join(', ')}`)
  }
  const checkpoint = () => { state.fileChanges = state.fileChanges.slice(-200); saveCheckpoint(log, assignmentId, state, actor, clock()) }
  const fpAdvisory = new Set(['JSON_FILE_STORE.unawaited-fs'])
  const fpFilesWith = (path: string, content: string): Record<string, string> => ({ ...Object.fromEntries(Object.keys(ws.snapshot()).filter((f) => /\.(m?js|html?)$/.test(f) && !/node_modules/.test(f)).map((f) => [f, ws.read(f)])), [path]: content })
  /** Recipe static checks on a proposed implementation file: only NEW findings located in that file are reported (a defect that was already there is not blamed on this edit). */
  const fpRecipeFresh = (path: string, content: string): RecipeFinding[] => {
    if (!fpOn || !fpContract || /^test\//.test(path) || !/\.(m?js|html?)$/.test(path)) return []
    const key = (f: { recipe: string; check: string; fact: string }) => `${f.recipe}.${f.check}|${f.fact}`
    const before = new Set(runRecipeChecks(fpFilesWith(path, ws.exists(path) ? ws.read(path) : ''), fpContract, fpRecipes).map(key))
    return runRecipeChecks(fpFilesWith(path, content), fpContract, fpRecipes).filter((f) => f.file === path && !fpAdvisory.has(`${f.recipe}.${f.check}`) && !before.has(key(f)))
  }
  const fpFindingsText = (fresh: RecipeFinding[]): string | null => {
    if (!fresh.length) return null
    fpm.recipe_gate_rejections += 1
    return `recipe check failed: ${fresh.slice(0, 3).map((f) => `[${f.recipe}.${f.check}] ${f.fact} (expected: ${f.expected})`).join('; ')}`
  }
  const fpRecipeGate = (path: string, content: string): string | null => fpFindingsText(fpRecipeFresh(path, content))
  const noteEdit = (p: { mode?: string; structural?: string[] }, existed: boolean) => {
    if (!fpOn) return
    if (p.structural?.length) fpm.structural_edits += p.structural.length
    else if (p.mode === 'edits') fpm.range_edits += 1
    else if (p.mode === 'rewrite' || (p.mode === 'new' && existed)) fpm.whole_file_rewrites += 1
    else if (p.mode === 'new') fpm.new_files += 1
  }

  // ---- helpers
  const budgetLeft = () => { const h = rescueHeld(); return modelCalls < limits.maxModelCalls - h.calls && Date.now() - t0 < limits.maxRuntimeMs - h.ms }
  /** the final candidate rescue may run unless a HARD stop applies; it ignores the helper share and the 70% runtime share, but never the call ceiling, the global timeout or a Commander pause/cancel */
  const rescueBlocked = (): string | null => {
    if (!executionGate(log, assignmentId).proceed) return 'COMMANDER_PAUSE_OR_CANCEL'
    if (Date.now() - t0 >= limits.maxRuntimeMs) return 'GLOBAL_HARD_TIMEOUT'
    if (modelCalls >= limits.maxModelCalls) return 'CALL_CEILING_EXHAUSTED'
    if (rescue.used_calls >= rescue.reserved_calls) return rescue.reserved_calls ? 'RESERVED_CALLS_USED' : 'NO_RESERVE'
    return null
  }
  const call = async (system: string, prompt: string, json = false, sampling: { temperature?: number; seed?: number } = {}, via?: ModelClient): Promise<ModelResult> => {
    if (!deps.tools.includes('model_local')) return { ok: false, detail: 'model_local not granted', executor: 'UNKNOWN' }
    // a test file Foundry generates from the contract is delivered as the reply: no model is asked, no model call is counted
    const genPath = /FILE TO CREATE: (\S+)/.exec(prompt)?.[1]
    const genText = genPath ? tplan?.files.find((f) => f.path === genPath)?.generated : undefined
    if (genText) return { ok: true, text: '```javascript\n' + genText + '\n```', executor: { provider: 'foundry', model: 'contract-test-generator' }, promptTokens: 0, outputTokens: 0, latencyMs: 0 }
    // A timed-out model call is retried a bounded number of times. The call has no side effects (nothing is written until a reply is parsed), the prompt and
    // sampling are reused unchanged, and every attempt counts against the model-call budget, so no state is lost and no effect is duplicated.
    const purpose = (/FILE TO (?:EDIT|CREATE|FIX): (\S+)/.exec(prompt)?.[1] ?? system.slice(0, 40)).slice(0, 80)
    let runaway = false
    for (let attempt = 0; ; attempt++) {
      modelCalls += 1
      const callNo = modelCalls
      const ac = new AbortController()
      const poll = setInterval(() => { const g = executionGate(log, assignmentId); if (!g.proceed && g.reason !== 'OK') ac.abort() }, 400)
      const started = Date.now()
      let r: ModelResult
      // after a runaway generation the same request would loop again: the retry says so, asks for compact setup code and samples warmer
      const retryNote = runaway ? '\n\nYOUR PREVIOUS ATTEMPT REPEATED THE SAME STATEMENT ENDLESSLY. Write each test with at most 6 setup requests; create bulk data with a for loop (for (let i = 0; i < 5; i++) await app.post(path, { title: \'t\' + i })), never by writing one line per item. Keep the whole file short.' : ''
      const sampled = runaway ? { ...sampling, temperature: Math.min(0.7, (sampling.temperature ?? 0.1) + 0.25 * attempt) } : sampling
      try { r = await (via ?? activeModel).generate({ system, prompt: prompt + retryNote, json, ...sampled, signal: ac.signal, maxTokens: 3500, timeoutMs: Math.min(300_000, limits.maxRuntimeMs) }) } finally { clearInterval(poll) }
      if (!r.ok && /degenerate repetition/i.test(r.detail)) runaway = true
      const waitedMs = Date.now() - started
      const note = (kind: 'TIMEOUT' | 'TRANSIENT', rec: Omit<ModelTimeoutRecord, 'kind'>) => (kind === 'TIMEOUT' ? timeouts : transients).push({ ...rec, kind })
      if (r.ok) { if (attempt > 0) { const kind = lastKind; note(kind, { call: callNo, attempt, outcome: 'RECOVERED', waitedMs, detail: 'reply received after retry', purpose }); emit(kind === 'TIMEOUT' ? 'MODEL_TIMEOUT_RECOVERED' : 'MODEL_TRANSIENT_RECOVERED', `${purpose}: reply on attempt ${attempt + 1}`) } return r }
      // only the model's own timeout or a transient HTTP 5xx is retried; a Foundry-gate abort (pause/cancel), 4xx, invalid model, malformed replies and policy refusals fail at once
      const kind = classifyModelFailure(r.detail, ac.signal.aborted)
      if (kind === 'NO_RETRY') return r
      lastKind = kind
      const word = kind === 'TIMEOUT' ? 'timed out' : `failed transiently (${r.detail})`
      if (attempt + 1 >= MODEL_MAX_ATTEMPTS) { note(kind, { call: callNo, attempt, outcome: 'EXHAUSTED', waitedMs, detail: r.detail, purpose }); emit(kind === 'TIMEOUT' ? 'MODEL_TIMEOUT_EXHAUSTED' : 'MODEL_TRANSIENT_EXHAUSTED', `${purpose}: ${attempt + 1} attempts ${kind === 'TIMEOUT' ? 'timed out' : 'failed'}`); return { ...r, detail: `${r.detail}; retries exhausted after ${attempt + 1} attempts` } }
      if (!budgetLeft() || !executionGate(log, assignmentId).proceed) { note(kind, { call: callNo, attempt, outcome: 'NOT_RETRIED', waitedMs, detail: `${r.detail}; budget or gate stopped the retry`, purpose }); return r }
      note(kind, { call: callNo, attempt, outcome: 'RETRIED', waitedMs, detail: r.detail, purpose }); emit(kind === 'TIMEOUT' ? 'MODEL_TIMEOUT_RETRY' : 'MODEL_TRANSIENT_RETRY', `${purpose}: attempt ${attempt + 1} ${word} after ${Math.round(waitedMs / 1000)}s; retrying (${attempt + 1}/${MODEL_MAX_ATTEMPTS - 1})`)
    }
  }
  const noteTokens = (r: ModelResult) => { if (r.ok) { executor = r.executor; tokens = tokens === 'UNKNOWN' || r.outputTokens === 'UNKNOWN' ? 'UNKNOWN' : tokens + r.outputTokens + (r.promptTokens === 'UNKNOWN' ? 0 : r.promptTokens); if (r.promptTokens === 'UNKNOWN') tokens = 'UNKNOWN' } }
  type Gate = { stop: WorkflowResult | null }
  const boundary = (): Gate => {
    const g = executionGate(log, assignmentId)
    if (g.proceed) return { stop: null }
    const v = deriveAssignments(log).assignments.get(assignmentId)!
    if (g.reason === 'PAUSED') return { stop: result('PAUSED', 'assignment is paused; no further work until a Commander resumes it') }
    if (g.reason === 'CANCEL_REQUESTED') { acknowledgeCancel(log, assignmentId, actor, clock()); finalizeCancel(log, assignmentId, actor, 'STOPPED', `stopped at a safe step boundary after cancellation (${v.stopReason ?? 'requested'})`, clock()); return { stop: result('CANCELLED', 'cancelled by the Commander at a safe boundary') } }
    if (g.reason === 'STOPPING') { finalizeCancel(log, assignmentId, actor, 'STOPPED', 'stopped', clock()); return { stop: result('CANCELLED', 'stopped') } }
    if (g.reason === 'AGENT_NOT_ACTIVE') { failAssignment(log, assignmentId, actor, 'the agent is no longer ACTIVE (retired or paused): work stopped', undefined, clock()); return { stop: result('FAILED', 'agent not active') } }
    return { stop: result('BLOCKED', `execution gate: ${g.reason}`) }
  }
  const budgetStop = (): WorkflowResult | null => { if (stepsDone >= limits.maxSteps) return result('FAILED', 'step budget exhausted'); if (!budgetLeft()) return result('FAILED', 'model-call or runtime budget exhausted'); return null }

  const readRel = (p: string) => (ws.exists(p) ? ws.read(p) : '')
  /** Workspace files that the failing output itself names (stack frames, import errors), then changed files, then what those import. */
  const candidatesFromOutput = (output: string, changedNow: string[]): string[] => {
    const named: string[] = []
    for (const m of output.matchAll(/(?:file:\/\/)?((?:\/[\w.@-]+)*\/)?((?:[\w.@-]+\/)*[\w.@-]+\.(?:m?js|cjs|ts|tsx))/g)) {
      const raw = (m[1] ?? '') + m[2]
      const rel = raw.startsWith(ws.root + '/') ? raw.slice(ws.root.length + 1) : raw.startsWith('/') ? '' : raw
      if (rel && !named.includes(rel) && ws.exists(rel) && !/^test\//.test(rel)) named.push(rel)
    }
    const idx = buildWorkspaceIndex(ws.root)
    const related = changedNow.flatMap((f) => (idx.files[f]?.imports ?? []).map((i) => i.resolved).filter((x): x is string => !!x))
    return [...new Set([...named, ...changedNow, ...related])].filter((p) => ws.exists(p)).slice(0, 6)
  }
  const keepExportsFor = (path: string): string[] => {
    if (!ws.exists(path)) return []
    const idx = buildWorkspaceIndex(ws.root)
    const f = idx.files[path]
    return (f?.exports ?? []).filter((name) => Object.values(idx.files).some((o) => o.path !== path && o.imports.some((i) => i.resolved === path && (i.names.includes(name) || i.names.includes('*')))))
  }
  /** Static API-compatibility gate: a rewrite may not delete an export that another file still imports. */
  const apiCompat = (path: string, content: string): string | null => {
    if (!ws.exists(path)) return null
    const before = indexSource(path, ws.read(path), new Set())
    const after = indexSource(path, content, new Set())
    const removed = before.exports.filter((e) => !after.exports.includes(e))
    if (!removed.length) return null
    const idx = buildWorkspaceIndex(ws.root)
    const users = removed.map((name) => ({ name, by: Object.values(idx.files).filter((f) => f.path !== path && f.imports.some((i) => i.resolved === path && (i.names.includes(name) || i.names.includes('*')))).map((f) => f.path) })).filter((u) => u.by.length)
    return users.length ? `your version removes exports that other files still import: ${users.map((u) => `${u.name} (used by ${u.by.join(', ')})`).join('; ')}. Keep them (add new exports instead of replacing).` : null
  }
  /** Static import gate: a written file may only import names that the workspace module really exports (ground truth, not memory). */
  const importCompat = (path: string, content: string, ignoreModules: Set<string> = new Set()): string | null => {
    const idx = buildWorkspaceIndex(ws.root)
    const known = new Set(Object.keys(idx.files))
    const entry = indexSource(path, content, known)
    const bad: string[] = []
    for (const imp of entry.imports) {
      if (!imp.resolved || imp.names.includes('*') || ignoreModules.has(imp.resolved)) continue
      const target = path === imp.resolved ? undefined : idx.files[imp.resolved]
      if (!target || target.kind === 'data' || target.isHtml || target.exports.includes('default')) continue
      const missing = imp.names.filter((n) => !target.exports.includes(n))
      if (missing.length) bad.push(`${missing.join(', ')} from ${imp.resolved} (it exports: ${target.exports.join(', ') || 'nothing'})`)
    }
    return bad.length ? `you import names that do not exist: ${bad.join('; ')}. Use only the real exports.` : null
  }
  /** Every static gate a reply must pass BEFORE it is written. */
  const gateProblem = (path: string, content: string, ignoreModules: Set<string> = new Set()): string | null => {
    const syn = syntaxProblems(path, content)
    if (syn.length) return `your version has a syntax error and the program would not start: ${syn.join('; ')}. Return the complete, syntactically valid file.`
    const dups = /\.m?[jt]sx?$/.test(path) ? topLevelDuplicates(path, content) : []
    if (dups.length) {
      const imported = dups.filter((n) => new RegExp(`import\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`).test(content))
      const hint = imported.length ? ` ${imported.join(', ')} is both imported and declared here: rename the import with "as" (e.g. import { ${imported[0]} as store_${imported[0]} } from ...) and call the alias.` : ' Edit the existing declaration instead of adding a second one.'
      return `your version declares ${dups.join(', ')} more than once at the top level (a SyntaxError).${hint}\n${collisionFacts(path, content, dups, buildWorkspaceIndex(ws.root))}`
    }
    return apiCompat(path, content) ?? importCompat(path, content, ignoreModules) ?? crossRefProblem(path, content)
  }
  /** Cross-reference gates (see staticGates.ts): only NEW problems are reported, so a file that already had a defect is not blamed for it. */
  const crossRefProblem = (path: string, content: string): string | null => {
    const before = ws.exists(path) ? ws.read(path) : ''
    if (/\.m?js$/.test(path)) {
      const had = new Set(undefinedNames(path, before))
      const fresh = undefinedNames(path, content).filter((n) => !had.has(n))
      if (fresh.length) {
        const idx = buildWorkspaceIndex(ws.root)
        const where = fresh.map((n) => { const f = Object.values(idx.files).find((x) => x.path !== path && x.exports.includes(n)); return f ? `${n} is exported by ${f.path} (add: import { ${n} } from '<relative path to ${f.path}>')` : `${n} is not exported by any workspace file (declare it or do not call it)` })
        return `your version uses names that are never declared or imported, which fails at run time with "is not defined": ${where.join('; ')}.`
      }
      const dispatcher = /createServer\s*\(/.test(content) || routeTable(content).length >= 3
      if (dispatcher) {
        const hadF = new Set(routeFindings(path, before).map((f) => `${f.kind}|${f.hidden}`))
        const found = routeFindings(path, content).filter((f) => !hadF.has(`${f.kind}|${f.hidden}`))
        if (found.length) return `route conflict: ${found.map((f) => f.kind === 'DUPLICATE' ? `${f.hidden} is registered twice (lines ${f.hidingLine} and ${f.hiddenLine})` : `${f.hidden} (line ${f.hiddenLine}) is never reached: ${f.hiding} (line ${f.hidingLine}) matches it first [${f.kind === 'PREFIX_SHADOWS' ? 'broad prefix route' : 'parameter route'}]`).join('; ')}. Register every specific route BEFORE any prefix or parameter route that also matches it.`
        const clients = Object.keys(ws.snapshot()).filter((f) => /^public\/.+\.js$/.test(f)).map((f) => ws.read(f))
        const cp = contractRouteProblems(path, content, req.acceptance, clients)
        if (cp.length) return `the server does not serve what the acceptance contract requires: ${cp.join('; ')}. Add or fix exactly these routes (method and path as written in the contract).`
        const files = { ...Object.fromEntries(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f)).map((f) => [f, ws.read(f)])), [path]: content }
        const lost = statusReachability(files, req.acceptance)
        if (lost.length) {
          const diag = statusDiagnosis(content, files, req.acceptance).filter((d) => lost.includes(d.status) && d.target !== 'OK')
          const handler = diag.filter((d) => d.target === 'HANDLER').map((d) => `${d.method} ${d.path} -> ${d.status}: ${d.reason}`)
          return `the acceptance contract requires HTTP ${lost.join(', ')} but nothing in the code can ever respond with it${handler.length ? ` (diagnosis HANDLER, the route is reachable: ${handler.slice(0, 3).join('; ')})` : ''}. A generic catch that always answers one status hides it: raise errors that carry their status (for example err.status) and answer with that status.`
        }
      }
      const drift = legacyStateDrift(path, before, content)
      if (drift.length) return `existing exports changed which data they use: ${drift.map((d) => `${d.fn}() used ${d.was} and now uses the NEW state ${d.now}`).join('; ')}. Existing endpoints must keep their own behaviour and data: leave ${drift.map((d) => d.fn).join(', ')} using ${drift[0].was} and add NEW functions for the new feature.`
      const snap = Object.fromEntries(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f) && !/^(test|node_modules|public)\//.test(f)).map((f) => [f, ws.read(f)]))
      const hadP = new Set(persistenceProblems(snap, req.acceptance))
      const pp = persistenceProblems({ ...snap, [path]: content }, req.acceptance).filter((x) => !hadP.has(x))
      if (pp.length) return `persistence contract: ${pp.join('; ')}`
    }
    if (/\.html?$/.test(path)) {
      const ids = [...new Set(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f) && !/^(test|src|node_modules)\//.test(f) && f !== 'server.mjs').flatMap((f) => domIds(ws.read(f))))]
      const had = new Set(missingDomIds(before, ids))
      const miss = missingDomIds(content, ids).filter((i) => !had.has(i))
      if (miss.length) return `the page is missing elements that its client scripts read: ${miss.map((i) => `id="${i}"`).join(', ')}. Add elements with exactly these ids.`
    }
    return null
  }
  /** NO_CHANGE is not acceptable for a page whose client scripts read element ids it does not contain. */
  const pageMissing = (path: string): string | null => {
    if (!ws.exists(path)) return null
    const ids = [...new Set(Object.keys(ws.snapshot()).filter((f) => /\.m?js$/.test(f) && !/^(test|src|node_modules)\//.test(f) && f !== 'server.mjs').flatMap((f) => domIds(ws.read(f))))]
    const miss = missingDomIds(ws.read(path), ids)
    return miss.length ? `NO_CHANGE is not valid: the client scripts read ${miss.map((i) => `id="${i}"`).join(', ')} but the page has no such element. Add them.` : null
  }
  const relatedFor = (path: string, doneFiles: string[]) => {
    const idx = buildWorkspaceIndex(ws.root)
    const f = idx.files[path]
    const names = new Set<string>([...(f?.imports.map((i) => i.resolved).filter((x): x is string => !!x) ?? []), ...doneFiles])
    const out: { path: string; text: string }[] = []
    let budget = 9000
    for (const p of names) { if (p === path || !ws.exists(p)) continue; const t = ws.read(p); if (budget - t.length < 0) break; budget -= t.length; out.push({ path: p, text: t }) }
    // for tests/ui: show the server routes and service as ground truth
    return out
  }
  let restoreSeq = 0
  /** tag: a restore/revert is a NEW effect even when the same content was written earlier (the idempotency key would otherwise treat it as already done and skip it). */
  const writeFile = async (stepId: string, path: string, content: string, tag = '') => {
    // first-pass: a known, deterministic defect is corrected on EVERY model write (edit stage, preflight repair, acceptance repair), not only on the first one
    if (fpOn && fpContract && tag === '' && !/^test\//.test(path) && /\.m?js$/.test(path)) {
      const fl = runRecipeChecks(fpFilesWith(path, content), fpContract, fpRecipes).filter((f) => f.file === path)
      const fx = fl.length ? autofix(path, content, fl, fpContract) : null
      if (fx) { content = fx.content; fpm.deterministic_structural_edits += fx.notes.length; emit('STRUCTURAL_AUTOFIX', `${path}: ${fx.notes.join('; ')} (on write)`) }
    }
    const key = `write:${path}:${sha256(content).slice(0, 12)}${tag}`
    const before = ws.hash(path)
    const expected: FileChange = { path, beforeHash: before, afterHash: sha256(content), stepId }
    const out = await runEffectOnce(log, assignmentId, key, { kind: 'file_write', consequential: true, summary: `write ${path}`, expectedChanges: [expected] }, async () => { const w = ws.write(path, content); return { value: w, fileChanges: [{ path, beforeHash: w.beforeHash, afterHash: w.afterHash, stepId }] } }, (p) => ws.hash(p))
    if (out.conflict) throw new Error(out.conflict)
    if (out.ran || out.skipped === 'RECONCILED_LANDED') { state.fileChanges = [...state.fileChanges.filter((c) => !(c.path === path && c.stepId === stepId)), expected]; if (!state.effectsDone.includes(key)) state.effectsDone.push(key); changed.add(path) }
  }
  // test runs are hermetic (fresh copy of the workspace each time); syntax/type checks are read-only so they run in place
  let helperCalls = 0
  const helperOk = (what: string): boolean => { const h = helperBudgetLeft({ helperCalls, modelCalls, maxModelCalls: limits.maxModelCalls, elapsedMs: Date.now() - t0, maxRuntimeMs: limits.maxRuntimeMs, policy: deps.helperPolicy }); if (!h.ok) emit('HELPER_BUDGET_EXHAUSTED', `${what}: ${h.why}`); return h.ok }
  const failCount = (r: CommandRecord): number => { const f = parseToolOutput(r.stdout, r.stderr).fail; return typeof f === 'number' ? f : 99 }
  const runCheck = async (argv: string[]) => (argv[0] === 'node' && argv[1] === '--test' ? runHermetic(ws.root, argv, deps.tools, { timeoutMs: 90_000, isolateEnv: storageEnvVars(req.acceptance) }) : runCommand(ws.root, argv, deps.tools, { timeoutMs: 90_000 }))
  const validationFor = (stepFiles: string[]): string[][] => {
    const cmds: string[][] = []
    for (const f of stepFiles) if (/\.m?js$/.test(f)) cmds.push(['node', '--check', f])
    return cmds
  }
  const allTests = (): string[] | null => { const t = Object.keys(ws.snapshot()).filter((f) => /^test\/.+\.test\.m?js$/.test(f)); return t.length ? ['node', '--test', ...t] : null }

  const hypTokens = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
  /** Near-identical wording (token Jaccard >= 0.6) means the analyst re-proposed a cause that was already acted on without fixing the failure. */
  const sameHypothesis = (a: string, b: string) => { const A = hypTokens(a), B = hypTokens(b); let i = 0; for (const x of A) if (B.has(x)) i += 1; return A.size > 0 && B.size > 0 && i / (A.size + B.size - i) >= 0.6 }
  const sourceFiles = (): Record<string, string> => Object.fromEntries(Object.keys(ws.snapshot()).filter((p) => /\.(m?js|html?)$/.test(p) && !/node_modules/.test(p)).map((p) => [p, ws.read(p)]))
  const modelLabel = (m: ModelClient): string => (m === deps.model ? (executor === 'UNKNOWN' ? 'primary' : executor.model) : deps.escalation && m === deps.escalation.model ? deps.escalation.label : 'unknown')
  const probeRecord = (pr: PersistenceProbe): CommandRecord => {
    const body = pr.verdict === 'FAIL' ? `not ok 1 - persistence round trip survives a restart\n  message: ${pr.detail}\n# tests 1\n# pass 0\n# fail 1\n` : `ok 1 - persistence round trip survives a restart\n# tests 1\n# pass 1\n# fail 0\n`
    return { argv: ['persistence-probe'], cwd: ws.root, exitCode: pr.verdict === 'FAIL' ? 1 : 0, timedOut: false, stdout: body, stderr: '', durationMs: 0, startedAt: clock().toISOString(), outputHash: sha256(body) }
  }
  const legacyNames = [...new Set(Object.values(baselineText).flatMap((t) => [...t.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)].map((m) => m[1])))]
  const runProbe = async (): Promise<PersistenceProbe> => persistenceProbe(ws.root, req.acceptance, Object.keys(ws.snapshot()), legacyNames)
  /**
   * The evidence-driven repair loop for ONE failing command. Returns true when the ORIGINAL failure is fixed.
   * failed check -> implicated route/symbol/storage path (failureEvidence) -> ordered, falsifiable hypotheses -> ONE hypothesis acted on per attempt
   * -> the original reproducer is re-run and the SAME check's failure is compared before/after: unchanged = REFUTED (never repeated), changed = progress.
   * Two refuted, materially distinct hypotheses escalate the context depth (and the model, when an escalation model is configured).
   * When the output is not a structured check list (or the failing step is a model-written test), the analyst-driven path below is used.
   */
  const debugLoop = async (failedCmd: CommandRecord, candidates: string[], stepId: string, label: string, rerunOriginal: () => Promise<CommandRecord> = () => runCheck(failedCmd.argv), confine?: string[]): Promise<boolean> => {
    let cmd = failedCmd
    let rec = recordFailure(log, assignmentId, cmd, actor, clock())
    const attemptsNotes: string[] = confine ? ['The implementation already PASSED the independent acceptance verification. The failing test is the suspect: fix the TEST file so it matches the real behaviour; do not change implementation files.'] : []
    const triedFiles = new Set<string>()
    const priorHyps: string[] = []
    const tried = new Map<string, { outcome: 'REFUTED' | 'CHANGED'; times: number; why: string }>()
    let refutedRun = 0
    let escalatedHere: EscalationRecord | null = null
    const canTry = (k: string) => { const t = tried.get(k); return !t || (t.outcome === 'CHANGED' && t.times < 2) }
    // Per-failure budget is MAX_REPAIR_ATTEMPTS; a repair that STRICTLY REDUCES the number of failing checks is progress and opens a fresh failure record
    // for the remainder (its own evidence discipline). The assignment's maxRetries ceiling bounds the total, and strictly-decreasing failures cannot loop.
    const totalCap = Math.max(1, limits.maxRetries), perCap = Math.min(MAX_REPAIR_ATTEMPTS, totalCap)
    try {
    for (let attempt = 1, total = 0; attempt <= perCap && total < totalCap; attempt++, total++) {
      const b = boundary(); if (b.stop) throw Object.assign(new Error('STOP'), { stop: b.stop })
      const bs = budgetStop(); if (bs) throw Object.assign(new Error('STOP'), { stop: bs })
      const out = `${cmd.stdout}\n${cmd.stderr}`
      const evCmd = addEvidence(log, assignmentId, rec.failureId, { kind: /\.m?js$/.test(cmd.argv.at(-1) ?? '') && cmd.argv[1] === '--check' ? 'type_diagnostic' : 'test_result', ref: `${cmd.argv.join(' ')}#attempt${attempt}`, content: out, summary: `${label} failed (exit ${cmd.exitCode}): ${out.split('\n').filter((l) => /Error|not ok|✖|fail/i.test(l)).slice(0, 2).join(' | ').slice(0, 220) || 'see output'}` }, actor, clock())
      const probe = !confine && wantsPersistence(req.acceptance) && /persist|surviv|restart/i.test(out) ? await runProbe().catch(() => null) : null
      const startup = !confine && /could not complete|server exited|did not start/i.test(out) ? await startupProbe(ws.root, Object.fromEntries(storageEnvVars(req.acceptance).map((v) => [v, `${v}.json`]))).catch(() => null) : null
      const ev0 = !/^not ok \d+ - |^\s*✖ /m.test(out) ? null : buildEvidence({ output: out, acceptance: req.acceptance, files: sourceFiles(), baseline: baselineText, probe, startupOutput: startup && !startup.started ? startup.output : undefined, testScope: !!confine, ...(label === 'implementation preflight' ? { extra: fpExtra } : {}) })
      // a confined repair (the verified implementation must not change) may only act on hypotheses that target the confined files
      const ev = ev0 && confine ? { ...ev0, queue: ev0.queue.filter((h) => h.files.length > 0 && h.files.every((f) => confine.includes(f))) } : ev0
      const nextH = ev?.queue.find((h) => canTry(h.key)) ?? null
      const refutedList = [...tried].filter(([, t]) => t.outcome === 'REFUTED').map(([key, t]) => ({ key, why: t.why }))
      // escalation: two materially distinct hypotheses were acted on and refuted
      const depth: 0 | 1 = refutedRun >= 2 ? 1 : 0
      if (depth === 1 && !escalatedHere) {
        const before = modelLabel(activeModel)
        if (deps.escalation && activeModel === deps.model) activeModel = deps.escalation.model
        escalatedHere = { step: stepId, attempt, reason: `${refutedRun} materially distinct hypotheses were refuted (${refutedList.map((r) => r.key).join(', ')})`, modelBefore: before, modelAfter: modelLabel(activeModel), contextDepth: 1 }
        escalations.push(escalatedHere)
        emit('ESCALATE', `${label}: context depth 0 -> 1${activeModel !== deps.model ? `, model ${before} -> ${modelLabel(activeModel)}` : ' (no escalation model configured; the model is unchanged)'}; ${escalatedHere.reason}`)
      }
      const implicatedFiles = (h: { files: string[] } | null) => [...new Set([...(h?.files ?? []), ...candidatesFromOutput(out, candidates.filter((c) => ws.exists(c)))])].filter((c) => ws.exists(c) && !/^test\//.test(c) && (!confine || confine.includes(c)))
      let hypText = '', key = '', targets: string[] = [], parsed: { hypothesis?: string; file?: string; differs?: string } = {}
      let cand: string[] = []
      let evidenceText = ''
      if (nextH) {
        hypText = nextH.statement; key = nextH.key
        targets = nextH.files.filter((f) => ws.exists(f) && f !== HARNESS_PATH)
        if (!targets.length) targets = implicatedFiles(nextH).slice(0, 1)
        cand = implicatedFiles(nextH)
        evidenceText = renderEvidence(ev!, nextH, refutedList)
        for (const f of cand) addEvidence(log, assignmentId, rec.failureId, { kind: 'file_read', ref: f, content: ws.read(f), summary: `current content of ${f}` }, actor, clock())
      } else {
        cand = candidatesFromOutput(out, candidates.filter((c) => ws.exists(c))).filter((c) => !confine || confine.includes(c))
        for (const c of cand) addEvidence(log, assignmentId, rec.failureId, { kind: 'file_read', ref: c, content: ws.read(c), summary: `current content of ${c}` }, actor, clock())
        const ar = await call(ANALYST_SYSTEM, analystPrompt({ failureOutput: out, candidates: cand.map((c) => ({ path: c, text: ws.read(c) })), prior: attemptsNotes }), true)
        noteTokens(ar)
        if (!ar.ok) { attemptsNotes.push(`analysis call failed: ${ar.detail}`); continue }
        try { parsed = JSON.parse(ar.text) } catch { parsed = {} }
        hypText = (parsed.hypothesis ?? '').trim()
        if (!hypText) { attemptsNotes.push('analysis returned no hypothesis'); continue }
        if (priorHyps.some((p) => sameHypothesis(p, hypText)) && budgetLeft()) {
          // the same cause was already acted on and the failure persists: ask once for a DIFFERENT cause before spending another repair
          const again = await call(ANALYST_SYSTEM, analystPrompt({ failureOutput: out, candidates: cand.map((c) => ({ path: c, text: ws.read(c) })), prior: [...attemptsNotes, `REPEATED HYPOTHESIS REJECTED: "${hypText.slice(0, 220)}" was already acted on and the failure persists. Propose a DIFFERENT cause (another file or another mechanism), grounded in the failing output.`] }), true, { temperature: 0.5, seed: 7 + attempt })
          noteTokens(again)
          let p2: { hypothesis?: string; file?: string; differs?: string } = {}
          try { p2 = again.ok ? JSON.parse(again.text) : {} } catch { p2 = {} }
          const h2 = (p2.hypothesis ?? '').trim()
          if (!h2 || priorHyps.some((p) => sameHypothesis(p, h2))) {
            attemptsNotes.push('analyst repeated an already-acted-on hypothesis even when asked for a different one')
            markUndetermined(log, assignmentId, rec.failureId, 'the analyst could only re-propose an already-acted-on cause; no new hypothesis exists to act on', actor, clock())
            state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: no new hypothesis available; cause UNDETERMINED` })
            return false
          }
          hypText = h2; parsed = p2
        }
        priorHyps.push(hypText)
        key = `analyst:${priorHyps.length}`
        targets = [cand.includes(parsed.file ?? '') ? parsed.file! : cand[0]].filter(Boolean)
      }
      if (!targets.length) { attemptsNotes.push('no implicated file could be identified'); continue }
      const lastHyp = [...deriveLedger(log, assignmentId).hypotheses.entries()].filter(([, h]) => h.failureId === rec.failureId && h.status !== 'REFUTED').at(-1)
      const hid = proposeHypothesis(log, assignmentId, rec.failureId, { statement: `${nextH ? `[${key}] ` : ''}${hypText}`.slice(0, 600), supporting: [evCmd.id], ...(lastHyp && attempt > 1 ? { revisionOf: lastHyp[0], whyRevised: `attempt ${attempt - 1} did not fix it; new failure output recorded as ${evCmd.id}` } : {}) }, actor, clock())
      const diff = attempt > 1 ? (parsed.differs && parsed.differs !== 'first attempt' ? parsed.differs : `attempt ${attempt} acts on ${key} (${targets.join(', ')}) using the new failure output`) : null
      const gate = authorizeRepair(log, assignmentId, rec.failureId, { hypothesisId: hid, newEvidence: attempt > 1 ? [evCmd.id] : [], differsFromPrevious: diff, files: targets })
      if (!gate.ok) { attemptsNotes.push(`repair blocked: ${gate.reason}`); markUndetermined(log, assignmentId, rec.failureId, gate.reason, actor, clock()); state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: ${gate.reason}; cause UNDETERMINED` }); return false }
      emit('HYPOTHESIS', `${label}: attempt ${attempt} acts on ${key} -> ${targets.join(', ')}`)
      const written: string[] = []
      let assistWrite: { rec: IngestionRecord; file: string; pre: string } | null = null
      const contractClauses = (() => { const c = criteriaForFailures(out, req.acceptance); return c.length ? `\nTHE ACCEPTANCE CONTRACT SAYS (this is the authoritative expectation for the failing check; the check output shows only what was observed): ${c.map((x) => `"${x}"`).join(' | ')}` : '' })()
      for (const file of targets.slice(0, 2)) {
        const keepR = keepExportsFor(file)
        const modeR = chooseMode(true, ws.read(file).split('\n').length, keepR)
        const relatedN = depth === 1 ? 5 : 3, relatedCap = depth === 1 ? 9000 : 3000
        const related = [...cand.filter((c) => c !== file).map((c) => ({ path: c, text: ws.read(c) })), ...relatedFor(file, [...changed])].filter((r, i, a) => a.findIndex((x) => x.path === r.path) === i).slice(0, relatedN)
        const mk = (extra: string, mode: 'edits' | 'rewrite') => repairPrompt({ failureOutput: out, hypothesis: `${hypText}${contractClauses}${targets.length > 1 ? `\n(This fix spans ${targets.join(' and ')}; you are editing ${file} now${written.length ? `; already changed: ${written.join(', ')}` : ''}.)` : ''}${extra}`, file, current: ws.read(file), related, request: req.request, lessons: deps.lessons?.({ plan, request: req.request }) ?? [], mode, evidence: evidenceText, relatedCap, ...(fpOn && fpContract && !confine ? { firstPass: { contractText: renderContract(fpContract, 1300), recipeText: renderRecipes(fpContract, fpRecipes, state.steps.find((x) => x.files[0] === file)?.layer ?? 'domain', 1400, { path: file, text: ws.exists(file) ? ws.read(file) : '' }) } } : {}) })
        // SOVEREIGN BUILD LAW: local-first. A bounded outside assist is allowed only when local resources are exhausted on this one file; its reply is stored in the
        // isolated review area first and enters the workspace only through Foundry's own gates below (static validation, export compatibility, rerun, accept/reject).
        let assist: IngestionRecord | null = null
        let rr: ModelResult
        const need = assistJustified({ minRefuted: deps.escalation ? ASSIST_MIN_REFUTED + 1 : ASSIST_MIN_REFUTED, refutedLocalHypotheses: refutedRun, localEscalationAlreadyTried: !!escalatedHere, file, assistsOnThisFile: ledger.assistsOn(file), callsSoFar: ledger.calls, maxCalls: ledger.maxCalls, providerAvailable: true })
        const trigger: EscalationTrigger = stepId === 'accept' ? 'ACCEPTANCE_FAILED_SAME_COMPONENT' : 'LOCAL_HYPOTHESES_REFUTED'
        const canServe = !!deps.frontier && deps.frontier.provider.available()
        if (need.justified && (!canServe || ledger.calls >= ledger.maxCalls) && !ledger.unmet.some((u) => u.file === file)) { const why = !deps.frontier ? 'no frontier provider is configured for this build (local-only)' : !canServe ? `${deps.frontier.provider.family} is not configured in this process` : 'frontier budget exhausted'; ledger.unmet.push({ trigger, file, basis: need.basis, reason: why }); emit('ESCALATION_NEEDED_UNMET', `${trigger} on ${file}: ${why}`) }
        if (deps.frontier && need.justified && !deps.frontier.provider.available()) { if (!ledger.unavailable) { ledger.unavailable = `FRONTIER_UNAVAILABLE: ${deps.frontier.provider.family} is not configured in this process; a bounded assist was justified (${need.basis}) but could not be requested`; emit('FRONTIER_UNAVAILABLE', ledger.unavailable) } }
        if (deps.frontier && need.justified && deps.frontier.provider.available() && budgetLeft() && Date.now() - t0 < limits.maxRuntimeMs * 0.85) {
          const importedBy = new Set((buildWorkspaceIndex(ws.root).files[file]?.imports ?? []).map((i) => i.resolved))
          const subtaskId = `${build.buildId}:fa${ledger.calls + 1}`
          const freq = buildFrontierRequest(build, { subtaskId, objective: `Repair ${file}: ${hypText}`.slice(0, 400), context: repairPrompt({ failureOutput: out, hypothesis: hypText, file, current: ws.read(file), related: related.filter((r) => importedBy.has(r.path)).slice(0, 2), request: req.request, lessons: [], mode: 'rewrite', evidence: evidenceText, relatedCap: 2500 }).slice(0, 13_500), constraints: ['return the complete new content of the one allowed file in a single fenced code block', 'keep every existing export that another file imports'], acceptance: req.acceptance, allowedFiles: [file], expectedReturn: 'PATCH_PROPOSAL' })
          const fprompt = renderFrontierRequest(freq)
          emit('FRONTIER_ASSIST_REQUEST', `${subtaskId} -> ${deps.frontier.provider.model}: ${need.basis}`)
          const started = Date.now()
          const fr = await deps.frontier.provider.ask({ system: ENGINEER_REWRITE_SYSTEM, prompt: fprompt, maxTokens: 3500, timeoutMs: Math.min(180_000, limits.maxRuntimeMs) })
          ledger.spend(fprompt.length, fr.ok ? fr.text.length : 0)
          const text = fr.ok ? fr.text : ''
          let artifactPath: string | null = null
          try { mkdirSync(deps.frontier.reviewDir, { recursive: true }); artifactPath = pathJoin(deps.frontier.reviewDir, `${subtaskId.replace(/[^\w.-]/g, '_')}.json`); writeFileSync(artifactPath, JSON.stringify({ request: freq, provider: deps.frontier.provider.family, model: deps.frontier.provider.model, at: clock().toISOString(), reply: text, error: fr.ok ? null : fr.detail }, null, 1)) } catch { artifactPath = null }
          assist = { subtaskId, buildId: build.buildId, missionId: build.missionId, provider: deps.frontier.provider.family, model: deps.frontier.provider.model, at: clock().toISOString(), task: freq.objective.slice(0, 160), contextScope: { files: [file], contextChars: freq.context.length }, reasonForEscalation: { trigger, basis: need.basis }, localAttemptsBefore: Math.max(refutedRun, attempt - 1), sharedFiles: [file], tokensEstimated: { in: Math.round(fprompt.length / 4), out: Math.round(text.length / 4) }, cost: 'UNKNOWN', cleanOutcomeImpact: 'PENDING', returnType: 'PATCH_PROPOSAL', artifactHash: sha(text), artifactPath, steps: checkProvenanceAndScope(freq, { provider: deps.frontier.provider.family, model: deps.frontier.provider.model, text, targetFile: fr.ok ? file : null }), decision: 'PENDING', reason: fr.ok ? 'received; awaiting Foundry ingestion gate' : `no reply: ${fr.detail}`, measuredBenefit: 'not yet measured' }
          ledger.records.push(assist)
          if (!fr.ok) { assist.decision = 'REJECTED'; assist.reason = `frontier call failed: ${fr.detail}`; emit('FRONTIER_ASSIST_RESULT', `${subtaskId}: REJECTED (${fr.detail})`) }
          rr = fr.ok ? { ok: true, text, executor: { provider: 'frontier', model: deps.frontier.provider.model }, promptTokens: 'UNKNOWN', outputTokens: 'UNKNOWN', latencyMs: Date.now() - started } : { ok: false, detail: fr.detail, executor: 'UNKNOWN' }
        } else {
          rr = await call(modeR === 'edits' ? ENGINEER_SYSTEM : ENGINEER_REWRITE_SYSTEM, mk('', modeR === 'edits' ? 'edits' : 'rewrite'))
          noteTokens(rr)
        }
        if (!rr.ok) { attemptsNotes.push(`repair call failed: ${rr.detail}`); continue }
        let pr = parseShaped(rr.text, ws.read(file), file)
        if (pr.kind !== 'code' && budgetLeft()) {
          // the command is failing, so NO_CHANGE / an unusable reply is not an answer: ask once more, with the refusal reason and a full rewrite allowed
          const why = pr.kind === 'invalid' ? pr.reason : 'NO_CHANGE is not valid: the failing command above proves a change is needed'
          const rr2 = await call(ENGINEER_REWRITE_SYSTEM, mk(`\nYOUR PREVIOUS REPLY WAS REJECTED: ${why}`, 'rewrite'))
          noteTokens(rr2)
          if (rr2.ok) pr = parseShaped(rr2.text, ws.read(file), file)
        }
        if (pr.kind !== 'code') { attemptsNotes.push(`repair reply unusable: ${pr.kind === 'invalid' ? pr.reason : 'NO_CHANGE'}`); if (assist && assist.decision === 'PENDING') { assist.steps.push({ stage: 'SCOPE', ok: false, note: `reply is not a usable single-file change: ${pr.kind === 'invalid' ? pr.reason : 'NO_CHANGE'}`.slice(0, 200) }); assist.decision = 'REJECTED'; assist.reason = 'unusable reply'; assist.measuredBenefit = 'none (never written)'; emit('FRONTIER_ASSIST_RESULT', `${assist.subtaskId}: REJECTED (unusable reply)`) } continue }
        if (pr.kind === 'code') pr = { ...pr, content: shapeStatus(file, pr.content) }
        let compat = gateProblem(file, pr.content)
        if (!compat && fpOn && !confine) compat = fpRecipeGate(file, pr.content)
        if (compat && pr.kind === 'code') { const sfix = structuralRoute(stepId, 'DEBUG_REPAIR', file, pr.content, compat, `${label}: ${nextH ? nextH.check : 'n/a'}`); if (sfix !== null) { pr = { ...pr, content: sfix }; compat = gateProblem(file, sfix) } }
        if (compat && pr.kind === 'code') { const stfx = structuralStatus(file, pr.content, compat); if (stfx !== null) { pr = { ...pr, content: stfx }; compat = gateProblem(file, stfx) } }
        if (compat && budgetLeft()) {
          const rr3 = await call(ENGINEER_REWRITE_SYSTEM, mk(`\nYOUR PREVIOUS REPLY WAS REJECTED BEFORE IT WAS WRITTEN: ${compat}`, 'rewrite'))
          noteTokens(rr3)
          const p3 = rr3.ok ? parseShaped(rr3.text, ws.read(file), file) : null
          if (p3 && p3.kind === 'code') { pr = p3; compat = gateProblem(file, pr.content) }
        }
        if (compat) { attemptsNotes.push(`repair rejected: ${compat}`); state.doNotRepeat.push({ key: `reject:${file}:repair${attempt}`, reason: compat }); if (assist) { assist.steps.push({ stage: 'STATIC_VALIDATION', ok: false, note: compat.slice(0, 200) }); assist.decision = 'REJECTED'; assist.reason = `failed Foundry static validation: ${compat.slice(0, 160)}`; assist.measuredBenefit = 'none (never written)'; emit('FRONTIER_ASSIST_RESULT', `${assist.subtaskId}: REJECTED (static validation)`) } continue }
        const beforeHash = ws.hash(file)
        const preContent = ws.read(file)
        if (assist) { assist.steps.push({ stage: 'STATIC_VALIDATION', ok: true, note: 'syntax, route, persistence and export-compatibility gates passed' }, { stage: 'LOCAL_REVIEW', ok: true, note: 'single allowed file; no other file touched' }, { stage: 'INTEGRATION_CANDIDATE', ok: true, note: 'written by Foundry through its own effect ledger' }); assistWrite = { rec: assist, file, pre: preContent } }
        await writeFile(stepId, file, pr.content)
        triedFiles.add(file); written.push(file)
        repairs += 1
        if (fpOn) { fpm.repairs_by_step[stepId] = (fpm.repairs_by_step[stepId] ?? 0) + 1; if (pr.kind === 'code') noteEdit(pr, true) }
        attemptsNotes.push(`attempt ${attempt}: ${hypText.slice(0, 120)} (edited ${file}${beforeHash === ws.hash(file) ? ', no effective change' : ''})`)
      }
      const sigBefore = nextH && ev ? ev.signatureOf(nextH.check) : ''
      if (!written.length) {
        if (nextH) { tried.set(key, { outcome: 'REFUTED', times: 1, why: 'no usable, gate-passing edit could be produced for it' }); refutedRun += 1; trace.push({ step: stepId, label, attempt, check: nextH.check, checkName: ev!.checks.find((c) => c.n === nextH.check)?.name ?? '', key, hypothesis: hypText.slice(0, 240), files: [], model: modelLabel(activeModel), contextDepth: depth, before: sigBefore, after: sigBefore, outcome: 'NO_EDIT' }) }
        continue
      }
      const repair = recordRepair(log, assignmentId, rec.failureId, { hypothesisId: hid, filesEdited: written.map((f) => ({ path: f, afterHash: ws.hash(f)! })), rationale: hypText, differsFromPrevious: diff, newEvidence: attempt > 1 ? [evCmd.id] : [] }, actor, clock())
      let rerun = await rerunOriginal()
      const v = recordValidation(log, assignmentId, rec.failureId, repair.repairId, rerun, { changedFiles: [...changed], index: buildWorkspaceIndex(ws.root) }, actor, clock())
      state.validations.push({ stepId, command: rerun.argv.join(' '), status: v.outcome === 'ORIGINAL_FIXED' ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: rerun.outputHash, summary: v.note.slice(0, 200) })
      checkpoint()
      emit('REPAIR', `${label}: attempt ${attempt} -> ${v.outcome}`)
      if (nextH && ev) {
        const evAfter = buildEvidence({ output: `${rerun.stdout}\n${rerun.stderr}`, acceptance: req.acceptance, files: sourceFiles(), baseline: baselineText })
        const still = evAfter.checks.some((c) => c.n === nextH.check)
        const sigAfter = still ? evAfter.signatureOf(nextH.check) : ''
        const outcome: RepairTraceEntry['outcome'] = v.outcome === 'ORIGINAL_FIXED' || !still ? 'TARGET_FIXED' : sigAfter !== sigBefore ? 'CHANGED' : 'REFUTED'
        if (outcome === 'REFUTED') { tried.set(key, { outcome: 'REFUTED', times: 1, why: `the failure of check ${nextH.check} was identical after the repair (${written.join(', ')})` }); refutedRun += 1 }
        else if (outcome === 'CHANGED') tried.set(key, { outcome: 'CHANGED', times: (tried.get(key)?.times ?? 0) + 1, why: 'failure changed' })
        trace.push({ step: stepId, label, attempt, check: nextH.check, checkName: ev.checks.find((c) => c.n === nextH.check)?.name ?? '', key, hypothesis: hypText.slice(0, 240), files: written, model: modelLabel(activeModel), contextDepth: depth, before: sigBefore, after: sigAfter, outcome })
        emit('HYPOTHESIS_RESULT', `${key}: ${outcome}`)
        if (escalatedHere && !escalatedHere.outcomeAfter) escalatedHere.outcomeAfter = `${outcome} (${modelLabel(activeModel)}, depth ${depth})`
      } else if (v.outcome === 'SAME_FAILURE') { refutedRun += 1 }
      if (assistWrite) {
        // measured benefit decides acceptance: kept only if it fixed the failure or strictly reduced the failing checks; otherwise Foundry reverts it
        const aw: { rec: IngestionRecord; file: string; pre: string } = assistWrite
        const nB = parseToolOutput(cmd.stdout, cmd.stderr).fail, nA = parseToolOutput(rerun.stdout, rerun.stderr).fail
        const tr = trace.at(-1), targetFixed = !!nextH && !!tr && tr.step === stepId && tr.attempt === attempt && tr.outcome === 'TARGET_FIXED'
        const improved = v.outcome === 'ORIGINAL_FIXED' || targetFixed || (rerun.exitCode !== 0 && nA < nB)
        aw.rec.steps.push({ stage: 'TESTS', ok: improved, note: `failing checks ${nB} -> ${nA}; outcome ${v.outcome}` }, { stage: 'INDEPENDENT_VERIFICATION', ok: improved, note: 'deferred to the acceptance and final verification steps, which still gate completion' })
        aw.rec.decision = improved ? 'ACCEPTED' : 'REJECTED'
        aw.rec.reason = improved ? 'integrated by Foundry: measurable local improvement' : 'no measurable improvement; Foundry reverted the file'
        aw.rec.measuredBenefit = `failing checks ${nB} -> ${nA}${targetFixed ? ' (target check fixed)' : ''}`
        emit('FRONTIER_ASSIST_RESULT', `${aw.rec.subtaskId}: ${aw.rec.decision} (${aw.rec.measuredBenefit})`)
        if (aw.rec.artifactPath) { try { writeFileSync(aw.rec.artifactPath.replace(/\.json$/, '.decision.json'), JSON.stringify(aw.rec, null, 1)) } catch { /* review area is best effort */ } }
        if (!improved && ws.read(aw.file) !== aw.pre) { await writeFile(stepId, aw.file, aw.pre, `:revertF${++restoreSeq}`); rerun = await rerunOriginal() }
      }
      if (v.outcome === 'ORIGINAL_FIXED') return true
      const before = parseToolOutput(cmd.stdout, cmd.stderr).fail, after = parseToolOutput(rerun.stdout, rerun.stderr).fail
      if (v.outcome === 'NEW_FAILURE' && rerun.exitCode !== 0 && after < before) {
        attemptsNotes.push(`progress: failing checks ${before} -> ${after}; continuing on the remaining failure`)
        emit('PROGRESS', `${label}: failing checks ${before} -> ${after}`)
        cmd = rerun; rec = recordFailure(log, assignmentId, cmd, actor, clock()); attempt = 0; triedFiles.clear(); priorHyps.length = 0; refutedRun = 0
        continue
      }
      cmd = rerun
    }
    markUndetermined(log, assignmentId, rec.failureId, 'repair attempts exhausted without fixing the original failure', actor, clock())
    state.doNotRepeat.push({ key: `failure:${rec.failureId}`, reason: `${label}: ${MAX_REPAIR_ATTEMPTS} evidence-based repairs failed; cause UNDETERMINED` })
    return false
    } finally { activeModel = deps.model }
  }

  /** Pure route ordering/duplicate conflicts are fixed STRUCTURALLY (the route blocks are moved, nothing else is touched); fails closed to the model when no unique safe operation exists. */
  const structuralRoute = (stepId: string, stage: RouteEditRecord['stage'], path: string, content: string, problem: string, originalCheck: string): string | null => {
    if (!/^route conflict/.test(problem) || !/\.m?js$/.test(path)) return null
    const fixed = repairRouteOrder(path, content)
    if (!fixed) return null
    const remaining = gateProblem(path, fixed.text)
    if (remaining && /^route conflict|^your version has a syntax error/.test(remaining)) return null // the move did not resolve the conflict or broke the file: model rewrite instead
    fpm.deterministic_structural_edits += 1; routeEdits.push({ step: stepId, stage, file: path, mode: fixed.mode, ops: fixed.ops, notes: fixed.notes, finding: problem.slice(0, 400), spanBefore: routeRegion(content, 1500), spanAfter: routeRegion(fixed.text, 1500), originalCheck, resultAfter: remaining ? `route order fixed; remaining gate problem: ${remaining.slice(0, 200)}` : 'route order fixed; all static gates pass' })
    emit('ROUTE_EDIT', `${path}: ${fixed.mode}: ${fixed.notes.join('; ')}`)
    return fixed.text
  }
  /** Contract statuses: domain throws get their status attached, and the handler's catch answers with it (deterministic, single-statement edits; the gates and the verifier still decide). */
  const nameRewrites: NameRewrite[] = []
  const shapeStatus = (path: string, content: string): string => {
    // test names stay short: a long name is rewritten BEFORE the review (name literal only; the body and every assertion are untouched)
    if (tplan?.files.some((f) => f.path === path)) { const n = normalizeTestNames(path, content); if (n.rewrites.length) { nameRewrites.push(...n.rewrites); emit('TEST_NAMES_SHORTENED', `${path}: ${n.rewrites.length} overlong test name(s) shortened (${n.rewrites.slice(0, 3).map((r) => `C${r.criterion}`).join(', ')}); bodies unchanged`); content = n.content } }
    const a = attachContractStatuses(path, content, req.acceptance); if (a) fpm.deterministic_structural_edits += 1; if (a) emit('STATUS_EDIT', `${path}: errors carry their contract status (${a.notes.slice(0, 4).join('; ')})`); return a ? a.text : content
  }
  const parseShaped = (text: string, current: string | null, path: string): ReturnType<typeof parseEditReply> => { let body = text; if (fpOn && !/^test\//.test(path)) { const sm = stripManifest(text); body = sm.text; fpLast.v = { path, manifest: sm.manifest } } const p = parseEditReply(body, current, path); return p.kind === 'code' ? { ...p, content: shapeStatus(path, p.content) } : p }
  const structuralStatus = (path: string, content: string, problem: string): string | null => {
    if (!/^the acceptance contract requires HTTP/.test(problem)) return null
    const fixed = mapCatchStatus(path, content)
    if (!fixed) return null
    const remaining = gateProblem(path, fixed)
    if (remaining && /^the acceptance contract requires HTTP|^your version has a syntax error/.test(remaining)) return null
    emit('STATUS_EDIT', `${path}: the catch block answers with the status an error carries`)
    return fixed
  }
  // ---- execute steps
  try {
    for (const step of state.steps) {
      if (step.status === 'DONE' || step.status === 'SKIPPED') continue
      const b0 = boundary(); if (b0.stop) { checkpoint(); return b0.stop }
      const bs0 = budgetStop(); if (bs0) { failAssignment(log, assignmentId, actor, bs0.reason, undefined, clock()); return bs0 }
      if (deps.crashAfterSteps !== undefined && stepsDone >= deps.crashAfterSteps) { checkpoint(); return result('CRASHED', `simulated process death after ${stepsDone} step(s)`) }
      state.currentStepId = step.id; step.status = 'ACTIVE'; checkpoint()
      if (step.id === 'preflight') {
        if (!fpContract) { step.status = 'DONE'; checkpoint(); continue }
        const runPf = async (): Promise<PreflightReport> => {
          const rep = await runPreflight(ws.root, fpContract!, { recipes: fpRecipes, baseline: baselineText, runtime: deps.firstPass?.runtime !== false })
          fpm.preflight_runs.push({ findings: rep.findings.length, advisories: rep.advisories.length, ms: rep.runtimeMs })
          fpm.final_preflight = rep
          fpExtra = (() => { const en = rep.findings.find((f) => f.stage === 'RUNTIME')?.file ?? 'server.mjs'; return preflightHypotheses(rep.findings, en, ws.exists(en) ? ws.read(en) : '') })()
          if (fpm.first_preflight === null) fpm.first_preflight = rep.findings
          emit('PREFLIGHT', `${rep.passed ? 'PASS' : `FAIL (${rep.findings.length})`}: ${rep.checked.length} check(s)${rep.advisories.length ? `, ${rep.advisories.length} advisory` : ''}${rep.skipped.length ? `, ${rep.skipped.length} skipped` : ''} in ${rep.runtimeMs}ms${rep.findings.length ? ` — ${rep.findings.slice(0, 3).map((f) => f.check).join(', ')}` : ''}`)
          return rep
        }
        const asRecord = (rep: PreflightReport): CommandRecord => { const body = preflightTap(rep); return { argv: ['implementation-preflight'], cwd: ws.root, exitCode: rep.passed ? 0 : 1, timedOut: false, stdout: body, stderr: '', durationMs: rep.runtimeMs, startedAt: clock().toISOString(), outputHash: sha256(body) } }
        let rep = await runPf()
        if (!rep.passed && fpContract) {
          // deterministic structural fixes first: they cost no model call and change only the lines they name
          const byFile = new Map<string, RecipeFinding[]>()
          for (const f of rep.findings) if (f.file && f.recipe && f.stage === 'STATIC') byFile.set(f.file, [...(byFile.get(f.file) ?? []), { recipe: f.recipe, check: f.check.replace(/^[A-Z_]+\./, ''), criterion: f.criterion, file: f.file, symbol: f.symbol, fact: f.fact, expected: f.expected }])
          let fixed = 0
          for (const [file, fs_] of byFile) { if (!ws.exists(file)) continue; const fx = autofix(file, ws.read(file), fs_, fpContract); if (fx) { await writeFile(step.id, file, fx.content); fixed += 1; fpm.deterministic_structural_edits += fx.notes.length; emit('STRUCTURAL_AUTOFIX', `${file}: ${fx.notes.join('; ')}`) } }
          if (fixed) { const again = await runPf(); fpm.first_preflight = fpm.first_preflight ?? again.findings; rep = again }
        }
        if (!rep.passed) {
          const before = repairs
          await debugLoop(asRecord(rep), [...changed].filter((f) => !/^test\//.test(f)), step.id, 'implementation preflight', async () => asRecord(await runPf()))
          fpm.preflight_repairs = repairs - before
          rep = fpm.final_preflight ?? rep
          if (!rep.passed) emit('PREFLIGHT_UNRESOLVED', `${rep.findings.length} preflight finding(s) remain after bounded repairs: ${rep.findings.slice(0, 3).map((f) => f.fact.slice(0, 120)).join(' | ')}`)
        }
        step.status = 'DONE'; step.note = rep.passed ? 'preflight passed' : `preflight: ${rep.findings.length} unresolved (the independent verification judges)`; stepsDone += 1; checkpoint(); continue
      }
      if (step.id === 'accept') {
        const fv = deps.finalVerification!
        // advisory pre-check: a storage round trip on the real module (create -> read -> fresh process -> read) BEFORE the independent verification is spent on it
        if (wantsPersistence(req.acceptance)) {
          const pr = await runProbe().catch(() => null)
          if (pr) {
            emit('PERSISTENCE_PROBE', `${pr.verdict}: ${pr.detail.slice(0, 200)}`)
            if (pr.verdict === 'FAIL') await debugLoop(probeRecord(pr), [...changed].filter((f) => !/^test\//.test(f)), step.id, 'storage round-trip probe', async () => probeRecord(await runProbe()))
          }
        }
        const run = await fv.run()
        if (fpOn && fpm.first_verifier === null) { const po = parseToolOutput(run.stdout, run.stderr); fpm.first_verifier = { pass: Number(po.pass) || 0, fail: Number(po.fail) || 0 }; fpm.verifier_failure_names = [...`${run.stdout}\n${run.stderr}`.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).slice(0, 12) }
        state.validations.push({ stepId: 'accept', command: fv.argv.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: fv.label })
        if (run.exitCode !== 0) {
          const ok = await debugLoop(run, [...changed].filter((f) => !/^test\//.test(f)), step.id, fv.label, fv.run)
          if (!ok) { step.status = 'FAILED'; step.note = `${fv.label} failing (UNDETERMINED)`; checkpoint(); failAssignment(log, assignmentId, actor, `${fv.label} fails and the cause is UNDETERMINED after bounded evidence-based repairs`, { validation: 'FAILED', summary: fv.label, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', `${fv.label}: UNDETERMINED`) }
        }
        step.status = 'DONE'; stepsDone += 1; checkpoint(); continue
      }
      if (step.id === 'verify') {
        // end-to-end: all repo tests, then the independent verification supplied by the Commander/harness
        const tests = allTests()
        if (tests) {
          const run = await runCheck(tests)
          state.validations.push({ stepId: 'verify', command: tests.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: `${parseToolOutput(run.stdout, run.stderr).pass} pass / ${parseToolOutput(run.stdout, run.stderr).fail} fail` })
          if (tplan && tests.length > 3 && run.exitCode === 0) {
            // order independence: the same files in reverse order must give the same outcome (every test has its own server and data, so this proves no hidden shared state)
            // a real order dependence is deterministic: a mismatch must repeat on fresh forward and reverse runs before it blocks CLEAN (a one-off mismatch is load/timing, and is recorded as such)
            const agree = async () => { const f = await runCheck(tests), r = await runCheck([tests[0], tests[1], ...tests.slice(2).reverse()]); return r.exitCode === f.exitCode && failCount(r) === failCount(f) }
            const first = await agree()
            orderIndependent = first || (await agree())
            emit('ORDER_CHECK', `reverse-order run ${orderIndependent ? 'passes like the forward run' : 'DIFFERS from the forward run (twice)'}${!first && orderIndependent ? ' (a one-off mismatch did not repeat)' : ''}`)
          }
          if (run.exitCode !== 0) { const ok = await debugLoop(run, [...changed].filter((f) => !/^test\//.test(f)).concat([...changed].filter((f) => /^test\//.test(f))), step.id, 'full test suite'); if (!ok) { step.status = 'FAILED'; step.note = 'test suite still failing (UNDETERMINED)'; checkpoint(); failAssignment(log, assignmentId, actor, 'the full test suite fails and the cause is UNDETERMINED after bounded evidence-based repairs', { validation: 'FAILED', summary: 'tests failing', artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', 'test suite failing; UNDETERMINED') } }
        }
        if (deps.finalVerification) {
          const fv = deps.finalVerification
          const run = await fv.run()
          state.validations.push({ stepId: 'verify', command: fv.argv.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: fv.label })
          if (run.exitCode !== 0) {
            const impl = [...changed].filter((f) => !/^test\//.test(f))
            const ok = await debugLoop(run, impl, step.id, fv.label, fv.run)
            if (!ok) { step.status = 'FAILED'; step.note = `${fv.label} failing (UNDETERMINED)`; checkpoint(); failAssignment(log, assignmentId, actor, `${fv.label} fails and the cause is UNDETERMINED after bounded evidence-based repairs`, { validation: 'FAILED', summary: fv.label, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', `${fv.label}: UNDETERMINED`) }
          }
        }
        step.status = 'DONE'; stepsDone += 1; checkpoint(); continue
      }
      // a file step
      const path = step.files[0]
      const job: FileJob = { path, layer: step.layer ?? 'domain', exists: ws.exists(path), current: readRel(path), role: step.layer === 'tests' ? 'test' : 'feature' }
      const notes = state.steps.filter((s) => s.status === 'DONE').map((s) => s.title)
      const lessons = deps.lessons?.({ plan, request: req.request }) ?? []
      let feedback = ''
      let routeKept = ''
      const keep = keepExportsFor(path)
      // first-pass: an existing implementation file of real size (30+ lines) is changed by structural/range edits, not regenerated; a tiny file is simply rewritten (its exports are still guarded)
      const mode = fpOn && job.role === 'feature' && job.exists ? (job.current.split('\n').length >= 30 ? 'edits' : 'rewrite') : chooseMode(job.exists, job.current.split('\n').length, keep)
      const fpStep: ImplStep | null = fpOn && fpContract && job.role === 'feature' ? buildImplStep(fpContract, fpRecipes, { file: path, layer: step.layer ?? 'domain', exists: job.exists, current: job.current, step: state.steps.findIndex((x) => x.id === step.id) + 1, dependsOn: state.steps.filter((x) => x.status === 'DONE' && x.files[0] && !/^test\//.test(x.files[0])).map((x) => x.files[0]) }) : null
      if (fpStep && !fpSteps.some((x) => x.TARGET_FILE === path)) fpSteps.push(fpStep)
      let fpForceRewrite = false // first-pass: edits that cannot be applied fall back to ONE whole-file reply (counted as a rewrite, never silent)
      const fpPrompt = (): { firstPass?: { contractText: string; recipeText: string; stepText: string; manifest: boolean } } => (fpStep && fpContract ? { firstPass: { contractText: renderContract(fpContract, 1300), recipeText: renderRecipes(fpContract, fpRecipes, step.layer ?? 'domain', 3000, { path, text: job.current }), stepText: renderImplStep(fpStep, 1500), manifest: true } } : {})
      const contractFile = !!tplan && step.layer === 'tests' && tplan.files.some((f) => f.path === path)
      if (contractFile && tplan) {
        // the harness is Foundry's, not the model's: deterministic text, rewritten whenever it differs
        const hsrc = harnessSource(tplan.entry, tplan.storageVars)
        if (!ws.exists(tplan.harnessPath) || ws.read(tplan.harnessPath) !== hsrc) { await writeFile(step.id, tplan.harnessPath, hsrc); emit('HARNESS_WRITTEN', `${tplan.harnessPath}: per-test server process, port and empty data directory`) }
      }
      const implRelated = (): { path: string; text: string }[] => {
        const idx = buildWorkspaceIndex(ws.root), out: { path: string; text: string }[] = []
        let budget = 8000
        const queue = [tplan?.entry ?? '']
        for (let depth = 0; depth < 3 && queue.length; depth++) for (const q of queue.splice(0)) {
          if (!q || out.some((o) => o.path === q) || /^test\//.test(q) || !ws.exists(q)) continue
          const t = ws.read(q); if (budget - t.length < 0) continue
          budget -= t.length; out.push({ path: q, text: t })
          for (const i of idx.files[q]?.imports ?? []) if (i.resolved) queue.push(i.resolved)
        }
        return out
      }
      const askFile = async (extra: string[], retry = 0, viaOverride?: ModelClient) => { const useMode = fpForceRewrite ? 'rewrite' : mode; const r = await call(useMode === 'edits' ? (fpStep ? ENGINEER_STRUCT_SYSTEM : ENGINEER_SYSTEM) : ENGINEER_REWRITE_SYSTEM, featurePrompt({ ...fpPrompt(), request: req.request, acceptance: req.acceptance, plan, job, related: contractFile ? implRelated() : relatedFor(path, [...changed]), lessons, priorNotes: [...notes, ...extra], keepExports: keep, mode: useMode, ...(contractFile && tplan ? { testPlanText: planPromptFor(tplan, path) } : {}) }), false, retry ? { temperature: 0.1 + 0.25 * retry, seed: 1000 + retry } : {}, viaOverride ?? (job.role === 'test' ? deps.testWriter?.model : undefined)); noteTokens(r); return r }
      let reply = await askFile([])
      let parsedReply: ReturnType<typeof parseEditReply> = reply.ok ? parseShaped(reply.text, job.exists ? job.current : null, path) : { kind: 'invalid', reason: 'model call failed' }
      if (parsedReply.kind === 'code') parsedReply = { ...parsedReply, content: shapeStatus(path, parsedReply.content) }
      for (let rej = 0; rej < 3 && reply.ok; rej++) {
        let problem = parsedReply.kind === 'invalid' ? parsedReply.reason : parsedReply.kind === 'code' ? gateProblem(path, parsedReply.content) : parsedReply.kind === 'no_change' && /\.html?$/.test(path) ? pageMissing(path) : null
        if (problem && parsedReply.kind === 'code') {
          const sfix = structuralRoute(step.id, 'EDIT_REJECTION', path, parsedReply.content, problem, 'edit-stage static gate')
          if (sfix !== null) { parsedReply = { ...parsedReply, content: sfix }; problem = gateProblem(path, sfix); if (problem) routeKept = routeRegion(sfix) }
          const stfx = problem ? structuralStatus(path, parsedReply.content, problem) : null
          if (stfx !== null) { parsedReply = { ...parsedReply, content: stfx }; problem = gateProblem(path, stfx) }
        }
        // first-pass: recipe static checks, then the worker's manifest is verified independently (a claim is never trusted)
        if (!problem && fpStep && parsedReply.kind === 'code') {
          // known, bounded defects are fixed by a deterministic structural edit BEFORE the worker is asked again
          let fresh = fpRecipeFresh(path, parsedReply.content)
          if (fresh.length && fpContract) { const fx = autofix(path, parsedReply.content, fresh, fpContract); if (fx) { parsedReply = { ...parsedReply, content: fx.content }; fpm.deterministic_structural_edits += fx.notes.length; emit('STRUCTURAL_AUTOFIX', `${path}: ${fx.notes.join('; ')}`); fresh = fpRecipeFresh(path, fx.content) } }
          problem = fpFindingsText(fresh)
          if (!problem && fpContract) {
            const fl = runRecipeChecks(fpFilesWith(path, parsedReply.content), fpContract, fpRecipes).filter((f) => f.file === path)
            const mc = checkManifest(fpLast.v?.path === path ? fpLast.v.manifest : null, parsedReply.content, fpStep, job.current, fl)
            if (mc.missing) { if (deps.firstPass?.requireManifest === true && rej === 0) { fpm.manifests.retries += 1; problem = 'MANIFEST_MISSING: add the ```manifest block (CHANGED / WHY / SATISFIES / PRESERVES / RISKS) after your code; keep the code exactly as it is' } }
            else if (mc.problems.length) { fpm.manifests.false_claims += mc.problems.length; emit('MANIFEST_CLAIM_UNVERIFIED', `${path}: ${mc.problems.slice(0, 2).join('; ').slice(0, 220)}`); if (mc.blocking.length) problem = `MANIFEST CHECK: ${mc.blocking.slice(0, 3).join('; ')}` }
          }
        }
        // TEST REVIEWER (deterministic contract-grounding challenge): a test that maps to no numbered criterion is sent back before it is ever executed
        if (!problem && contractFile && tplan && rej < 2 && parsedReply.kind === 'code') { const rv = reviewTestFile(path, parsedReply.content, tplan); const rp = reviewProblem(rv); if (rp) { problem = `TEST REVIEWER: ${rp}`; testReviews.push({ file: path, reviewer: 'foundry:deterministic-review', verdict: 'REVISE', findings: rv.map((f) => `${f.code}: ${f.detail}`.slice(0, 200)) }) } }
        if (!problem && job.role === 'test' && (deps.testWriter || deps.groundTests || contractFile) && rej < 2 && parsedReply.kind === 'code') { const ch = ungroundedChallenge(groundTests(path, parsedReply.content, req.acceptance, writerLabel), req.acceptance.length); if (ch) problem = `TEST REVIEWER: ${ch}` }
        if (!problem) break
        if (rej >= 2 && !isCollisionProblem(problem) && !FACT_BEARING.test(problem)) break // the third, targeted retry is reserved for problems that carry exact facts (collisions, route conflicts, contract routes/statuses, state drift, persistence, syntax, undeclared names); bounded
        feedback = problem
        emit('REJECT', `${path}: ${problem}`)
        state.doNotRepeat.push({ key: `reject:${path}:${rej}`, reason: problem })
        if (fpStep && !/^MANIFEST/.test(problem)) fpm.reply_rejections.push({ file: path, problem: problem.slice(0, 220) })
        if (fpStep && mode === 'edits' && !fpForceRewrite && (parsedReply.kind === 'invalid' || (parsedReply.kind === 'code' && parsedReply.mode === 'edits' && /syntax error|would not start/i.test(problem)))) { fpForceRewrite = true; emit('EDIT_FALLBACK_REWRITE', `${path}: the structural/range edits ${parsedReply.kind === 'invalid' ? `could not be applied (${parsedReply.reason.slice(0, 120)})` : 'produced a file that does not parse'}; asking for the whole file once`) }
        const bs = budgetStop(); if (bs) { failAssignment(log, assignmentId, actor, bs.reason, undefined, clock()); return bs }
        reply = await askFile([`YOUR PREVIOUS REPLY WAS REJECTED: ${problem}`, (routeKept && parsedReply.kind === 'code' ? `THE ENGINE ALREADY CORRECTED THE ROUTE ORDER of your reply (do not change the order of the routes). Here is the corrected file; return it with ONLY the problem above fixed:\n${parsedReply.content.slice(0, 7500)}` : parsedReply.kind === 'code' && /^route conflict|^the server does not serve/.test(problem) && routeRegion(parsedReply.content) ? `THE ROUTE LAYOUT OF THE REJECTED REPLY (line numbers match the message above; reorder these so every specific route comes before the broader route that also matches it, then keep everything else):\n${routeRegion(parsedReply.content)}` : `THE REJECTED REPLY (do NOT repeat it):\n${reply.text.slice(0, 700)}`)], rej + 1)
        parsedReply = reply.ok ? parseShaped(reply.text, job.exists ? job.current : null, path) : { kind: 'invalid', reason: 'model call failed' }
      }
      void feedback
      // INDEPENDENT-WRITER FALLBACK: if the test writer could not produce a statically valid test file, the builder gets bounded tries at it (competing attempt) instead of failing the step.
      if (job.role === 'test' && deps.testWriter && reply.ok) {
        const skipForFallback = new Set(state.steps.filter((x) => x.status === 'SKIPPED').flatMap((x) => x.files))
        const badNow = () => (parsedReply.kind === 'code' ? gateProblem(path, parsedReply.content, skipForFallback) : parsedReply.kind === 'invalid' ? parsedReply.reason : null)
        let bad = badNow()
        for (let fb = 0; bad && fb < 2 && budgetLeft() && helperOk(`${path}: writer fallback`); fb++) {
          helperCalls += 1
          emit('TEST_WRITER_FALLBACK', `${path}: the independent writer ${writerLabel} produced an unusable file (${bad.slice(0, 160)}); asking the builder (attempt ${fb + 1}/2)`)
          reply = await askFile([`THE PREVIOUS TEST FILE WAS UNUSABLE: ${bad}. Keep it small: at most ${req.acceptance.length} tests, one per numbered obligation.`], fb, deps.model)
          parsedReply = reply.ok ? parseShaped(reply.text, job.exists ? job.current : null, path) : { kind: 'invalid', reason: 'model call failed' }
          bad = badNow()
        }
      }
      if (reply.ok) { const skippedFiles = new Set(state.steps.filter((x) => x.status === 'SKIPPED').flatMap((x) => x.files)) // a skipped step's file may be the true defect: let evidence-driven repair find it rather than failing here
      const still = parsedReply.kind === 'code' ? gateProblem(path, parsedReply.content, skippedFiles) : null; if (still) { step.status = 'FAILED'; step.note = `rejected: ${still}`; checkpoint(); failAssignment(log, assignmentId, actor, `the model repeatedly produced a ${path} that ${still}`, undefined, clock()); return result('FAILED', `${path}: incompatible rewrite after 2 rejections`) } }
      if (!reply.ok) { if (reply.detail.includes('cancel')) { const b = boundary(); if (b.stop) { checkpoint(); return b.stop } } step.status = 'FAILED'; step.note = `model call failed: ${reply.detail}`; checkpoint(); failAssignment(log, assignmentId, actor, `model call failed: ${reply.detail}`, undefined, clock()); return result('FAILED', `model call failed: ${reply.detail}`) }
      const pr = parsedReply
      if (pr.kind === 'no_change') { step.status = 'SKIPPED'; step.note = 'model: NO_CHANGE needed for this file'; checkpoint(); emit('NO_CHANGE', path); continue }
      if (pr.kind === 'invalid') { step.status = 'FAILED'; step.note = `unusable reply: ${pr.reason}`; checkpoint(); failAssignment(log, assignmentId, actor, `model reply unusable for ${path}: ${pr.reason}`, undefined, clock()); return result('FAILED', `unusable reply for ${path}`) }
      if (fpStep && pr.kind === 'code') { noteEdit(pr, job.exists); if (fpLast.v?.path === path && fpLast.v.manifest) fpm.manifests.present += 1; else fpm.manifests.missing += 1 }
      let toWrite = pr.content
      if (contractFile && tplan) {
        const dropped = dropUngrounded(path, toWrite, req.acceptance)
        if (dropped) { toWrite = dropped.content; testReviews.push({ file: path, reviewer: 'foundry:deterministic-review', verdict: 'REJECTED_UNGROUNDED', findings: dropped.names.map((n) => n.slice(0, 120)) }); emit('TEST_REJECTED_BEFORE_EXECUTION', `${path}: ${dropped.names.length} test(s) map to no acceptance criterion`) }
        // LOCAL TEST REVIEWER: a separate local model judges the file against its plan rows BEFORE it runs; at most one revision, accepted only if it still passes every static and plan check
        if (deps.testReviewer && !tplan.files.find((f) => f.path === path)?.generated && budgetLeft() && helperOk(`${path}: local test review`)) {
          helperCalls += 1
          const rv = await call(REVIEWER_SYSTEM, reviewerPrompt(tplan, path, toWrite), true, { temperature: 0 }, deps.testReviewer.model)
          const verdict = rv.ok ? parseReviewerVerdict(rv.text) : null
          testReviews.push({ file: path, reviewer: deps.testReviewer.label, verdict: verdict?.verdict ?? 'NO_VERDICT', findings: verdict?.problems ?? [] })
          emit('TEST_REVIEW', `${path}: ${deps.testReviewer.label}: ${verdict?.verdict ?? 'NO_VERDICT'}`)
          if (verdict?.verdict === 'REVISE' && budgetLeft()) {
            const r2 = await askFile([`THE LOCAL REVIEWER FOUND THESE PROBLEMS (fix exactly these and keep everything else): ${verdict.problems.join(' | ')}`, `THE FILE TO REVISE:\n${toWrite.slice(0, 6000)}`], 1)
            const p2 = r2.ok ? parseShaped(r2.text, job.exists ? job.current : null, path) : null
            if (p2?.kind === 'code' && !gateProblem(path, p2.content) && !reviewProblem(reviewTestFile(path, p2.content, tplan))) { toWrite = dropUngrounded(path, p2.content, req.acceptance)?.content ?? p2.content; testReviews.push({ file: path, reviewer: deps.testReviewer.label, verdict: 'REVISION_ACCEPTED', findings: [] }) } else testReviews.push({ file: path, reviewer: deps.testReviewer.label, verdict: 'REVISION_REJECTED', findings: ['the revision failed a static or plan check; the original (already reviewed deterministically) is kept'] })
          }
        }
      }
      await writeFile(step.id, path, toWrite)
      emit('WRITE', path)
      // validate this step
      let stepOk = true
      for (const argv of validationFor([path])) {
        const run = await runCheck(argv)
        state.validations.push({ stepId: step.id, command: argv.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: run.exitCode === 0 ? 'syntax ok' : (run.stderr.split('\n').find((l) => /Error/.test(l)) ?? 'failed').slice(0, 160) })
        if (run.exitCode !== 0) { stepOk = await debugLoop(run, [path], step.id, `syntax check ${path}`); if (!stepOk) break }
      }
      if (stepOk && step.layer === 'tests') {
        const tests = allTests()
        if (tests) {
          let run = await runCheck(tests)
          state.validations.push({ stepId: step.id, command: tests.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: `${parseToolOutput(run.stdout, run.stderr).pass} pass / ${parseToolOutput(run.stdout, run.stderr).fail} fail` })
          // COMPETING LOCAL ATTEMPTS: once the implementation is independently verified, a failing test file is a test defect. Other local writers get one bounded try each BEFORE
          // any repair, correction or quarantine; the candidate that satisfies the verified implementation with the most contract-grounded tests wins, everything else is discarded.
          // env/flake handling and defect classification (evidence first: whose fault is each failing test?)
          const classifyRun = (r: CommandRecord): DefectVerdict[] => {
            if (!contractFile) return []
            const verifierPassed = state.validations.some((v) => v.stepId === 'accept' && v.status === 'PASSED')
            const fails = parseTestFailures(`${r.stdout}\n${r.stderr}`).filter((f) => f.file === path || f.file === null)
            const g = groundTests(path, ws.read(path), req.acceptance, writerLabel)
            const cc = correctToContract(path, ws.read(path), fails.map((f) => ({ line: f.line, actual: f.actual, expected: f.expected })))
            const out: DefectVerdict[] = []
            for (const f of fails) {
              const grounded = g.some((x) => x.name.trim() === f.name.trim() && x.confidence !== 'NONE')
              const v = classifyTestDefect({ verifierPassed, grounded, message: `${f.message} ${r.stderr.slice(-400)}`, contradictsContract: !!cc?.corrections.some((c) => c.line === f.line) })
              out.push(v)
              if (!testDefects.some((d) => d.file === path && d.test === f.name && d.kind === v.kind)) testDefects.push({ file: path, test: f.name, kind: v.kind, basis: v.basis, resolved: false })
            }
            return out
          }
          // IMPLEMENTATION_DEFECT (deterministic, bounded): a DEFAULT_PATH test fails because the module anchors the contract's default data path somewhere other than the working directory.
          // The test is right and the implementation is wrong, so the one declaration is corrected, the tests re-run, and the independent verifier must still pass; otherwise the edit is reverted.
          const repairImplementationDefault = async (): Promise<boolean> => {
            if (!tplan || !contractFile || run.exitCode === 0 || !state.validations.some((v) => v.stepId === 'accept' && v.status === 'PASSED')) return false
            const failed = parseTestFailures(`${run.stdout}\n${run.stderr}`).filter((f) => f.file === path && /\bDEFAULT_PATH\b/.test(f.name))
            if (!failed.length) return false
            const snap: Record<string, string> = {}
            for (const v of tplan.storageVars) {
              const def = /default:?\s*([\w./-]+\.\w+)/i.exec(req.acceptance.find((a) => a.includes(v)) ?? '')?.[1]
              if (!def) continue
              for (const f of Object.keys(ws.snapshot()).filter((x) => /\.m?js$/.test(x) && !/^(?:test|public|node_modules)\//.test(x) && ws.read(x).includes(`process.env.${v}`))) {
                const fx = repairDefaultStoragePath(ws.read(f), v, def) ?? repairMissingStorageDir(ws.read(f), v, def)
                if (!fx) continue
                snap[f] = ws.read(f)
                await writeFile(step.id, f, fx.content)
                fpm.deterministic_structural_edits += 1
                emit('IMPLEMENTATION_REPAIR', `${f}: ${fx.note}`)
              }
            }
            if (!Object.keys(snap).length) return false
            const again = await runCheck(tests)
            const chk = deps.finalVerification ? await deps.finalVerification.run() : null
            if (again.exitCode !== 0 && failCount(again) >= failCount(run) || (chk && chk.exitCode !== 0)) {
              for (const [f, t] of Object.entries(snap)) await writeFile(step.id, f, t, `:revert${++restoreSeq}`)
              emit('IMPLEMENTATION_REPAIR_REVERTED', `${path}: the default-path repair did not help or broke the independent acceptance`)
              return false
            }
            for (const f of failed) testDefects.push({ file: path, test: f.name, kind: 'IMPLEMENTATION_DEFECT', basis: `the contract names a default data path under the working directory; the module placed it elsewhere (${Object.keys(snap).join(', ')} corrected)`, resolved: true })
            run = again
            return true
          }
          const runCandidates = async () => {
            const rescueMode = !!(tplan && contractFile)
            const rescueNo = rescueMode && run.exitCode !== 0 && deps.testCandidates?.length ? rescueBlocked() : null
            if (rescueNo) { rescue.rescue_skipped_reason = rescueNo; emit('TEST_RESCUE_SKIPPED', `${path}: ${rescueNo}`) }
            if (run.exitCode !== 0 && deps.testCandidates?.length && !tplan?.files.find((f) => f.path === path)?.generated && state.validations.some((v) => v.stepId === 'accept' && v.status === 'PASSED') && !rescueNo && (rescueMode || helperOk(`${path}: competing test candidates`))) {
            const base = ws.read(path)
            const pool: { label: string; content: string; failing: number; passed: boolean; grounded: number }[] = [{ label: writerLabel, content: base, failing: failCount(run), passed: false, grounded: groundTests(path, base, req.acceptance, writerLabel).filter((g) => g.confidence !== 'NONE').length }]
            for (const alt of deps.testCandidates.slice(0, deps.maxCandidatesPerFile ?? 1)) {
              if (rescueMode) { const no = rescueBlocked(); if (no) { rescue.rescue_skipped_reason = no; emit('TEST_RESCUE_SKIPPED', `${path}: ${no}`); break } } else if (!budgetLeft() || !helperOk(`${path}: candidate ${alt.label}`)) break
              emit('TEST_CANDIDATE', `${path}: asking ${alt.label} for a competing test file`)
              helperCalls += 1
              const rescueStart = Date.now(), callsBefore = modelCalls
              if (rescueMode) rescue.rescue_attempted = true
              const r = await askFile([], alt.model === deps.model ? 1 : 0, alt.model)
              if (rescueMode) { rescue.used_calls += modelCalls - callsBefore; rescue.used_time_ms += Date.now() - rescueStart; if (!r.ok) rescue.rescue_skipped_reason = `MODEL_UNAVAILABLE: ${r.detail.slice(0, 120)}` }
              if (!r.ok) { candidateLog.push({ label: alt.label, file: path, failing: -1, passed: false, kept: false }); continue }
              let pa = parseShaped(r.text, job.exists ? job.current : null, path)
              if (pa.kind === 'code') pa = { ...pa, content: shapeStatus(path, pa.content) }
              if (pa.kind !== 'code' || gateProblem(path, pa.content)) { candidateLog.push({ label: alt.label, file: path, failing: -1, passed: false, kept: false }); continue }
              await writeFile(step.id, path, pa.content, `:cand${++restoreSeq}`)
              const rc = await runCheck(tests)
              const failing = rc.exitCode === 0 ? 0 : failCount(rc)
              pool.push({ label: alt.label, content: pa.content, failing, passed: rc.exitCode === 0, grounded: groundTests(path, pa.content, req.acceptance, alt.label).filter((g) => g.confidence !== 'NONE').length })
              candidateLog.push({ label: alt.label, file: path, failing, passed: rc.exitCode === 0, kept: false })
              if (rc.exitCode === 0) break
            }
            const best = [...pool].sort((a, b) => Number(b.passed) - Number(a.passed) || a.failing - b.failing || b.grounded - a.grounded)[0]
            if (ws.read(path) !== best.content) await writeFile(step.id, path, best.content, `:cand${++restoreSeq}`)
            const kept = candidateLog.find((c) => c.label === best.label && c.file === path); if (kept) kept.kept = true
            emit('TEST_CANDIDATE_CHOSEN', `${path}: kept ${best.label} (${best.passed ? 'passes' : `${best.failing} failing`}, ${best.grounded} contract-grounded) of ${pool.length} candidate(s)`)
            run = await runCheck(tests)
            state.validations.push({ stepId: step.id, command: tests.join(' '), status: run.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: run.outputHash, summary: `after competing test candidates: kept ${best.label}` })
          }
          }
          if (run.exitCode !== 0 && contractFile) {
            const first = classifyRun(run)
            if (first.some((d) => d.kind === 'ENVIRONMENT_DEFECT')) {
              emit('ENVIRONMENT_RERUN', `${path}: a failure looks like a server start/connection problem of the isolated run; re-running once on fresh state`)
              const again = await runCheck(tests)
              state.validations.push({ stepId: step.id, command: tests.join(' '), status: again.exitCode === 0 ? 'PASSED' : 'FAILED', at: clock().toISOString(), outputHash: again.outputHash, summary: 'environment re-run on fresh isolated state' })
              if (again.exitCode === 0 || failCount(again) < failCount(run)) { run = again; if (run.exitCode === 0) for (const d of testDefects) if (d.file === path && d.kind === 'ENVIRONMENT_DEFECT') d.resolved = true }
            }
          }
          if (!(tplan && contractFile)) await runCandidates()
          if (tplan && contractFile && run.exitCode !== 0) await repairImplementationDefault()
          if (run.exitCode !== 0) {
            // Once the independent acceptance has PASSED, the implementation is verified ground truth: a failure that only implicates the NEW test is a test defect,
            // so the repair is confined to that test file instead of risking the verified behaviour.
            const acceptPassed = state.validations.some((v) => v.stepId === 'accept' && v.status === 'PASSED')
            const out = `${run.stdout}\n${run.stderr}`
            const otherTests = tests.slice(2).filter((t) => t !== path && out.includes(t))
            // ...unless the failure output itself implicates implementation files (a stack frame or path inside src/, server, public): then the implementation is a suspect too
            const implicated = candidatesFromOutput(out, []).filter((f) => !/^test\//.test(f))
            // a test Foundry generated from the contract is never rewritten by a model: when it fails against the verified implementation the implementation is the suspect
            const genFile = !!tplan?.files.find((f) => f.path === path)?.generated
            const testOnly = !genFile && acceptPassed && out.includes(path) && !otherTests.length && !implicated.length
            const implSnap = Object.fromEntries([...changed].filter((f) => !/^test\//.test(f) && ws.exists(f)).map((f) => [f, ws.read(f)]))
            stepOk = await debugLoop(run, testOnly ? [path] : [...changed].filter((f) => !/^test\//.test(f)).concat(genFile ? [] : [path]), step.id, 'tests', () => runCheck(tests), testOnly ? [path] : undefined)
            // implementation files edited at the test stage must not regress the independently verified behaviour: the verifier is the arbiter, the edit is reverted otherwise
            if (acceptPassed && deps.finalVerification && Object.entries(implSnap).some(([f, t]) => ws.read(f) !== t)) {
              const chk = await deps.finalVerification.run()
              if (chk.exitCode !== 0) { for (const [f, t] of Object.entries(implSnap)) if (ws.read(f) !== t) await writeFile(step.id, f, t, `:revert${++restoreSeq}`); state.doNotRepeat.push({ key: `revert:${step.id}`, reason: 'a repair at the test stage changed implementation files and broke the independent acceptance; the edit was reverted' }); emit('REVERT_REGRESSION', `${step.id}: implementation edit reverted (independent acceptance regressed)`); stepOk = (await runCheck(tests)).exitCode === 0 }
            }
            if (!stepOk && acceptPassed) {
              // The implementation PASSED the independent acceptance and only the model-written test still fails: the test asserts something the contract does not require.
              // Quarantine exactly the failing cases (recorded, reviewable, never silent) so an invented expectation cannot block a feature that meets its acceptance criteria.
              // First, a deterministic correction where the test CLEARLY contradicts the authoritative acceptance contract (see correctContractAssertions: fail closed otherwise).
              {
                const r0 = await runCheck(tests)
                const cc = correctToContract(path, ws.read(path), parseTestFailures(`${r0.stdout}\n${r0.stderr}`).filter((f) => f.file === path))
                if (cc?.refused.length) emit('CONTRACT_CORRECTION_REFUSED', `${path}: ${cc.refused.join('; ').slice(0, 300)}`)
                if (cc?.corrections.length) {
                  const before = ws.read(path), failsBefore = parseTestFailures(`${r0.stdout}\n${r0.stderr}`).length
                  await writeFile(step.id, path, cc.content)
                  const r1 = await runCheck(tests)
                  const failsAfter = r1.exitCode === 0 ? 0 : parseTestFailures(`${r1.stdout}\n${r1.stderr}`).length
                  if (failsAfter < failsBefore) {
                    corrections.push(...cc.corrections)
                    const note = cc.corrections.map((c) => `line ${c.line}: ${c.from} -> ${c.to} (criterion ${c.criterion})`).join('; ')
                    state.doNotRepeat.push({ key: `contract-correction:${path}`, reason: `corrected ${cc.corrections.length} model-written status assertion(s) that contradicted the acceptance contract: ${note}` })
                    emit('CONTRACT_CORRECTION', `${path}: ${note}`)
                    if (r1.exitCode === 0) { state.validations.push({ stepId: step.id, command: tests.join(' '), status: 'PASSED', at: clock().toISOString(), outputHash: r1.outputHash, summary: `after correcting ${cc.corrections.length} assertion(s) to the acceptance contract; no test removed` }); stepOk = true }
                  } else { await writeFile(step.id, path, before, `:restore${++restoreSeq}`); emit('CONTRACT_CORRECTION_REVERTED', `${path}: the correction did not reduce the failures`) }
                }
              }
            }
            // CONTRACT-MODE ORDER: reviewer (before the run) -> writer retry with evidence (debug loop) -> deterministic correction -> ONE alternate local candidate -> isolated re-run -> only then quarantine
            if (!stepOk && acceptPassed && tplan && contractFile) {
              run = await runCheck(tests)
              if (run.exitCode !== 0) await runCandidates()
              stepOk = run.exitCode === 0
            }
            // TEST-AUTHORING ESCALATION (last step of the local-first order: writer + repairs -> one local candidate -> deterministic contract correction -> optional bounded assist).
            // Only a failing test that is GROUNDED in an acceptance criterion, on an implementation the independent verifier already passed, whose local candidate also failed, qualifies.
            if (!stepOk && acceptPassed) {
              const ar = await runCheck(tests)
              const testText = ws.read(path)
              const fails = parseTestFailures(`${ar.stdout}\n${ar.stderr}`).filter((f) => f.file === path)
              const groundedNow = groundTests(path, testText, req.acceptance, writerLabel)
              const isGrounded = (n: string) => groundedNow.some((g) => g.name.trim() === n.trim() && g.confidence !== 'NONE')
              const gFail = fails.filter((f) => isGrounded(f.name)), uFail = fails.filter((f) => !isGrounded(f.name))
              const cands = candidateLog.filter((c) => c.file === path)
              const td = testAssistJustified({ implementationVerified: true, failingGroundedTests: gFail.length, failingUngroundedTests: uFail.length, localCandidatesTried: cands.length, localCandidatePassed: cands.some((c) => c.passed), file: path, assistsOnThisFile: ledger.assistsOn(path), callsSoFar: ledger.calls, maxCalls: ledger.maxCalls, providerAvailable: !!deps.frontier && deps.frontier.provider.available() })
              if (td.opportunity && !td.justified && !ledger.unmet.some((u) => u.file === path)) {
                const why = !deps.frontier ? 'no frontier provider is configured for this build (local-only)' : !deps.frontier.provider.available() ? `FRONTIER_UNAVAILABLE: ${deps.frontier.provider.family} is not configured in this process` : 'frontier budget exhausted'
                ledger.unmet.push({ trigger: 'TEST_CANDIDATES_EXHAUSTED', file: path, basis: td.basis, reason: why })
                if (deps.frontier && !ledger.unavailable && !deps.frontier.provider.available()) ledger.unavailable = why
                emit('ESCALATION_NEEDED_UNMET', `TEST_CANDIDATES_EXHAUSTED on ${path}: ${why}`)
                if (deps.frontier && !deps.frontier.provider.available()) emit('FRONTIER_UNAVAILABLE', why)
              }
              if (td.justified && deps.frontier && Date.now() - t0 < limits.maxRuntimeMs * 0.85) {
                const idxT = buildWorkspaceIndex(ws.root)
                const impl = (idxT.files[path]?.imports ?? []).map((i) => i.resolved).filter((x): x is string => !!x && ws.exists(x)).slice(0, 2)
                const subtaskId = `${build.buildId}:ta${ledger.calls + 1}`
                const context = [
                  `FAILING TEST FILE ${path}:\n\`\`\`\n${testText.slice(0, 5000)}\n\`\`\``,
                  `FAILING ASSERTIONS (observed behavior of the verified implementation):\n${gFail.map((f) => `- "${f.name}" line ${f.line ?? '?'}: ${f.message}${f.actual !== null ? ` | actual ${f.actual}` : ''}${f.expected !== null ? ` | expected ${f.expected}` : ''}`).join('\n')}`,
                  `IMPLEMENTATION THAT ALREADY PASSES THE INDEPENDENT ACCEPTANCE (do not change it):\n${impl.map((f) => `--- ${f} ---\n${ws.read(f).slice(0, 2500)}`).join('\n\n')}`,
                  `LOCAL CANDIDATE RESULTS: ${cands.map((c) => `${c.label}: ${c.passed ? 'passes' : `${c.failing} failing`}`).join('; ') || 'none'}`,
                ].join('\n\n')
                const treq = buildFrontierRequest(build, { subtaskId, objective: `Correct the failing contract-grounded tests in ${path} so they prove the acceptance criteria against the verified implementation`, context, constraints: ['return the complete corrected test file in a single fenced code block', 'every test must prove one numbered acceptance criterion and be named with [C<number>]', 'keep every criterion that the current file covers covered', 'do not weaken, remove or reword the acceptance criteria and do not assert behavior the criteria do not state'], acceptance: req.acceptance, allowedFiles: [path], expectedReturn: 'TEST_PATCH_PROPOSAL' })
                const tprompt = renderFrontierRequest(treq)
                emit('FRONTIER_ASSIST_REQUEST', `${subtaskId} -> ${deps.frontier.provider.model}: ${td.basis}`)
                const started = Date.now()
                const fr = await deps.frontier.provider.ask({ system: ENGINEER_REWRITE_SYSTEM, prompt: tprompt, maxTokens: 3500, timeoutMs: Math.min(180_000, limits.maxRuntimeMs) })
                ledger.spend(tprompt.length, fr.ok ? fr.text.length : 0)
                const text = fr.ok ? fr.text : ''
                let artifactPath: string | null = null
                try { mkdirSync(deps.frontier.reviewDir, { recursive: true }); artifactPath = pathJoin(deps.frontier.reviewDir, `${subtaskId.replace(/[^\w.-]/g, '_')}.json`); writeFileSync(artifactPath, JSON.stringify({ request: treq, provider: deps.frontier.provider.family, model: deps.frontier.provider.model, at: clock().toISOString(), reply: text, error: fr.ok ? null : fr.detail }, null, 1)) } catch { artifactPath = null }
                const rec: IngestionRecord = { subtaskId, buildId: build.buildId, missionId: build.missionId, provider: deps.frontier.provider.family, model: deps.frontier.provider.model, at: clock().toISOString(), task: treq.objective.slice(0, 160), contextScope: { files: [path], contextChars: context.length }, reasonForEscalation: { trigger: 'TEST_CANDIDATES_EXHAUSTED', basis: td.basis }, localAttemptsBefore: cands.length + 1, sharedFiles: [path, ...impl], tokensEstimated: { in: Math.round(tprompt.length / 4), out: Math.round(text.length / 4) }, cost: 'UNKNOWN', cleanOutcomeImpact: 'PENDING', returnType: 'TEST_PATCH_PROPOSAL', artifactHash: sha(text), artifactPath, steps: checkProvenanceAndScope(treq, { provider: deps.frontier.provider.family, model: deps.frontier.provider.model, text, targetFile: fr.ok ? path : null }), decision: 'PENDING', reason: fr.ok ? 'received; awaiting Foundry ingestion gate' : `no reply: ${fr.detail}`, measuredBenefit: 'not yet measured' }
                ledger.records.push(rec)
                const reject = (why: string, stage: 'SCOPE' | 'STATIC_VALIDATION' | 'LOCAL_REVIEW' | 'TESTS' | 'INDEPENDENT_VERIFICATION', benefit = 'none (workspace unchanged)') => { rec.steps.push({ stage, ok: false, note: why.slice(0, 200) }); rec.decision = 'REJECTED'; rec.reason = why.slice(0, 200); rec.measuredBenefit = benefit; emit('FRONTIER_ASSIST_RESULT', `${subtaskId}: REJECTED (${why.slice(0, 100)})`) }
                const pt = fr.ok ? parseEditReply(text, testText, path) : ({ kind: 'invalid', reason: fr.ok ? '' : fr.detail } as ReturnType<typeof parseEditReply>)
                if (!fr.ok) reject(`frontier call failed: ${fr.detail}`, 'SCOPE')
                else if (pt.kind !== 'code') reject(`reply is not a usable single test file: ${pt.kind === 'invalid' ? pt.reason : 'NO_CHANGE'}`, 'SCOPE')
                else {
                  const staticProblem = gateProblem(path, pt.content)
                  const proposed = groundTests(path, pt.content, req.acceptance, `${deps.frontier.provider.model}`)
                  const before = new Set(groundedNow.filter((g) => g.confidence !== 'NONE').map((g) => g.criterion_id)), after = new Set(proposed.filter((g) => g.confidence !== 'NONE').map((g) => g.criterion_id))
                  const lost = [...before].filter((c) => !after.has(c)), ungroundedNew = proposed.filter((g) => g.confidence === 'NONE')
                  if (staticProblem) reject(`failed Foundry static validation: ${staticProblem}`, 'STATIC_VALIDATION')
                  else if (!proposed.length || ungroundedNew.length || lost.length) reject(`contract grounding check failed: ${!proposed.length ? 'no tests' : ungroundedNew.length ? `${ungroundedNew.length} test(s) map to no criterion` : `criteria ${lost.join(',')} would lose coverage`}`, 'LOCAL_REVIEW')
                  else {
                    rec.steps.push({ stage: 'STATIC_VALIDATION', ok: true, note: 'syntax and export gates passed' }, { stage: 'LOCAL_REVIEW', ok: true, note: `every test grounded; criteria covered ${[...after].join(',')} (no coverage lost)` }, { stage: 'INTEGRATION_CANDIDATE', ok: true, note: 'written by Foundry through its own effect ledger' })
                    await writeFile(step.id, path, pt.content, `:testassist${++restoreSeq}`)
                    const tr = await runCheck(tests)
                    const vr = tr.exitCode === 0 && deps.finalVerification ? await deps.finalVerification.run() : null
                    if (tr.exitCode === 0 && vr && vr.exitCode === 0) {
                      rec.steps.push({ stage: 'TESTS', ok: true, note: 'all tests pass locally with nothing quarantined' }, { stage: 'INDEPENDENT_VERIFICATION', ok: true, note: 'the independent verifier still passes the implementation' })
                      rec.decision = 'ACCEPTED'; rec.reason = 'integrated by Foundry: tests pass locally, grounded, nothing quarantined'; rec.measuredBenefit = `${gFail.length} grounded failing test(s) -> 0; no quarantine`
                      state.validations.push({ stepId: step.id, command: tests.join(' '), status: 'PASSED', at: clock().toISOString(), outputHash: tr.outputHash, summary: 'after a bounded test-authoring assist; nothing quarantined' })
                      emit('FRONTIER_ASSIST_RESULT', `${subtaskId}: ACCEPTED (${rec.measuredBenefit})`)
                      stepOk = true
                    } else {
                      await writeFile(step.id, path, testText, `:restore${++restoreSeq}`)
                      reject(tr.exitCode !== 0 ? `the proposed tests still fail locally (${failCount(tr)} failing)` : 'the independent verifier no longer passes after the proposed tests', tr.exitCode !== 0 ? 'TESTS' : 'INDEPENDENT_VERIFICATION', `failing ${gFail.length} -> ${tr.exitCode !== 0 ? failCount(tr) : 0}; workspace restored`)
                    }
                  }
                }
                if (rec.artifactPath) { try { writeFileSync(rec.artifactPath.replace(/\.json$/, '.decision.json'), JSON.stringify(rec, null, 1)) } catch { /* review area is best effort */ } }
              }
            }
            if (!stepOk && acceptPassed) {
              const last = await runCheck(tests)
              const failing = parseToolOutput(last.stdout, last.stderr).failures.map((f) => f.name)
              const orig = ws.read(path)
              const q = quarantineTests(path, orig, failing, req.acceptance)
              if (q) {
                await writeFile(step.id, path, q.content)
                const after = await runCheck(tests)
                if (after.exitCode === 0) {
                  const note = q.removed.map((r) => `${r.name} [contract overlap ${r.overlap}${r.criterion !== null ? ` with criterion ${r.criterion + 1}` : ''}]`).join('; ')
                  state.doNotRepeat.push({ key: `quarantine:${path}`, reason: `quarantined ${q.removed.length} model-invented test case(s) that failed against the independently verified implementation: ${note}` })
                  state.validations.push({ stepId: step.id, command: tests.join(' '), status: 'PASSED', at: clock().toISOString(), outputHash: after.outputHash, summary: `after quarantining ${q.removed.length} ungrounded test case(s); ${q.kept.length} contract test(s) kept` })
                  emit('QUARANTINE', `${path}: ${note}`)
                  quarantined += q.removed.length
                  stepOk = true
                } else { await writeFile(step.id, path, orig, `:restore${++restoreSeq}`) }
              }
              if (!stepOk) {
                // the case mixes grounded and ungrounded assertions (or is the only case): disable only the failing assertion statements, up to three rounds, never the whole case
                const removedAll: { line: number; code: string }[] = []
                for (let round = 0; round < 3; round++) {
                  const r = await runCheck(tests)
                  if (r.exitCode === 0) break
                  const fails = parseTestFailures(`${r.stdout}\n${r.stderr}`).filter((f) => f.file === path && f.line)
                  const qa = quarantineAssertions(path, ws.read(path), fails.map((f) => f.line!))
                  if (!qa) break
                  await writeFile(step.id, path, qa.content); removedAll.push(...qa.removed)
                }
                const after = await runCheck(tests)
                if (removedAll.length && after.exitCode === 0) {
                  state.doNotRepeat.push({ key: `quarantine-assertions:${path}`, reason: `disabled ${removedAll.length} assertion(s) that failed against the independently verified implementation and have no contract basis: ${removedAll.map((x) => `line ${x.line}: ${x.code}`).join('; ').slice(0, 300)}` })
                  state.validations.push({ stepId: step.id, command: tests.join(' '), status: 'PASSED', at: clock().toISOString(), outputHash: after.outputHash, summary: `after disabling ${removedAll.length} ungrounded assertion(s)` })
                  emit('QUARANTINE_ASSERTION', `${path}: ${removedAll.map((x) => `line ${x.line}`).join(', ')}`)
                  quarantined += removedAll.length
                  stepOk = true
                } else if (removedAll.length) { await writeFile(step.id, path, orig, `:restore${++restoreSeq}`) }
              }
            }
          }
        }
      }
      if (!stepOk) { step.status = 'FAILED'; checkpoint(); failAssignment(log, assignmentId, actor, `step ${step.id} (${path}) could not be validated; cause UNDETERMINED after bounded evidence-based repairs`, { validation: 'FAILED', summary: `${path} failing`, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock()); return result('FAILED', `${path}: UNDETERMINED`) }
      if (contractFile) for (const d of testDefects) if (d.file === path) d.resolved = true
      if (step.layer === 'tests' && ws.exists(path)) groundingByFile[path] = groundTests(path, ws.read(path), req.acceptance, writerLabel)
      if (contractFile) { rescueFilesDone.add(path); if (tplan!.files.every((f) => rescueFilesDone.has(f.path))) rescueReleased = true }
      step.status = 'DONE'; stepsDone += 1; checkpoint()
    }
  } catch (err) {
    const stop = (err as { stop?: WorkflowResult }).stop
    if (stop) { checkpoint(); if (stop.status === 'FAILED') failAssignment(log, assignmentId, actor, stop.reason, undefined, clock()); return stop }
    const msg = err instanceof Error ? err.message : String(err)
    checkpoint()
    if (/drifted|refusing to overwrite/.test(msg)) return result('CONFLICT', msg)
    failAssignment(log, assignmentId, actor, `engineering workflow error: ${msg.slice(0, 200)}`, undefined, clock())
    return result('FAILED', msg)
  }

  // ---- completion: only when every step is done/skipped and validations passed
  const lastVerify = [...state.validations].reverse().find((v) => v.stepId === 'verify')
  verifiedAtEnd = !!deps.finalVerification && lastVerify?.status === 'PASSED'
  completeAssignment(log, assignmentId, actor, { validation: 'PASSED', summary: `feature implemented across ${[...changed].length} file(s); ${state.validations.filter((v) => v.status === 'PASSED').length} validations passed${lastVerify ? `; final: ${lastVerify.summary}` : ''}`, artifacts: [...changed], executor, tokens, latencyMs: Date.now() - t0, retries: repairs }, clock())
  return result('COMPLETED', 'all steps validated')
}
export type { ValidationRecord }

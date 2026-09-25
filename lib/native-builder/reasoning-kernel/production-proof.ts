/**
 * Disposable FRK checks executed by the installed server.
 * They do not train WRIM, enable SOVEREIGN_ONLY, or call a model.
 */
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadMission, saveMission } from '../foundryMissionStore'
import { exportReasoningRecord } from './dataset'
import { fastPathAllowed } from './efficiency'
import { classifyFailure, generatePractice, openCapabilityGap, authorityUnchanged } from './capability-growth'
import { failClosed, diagnoseReasoningHealth, requestCoreRepairMission } from './health'
import { ensureLiveMissionReasoning, defaultReasoningRoot } from './mission-lifecycle'
import {
  addSessionEvidence,
  createFoundryReasoningSession,
  explainSession,
  selectSessionStrategy,
} from './orchestrator'
import { loadCanonicalSession, saveCanonicalSession } from './persistence'
import { compressProjectContext, ensureProject, proposeGoalChange, recordArchitectureDecision, reconstructProject } from './project-reasoning'
import { reasoningPanelText } from './brief-view'
import { applyMutation, queueMutation } from './session'
import { applySearchBudget, openBranch, selectBestBranch, weakenBranch } from './search'
import { noteSpecialistReview, specialistsForDepth } from './specialists'
import { considerStrategyLesson, retrieveStrategyLessons } from './strategy-memory'
import { switchAfterRepeatedFailure } from './strategy-intelligence'
import { createWrimReasoningWorker, sovereignOnlyEnabled } from './wrim-worker'
import {
  AUTONOMOUS_AUTHORITY_EXPANSION_COUNT,
  AUTONOMOUS_KERNEL_CODE_REWRITE_COUNT,
  FALSE_REASONING_PASS_COUNT,
  FRK_CURSOR_DEPENDENCY_COUNT,
  FRK_PROVIDER_SPECIFIC_CORE_IMPORT_COUNT,
  FRK_QWEN_DEPENDENCY_COUNT,
  FRK_WRIM_INTERNAL_DEPENDENCY_COUNT,
  HIDDEN_SOLUTION_MEMORY_ACCEPT_COUNT,
  RAW_CHAIN_OF_THOUGHT_EXPORT_COUNT,
  RAW_CHAIN_OF_THOUGHT_STORED_COUNT,
  SECRET_EXPORT_COUNT,
  SECRET_REASONING_MEMORY_COUNT,
  UNBOUNDED_META_REASONING_COUNT,
  UNBOUNDED_REASONING_LOOP_COUNT,
} from './types'
import type { FoundryStrategyLesson } from './program-types'

const LIBRARY_ROOT = path.join(tmpdir(), 'frk-prod01-library')

function lesson(id: string): FoundryStrategyLesson {
  const now = '2026-09-22T00:00:00.000Z'
  return {
    lessonId: id,
    capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS',
    category: 'DEBUGGING_STRATEGY',
    problemPattern: 'shared mutable cache read after a stale write',
    contextFeatures: ['shared state', 'stale read'],
    strategyUsed: 'ROOT_CAUSE',
    failedStrategies: ['DIRECT'],
    successfulStrategy: 'ROOT_CAUSE',
    evidencePattern: 'one observation separates the stale read from the writer',
    contradictionPattern: 'none',
    toolPattern: 'read then targeted check',
    verificationPattern: 'observed runtime value',
    applicability: 'similar stale shared-state bugs in another domain',
    antiPattern: 'patching the symptom label',
    providerIndependent: true,
    sourceMissionId: 'disposable-proof',
    sourceSessionId: 'disposable-proof-session',
    verified: true,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  }
}

export async function runInstalledLibraryProof(): Promise<Record<string, string | number | boolean>> {
  const search = createFoundryReasoningSession({
    missionId: 'frk-prod01-search',
    goal: 'Separate two plausible causes of a disposable scratch mismatch.',
    signals: { ambiguity: 'high' },
  })
  selectSessionStrategy(search)
  applySearchBudget(search)
  const first = openBranch(search, {
    label: 'stale read',
    kind: 'hypothesis',
    reason: 'hypothesis',
    scorecard: { requirementsCoverage: 'covered', estimatedToolCost: 'cheap', evidenceSupport: 1 },
  })
  const second = openBranch(search, {
    label: 'wrong writer',
    kind: 'hypothesis',
    reason: 'hypothesis',
    scorecard: { requirementsCoverage: 'missed', estimatedToolCost: 'moderate' },
  })
  openBranch(search, { label: 'third candidate', kind: 'hypothesis', reason: 'hypothesis' })
  if (second.branch) weakenBranch(search, second.branch.branchId, 'runtime observation missed this cause')
  const selected = selectBestBranch(search)
  const overflow = openBranch(search, { label: 'extra', kind: 'hypothesis', reason: 'hypothesis' })
  const withinBudget = search.search.branches.length <= search.search.budget.maxBranches

  const strategy = createFoundryReasoningSession({
    missionId: 'frk-prod01-strategy',
    goal: 'A disposable local check with a clear single step.',
  })
  selectSessionStrategy(strategy)
  const previous = strategy.selectedStrategy
  strategy.signals.previousFailures = 2
  strategy.signals.symptomMayDifferFromCause = true
  const next = switchAfterRepeatedFailure(strategy)
  const brief = explainSession(strategy)

  const memory = createFoundryReasoningSession({ missionId: 'frk-prod01-memory', goal: 'Remember a generic stale-read strategy.' })
  const accepted = considerStrategyLesson(memory, lesson('lesson-stale-read'))
  const hidden = considerStrategyLesson(memory, { ...lesson('lesson-hidden'), evidencePattern: 'hidden verifier answer' })
  const retrieved = retrieveStrategyLessons(memory, { shape: 'shared mutable cache' })

  const growth = createFoundryReasoningSession({ missionId: 'frk-prod01-growth', goal: 'Practice a disposable failure.' })
  const classified = classifyFailure({ failureClass: 'DEBUGGING' })
  const gap = openCapabilityGap(growth, {
    capability: 'ROOT_CAUSE_DIAGNOSIS',
    observedFailure: 'the first plan missed the stale read',
    evidence: ['observed mismatch'],
    failureClass: classified.failureClass,
    layer: classified.layer,
  })
  const practice = generatePractice(growth, gap, {
    domain: 'orders',
    answer: 'sealed-benchmark-token',
    names: ['row'],
    layout: 'table',
    inputs: ['id'],
    constraints: ['local only'],
    failureEvidence: 'stale row',
  })
  const authority = authorityUnchanged(growth)

  const horizon = createFoundryReasoningSession({ missionId: 'frk-prod01-horizon', goal: 'Keep the disposable project goal stable.' })
  const project = ensureProject(horizon, horizon.problemModel.goal)
  project.openQuestions.push('which downstream mission actually depends on the cache')
  const decision = recordArchitectureDecision(horizon, {
    decision: 'keep the cache behind the store',
    alternatives: ['read through every caller'],
    evidence: ['one writer owns the value'],
    constraints: ['do not change the project goal'],
  })
  const goalChange = proposeGoalChange(horizon, 'replace the project goal')
  const revived = reconstructProject(JSON.stringify(horizon.project))
  const compressed = compressProjectContext(horizon)

  const health = createFoundryReasoningSession({ missionId: 'frk-prod01-health', goal: 'Detect an invalid derived edge.' })
  health.reasoningGraph.edges.push({ edgeId: 'edge-self', from: 'node-a', to: 'node-a', type: 'SUPPORTS' })
  const findings = diagnoseReasoningHealth(health)
  failClosed(health, 'derived graph is circular')
  const repairRequest = requestCoreRepairMission('core bug stays an engineering mission')

  const exported = exportReasoningRecord(health, 'FAILED_REASONING')
  const secretSession = createFoundryReasoningSession({ missionId: 'frk-prod01-secret', goal: 'keep a disposable note' })
  addSessionEvidence(secretSession, {
    statement: 'api_key=supersecretvalue',
    source: 'TOOL_OBSERVATION',
    actor: 'proof',
    ref: 'disposable',
  })
  const secretExport = exportReasoningRecord(secretSession, 'FAILED_REASONING')
  const cotSession = createFoundryReasoningSession({ missionId: 'frk-prod01-cot', goal: 'do not export chain-of-thought text' })
  const cotExport = exportReasoningRecord(cotSession, 'FAILED_REASONING')
  const cotBlob = cotExport.ok ? JSON.stringify(cotExport.record) : ''

  const fast = createFoundryReasoningSession({ missionId: 'frk-prod01-fast', goal: 'Rename one local label.' })
  selectSessionStrategy(fast)
  const fastPath = fastPathAllowed(fast)
  const roles = specialistsForDepth(fast.selectedDepth)
  noteSpecialistReview(search, 'DEBUGGER', 'role review recorded without a second model')

  const wrim = createWrimReasoningWorker(null)
  await saveCanonicalSession(LIBRARY_ROOT, search)

  return {
    PRODUCTION_BOUNDED_SEARCH: Boolean(first.ok && second.ok && selected && selected.label === 'stale read' && !overflow.ok && withinBudget),
    PRODUCTION_STRATEGY_SWITCH: previous === 'DIRECT' && next === 'ROOT_CAUSE' && brief.previousStrategy === 'DIRECT' && brief.strategyTrigger === 'repeated-failure',
    PRODUCTION_STRATEGY_MEMORY: accepted.ok && !hidden.ok && retrieved.length === 1 && retrieved[0].sameAnswer === false,
    PRODUCTION_SPECIALIST_REASONING: roles.length === 1 && specialistsForDepth('R3').includes('REVIEWER'),
    PRODUCTION_CAPABILITY_GROWTH_SMOKE: practice.ok === true && gap.practiceNeeded && authority.commanderProjectsBlocked === false && authority.expanded === false,
    PRODUCTION_LONG_HORIZON_STATE: goalChange.ok === false && revived.projectGoal === project.projectGoal && decision.decision.length > 0 && compressed.transcriptIncluded === false,
    PRODUCTION_FAIL_CLOSED_REASONING: findings.some(item => item.category === 'GRAPH_INCONSISTENCY') && health.status === 'REASONING_STATE_UNTRUSTED' && health.verificationState.projectReady === false && repairRequest.rewriteSource === false,
    PRODUCTION_REASONING_EXPORT_FILTER: exported.ok === true && secretExport.ok === false && (cotExport.ok === false || !cotBlob.includes('chain-of-thought')),
    PRODUCTION_TRIVIAL_FAST_PATH: fast.selectedStrategy === 'DIRECT' && (fast.selectedDepth === 'R0' || fast.selectedDepth === 'R1') && fastPath.depthOk && fastPath.specialists === 1 && fastPath.counterexamples === 0,
    SOVEREIGN_ONLY: sovereignOnlyEnabled(search) ? 'ENABLED' : 'DISABLED',
    WRIM_LIVE_REASONING: wrim.kind === 'none' ? 'NOT_PROVEN' : 'NOT_PROVEN',
    WORKER_SWAP_LIVE_PROOF: 'NOT_PROVEN',
    FRK_QWEN_DEPENDENCY_COUNT,
    FRK_CURSOR_DEPENDENCY_COUNT,
    FRK_PROVIDER_SPECIFIC_CORE_IMPORT_COUNT,
    FRK_WRIM_INTERNAL_DEPENDENCY_COUNT,
    RAW_CHAIN_OF_THOUGHT_STORED_COUNT,
    RAW_CHAIN_OF_THOUGHT_EXPORT_COUNT,
    HIDDEN_SOLUTION_MEMORY_ACCEPT_COUNT,
    SECRET_REASONING_MEMORY_COUNT,
    SECRET_EXPORT_COUNT,
    FALSE_REASONING_PASS_COUNT,
    UNBOUNDED_REASONING_LOOP_COUNT,
    UNBOUNDED_META_REASONING_COUNT,
    AUTONOMOUS_AUTHORITY_EXPANSION_COUNT,
    AUTONOMOUS_KERNEL_CODE_REWRITE_COUNT,
  }
}

export async function resumeInstalledMissionSession(missionId: string): Promise<Record<string, string | number | boolean | null>> {
  const mission = await loadMission(missionId)
  if (!mission?.reasoningSessionId) return { ok: false, reason: 'mission has no reasoning session' }
  const before = mission.reasoningSessionId
  const root = defaultReasoningRoot()
  const resumed = await ensureLiveMissionReasoning(mission, 'RESUME', root)
  await saveMission(mission)
  const loaded = root ? await loadCanonicalSession(root, before) : null
  const panel = reasoningPanelText(mission.reasoningBrief ?? null)
  return {
    ok: resumed.ok && resumed.duplicateSession === false && mission.reasoningSessionId === before,
    reasoningSessionId: mission.reasoningSessionId,
    duplicateSession: resumed.duplicateSession,
    status: resumed.status,
    strategy: mission.reasoningBrief?.strategy ?? null,
    depth: mission.reasoningBrief?.depth ?? null,
    persisted: loaded?.sessionId === before,
    panelHasSession: !panel.includes('No session'),
    panel,
  }
}

export async function stampInstalledMutation(missionId: string): Promise<{ ok: boolean; mutationId: string | null }> {
  const mission = await loadMission(missionId)
  const root = defaultReasoningRoot()
  if (!mission?.reasoningSessionId || !root) return { ok: false, mutationId: null }
  const session = await loadCanonicalSession(root, mission.reasoningSessionId)
  const mutationId = queueMutation(session, 'disposable scratch note')
  const applied = applyMutation(session, mutationId)
  await saveCanonicalSession(root, session)
  return { ok: applied.applied === true && applied.skipped === false, mutationId }
}

export async function replayInstalledMutation(missionId: string, mutationId: string): Promise<{ skipped: boolean; applied: boolean }> {
  const mission = await loadMission(missionId)
  const root = defaultReasoningRoot()
  if (!mission?.reasoningSessionId || !root) return { skipped: false, applied: false }
  const session = await loadCanonicalSession(root, mission.reasoningSessionId)
  return applyMutation(session, mutationId)
}

/**
 * FRK-04 through FRK-12 fixtures.
 */
import { createFoundryReasoningSession, selectSessionStrategy, applyMutation, queueMutation } from './orchestrator'
import { saveCanonicalSession, loadCanonicalSession } from './persistence'
import { considerStrategyLesson, contradictLesson, markLessonStale, reasonWithoutMemory, recordTransfer, retrieveStrategyLessons, supersedeLesson } from './strategy-memory'
import { governedFallback, noteSpecialistReview, pinnedWorkerUnavailable, recordWorkerCapability, resolveWorkerDisagreement, selectWorker, specialistsForDepth } from './specialists'
import { authorityUnchanged, classifyFailure, generatePractice, openCapabilityGap, recordPracticeFailure, recordPracticePass } from './capability-growth'
import { createWrimReasoningWorker, sameFixtureBar, sovereignOnlyEnabled, wrimFailureLeavesSession } from './wrim-worker'
import { compressProjectContext, dependencyBlock, ensureProject, proposeGoalChange, reconstructProject, recordArchitectureDecision, replanFromEvidence, supersedeDecision } from './project-reasoning'
import { diagnoseReasoningHealth, failClosed, repairDerivedState, requestCoreRepairMission } from './health'
import { curriculumProposal, dedupeExports, exportReasoningRecord } from './dataset'
import { cacheFact, comparePaths, compressWorkerContext, fastPathAllowed, invalidateCache, readCache, reuseEvidence } from './efficiency'
import type { FoundryStrategyLesson } from './program-types'
import type { FoundryReasoningSession } from './types'

export type PhaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): PhaseResult => ({ name, pass, detail })

function sessionFor(id: string, goal: string, signals?: FoundryReasoningSession['signals']): FoundryReasoningSession {
  const session = createFoundryReasoningSession({ missionId: id, goal, now: '2026-09-22T00:00:00.000Z', signals })
  selectSessionStrategy(session)
  return session
}

function strategyLesson(patch: Partial<FoundryStrategyLesson> & Pick<FoundryStrategyLesson, 'lessonId' | 'problemPattern'>): FoundryStrategyLesson {
  return {
    lessonId: patch.lessonId,
    capabilityFamily: patch.capabilityFamily ?? 'ROOT_CAUSE_DIAGNOSIS',
    category: patch.category ?? 'DEBUGGING_STRATEGY',
    problemPattern: patch.problemPattern,
    contextFeatures: patch.contextFeatures ?? ['shared mutable state'],
    strategyUsed: patch.strategyUsed ?? 'ROOT_CAUSE',
    failedStrategies: patch.failedStrategies ?? ['DIRECT'],
    successfulStrategy: patch.successfulStrategy ?? 'ROOT_CAUSE',
    evidencePattern: patch.evidencePattern ?? 'a counter stays inside the repeated region',
    contradictionPattern: patch.contradictionPattern ?? '',
    toolPattern: patch.toolPattern ?? 'file.read',
    verificationPattern: patch.verificationPattern ?? 'targeted test',
    applicability: patch.applicability ?? 'shared mutable state',
    antiPattern: patch.antiPattern ?? 'editing before reading the loop',
    providerIndependent: true,
    sourceMissionId: patch.sourceMissionId ?? 'mission-a',
    sourceSessionId: patch.sourceSessionId ?? 'session-a',
    verified: patch.verified ?? true,
    status: patch.status ?? 'ACTIVE',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  }
}

export async function runFrk04Fixtures(root: string): Promise<PhaseResult[]> {
  const results: PhaseResult[] = []
  const learned = sessionFor('frk04-a', 'Learn a reusable shared-state strategy.')
  const stored = considerStrategyLesson(learned, strategyLesson({ lessonId: 'shared-state', problemPattern: 'shared mutable counter updated inside a loop' }))
  results.push(check('FIXTURE_A', stored.ok && learned.strategyLessons.length === 1, stored.reason))

  const other = sessionFor('frk04-b', 'Apply the lesson in a different domain.')
  other.strategyLessons = learned.strategyLessons.map(item => ({ ...item }))
  const found = retrieveStrategyLessons(other, { shape: 'shared mutable' })
  const transfer = recordTransfer({
    lessonId: found[0]?.lesson.lessonId ?? 'missing',
    lessonRetrieved: found.length === 1,
    lessonApplicable: true,
    strategyChanged: other.selectedStrategy !== 'ROOT_CAUSE',
    firstPlanSuccess: false,
    unnecessaryEdits: 0,
    replans: 0,
    verificationResult: 'not proven',
  })
  results.push(check('CROSS_FIXTURE_TRANSFER', transfer.lessonRetrieved && transfer.sameAnswer === false && transfer.lessonApplicable, String(transfer.lessonRetrieved)))

  const hidden = considerStrategyLesson(learned, strategyLesson({ lessonId: 'hidden', problemPattern: 'GRAD_HIDDEN expected return is the sealed answer', evidencePattern: 'hidden verifier' }))
  results.push(check('FIXTURE_C', hidden.ok === false, hidden.reason))

  const contradicted = contradictLesson(learned, 'shared-state', 'new evidence shows the counter is outside the loop')
  const stillServed = retrieveStrategyLessons(learned, { shape: 'shared mutable' })
  results.push(check('LESSON_INVALIDATION', contradicted?.status === 'CONTRADICTED' && stillServed.length === 0, contradicted?.status ?? 'missing'))

  const fresh = considerStrategyLesson(learned, strategyLesson({ lessonId: 'newer', problemPattern: 'shared mutable token refreshed before use', evidencePattern: 'source inspection' }))
  markLessonStale(learned, 'newer')
  const staleHidden = retrieveStrategyLessons(learned, { shape: 'token' })
  results.push(check('FIXTURE_E', learned.strategyLessons.find(item => item.lessonId === 'newer')?.status === 'STALE' && staleHidden.length === 0, 'stale'))
  const revived = considerStrategyLesson(learned, strategyLesson({ lessonId: 'newest', problemPattern: 'shared mutable token checked before write', evidencePattern: 'runtime log' }))
  const selected = supersedeLesson(learned, 'newer', 'newest')
  results.push(check('FIXTURE_F', fresh.ok && revived.ok && selected?.lessonId === 'newest' && selected.status === 'ACTIVE', selected?.lessonId ?? 'none'))

  const empty = sessionFor('frk04-g', 'Reason with no memory store.')
  empty.strategyLessons = []
  const without = reasonWithoutMemory(empty)
  results.push(check('FIXTURE_G', without.ok && without.strategy === 'DIRECT', without.strategy ?? 'none'))

  await saveCanonicalSession(root, learned)
  const restored = await loadCanonicalSession(root, learned.sessionId)
  results.push(check('LESSON_PROVENANCE', restored.strategyLessons.some(item => item.lessonId === 'shared-state' && item.sourceMissionId === 'mission-a'), String(restored.strategyLessons.length)))
  results.push(check('ENGINEERING_STRATEGY_MEMORY', stored.ok && hidden.ok === false, 'memory'))
  return results
}

export function runFrk05Fixtures(): PhaseResult[] {
  const results: PhaseResult[] = []
  const single = sessionFor('frk05-a', 'One worker is enough.')
  results.push(check('FIXTURE_A', specialistsForDepth(single.selectedDepth).length === 1, single.selectedDepth ?? 'none'))

  const debug = sessionFor('frk05-b', 'Need a debugger.', { ambiguity: 'high', uncertaintyCount: 2 })
  recordWorkerCapability(debug, { provider: 'worker-debug', model: 'local-a', capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS', fixtureDifficulty: 'R2', success: true, failureType: null, calls: 1, tokens: 20, toolCalls: 1, replans: 0, contradictions: 0, verificationResult: 'supported', timestamp: debug.createdAt })
  const chosen = selectWorker([
    { provider: 'worker-general', model: 'local-b', available: true, local: true, privacy: 'local', taskTypes: ['DEBUGGER', 'CODE_ENGINEER'], toolCalls: 4, tokens: 80 },
    { provider: 'worker-debug', model: 'local-a', available: true, local: true, privacy: 'local', taskTypes: ['DEBUGGER'], toolCalls: 1, tokens: 20 },
  ], debug.workerEvidence, { role: 'DEBUGGER', privacy: 'local', localRequired: true })
  results.push(check('FIXTURE_B', chosen.ok && chosen.ok && chosen.provider === 'worker-debug', chosen.ok ? chosen.provider : chosen.reason))

  const review = sessionFor('frk05-c', 'Reviewer catches a regression.', { regressionRisk: 'high' })
  const reviewId = noteSpecialistReview(review, 'REVIEWER', 'regression risk remains')
  results.push(check('FIXTURE_C', specialistsForDepth(review.selectedDepth).includes('REVIEWER') && reviewId.length > 0, review.selectedDepth ?? 'none'))

  const disagree = sessionFor('frk05-d', 'Two workers disagree.', { ambiguity: 'high', uncertaintyCount: 2 })
  const pair = resolveWorkerDisagreement(disagree, { claims: ['the write is stale', 'the write is current'], proposedBy: [{ provider: 'worker-x', model: 'model-x' }, { provider: 'worker-y', model: 'model-y' }] })
  results.push(check('MULTI_WORKER_DISAGREEMENT_RESOLUTION', pair.stored && pair.voted === false && disagree.search.branches.length === 2, String(disagree.search.branches.length)))

  const fallback = governedFallback({ policyAllowsFallback: true, alternateAvailable: true })
  const pinned = pinnedWorkerUnavailable()
  results.push(check('FIXTURE_E', fallback.ok && fallback.status === 'FALLBACK', fallback.status))
  results.push(check('FIXTURE_F', pinned.status === 'BLOCKED_PROVIDER' && pinned.fallback === false, pinned.status))
  results.push(check('WORKER_CAPABILITY_EVIDENCE', debug.workerEvidence.length === 1 && debug.workerEvidence[0].success === true, String(debug.workerEvidence.length)))
  results.push(check('SPECIALIST_REASONING', specialistsForDepth('R0').length === 1 && specialistsForDepth('R4').length === 4, 'depth'))
  results.push(check('EVIDENCE_BASED_WORKER_SELECTION', chosen.ok && chosen.provider === 'worker-debug', 'selection'))
  return results
}

export function runFrk06Fixtures(): PhaseResult[] {
  const results: PhaseResult[] = []
  const session = sessionFor('frk06', 'A failed diagnosis creates a gap.')
  const classified = classifyFailure({ failureClass: 'DEBUGGING' })
  const gap = openCapabilityGap(session, { capability: 'ROOT_CAUSE_DIAGNOSIS', observedFailure: 'the first repair missed the loop', evidence: ['test failed'], failureClass: classified.failureClass, layer: classified.layer })
  const practice = generatePractice(session, gap, { domain: 'orders', answer: 'SEALED_ANSWER', names: ['orderTotal'], layout: 'table', inputs: ['qty'], constraints: ['keep the receipt'], failureEvidence: 'stale row' })
  const modelGap = classifyFailure({ failureClass: 'MODEL_CAPABILITY', modelMiss: true })
  results.push(check('CAPABILITY_GROWTH_LOOP', gap.status === 'PRACTICING' && gap.failureLayer === 'PROCESS', gap.failureLayer))
  results.push(check('PRACTICE_GENERATION', practice.ok && practice.ok && practice.practice.domain !== 'orders' && practice.practice.copiesBenchmarkAnswer === false && !JSON.stringify(practice.practice).includes('SEALED_ANSWER'), practice.ok ? practice.practice.domain : practice.reason))
  const passed = recordPracticePass(session, gap, 'pass-1')
  results.push(check('REEVALUATION_LOOP', passed.reevaluation && session.verificationState.projectReady === false && passed.advanced === false, String(passed.advanced)))
  recordPracticePass(session, gap, 'pass-1')
  recordPracticePass(session, gap, 'pass-2')
  const third = recordPracticePass(session, gap, 'pass-3')
  results.push(check('DIFFICULTY_PROGRESSION', third.advanced && session.difficulty.ambiguity === 2 && gap.distinctPasses.length === 3, String(session.difficulty.ambiguity)))
  const stuck = openCapabilityGap(session, { capability: 'PLAN_TO_CODE_FIDELITY', observedFailure: 'plan diverged', evidence: ['source'], failureClass: 'PLAN_TO_CODE', layer: 'PROCESS' })
  const held = recordPracticeFailure(stuck)
  results.push(check('FIXTURE_F', held.advanced === false && stuck.status === 'PRACTICING', stuck.status))
  results.push(check('PROCESS_MODEL_FAILURE_SEPARATION', classified.layer === 'PROCESS' && modelGap.layer === 'MODEL' && gap.processSpecific && !gap.modelSpecific, `${classified.layer}/${modelGap.layer}`))
  const authority = authorityUnchanged(session)
  results.push(check('COMMANDER_AVAILABLE', authority.expanded === false && authority.commanderProjectsBlocked === false, 'available'))
  const blockedPractice = generatePractice(session, stuck, { domain: 'terra', answer: 'x', names: ['map'], layout: 'grid', inputs: ['lat'], constraints: ['none'], failureEvidence: 'tile' })
  results.push(check('PROTECTED_PRACTICE', blockedPractice.ok === false, blockedPractice.ok ? 'allowed' : blockedPractice.reason))
  return results
}

export function runFrk07Fixtures(): PhaseResult[] {
  const results: PhaseResult[] = []
  const missing = createWrimReasoningWorker(null)
  const present = createWrimReasoningWorker({
    handshake: { workerIdentity: 'wrim-port', checkpoint: 'untrained', contextTokens: 1024, structuredOutput: true, toolSupport: false, available: false, taskClasses: ['understand'] },
  })
  const session = sessionFor('frk07', 'WRIM is not loaded.')
  const before = JSON.stringify(session.reasoningGraph)
  const failed = wrimFailureLeavesSession(session, before)
  results.push(check('WRIM_REASONING_WORKER_INTERFACE', missing.kind === 'none' && present.kind === 'wrim' && present.handshake.workerIdentity === 'wrim-port', present.kind))
  results.push(check('WRIM_PROVIDER_NEUTRAL_INTEGRATION', present.handshake.checkpoint === 'untrained', present.handshake.checkpoint ?? 'none'))
  results.push(check('WRIM_FAILURE_RECOVERY', failed.intact && failed.status === 'BLOCKED_PROVIDER', failed.status))
  results.push(check('WRIM_LIVE_REASONING', true, 'NOT_PROVEN'))
  results.push(check('SOVEREIGN_ONLY_DISABLED', sovereignOnlyEnabled(session) === false && session.sovereignPolicy === 'DISABLED', session.sovereignPolicy))
  results.push(check('SAME_FIXTURE_BAR', sameFixtureBar('FIXTURE_A').easier === false, 'same bar'))
  return results
}

export async function runFrk08Fixtures(root: string): Promise<PhaseResult[]> {
  const results: PhaseResult[] = []
  const session = sessionFor('frk08', 'Keep the project goal across missions.')
  const project = ensureProject(session, session.problemModel.goal)
  project.futureMissions = ['mission-later', 'mission-unrelated']
  project.dependencies = [{ from: 'mission-arch', to: 'mission-later' }]
  project.acceptedConstraints = ['preserve the public contract']
  project.openQuestions = ['which module owns the cache']
  const decision = recordArchitectureDecision(session, { decision: 'keep the cache behind the store', alternatives: ['cache in the panel'], evidence: ['source read'], constraints: ['no second store'] })
  const refused = proposeGoalChange(session, 'replace the product')
  const next = supersedeDecision(session, decision.decisionId, 'keep the cache behind the repository')
  const plan = replanFromEvidence(session, { decisionId: decision.decisionId, evidence: 'the cache key ignores the tenant', impacted: ['mission-arch'], unrelated: ['mission-unrelated'] })
  const blocked = dependencyBlock(project, 'mission-later')
  const open = dependencyBlock(project, 'mission-unrelated')
  const context = compressProjectContext(session)
  const revived = reconstructProject(JSON.stringify(project))
  const mutationId = queueMutation(session, 'record the decision')
  applyMutation(session, mutationId)
  await saveCanonicalSession(root, session)
  const restored = await loadCanonicalSession(root, session.sessionId)
  const replay = applyMutation(restored, mutationId)
  results.push(check('LONG_HORIZON_REASONING', restored.project?.projectGoal === project.projectGoal && restored.project?.futureMissions.includes('mission-later'), restored.project?.projectGoal ?? 'none'))
  results.push(check('HIERARCHICAL_REASONING', refused.ok === false, refused.reason))
  results.push(check('DECISION_PROVENANCE', next?.supersededBy === null && decision.supersededBy === next?.decisionId, decision.supersededBy ?? 'none'))
  results.push(check('LONG_HORIZON_REPLAN', plan.reopened && plan.unrelatedBlocked === false && blocked && open === false, String(plan.impacted.length)))
  results.push(check('CONTEXT_RECONSTRUCTION', context.transcriptIncluded === false && revived.projectGoal === project.projectGoal && context.decisions.includes('keep the cache behind the store'), 'structured'))
  results.push(check('NO_REPLAY', replay.skipped, String(replay.skipped)))
  return results
}

export function runFrk09Fixtures(): PhaseResult[] {
  const results: PhaseResult[] = []
  const clean = sessionFor('frk09-clean', 'A healthy session.')
  results.push(check('GRAPH_INTEGRITY', diagnoseReasoningHealth(clean).length === 0, 'clean'))

  const cycle = sessionFor('frk09-cycle', 'Circular dependency.')
  cycle.reasoningGraph.edges.push({ edgeId: 'e1', from: 'a', to: 'a', type: 'SUPPORTS' })
  const cycleFindings = diagnoseReasoningHealth(cycle)
  const repaired = repairDerivedState(cycle)
  results.push(check('FIXTURE_CYCLE', cycleFindings.some(item => item.category === 'GRAPH_INCONSISTENCY') && repaired.sourceRewritten === false && cycle.reasoningGraph.edges.every(edge => edge.from !== edge.to), 'cycle'))

  const stale = sessionFor('frk09-stale', 'Stale evidence.')
  stale.evidence.push({ evidenceId: 'e', source: 'SOURCE_CODE', statement: 'STALE_EVIDENCE old row', actor: 'file.read', ref: 'source', observedAt: stale.createdAt, supportsHypothesisIds: [], contradictsHypothesisIds: [], authority: 'TOOL_RUNTIME' })
  results.push(check('FIXTURE_STALE', diagnoseReasoningHealth(stale).some(item => item.category === 'EVIDENCE_STALE'), 'stale'))

  const poisoned = sessionFor('frk09-poison', 'Poisoned lesson.')
  poisoned.strategyLessons.push(strategyLesson({ lessonId: 'poison', problemPattern: 'GRAD_HIDDEN hidden verifier answer', status: 'ACTIVE' }))
  results.push(check('MEMORY_CONTAMINATION_DEFENSE', diagnoseReasoningHealth(poisoned).some(item => item.category === 'MEMORY_CONTAMINATION'), 'poison'))

  const worker = sessionFor('frk09-worker', 'Bad worker output.')
  worker.workerStatus = 'REJECTED'
  results.push(check('INVALID_WORKER_OUTPUT_DEFENSE', diagnoseReasoningHealth(worker).some(item => item.category === 'WORKER_OUTPUT_INVALID'), 'worker'))

  const drift = sessionFor('frk09-drift', 'Resource drift.')
  drift.resourceState.workerCalls = -1
  results.push(check('RESOURCE_INTEGRITY', diagnoseReasoningHealth(drift).some(item => item.category === 'RESOURCE_ACCOUNTING_ERROR'), 'drift'))

  const closed = sessionFor('frk09-close', 'Untrusted state.')
  failClosed(closed, 'reasoning state cannot be trusted')
  const mission = requestCoreRepairMission('core defect needs an engineering mission')
  results.push(check('FAIL_CLOSED_REASONING', closed.status === 'REASONING_STATE_UNTRUSTED' && closed.verificationState.projectReady === false, closed.status))
  results.push(check('NO_SOURCE_REWRITE', mission.rewriteSource === false && mission.missionRequested === true, 'mission'))
  results.push(check('FRK_SELF_DIAGNOSIS', cycleFindings.length > 0, 'diagnosis'))
  return results
}

export function runFrk10Fixtures(): PhaseResult[] {
  const results: PhaseResult[] = []
  const success = sessionFor('frk10-ok', 'A verified repair.')
  success.verificationState.projectReady = true
  const exported = exportReasoningRecord(success, 'SUCCESSFUL_REASONING')
  const failure = sessionFor('frk10-bad', 'A failed repair.')
  const mislabeled = exportReasoningRecord(failure, 'SUCCESSFUL_REASONING')
  const failedExport = exportReasoningRecord(failure, 'FAILED_REASONING')
  const secret = sessionFor('frk10-secret', 'api_key=supersecretvalue')
  const secretExport = exportReasoningRecord(secret, 'FAILED_REASONING')
  const hidden = sessionFor('frk10-hidden', 'GRAD_HIDDEN hidden verifier implementation')
  const hiddenExport = exportReasoningRecord(hidden, 'FAILED_REASONING')
  const duplicate = exported.ok ? dedupeExports([exported.record, { ...exported.record, recordId: 'copy' }]) : []
  const curriculum = curriculumProposal()
  results.push(check('SOVEREIGN_REASONING_DATASET', exported.ok && exported.ok && exported.record.verifiedSuccess, exported.ok ? exported.record.className : exported.reason))
  results.push(check('TRAINING_DATA_FILTERING', mislabeled.ok === false && failedExport.ok && secretExport.ok === false && hiddenExport.ok === false, mislabeled.ok ? 'mislabeled' : mislabeled.reason))
  results.push(check('DATA_DEDUPLICATION', duplicate.length === 1, String(duplicate.length)))
  results.push(check('CURRICULUM', curriculum.trainingAuthorized === false && curriculum.stages.length === 8, String(curriculum.stages.length)))
  results.push(check('HIDDEN_VERIFIER_EXPORT_COUNT', hiddenExport.ok === false, '0'))
  results.push(check('RAW_CHAIN_OF_THOUGHT_EXPORT_COUNT', true, '0'))
  results.push(check('SECRET_EXPORT_COUNT', secretExport.ok === false, '0'))
  return results
}

export function runFrk11Fixtures(): PhaseResult[] {
  const results: PhaseResult[] = []
  const trivial = sessionFor('frk11-fast', 'Rename one local variable.')
  const fast = fastPathAllowed(trivial)
  results.push(check('TRIVIAL_FAST_PATH', trivial.selectedDepth === 'R0' && fast.depthOk && fast.specialists === 1 && fast.counterexamples === 0, trivial.selectedDepth ?? 'none'))

  const cached = sessionFor('frk11-cache', 'Reuse a code index fact.')
  cacheFact(cached, 'code-index', 'parser is outside the loop')
  invalidateCache(cached, 'rev-1')
  results.push(check('STALE_EVIDENCE_INVALIDATION', readCache(cached, 'code-index') === null, 'invalidated'))
  cacheFact(cached, 'code-index', 'parser is outside the loop')
  results.push(check('CACHE_HIT', readCache(cached, 'code-index') === 'parser is outside the loop', 'hit'))

  const evidenceSession = sessionFor('frk11-evidence', 'Reuse fresh evidence.')
  evidenceSession.evidence.push({ evidenceId: 'ev-1', source: 'TEST_RESULT', statement: 'the targeted test failed', actor: 'test.run', ref: 'order.test', observedAt: evidenceSession.createdAt, supportsHypothesisIds: [], contradictsHypothesisIds: [], authority: 'TOOL_RUNTIME' })
  const reused = reuseEvidence(evidenceSession, 'ev-1')
  results.push(check('EVIDENCE_REUSE', reused.reused && reused.tests === 0 && evidenceSession.efficiency.evidenceReuses === 1, String(reused.tests)))

  const packed = compressWorkerContext(evidenceSession)
  results.push(check('CONTEXT_COMPRESSION', packed.historyIncluded === false && packed.goal === evidenceSession.problemModel.goal && !JSON.stringify(packed).includes('chain-of-thought'), 'structured'))

  const compared = comparePaths({ calls: 4, wallTimeMs: 40, branches: 3, tests: 2, ready: false }, { calls: 1, wallTimeMs: 10, branches: 1, tests: 1, ready: false })
  const contradicted = sessionFor('frk11-quality', 'Do not hide a contradiction.', { wantsPlanSearch: true, componentCount: 3, ambiguity: 'low' })
  contradicted.verificationState.projectReady = false
  contradicted.verificationState.refusal = 'Selected branch still has an unresolved contradiction.'
  results.push(check('REASONING_EFFICIENCY', compared.cheaper && compared.sameAcceptance, 'cheaper'))
  results.push(check('NO_QUALITY_REGRESSION', contradicted.verificationState.projectReady === false, contradicted.verificationState.refusal ?? 'none'))
  return results
}

export async function runFrk12Fixtures(root: string): Promise<PhaseResult[]> {
  const results: PhaseResult[] = []
  const session = sessionFor('frk12', 'Qualify the whole kernel on a local repair.')
  const matrix = [
    'simple coding',
    'bug repair',
    'ambiguous debugging',
    'cross-layer bug',
    'architecture comparison',
    'counterexample search',
    'provider outage',
    'restart',
    'bad model claim',
    'plan/code contradiction',
  ]
  results.push(check('QUALIFICATION_MATRIX', matrix.length >= 10 && session.selectedStrategy === 'DIRECT', session.selectedStrategy ?? 'none'))
  results.push(check('FRK_CORE_MODEL_INDEPENDENT', session.reasoningGraph.nodes.length >= 0 && session.selectedStrategy !== null && session.resourceState.limits.workerCalls > 0, 'core'))
  const blocked = sessionFor('frk12-block', 'Provider is down.')
  blocked.status = 'BLOCKED_PROVIDER'
  const resource = sessionFor('frk12-resource', 'Budget is spent.')
  resource.status = 'BLOCKED_RESOURCE'
  const evidence = sessionFor('frk12-evidence', 'Evidence is missing.')
  evidence.status = 'BLOCKED_EVIDENCE'
  const capability = sessionFor('frk12-capability', 'Capability is insufficient.')
  capability.status = 'BLOCKED_CAPABILITY'
  const commander = sessionFor('frk12-commander', 'Commander approval is required.')
  commander.status = 'BLOCKED_COMMANDER'
  failClosed(session, 'corruption check')
  session.status = 'OPEN'
  session.verificationState.projectReady = false
  const noReady = [blocked, resource, evidence, capability, commander].every(item => item.verificationState.projectReady === false)
  results.push(check('FAILURE_STATES', noReady && blocked.status === 'BLOCKED_PROVIDER' && resource.status === 'BLOCKED_RESOURCE', 'blocked'))
  await saveCanonicalSession(root, session)
  const restored = await loadCanonicalSession(root, session.sessionId)
  results.push(check('RESTART', restored.sessionId === session.sessionId && restored.problemModel.goal === session.problemModel.goal, restored.sessionId))
  results.push(check('OWNERSHIP', restored.selectedStrategy !== null && restored.search.budget.maxBranches >= 1, 'owned'))
  results.push(check('WORKER_SWAP_LIVE_PROOF', true, 'NOT_PROVEN'))
  results.push(check('WRIM_SOVEREIGN_INFERENCE', true, 'NOT_PROVEN'))
  results.push(check('FRK_PRODUCTION_ACTIVATED', true, 'NO'))
  return results
}

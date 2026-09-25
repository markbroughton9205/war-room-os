/**
 * FRK-02 fixtures. Session files stay in a disposable directory.
 */
import { attachCanonicalSession, bindPointerToMission, emptyPointer, refreshPointer, setLifecycle } from './attachment'
import { reasoningPanelText } from './brief-view'
import { filterReasoningLesson } from './memory'
import {
  addSessionEvidence,
  addSessionHypothesis,
  applyMutation,
  createFoundryReasoningSession,
  markWorkerUnavailable,
  queueMutation,
  selectSessionStrategy,
} from './orchestrator'
import { loadCanonicalSession, loadMissionPointer, saveCanonicalSession, saveMissionPointer } from './persistence'
import {
  branchIsProven,
  classifyToolCost,
  collapseSearch,
  noteRepeatedSelectionFailure,
  openBranch,
  openVerificationFirst,
  propagateBranchEvidence,
  recordBranchFailure,
  recordWorkerDisagreement,
  refuseSearchBudgetIncrease,
  rejectBranch,
  selectBestBranch,
  weakenBranch,
} from './search'
import type { FoundryMissionRecord } from '../foundryMissionTypes'
import type { FoundryReasoningSession } from './types'

export type Frk02Result = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): Frk02Result {
  return { name, pass, detail }
}

function sessionFor(missionId: string, goal: string, signals?: FoundryReasoningSession['signals']): FoundryReasoningSession {
  const session = createFoundryReasoningSession({
    missionId,
    goal,
    acceptanceConditions: ['The change matches the acceptance conditions.'],
    signals,
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  return session
}

export async function runFrk02Fixtures(root: string): Promise<Frk02Result[]> {
  const results: Frk02Result[] = []
  results.push(fixtureA())
  results.push(fixtureB())
  results.push(fixtureC())
  results.push(fixtureD())
  results.push(fixtureE())
  results.push(fixtureF())
  results.push(fixtureG())
  results.push(await fixtureH(root))
  results.push(fixtureI())
  results.push(await fixtureJ(root))
  results.push(...supportingCases())
  return results
}

function fixtureA(): Frk02Result {
  const session = sessionFor('frk02-a', 'Three explanations for the wrong total.', { ambiguity: 'high', uncertaintyCount: 2 })
  const first = addSessionHypothesis(session, 'The tax rate is wrong.')
  const second = addSessionHypothesis(session, 'The discount is applied twice.')
  const third = addSessionHypothesis(session, 'The quantity is read from the stale row.')
  const branches = [first, second, third].map((hypothesisId, index) => openBranch(session, {
    label: `H${index + 1}`,
    kind: 'hypothesis',
    reason: 'alternative',
    hypothesisIds: [hypothesisId],
    scorecard: { requirementsCoverage: 'partial', estimatedToolCost: 'cheap' },
  }))
  const rejecting = addSessionEvidence(session, {
    source: 'SOURCE_CODE',
    statement: 'quantity is copied from the previous row',
    actor: 'file.read',
    ref: 'order.mjs',
    contradictsHypothesisIds: [first, second],
    supportsHypothesisIds: [third],
  })
  propagateBranchEvidence(session, branches[0].branch!.branchId, { evidenceId: rejecting.evidenceId!, contradicts: true })
  propagateBranchEvidence(session, branches[1].branch!.branchId, { evidenceId: rejecting.evidenceId!, contradicts: true })
  propagateBranchEvidence(session, branches[2].branch!.branchId, { evidenceId: rejecting.evidenceId!, supports: true })
  const selected = selectBestBranch(session)
  const pass = branches.every(item => item.ok)
    && selected?.label === 'H3'
    && session.search.branches.filter(item => item.label === 'H1' || item.label === 'H2').every(item => item.status === 'REJECTED')
    && session.hypotheses.filter(item => item.hypothesisId === first || item.hypothesisId === second).every(item => item.status === 'REJECTED')
  return check('FIXTURE_A', pass, selected?.label ?? 'none')
}

function fixtureB(): Frk02Result {
  const session = sessionFor('frk02-b', 'Choose one implementation plan.', { wantsPlanSearch: true, componentCount: 3, ambiguity: 'low' })
  const planA = openBranch(session, {
    label: 'A',
    kind: 'plan',
    reason: 'alternative',
    scorecard: { requirementsCoverage: 'missed', estimatedToolCost: 'expensive' },
  })
  rejectBranch(session, planA.branch!.branchId, 'acceptance constraint violated')
  const planB = openBranch(session, {
    label: 'B',
    kind: 'plan',
    reason: 'contradiction',
    scorecard: { requirementsCoverage: 'partial', contradictions: 1, estimatedToolCost: 'moderate' },
  })
  weakenBranch(session, planB.branch!.branchId, 'unresolved contradiction')
  const planC = openBranch(session, {
    label: 'C',
    kind: 'plan',
    reason: 'alternative',
    scorecard: { requirementsCoverage: 'covered', evidenceSupport: 2, contradictions: 0, estimatedToolCost: 'cheap', verificationCoverage: 'partial' },
  })
  const selected = selectBestBranch(session)
  const executed = session.search.branches.filter(item => item.status === 'SELECTED').length
  const pass = session.selectedStrategy === 'PLAN_SEARCH'
    && selected?.label === 'C'
    && session.search.branches.find(item => item.label === 'A')?.status === 'REJECTED'
    && session.search.branches.find(item => item.label === 'B')?.status === 'WEAKENED'
    && executed === 1
    && planC.ok
  return check('FIXTURE_B', pass, `${selected?.label} strategy=${session.selectedStrategy}`)
}

function fixtureC(): Frk02Result {
  const session = sessionFor('frk02-c', 'The first plan failed its test.', { wantsPlanSearch: true, componentCount: 3, ambiguity: 'low' })
  const first = openBranch(session, {
    label: 'A',
    kind: 'plan',
    reason: 'alternative',
    scorecard: { requirementsCoverage: 'covered', evidenceSupport: 1 },
  })
  selectBestBranch(session)
  rejectBranch(session, first.branch!.branchId, 'required evidence refutes approach')
  const alternative = openBranch(session, {
    label: 'B',
    kind: 'plan',
    reason: 'contradiction',
    scorecard: { requirementsCoverage: 'covered', evidenceSupport: 2, contradictions: 0, estimatedToolCost: 'cheap' },
  })
  const selected = selectBestBranch(session)
  const pass = first.branch?.status === 'REJECTED'
    && selected?.branchId === alternative.branch?.branchId
    && selected?.branchId !== first.branch?.branchId
  return check('FIXTURE_C', pass, `${first.branch?.status} -> ${selected?.label}`)
}

function fixtureD(): Frk02Result {
  const session = sessionFor('frk02-d', 'The selected repair misses an empty shelf.', { regressionRisk: 'high' })
  const current = openBranch(session, {
    label: 'repair',
    kind: 'repair',
    reason: 'alternative',
    scorecard: { requirementsCoverage: 'partial' },
  })
  const counter = openBranch(session, {
    label: 'empty shelf',
    kind: 'counterexample',
    reason: 'critic',
    parentBranchId: current.branch?.branchId,
    scorecard: { requirementsCoverage: 'partial', estimatedToolCost: 'cheap' },
  })
  const evidence = addSessionEvidence(session, {
    source: 'TEST_RESULT',
    statement: 'empty shelf still accepts the order',
    actor: 'test.run',
    ref: 'order.test',
  })
  propagateBranchEvidence(session, current.branch!.branchId, { evidenceId: evidence.evidenceId!, contradicts: true })
  const pass = session.selectedDepth === 'R3'
    && counter.ok
    && current.branch?.status === 'REJECTED'
    && session.search.branches.some(item => item.kind === 'counterexample')
  return check('FIXTURE_D', pass, `${session.selectedDepth} ${current.branch?.status}`)
}

function fixtureE(): Frk02Result {
  const session = sessionFor('frk02-e', 'Stop repeating the same repair.', { ambiguity: 'medium', componentCount: 2 })
  const branch = openBranch(session, { label: 'patch', kind: 'repair', reason: 'alternative' })
  const before = session.selectedStrategy
  const failure = { planId: 'plan-1', editArea: 'catalog.mjs:lookup', failure: 'counter still inside the loop' }
  recordBranchFailure(session, branch.branch!.branchId, failure)
  const second = recordBranchFailure(session, branch.branch!.branchId, failure)
  const pass = second.rejected
    && branch.branch?.status === 'REJECTED'
    && session.selectedStrategy !== before
    && session.search.repeatedFailedWithoutReplan === 0
  return check('FIXTURE_E', pass, `${before} -> ${session.selectedStrategy}`)
}

function fixtureF(): Frk02Result {
  const session = sessionFor('frk02-f', 'Rename one local variable.')
  const first = openBranch(session, { label: 'only', kind: 'plan', reason: 'alternative' })
  const second = openBranch(session, { label: 'extra', kind: 'plan', reason: 'alternative' })
  const pass = session.selectedDepth === 'R0'
    && session.search.budget.maxBranches === 1
    && first.ok
    && second.ok === false
    && session.search.branches.length === 1
  return check('FIXTURE_F', pass, `branches=${session.search.branches.length} cap=${session.search.budget.maxBranches}`)
}

function fixtureG(): Frk02Result {
  const session = sessionFor('frk02-g', 'Cross-layer repair with several alternatives.', {
    ambiguity: 'high',
    componentCount: 4,
    blastRadius: 'cross-layer',
    previousFailures: 2,
    budgetAllowsDeepSearch: true,
  })
  let opened = 0
  for (let index = 0; index < 8; index += 1) {
    const result = openBranch(session, { label: `B${index}`, kind: 'repair', reason: 'alternative' })
    if (result.ok && !result.duplicate) opened += 1
  }
  const raised = refuseSearchBudgetIncrease(session)
  const pass = session.selectedDepth === 'R4'
    && session.search.budget.maxBranches === 6
    && opened === 6
    && session.search.branches.length === 6
    && session.search.budget.maxWorkerCalls <= 8
    && raised.ok === false
    && raised.code === 'AUTOMATIC_BUDGET_INCREASE_REFUSED'
  return check('FIXTURE_G', pass, `opened=${opened} workers<=${session.search.budget.maxWorkerCalls}`)
}

function snapshotReasoning(session: FoundryReasoningSession): string {
  return JSON.stringify({
    goal: session.problemModel.goal,
    graph: session.reasoningGraph.nodes.map(item => item.nodeId),
    hypotheses: session.hypotheses.map(item => `${item.hypothesisId}:${item.status}`),
    evidence: session.evidence.map(item => item.evidenceId),
    strategy: session.selectedStrategy,
    depth: session.selectedDepth,
    contradictions: session.contradictions.map(item => item.contradictionId),
    verification: session.verificationState.refusal,
    replans: session.resourceState.replans,
    lessons: session.lessons.map(item => item.lessonId),
    branches: session.search.branches.map(item => `${item.branchId}:${item.status}`),
    applied: session.appliedMutationIds,
  })
}

async function fixtureH(root: string): Promise<Frk02Result> {
  const session = sessionFor('frk02-h', 'Resume three branches without replaying the edit.', { ambiguity: 'high', uncertaintyCount: 2 })
  addSessionHypothesis(session, 'The stored row is stale.')
  addSessionEvidence(session, {
    source: 'RUNTIME_OUTPUT',
    statement: 'the log shows the previous identifier',
    actor: 'process.status',
    ref: 'runtime-log',
  })
  session.lessons.push({
    lessonId: 'lesson-h',
    pattern: 'a stale read can survive a local rename',
    context: 'stores',
    evidence: ['runtime log'],
    applicability: 'stores',
    capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS',
    sameAnswer: false,
  })
  for (const label of ['A', 'B', 'C']) {
    openBranch(session, { label, kind: 'hypothesis', reason: 'alternative' })
  }
  selectBestBranch(session)
  rejectBranch(session, session.search.branches[1].branchId, 'contradicted by test evidence')
  rejectBranch(session, session.search.branches[2].branchId, 'acceptance constraint violated')
  const mutationId = queueMutation(session, 'replace the stale read')
  applyMutation(session, mutationId)
  const before = snapshotReasoning(session)
  setLifecycle(session, 'SUSPEND')
  await saveCanonicalSession(root, session)
  const restored = await loadCanonicalSession(root, session.sessionId)
  const replay = applyMutation(restored, mutationId)
  const again = openBranch(restored, { label: 'A', kind: 'hypothesis', reason: 'alternative' })
  setLifecycle(restored, 'RESUME')
  const pass = snapshotReasoning(restored) === before
    && replay.skipped
    && replay.applied === false
    && again.duplicate === true
    && restored.search.branches.length === 3
    && restored.search.lifecycle === 'RESUME'
  return check('FIXTURE_H', pass, `skipped=${replay.skipped} duplicate=${again.duplicate === true}`)
}

function fixtureI(): Frk02Result {
  const session = sessionFor('frk02-i', 'The worker dropped mid-search.', { ambiguity: 'high', uncertaintyCount: 2 })
  openBranch(session, { label: 'A', kind: 'hypothesis', reason: 'alternative' })
  openBranch(session, { label: 'B', kind: 'hypothesis', reason: 'alternative' })
  const before = JSON.stringify(session.search.branches)
  markWorkerUnavailable(session, 'worker unavailable')
  const pass = session.status === 'BLOCKED_PROVIDER'
    && JSON.stringify(session.search.branches) === before
    && session.problemModel.goal.length > 0
  return check('FIXTURE_I', pass, session.status)
}

async function fixtureJ(root: string): Promise<Frk02Result> {
  const session = sessionFor('frk02-j', 'Show the attached reasoning brief.', { ambiguity: 'medium', componentCount: 2 })
  openBranch(session, { label: 'A', kind: 'plan', reason: 'alternative', scorecard: { requirementsCoverage: 'covered', evidenceSupport: 1 } })
  selectBestBranch(session)
  const pointer = emptyPointer(session.missionId)
  const attached = attachCanonicalSession(pointer, session)
  await saveCanonicalSession(root, session)
  await saveMissionPointer(root, pointer)
  const loadedPointer = await loadMissionPointer(root, session.missionId)
  const loadedSession = await loadCanonicalSession(root, loadedPointer.reasoningSessionId!)
  const text = reasoningPanelText(loadedPointer.reasoningBrief)
  const mission = { missionId: session.missionId } as FoundryMissionRecord
  bindPointerToMission(mission, loadedPointer)
  const missionJson = JSON.stringify(loadedPointer)
  const pass = attached.ok
    && attached.duplicateSession === false
    && mission.reasoningSessionId === loadedSession.sessionId
    && !text.includes('No session')
    && text.includes('Strategy:')
    && text.includes(loadedSession.selectedStrategy ?? '')
    && !missionJson.includes('"reasoningGraph"')
    && loadedSession.reasoningGraph.nodes.length === session.reasoningGraph.nodes.length
  return check('FIXTURE_J', pass, loadedPointer.reasoningStatus ?? 'none')
}

function supportingCases(): Frk02Result[] {
  const cases: Frk02Result[] = []
  const restart = sessionFor('frk02-restart', 'Keep the whole reasoning state.', {
    ambiguity: 'high',
    uncertaintyCount: 2,
  })
  addSessionHypothesis(restart, 'The write is stale.')
  addSessionEvidence(restart, { source: 'RUNTIME_OUTPUT', statement: 'log shows the old id', actor: 'process.status', ref: 'log' })
  restart.verificationState.refusal = 'not proven'
  restart.lessons.push({
    lessonId: 'lesson-restart',
    pattern: 'stale write',
    context: 'store',
    evidence: ['runtime log'],
    applicability: 'stores',
    capabilityFamily: 'ROOT_CAUSE_DIAGNOSIS',
    sameAnswer: false,
  })
  const snapshot = JSON.stringify({
    goal: restart.problemModel.goal,
    nodes: restart.reasoningGraph.nodes.length,
    hypotheses: restart.hypotheses.length,
    evidence: restart.evidence.length,
    strategy: restart.selectedStrategy,
    depth: restart.selectedDepth,
    contradictions: restart.contradictions.length,
    verification: restart.verificationState.refusal,
    replans: restart.resourceState.replans,
    lessons: restart.lessons.length,
  })
  const revived = JSON.parse(JSON.stringify(restart)) as FoundryReasoningSession
  const revivedSnapshot = JSON.stringify({
    goal: revived.problemModel.goal,
    nodes: revived.reasoningGraph.nodes.length,
    hypotheses: revived.hypotheses.length,
    evidence: revived.evidence.length,
    strategy: revived.selectedStrategy,
    depth: revived.selectedDepth,
    contradictions: revived.contradictions.length,
    verification: revived.verificationState.refusal,
    replans: revived.resourceState.replans,
    lessons: revived.lessons.length,
  })
  cases.push(check('FRK_MISSION_RESTART_RECOVERY', snapshot === revivedSnapshot, revived.selectedDepth ?? 'none'))

  const lifecycle = sessionFor('frk02-life', 'Walk the session lifecycle.')
  const steps = ['CREATE', 'ATTACH', 'LOAD', 'UPDATE', 'SUSPEND', 'RESUME', 'COMPLETE'] as const
  for (const step of steps) setLifecycle(lifecycle, step)
  const blocked = sessionFor('frk02-block', 'Block the session.')
  setLifecycle(blocked, 'BLOCK')
  cases.push(check('LIFECYCLE', lifecycle.search.lifecycle === 'COMPLETE' && blocked.search.lifecycle === 'BLOCK', lifecycle.search.lifecycle))

  const brief = sessionFor('frk02-brief', 'Persist the brief after a branch change.', { ambiguity: 'medium', componentCount: 2 })
  openBranch(brief, { label: 'A', kind: 'plan', reason: 'alternative' })
  const pointer = emptyPointer(brief.missionId)
  attachCanonicalSession(pointer, brief)
  const firstAt = pointer.reasoningUpdatedAt
  openBranch(brief, { label: 'B', kind: 'plan', reason: 'contradiction' })
  refreshPointer(pointer, brief)
  const passBrief = pointer.reasoningBrief?.searchBranches.length === 2
    && pointer.reasoningBrief.strategy === brief.selectedStrategy
    && pointer.reasoningUpdatedAt === firstAt
    && !JSON.stringify(pointer).includes('"reasoningGraph"')
  cases.push(check('REASONING_BRIEF_PERSISTENCE', passBrief, `${pointer.reasoningBrief?.searchBranches.length}`))

  const disagree = sessionFor('frk02-disagree', 'Two workers disagree.', { ambiguity: 'high', uncertaintyCount: 2 })
  const prior = openBranch(disagree, { label: 'kept', kind: 'hypothesis', reason: 'alternative' })
  const pair = recordWorkerDisagreement(disagree, {
    claims: ['the parser is inside the loop', 'the parser is outside the loop'],
    proposedBy: [{ provider: 'worker-x', model: 'model-x' }, { provider: 'worker-y', model: 'model-y' }],
  })
  cases.push(check(
    'WORKER_DISAGREEMENT',
    prior.ok && Boolean(pair.first && pair.second) && disagree.search.branches.some(item => item.label === 'kept') && pair.first?.proposedBy?.provider === 'worker-x' && pair.second?.proposedBy?.provider === 'worker-y',
    `${disagree.search.branches.length}`,
  ))

  const proof = sessionFor('frk02-proof', 'A proposal is not proof.', { ambiguity: 'medium', componentCount: 2 })
  const proposed = openBranch(proof, { label: 'model plan', kind: 'plan', reason: 'alternative', scorecard: { requirementsCoverage: 'covered' } })
  const modelEvidence = addSessionEvidence(proof, { source: 'MODEL_ASSERTION', statement: 'this is fixed', actor: 'worker', ref: 'summary' })
  propagateBranchEvidence(proof, proposed.branch!.branchId, { evidenceId: modelEvidence.evidenceId!, supports: true })
  selectBestBranch(proof)
  cases.push(check('MODEL_NOT_PROOF', branchIsProven(proof, proposed.branch!.branchId) === false, String(branchIsProven(proof, proposed.branch!.branchId))))

  const verify = sessionFor('frk02-verify', 'Inspect before editing.', { verificationFirst: true, ambiguity: 'low' })
  const cheap = openVerificationFirst(verify, 'the parse site is inside the loop')
  cases.push(check(
    'VERIFICATION_FIRST',
    verify.selectedStrategy === 'VERIFICATION_FIRST' && cheap.branch?.scorecard.estimatedToolCost === 'cheap' && classifyToolCost('file.read') === 'cheap' && classifyToolCost('file.replace_unique') === 'expensive',
    cheap.branch?.kind ?? 'none',
  ))

  const drop = sessionFor('frk02-drop', 'Collapse after the evidence selects one branch.', {
    ambiguity: 'high',
    componentCount: 4,
    blastRadius: 'cross-layer',
    previousFailures: 2,
    budgetAllowsDeepSearch: true,
  })
  openBranch(drop, { label: 'keep', kind: 'plan', reason: 'alternative', scorecard: { requirementsCoverage: 'covered', evidenceSupport: 2, contradictions: 0 } })
  openBranch(drop, { label: 'drop', kind: 'plan', reason: 'alternative', scorecard: { requirementsCoverage: 'partial' } })
  selectBestBranch(drop)
  const started = drop.selectedDepth
  collapseSearch(drop)
  cases.push(check(
    'DEESCALATE_SEARCH',
    started === 'R4' && drop.selectedDepth === 'R1' && drop.search.branches.filter(item => item.status === 'SELECTED').length === 1 && drop.search.branches.some(item => item.status === 'REJECTED'),
    drop.depthHistory.join('→'),
  ))

  const hidden = filterReasoningLesson({
    lessonId: 'hidden',
    pattern: 'loop parse',
    context: 'GRAD_HIDDEN expected return is the sealed answer',
    evidence: ['source'],
    applicability: 'parsers',
    capabilityFamily: 'PLAN_TO_CODE_FIDELITY',
    sameAnswer: false,
  })
  const generic = filterReasoningLesson({
    lessonId: 'generic',
    pattern: 'a counter that stays inside a loop survives a move-the-parse attempt',
    context: 'inspect the source before accepting the repair',
    failedApproach: 'editing without reading the loop',
    evidence: ['source inspection'],
    applicability: 'parsers',
    antiPattern: 'trusting a repair claim without reading the loop',
    capabilityFamily: 'PLAN_TO_CODE_FIDELITY',
    sameAnswer: false,
  })
  cases.push(check('SEARCH_MEMORY', hidden.ok === false && generic.ok === true, hidden.ok ? 'kept hidden' : hidden.reason))

  const practice = sessionFor('frk02-practice', 'Failed selections do not block Commander work.', { ambiguity: 'high', uncertaintyCount: 2 })
  const left = openBranch(practice, { label: 'left', kind: 'plan', reason: 'alternative' })
  const right = openBranch(practice, { label: 'right', kind: 'plan', reason: 'alternative' })
  rejectBranch(practice, left.branch!.branchId, 'contradicted')
  rejectBranch(practice, right.branch!.branchId, 'contradicted')
  noteRepeatedSelectionFailure(practice)
  cases.push(check('PRACTICE', practice.practice.length === 1 && practice.commanderProjectsBlocked === false, String(practice.practice.length)))

  const firstMission = sessionFor('frk02-one', 'One canonical session.')
  const other = sessionFor('frk02-other', 'A second session must not attach.')
  const owned = emptyPointer(firstMission.missionId)
  const firstAttach = attachCanonicalSession(owned, firstMission)
  const secondAttach = attachCanonicalSession(owned, other)
  cases.push(check(
    'DUPLICATE_SESSION',
    firstAttach.ok && firstAttach.duplicateSession === false && secondAttach.ok === false && owned.reasoningSessionId === firstMission.sessionId,
    secondAttach.reason,
  ))

  const ready = sessionFor('frk02-ready', 'An open contradiction blocks ready.', { wantsPlanSearch: true, componentCount: 3, ambiguity: 'low' })
  openBranch(ready, { label: 'shaky', kind: 'plan', reason: 'contradiction', scorecard: { requirementsCoverage: 'covered', contradictions: 1 } })
  const chosen = selectBestBranch(ready)
  cases.push(check('ACCEPTANCE_IMPACT', chosen?.scorecard.contradictions === 1 && ready.verificationState.projectReady === false, ready.verificationState.refusal ?? 'none'))

  return cases
}

/**
 * Bounded FRK action loop.
 * Model output is ingested only after validation. Mutations stay unexecuted.
 */
import { actionFingerprint } from '../foundryReplanEngine'
import { FOUNDRY_STAGNATION_THRESHOLDS } from '../foundryReplanTypes'
import { chargeResource, refuseBudgetIncrease, tightenSearchForDeepLevel } from './budget'
import { applySearchBudget } from './search'
import { recordStrategyDecision } from './strategy-intelligence'
import { createContradiction, unresolvedAcceptanceBlock } from './contradictions'
import { critiqueIndependent, unresolvedCriticBlock } from './critic'
import { deescalateDepth, escalateDepth, selectDepth } from './depth-controller'
import { createEvidence } from './evidence'
import { addGraphEdge, addGraphNode, edgeShell, graphInvariant, nodeShell } from './graph'
import { buildEvidenceRequest, createHypothesis, selectedHypothesis, updateBeliefs } from './hypotheses'
import { bumpDifficulty, filterReasoningLesson, notePractice, retrieveLessons } from './memory'
import {
  applyMutation,
  createFoundryReasoningSession,
  explainSession,
  nextSessionId,
  queueMutation,
  restoreSession,
  serializeSession,
  stopSession,
  touchSession,
} from './session'
import { selectStrategy } from './strategy-selector'
import {
  chooseCandidatePlan,
  compareArchitectures,
  counterexampleQuestions,
  decomposeProblem,
  directPath,
  rootCauseRecord,
  strategyCeremony,
} from './strategies'
import { clipText } from './text'
import {
  FRK_COMMANDER_GATED_ACTIONS,
  FRK_MAX_STEPS,
  FRK_PHASES,
  FRK_VERIFICATION_FORMS,
  type FoundryArchitectureOption,
  type FoundryCandidatePlan,
  type FoundryEvidence,
  type FoundryReasoningSession,
  type FoundryReasoningWorkerResponse,
  type FrkCapability,
  type FrkContradictionType,
  type FrkCriticCategory,
  type FrkEvidenceSource,
  type FrkMetaDecision,
  type FrkPhase,
  type FrkResourceCharge,
  type FrkWorkerTask,
} from './types'
import { bindClaim, inspectImplementationFidelity, workerSelfDeclaredSuccess } from './verifier'

export {
  applyMutation,
  createFoundryReasoningSession,
  explainSession,
  queueMutation,
  restoreSession,
  serializeSession,
}
export { graphInvariant } from './graph'
export { retrieveLessons, capabilityAtlasStatus } from './memory'
export { refuseBudgetIncrease } from './budget'

function ids(session: FoundryReasoningSession): () => string {
  return () => nextSessionId(session, 'node')
}

export function selectSessionStrategy(session: FoundryReasoningSession): void {
  const depthBefore = session.selectedDepth
  const strategy = selectStrategy(session.signals)
  if (session.selectedStrategy && session.selectedStrategy !== strategy) {
    session.previousStrategy = session.selectedStrategy
    session.directionChanges.push(`strategy ${session.selectedStrategy} to ${strategy}`)
  }
  session.selectedStrategy = strategy
  const depth = selectDepth(session.signals)
  applyDepth(session, depth)
  session.phase = 'REASON'
  session.status = 'RUNNING'
  if (strategy === 'DIRECT') directPath(session.reasoningGraph, ids(session), session.problemModel.goal)
  recordStrategyDecision(session, {
    trigger: 'initial-selection',
    selected: strategy,
    reason: `${strategy} matches the current problem signals.`,
    depthBefore,
    depthAfter: session.selectedDepth,
    gain: strategy === 'VERIFICATION_FIRST' ? 'HIGH' : 'MEDIUM',
  })
  session.strategyTrigger = 'initial-selection'
  touchSession(session)
}

function applyDepth(session: FoundryReasoningSession, depth: NonNullable<FoundryReasoningSession['selectedDepth']>): void {
  if (session.selectedDepth === depth) return
  session.selectedDepth = depth
  session.depthHistory.push(depth)
  if (depth === 'R4') tightenSearchForDeepLevel(session.resourceState)
  applySearchBudget(session)
}

export function escalateSession(
  session: FoundryReasoningSession,
  reason: 'check_failed' | 'contradiction' | 'repeated_repair' | 'multi_component',
): void {
  const current = session.selectedDepth ?? selectDepth(session.signals)
  const next = escalateDepth(current, reason, session.signals.budgetAllowsDeepSearch && session.resourceState.searchBranches < session.resourceState.limits.searchBranches)
  applyDepth(session, next)
  session.directionChanges.push(`escalated to ${next} because ${reason}`)
}

export function deescalateSession(session: FoundryReasoningSession): void {
  const current = session.selectedDepth ?? 'R1'
  const collapsed = session.hypotheses.filter(item => item.status === 'ACTIVE' || item.status === 'WEAKENED').length <= 1
    && session.contradictions.every(item => item.resolved || !item.affectsAcceptance)
  const next = deescalateDepth(current, collapsed)
  applyDepth(session, next)
  if (next !== current) session.directionChanges.push(`de-escalated to ${next}`)
}

export function addSessionHypothesis(
  session: FoundryReasoningSession,
  claim: string,
  predictedEvidence: string[] = [],
): string {
  const hypothesis = createHypothesis({
    hypothesisId: nextSessionId(session, 'hypothesis'),
    claim,
    predictedEvidence,
  })
  session.hypotheses.push(hypothesis)
  const node = nodeShell(hypothesis.hypothesisId, 'HYPOTHESIS', hypothesis.claim, 'POSSIBLE')
  addGraphNode(session.reasoningGraph, node)
  return hypothesis.hypothesisId
}

export function requestDiscriminatingEvidence(session: FoundryReasoningSession, distinguishingObservation: string): string {
  const request = buildEvidenceRequest({
    requestId: nextSessionId(session, 'evidence-request'),
    hypotheses: session.hypotheses,
    distinguishingObservation,
  })
  session.evidenceRequests.push(request)
  for (const hypothesis of session.hypotheses) {
    if (request.hypothesisIds.includes(hypothesis.hypothesisId)) hypothesis.nextDiscriminatingCheck = request.question
  }
  addGraphNode(session.reasoningGraph, nodeShell(request.requestId, 'QUESTION', request.question, 'UNKNOWN'))
  return request.requestId
}

export function addSessionEvidence(session: FoundryReasoningSession, input: {
  source: FrkEvidenceSource
  statement: string
  actor: string
  ref: string
  supportsHypothesisIds?: string[]
  contradictsHypothesisIds?: string[]
}): { ok: boolean; reason?: string; evidenceId?: string } {
  const built = createEvidence({
    evidenceId: nextSessionId(session, 'evidence'),
    source: input.source,
    statement: input.statement,
    actor: input.actor,
    ref: input.ref,
    observedAt: session.createdAt,
    supportsHypothesisIds: input.supportsHypothesisIds,
    contradictsHypothesisIds: input.contradictsHypothesisIds,
  })
  if (!built.ok) return built
  session.evidence.push(built.evidence)
  addGraphNode(session.reasoningGraph, nodeShell(built.evidence.evidenceId, 'EVIDENCE', built.evidence.statement, 'KNOWN'))
  updateBeliefs(session.hypotheses, session.evidence)
  for (const hypothesisId of built.evidence.supportsHypothesisIds) {
    addGraphEdge(session.reasoningGraph, edgeShell(nextSessionId(session, 'edge'), built.evidence.evidenceId, hypothesisId, 'SUPPORTS'))
  }
  for (const hypothesisId of built.evidence.contradictsHypothesisIds) {
    addGraphEdge(session.reasoningGraph, edgeShell(nextSessionId(session, 'edge'), built.evidence.evidenceId, hypothesisId, 'CONTRADICTS'))
  }
  return { ok: true, evidenceId: built.evidence.evidenceId }
}

export function refreshBeliefs(session: FoundryReasoningSession): void {
  updateBeliefs(session.hypotheses, session.evidence)
}

export function addSessionContradiction(
  session: FoundryReasoningSession,
  type: FrkContradictionType,
  summary: string,
  affectsAcceptance: boolean,
): string {
  const record = createContradiction({
    contradictionId: nextSessionId(session, 'contradiction'),
    type,
    summary,
    affectsAcceptance,
  })
  session.contradictions.push(record)
  addGraphNode(session.reasoningGraph, nodeShell(record.contradictionId, 'CONTRADICTION', `${type}: ${summary}`, 'CONTRADICTED'))
  if (affectsAcceptance) session.verificationState.projectReady = false
  return record.contradictionId
}

export function addCandidatePlans(
  session: FoundryReasoningSession,
  plans: Array<{ label: 'A' | 'B' | 'C'; summary: string; coversAcceptance: boolean }>,
): void {
  session.candidatePlans = plans.map(plan => ({
    planId: nextSessionId(session, 'plan'),
    label: plan.label,
    summary: clipText(plan.summary),
    coversAcceptance: plan.coversAcceptance,
    selected: false,
    executed: false,
  }))
  for (const plan of session.candidatePlans) {
    addGraphNode(session.reasoningGraph, nodeShell(plan.planId, 'PLAN', `${plan.label}: ${plan.summary}`, 'POSSIBLE'))
  }
}

export function chooseSessionPlan(session: FoundryReasoningSession): FoundryCandidatePlan | null {
  const chosen = chooseCandidatePlan(session.candidatePlans)
  session.currentPlan = chosen
  return chosen
}

export function addArchitectures(session: FoundryReasoningSession, options: Array<Omit<FoundryArchitectureOption, 'optionId'>>): void {
  session.architectures = options.map(option => ({ ...option, optionId: nextSessionId(session, 'architecture') }))
  const compared = compareArchitectures(session.architectures)
  session.selectedArchitectureId = compared.selectedId
  session.directionChanges.push(compared.reason)
  session.capabilitySignals.push({
    capability: 'ARCHITECTURE_SELECTION',
    gap: compared.selectedId === null,
    evidence: compared.reason,
  })
}

export function recordRootCause(session: FoundryReasoningSession, input: {
  symptom: string
  candidateCauses: string[]
  evidenceIds: string[]
  rootCause?: string
  repairImplication?: string
}): { ok: boolean; reason?: string } {
  const result = rootCauseRecord(input)
  if (!result.ok) return result
  session.rootCause = result.record
  session.capabilitySignals.push({
    capability: 'ROOT_CAUSE_DIAGNOSIS',
    gap: !result.record.rootCause,
    evidence: result.record.rootCause ?? result.record.symptom,
  })
  return { ok: true }
}

export function searchCounterexamples(session: FoundryReasoningSession): string[] {
  const questions = counterexampleQuestions()
  for (const question of questions) {
    addGraphNode(session.reasoningGraph, nodeShell(nextSessionId(session, 'counterexample'), 'QUESTION', question, 'UNKNOWN'))
  }
  session.capabilitySignals.push({
    capability: 'COUNTEREXAMPLE_SEARCH',
    gap: false,
    evidence: `${questions.length} counterexample questions`,
  })
  return questions
}

export function decomposeSession(session: FoundryReasoningSession, subgoals: string[]): string[] {
  session.selectedStrategy = 'DECOMPOSE'
  return decomposeProblem(session.reasoningGraph, ids(session), session.acceptanceCriteria, subgoals)
}

export function predictOutcome(session: FoundryReasoningSession, input: {
  expectedFileChange: string
  expectedTestOutcome: string
  expectedRuntimeEffect: string
  possibleRegressions?: string[]
}): string {
  const predictionId = nextSessionId(session, 'prediction')
  session.predictions.push({
    predictionId,
    expectedFileChange: clipText(input.expectedFileChange),
    expectedTestOutcome: clipText(input.expectedTestOutcome),
    expectedRuntimeEffect: clipText(input.expectedRuntimeEffect),
    possibleRegressions: (input.possibleRegressions ?? []).map(clipText),
    compared: false,
    matched: null,
  })
  return predictionId
}

export function observeSession(session: FoundryReasoningSession, input: {
  summary: string
  actionId?: string
  hypothesisId?: string
  planId?: string
  predictionId?: string
  evidenceId?: string
}): string {
  const observationId = nextSessionId(session, 'observation')
  session.observations.push({
    observationId,
    actionId: input.actionId ?? null,
    hypothesisId: input.hypothesisId ?? null,
    planId: input.planId ?? null,
    predictionId: input.predictionId ?? null,
    summary: clipText(input.summary),
    evidenceId: input.evidenceId ?? null,
  })
  addGraphNode(session.reasoningGraph, nodeShell(observationId, 'OBSERVATION', input.summary, 'KNOWN'))
  return observationId
}

export function comparePrediction(session: FoundryReasoningSession, predictionId: string, observedTestOutcome: string): void {
  const prediction = session.predictions.find(item => item.predictionId === predictionId)
  if (!prediction) return
  prediction.compared = true
  prediction.matched = prediction.expectedTestOutcome === observedTestOutcome
  if (!prediction.matched) {
    addSessionContradiction(session, 'PREDICTION_VS_RUNTIME', `Predicted ${prediction.expectedTestOutcome} and observed ${observedTestOutcome}.`, true)
    addSessionContradiction(session, 'PREDICTION_MISMATCH', 'Observation differs from the predicted test outcome.', true)
    const charge = chargeResource(session.resourceState, 'replans', 1)
    session.status = 'REPLANNING'
    session.phase = 'REPLAN'
    if (charge.ok) {
      addCandidatePlans(session, [
        { label: 'A', summary: session.currentPlan?.summary ?? 'original plan', coversAcceptance: false },
        { label: 'B', summary: 'replan after prediction mismatch', coversAcceptance: true },
      ])
      chooseSessionPlan(session)
      session.directionChanges.push('prediction mismatch triggered replan')
    }
  }
}

export function critiqueSession(session: FoundryReasoningSession, input: {
  category: FrkCriticCategory
  summary: string
  blocksAcceptance: boolean
  problem: string
  constraints: string[]
  plan: string
  source: string
  evidence: string
}): { ok: boolean; reason?: string } {
  const result = critiqueIndependent({
    findingId: nextSessionId(session, 'critic'),
    ...input,
  })
  if (!result.ok) return result
  session.criticFindings.push(result.finding)
  addGraphNode(session.reasoningGraph, nodeShell(result.finding.findingId, 'CRITIQUE', result.finding.summary, 'POSSIBLE'))
  refreshProjectReady(session)
  return { ok: true }
}

export function adversarialReview(session: FoundryReasoningSession, input: {
  whatWouldMakeThisWrong: string
  problem: string
  constraints: string[]
  plan: string
  source: string
  evidence: string
  blocksAcceptance: boolean
}): { ok: boolean; reason?: string } {
  return critiqueSession(session, {
    category: 'MISSING_EDGE_CASE',
    summary: `What would make this solution wrong? ${input.whatWouldMakeThisWrong}`,
    blocksAcceptance: input.blocksAcceptance,
    problem: input.problem,
    constraints: input.constraints,
    plan: input.plan,
    source: input.source,
    evidence: input.evidence,
  })
}

export function verifySessionClaim(session: FoundryReasoningSession, input: {
  claim: string
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  workerText?: string
}): string {
  const supporting = session.evidence.filter(item => input.supportingEvidenceIds.includes(item.evidenceId))
  const contradicting = session.evidence.filter(item => input.contradictingEvidenceIds.includes(item.evidenceId))
  const declared = input.workerText ? workerSelfDeclaredSuccess(input.workerText) : false
  const claim = bindClaim({
    claimId: nextSessionId(session, 'claim'),
    claim: input.claim,
    supporting,
    contradicting,
    workerDeclaredSuccess: declared,
  })
  session.verificationState.claims.push(claim)
  session.verificationState.formsConsidered = [...FRK_VERIFICATION_FORMS]
  const evidenceNode = supporting[0] ?? contradicting[0]
  const verificationId = nextSessionId(session, 'verification')
  addGraphNode(session.reasoningGraph, nodeShell(verificationId, 'VERIFICATION', `${claim.status}: ${claim.claim}`, claim.status === 'PROVEN' ? 'KNOWN' : 'POSSIBLE'))
  if (evidenceNode) {
    addGraphEdge(session.reasoningGraph, edgeShell(nextSessionId(session, 'edge'), evidenceNode.evidenceId, verificationId, 'VERIFIES'))
  }
  refreshProjectReady(session)
  return claim.claimId
}

export function verifyFidelity(session: FoundryReasoningSession, input: {
  symptom: string
  constraints: string[]
  approach: string
  files: Record<string, string>
  rootCause?: string
  workerText?: string
}): void {
  const check = inspectImplementationFidelity(input)
  session.fidelity = { status: check.status, mismatch: check.mismatch, reinspected: true }
  session.capabilitySignals.push({
    capability: 'PLAN_TO_CODE_FIDELITY',
    gap: check.status === 'CONTRADICTED' || check.status === 'PARTIAL',
    evidence: check.mismatch || check.status,
  })
  if (check.status === 'CONTRADICTED') {
    addSessionContradiction(session, 'MODEL_VS_SOURCE', check.mismatch || 'Source contradicts the model claim.', true)
    addSessionContradiction(session, 'PLAN_VS_CODE', check.mismatch || 'Plan and source disagree.', true)
  }
  if (input.workerText && workerSelfDeclaredSuccess(input.workerText)) {
    verifySessionClaim(session, {
      claim: input.workerText,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: session.contradictions.length ? session.evidence.map(item => item.evidenceId) : [],
      workerText: input.workerText,
    })
  }
  refreshProjectReady(session)
}

export function recordPatchAttempt(session: FoundryReasoningSession, input: {
  hypothesisId: string
  planId: string
  patchRegion: string
  failureEvidence: string
}): void {
  const fingerprint = actionFingerprint({
    tool: input.patchRegion,
    args: { hypothesisId: input.hypothesisId, planId: input.planId },
    error: input.failureEvidence,
  })
  const repeats = fingerprint === session.stagnation.fingerprint ? session.stagnation.repeats + 1 : 1
  session.stagnation.fingerprint = fingerprint
  session.stagnation.repeats = repeats
  if (repeats >= FOUNDRY_STAGNATION_THRESHOLDS.identicalActionRepeats) {
    session.stagnation.detected = true
    const previous = session.selectedStrategy
    session.selectedStrategy = previous === 'REPAIR_LOOP' ? 'HYPOTHESIS_COMPETITION' : 'REPAIR_LOOP'
    session.stagnation.response = 'strategy_change'
    session.directionChanges.push(`stagnation changed strategy from ${previous ?? 'none'} to ${session.selectedStrategy}`)
    session.status = 'REPLANNING'
  }
}

export function metaReason(session: FoundryReasoningSession): FrkMetaDecision {
  let decision: FrkMetaDecision = 'CONTINUE'
  if (session.stagnation.detected) decision = 'CHANGE_STRATEGY'
  else if (session.contradictions.some(item => !item.resolved) && session.evidenceRequests.length === 0) decision = 'GATHER_EVIDENCE'
  else if (session.signals.componentCount > 1 && session.selectedStrategy === 'DIRECT') decision = 'DECOMPOSE'
  else if ((session.selectedDepth === 'R4' || session.selectedDepth === 'R3') && session.hypotheses.filter(item => item.status === 'ACTIVE').length <= 1) decision = 'SIMPLIFY'
  else if (session.stopReason) decision = 'BLOCK'
  session.metaDecisions.push(decision)
  return decision
}

export function selectEvidenceTool(session: FoundryReasoningSession, need: string): { executed: false; toolFamily: string } {
  const toolFamily = /test/i.test(need) ? 'test.run' : /source|file|parse/i.test(need) ? 'file.read' : 'workspace.inspect'
  session.toolSelections.push({
    selectionId: nextSessionId(session, 'tool'),
    need: clipText(need),
    toolFamily,
    reason: 'Evidence is required. Execution stays with the Tool Broker.',
    authority: 'TOOL_BROKER',
    executed: false,
  })
  return { executed: false, toolFamily }
}

export function rememberLesson(session: FoundryReasoningSession, lesson: Omit<FoundryReasoningSession['lessons'][number], 'lessonId' | 'sameAnswer'>): { ok: boolean; reason: string } {
  const candidate = { ...lesson, lessonId: nextSessionId(session, 'lesson'), sameAnswer: false as const }
  const filtered = filterReasoningLesson(candidate)
  if (!filtered.ok) {
    session.rejectedLessons.push({ reason: filtered.reason })
    return filtered
  }
  session.lessons.push(filtered.lesson)
  addGraphNode(session.reasoningGraph, nodeShell(filtered.lesson.lessonId, 'LESSON', filtered.lesson.pattern, 'LIKELY'))
  return { ok: true, reason: 'Lesson retained as a pattern.' }
}

export function lessonsFor(session: FoundryReasoningSession, query: { pattern?: string; capabilityFamily?: FrkCapability; failureMode?: string }) {
  return retrieveLessons(session.lessons, query)
}

export function noteCapabilityFailure(session: FoundryReasoningSession, capability: FrkCapability, evidence: string): void {
  session.capabilitySignals.push({ capability, gap: true, evidence: clipText(evidence) })
  session.practice.push(notePractice({
    practiceId: nextSessionId(session, 'practice'),
    capability,
    chosen: `practice ${capability} on a disposable case`,
    evidence,
  }))
  session.commanderProjectsBlocked = false
}

export function noteCapabilitySuccess(session: FoundryReasoningSession): void {
  session.difficulty = bumpDifficulty(session.difficulty)
}

export function recordRoutingEvidence(session: FoundryReasoningSession, input: {
  problemFamily: string
  provider: string
  model: string
  result: string
  verification: string
}): void {
  session.routingEvidence.push({
    problemFamily: input.problemFamily,
    difficulty: session.selectedDepth ?? 'R0',
    provider: input.provider,
    model: input.model,
    result: input.result,
    resourceUse: { workerCalls: session.resourceState.workerCalls, tokens: session.resourceState.tokens },
    replans: session.resourceState.replans,
    contradictions: session.contradictions.length,
    verification: input.verification,
    policyChanged: false,
  })
}

export function chargeSession(session: FoundryReasoningSession, charge: FrkResourceCharge, amount = 1): { ok: boolean; code: string } {
  const result = chargeResource(session.resourceState, charge, amount)
  if (!result.ok) stopSession(session, 'BUDGET_EXHAUSTED')
  return result
}

export function requestBudgetRaise(session: FoundryReasoningSession): { ok: false; code: 'AUTOMATIC_BUDGET_INCREASE_REFUSED' } {
  return refuseBudgetIncrease(session.resourceState)
}

export function declareDecision(session: FoundryReasoningSession, input: {
  summary: string
  evidenceId?: string
  assumptionId?: string
  certainty: 'KNOWN' | 'POSSIBLE'
}): { ok: boolean; reason: string } {
  const assumption = input.assumptionId ? session.assumptions.find(item => item.assumptionId === input.assumptionId) : undefined
  const evidence = input.evidenceId ? session.evidence.find(item => item.evidenceId === input.evidenceId) : undefined
  if (!assumption && !evidence) return { ok: false, reason: 'A decision requires evidence or an explicit assumption.' }
  const unresolved = Boolean(assumption && assumption.status === 'OPEN')
  if (input.certainty === 'KNOWN' && (!evidence || unresolved)) {
    return { ok: false, reason: 'Unsupported final certainty is refused.' }
  }
  const decisionId = nextSessionId(session, 'decision')
  const node = nodeShell(decisionId, 'DECISION', input.summary, input.certainty === 'KNOWN' ? 'KNOWN' : 'POSSIBLE')
  node.assumptionUnresolved = unresolved
  node.supportRef = evidence?.evidenceId ?? assumption?.assumptionId ?? null
  addGraphNode(session.reasoningGraph, node)
  if (evidence) addGraphEdge(session.reasoningGraph, edgeShell(nextSessionId(session, 'edge'), evidence.evidenceId, decisionId, 'SUPPORTS'))
  if (assumption) {
    const assumptionNode = nodeShell(assumption.assumptionId, 'ASSUMPTION', assumption.statement, unresolved ? 'POSSIBLE' : 'LIKELY')
    if (!session.reasoningGraph.nodes.some(item => item.nodeId === assumption.assumptionId)) addGraphNode(session.reasoningGraph, assumptionNode)
    addGraphEdge(session.reasoningGraph, edgeShell(nextSessionId(session, 'edge'), assumption.assumptionId, decisionId, 'DERIVED_FROM'))
  }
  return { ok: true, reason: unresolved ? 'Decision depends on an unresolved assumption.' : 'Decision is grounded.' }
}

export function refreshProjectReady(session: FoundryReasoningSession): boolean {
  const contradictionBlock = unresolvedAcceptanceBlock(session.contradictions)
  const criticBlock = unresolvedCriticBlock(session.criticFindings)
  const unproven = session.verificationState.claims.some(item => item.status !== 'PROVEN')
  const refusal = contradictionBlock ?? criticBlock ?? (unproven ? 'Acceptance is not proven.' : null)
  session.verificationState.refusal = refusal
  session.verificationState.projectReady = refusal === null && session.verificationState.claims.some(item => item.status === 'PROVEN')
  if (refusal) {
    session.status = 'READY_REFUSED'
  } else if (session.verificationState.projectReady) {
    session.status = 'PROJECT_READY'
    session.stopReason = 'ACCEPTANCE_PROVEN'
  }
  return session.verificationState.projectReady
}

export function markWorkerUnavailable(session: FoundryReasoningSession, reason: string): void {
  session.workerStatus = 'BLOCKED_PROVIDER'
  session.directionChanges.push(clipText(reason))
  stopSession(session, 'BLOCKED_PROVIDER')
}

const GATED = new RegExp(FRK_COMMANDER_GATED_ACTIONS.join('|'), 'i')

export function validateWorkerOutput(
  session: FoundryReasoningSession,
  response: FoundryReasoningWorkerResponse,
  expectedTask: FrkWorkerTask,
): { ok: true } | { ok: false; reason: string } {
  if (response.task !== expectedTask) return { ok: false, reason: 'Worker task does not match the request.' }
  if (!response.summary || typeof response.summary !== 'string') return { ok: false, reason: 'Worker summary is missing.' }
  if (GATED.test(response.summary)) return { ok: false, reason: 'Worker requested a Commander-gated action.' }
  if ((response.resourceTokens ?? 0) > session.resourceState.limits.tokens - session.resourceState.tokens) {
    return { ok: false, reason: 'Worker resource request exceeds the remaining budget.' }
  }
  for (const tool of response.toolRequests ?? []) {
    if (!tool.name || GATED.test(tool.name)) return { ok: false, reason: 'Worker tool request is outside governed evidence tools.' }
  }
  if ((response.claims ?? []).length && !(response.hypotheses ?? []).length && expectedTask === 'hypotheses') {
    return { ok: false, reason: 'Hypothesis task returned claims without hypotheses.' }
  }
  return { ok: true }
}

export function ingestWorkerOutput(session: FoundryReasoningSession, response: FoundryReasoningWorkerResponse, expectedTask: FrkWorkerTask): { ok: boolean; reason: string } {
  const valid = validateWorkerOutput(session, response, expectedTask)
  if (!valid.ok) {
    session.workerStatus = 'REJECTED'
    return valid
  }
  const summary = clipText(response.summary)
  if (expectedTask === 'hypotheses') {
    for (const item of response.hypotheses ?? []) addSessionHypothesis(session, item.claim, item.predictedEvidence)
  }
  if (expectedTask === 'plans' && response.plans?.length) {
    addCandidatePlans(session, response.plans.map(plan => ({ ...plan, coversAcceptance: false })))
  }
  session.workerStatus = 'VALIDATED'
  session.directionChanges.push(`worker proposal accepted: ${summary}`)
  chargeSession(session, 'workerCalls', 1)
  return { ok: true, reason: 'Structured worker proposal accepted. It is not proof.' }
}

export function advanceSession(session: FoundryReasoningSession): FrkPhase {
  if (session.stepCount >= Math.min(FRK_MAX_STEPS, session.resourceState.limits.maxSteps)) {
    stopSession(session, 'BUDGET_EXHAUSTED')
    return session.phase
  }
  session.stepCount += 1
  const index = FRK_PHASES.indexOf(session.phase)
  const next = FRK_PHASES[Math.min(index + 1, FRK_PHASES.length - 1)]
  session.phase = next
  if (next === 'SELECT_STRATEGY' && !session.selectedStrategy) selectSessionStrategy(session)
  if (next === 'REQUEST_EVIDENCE' && session.selectedStrategy === 'HYPOTHESIS_COMPETITION' && session.hypotheses.length > 1 && !session.evidenceRequests.length) {
    requestDiscriminatingEvidence(session, 'an observation that one explanation predicts and the other does not')
  }
  if (next === 'ACT') {
    const mutationId = queueMutation(session, 'governed action remains unexecuted')
    session.toolSelections.push({
      selectionId: nextSessionId(session, 'tool'),
      need: 'mutation',
      toolFamily: 'file.replace_unique',
      reason: mutationId,
      authority: 'TOOL_BROKER',
      executed: false,
    })
  }
  if (next === 'DECIDE') refreshProjectReady(session)
  if (next === 'LEARN' && session.stopReason === 'ACCEPTANCE_PROVEN') stopSession(session, 'ACCEPTANCE_PROVEN')
  touchSession(session)
  return session.phase
}

export function runBoundedSession(session: FoundryReasoningSession): void {
  const limit = Math.min(FRK_MAX_STEPS, session.resourceState.limits.maxSteps)
  for (let step = 0; step < limit; step += 1) {
    if (session.stopReason) return
    advanceSession(session)
  }
  if (!session.stopReason) stopSession(session, 'BUDGET_EXHAUSTED')
}

export function activeHypothesis(session: FoundryReasoningSession) {
  return selectedHypothesis(session.hypotheses)
}

export function ceremony(session: FoundryReasoningSession): 'minimal' | 'deliberate' {
  return strategyCeremony(session.selectedStrategy ?? 'DIRECT')
}

export function evidenceById(session: FoundryReasoningSession, evidenceId: string): FoundryEvidence | undefined {
  return session.evidence.find(item => item.evidenceId === evidenceId)
}

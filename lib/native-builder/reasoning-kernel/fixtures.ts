/**
 * Deterministic FRK fixtures. No model calls and no filesystem mutations.
 */
import type { FoundryReasoningSession } from './types'
import {
  activeHypothesis,
  addArchitectures,
  addCandidatePlans,
  addSessionContradiction,
  addSessionEvidence,
  addSessionHypothesis,
  adversarialReview,
  ceremony,
  chargeSession,
  chooseSessionPlan,
  comparePrediction,
  createFoundryReasoningSession,
  critiqueSession,
  declareDecision,
  decomposeSession,
  deescalateSession,
  escalateSession,
  graphInvariant,
  ingestWorkerOutput,
  lessonsFor,
  markWorkerUnavailable,
  metaReason,
  noteCapabilityFailure,
  noteCapabilitySuccess,
  observeSession,
  predictOutcome,
  recordPatchAttempt,
  recordRootCause,
  recordRoutingEvidence,
  refreshProjectReady,
  rememberLesson,
  requestBudgetRaise,
  requestDiscriminatingEvidence,
  restoreSession,
  runBoundedSession,
  searchCounterexamples,
  selectEvidenceTool,
  selectSessionStrategy,
  serializeSession,
  verifyFidelity,
  verifySessionClaim,
  applyMutation,
  queueMutation,
  capabilityAtlasStatus,
} from './orchestrator'

export type FixtureResult = { name: string; pass: boolean; detail: string }

function result(name: string, pass: boolean, detail: string): FixtureResult {
  return { name, pass, detail }
}

const CATALOG = `export function lookup(parts, id) {
  const blob = JSON.stringify(parts)
  for (const part of parts) {
    const again = JSON.parse(blob)
    if (part.id === id) return again
  }
}
`

export function fixtureA(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-a',
    goal: 'Explain why lookup parses the catalog on every row.',
    acceptanceConditions: ['The surviving hypothesis matches the source.'],
    signals: { ambiguity: 'high', uncertaintyCount: 2 },
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  const outside = addSessionHypothesis(session, 'The parse already moved outside the loop.', ['JSON.parse sits before the loop'])
  const inside = addSessionHypothesis(session, 'The parse is still inside the loop.', ['JSON.parse sits inside the for loop'])
  const requestId = requestDiscriminatingEvidence(session, 'Whether JSON.parse is inside the for loop.')
  const evidence = addSessionEvidence(session, {
    source: 'SOURCE_CODE',
    statement: 'catalog.mjs still calls JSON.parse inside the for loop.',
    actor: 'file.read',
    ref: 'catalog.mjs',
    supportsHypothesisIds: [inside],
    contradictsHypothesisIds: [outside],
  })
  const selected = activeHypothesis(session)
  const rejected = session.hypotheses.find(item => item.hypothesisId === outside)
  const pass = session.selectedStrategy === 'HYPOTHESIS_COMPETITION'
    && session.evidenceRequests.some(item => item.requestId === requestId && item.hypothesisIds.length === 2)
    && evidence.ok
    && selected?.hypothesisId === inside
    && rejected?.status === 'REJECTED'
  return result('FIXTURE_A', pass, `${selected?.claim ?? 'none'} rejected=${rejected?.status}`)
}

export function fixtureB(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-b',
    goal: 'Move catalog parsing outside the loop.',
    constraints: ['Do not raise a LIMIT constant.'],
    now: '2026-09-22T00:00:00.000Z',
  })
  verifyFidelity(session, {
    symptom: 'lookup() parses the whole catalog again on every row. Return the matching part and keep parses near one.',
    constraints: ['Do not raise a LIMIT constant.'],
    approach: 'parse catalog once outside the loop',
    rootCause: 'The blob is re-parsed in every loop cycle.',
    files: { 'catalog.mjs': CATALOG },
    workerText: 'fixed. the parse moved outside the loop',
  })
  const claim = session.verificationState.claims[0]
  const pass = session.contradictions.some(item => item.type === 'MODEL_VS_SOURCE')
    && session.fidelity.reinspected
    && session.fidelity.status === 'CONTRADICTED'
    && claim?.status !== 'PROVEN'
    && session.verificationState.projectReady === false
  return result('FIXTURE_B', pass, `${session.fidelity.status} claim=${claim?.status} ready=${session.verificationState.projectReady}`)
}

export function fixtureC(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-c',
    goal: 'Expect the targeted test to pass after the edit.',
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  const plan = addCandidatePlans(session, [{ label: 'A', summary: 'edit the parser', coversAcceptance: true }])
  void plan
  chooseSessionPlan(session)
  const before = session.currentPlan?.planId
  const predictionId = predictOutcome(session, {
    expectedFileChange: 'parser updated',
    expectedTestOutcome: 'pass',
    expectedRuntimeEffect: 'one parse per call',
  })
  observeSession(session, { summary: 'test command failed', predictionId, planId: before ?? undefined })
  comparePrediction(session, predictionId, 'fail')
  const pass = session.contradictions.some(item => item.type === 'PREDICTION_VS_RUNTIME')
    && session.resourceState.replans === 1
    && session.currentPlan?.planId !== before
    && session.status === 'REPLANNING'
  return result('FIXTURE_C', pass, `replans=${session.resourceState.replans} plan=${session.currentPlan?.label}`)
}

export function fixtureD(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-d',
    goal: 'Rename a local variable in one function.',
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  const pass = (session.selectedDepth === 'R0' || session.selectedDepth === 'R1')
    && session.selectedStrategy === 'DIRECT'
    && session.selectedDepth !== 'R4'
    && session.resourceState.searchBranches === 0
    && ceremony(session) === 'minimal'
  return result('FIXTURE_D', pass, `${session.selectedStrategy} ${session.selectedDepth} branches=${session.resourceState.searchBranches}`)
}

export function fixtureE(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-e',
    goal: 'A cross-layer bug may be in the route or the store.',
    signals: { ambiguity: 'medium', componentCount: 2, blastRadius: 'module' },
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  const started = session.selectedDepth
  session.signals = { ...session.signals, ambiguity: 'high', blastRadius: 'cross-layer', componentCount: 3 }
  addSessionContradiction(session, 'EVIDENCE_VS_EVIDENCE', 'Route log and store row disagree.', true)
  escalateSession(session, 'contradiction')
  session.capabilitySignals.push({ capability: 'CROSS_LAYER_REASONING', gap: true, evidence: 'cross-layer contradiction' })
  const pass = started === 'R1'
    && session.depthHistory.includes('R2')
    && session.selectedDepth !== started
    && session.selectedDepth !== 'R4'
  return result('FIXTURE_E', pass, `${session.depthHistory.join('→')}`)
}

export function fixtureF(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-f',
    goal: 'Stop repeating the same patch.',
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  const before = session.selectedStrategy
  const attempt = { hypothesisId: 'h', planId: 'p', patchRegion: 'catalog.mjs:lookup', failureEvidence: 'parse still inside loop' }
  recordPatchAttempt(session, attempt)
  recordPatchAttempt(session, attempt)
  const pass = session.stagnation.detected
    && session.stagnation.response === 'strategy_change'
    && session.selectedStrategy !== before
  return result('FIXTURE_F', pass, `${before} → ${session.selectedStrategy} repeats=${session.stagnation.repeats}`)
}

export function fixtureG(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-g',
    goal: 'Accept an order only when the shelf has stock.',
    constraints: ['Empty shelf must not count as stock.'],
    acceptanceConditions: ['Empty input is rejected.'],
    now: '2026-09-22T00:00:00.000Z',
  })
  const missing = addSessionEvidence(session, {
    source: 'SOURCE_CODE',
    statement: 'accept() returns true when items is empty.',
    actor: 'file.read',
    ref: 'order.mjs',
  })
  const critique = critiqueSession(session, {
    category: 'MISSING_EDGE_CASE',
    summary: 'Empty shelf still accepts the order.',
    blocksAcceptance: true,
    problem: session.problemModel.goal,
    constraints: session.constraints,
    plan: 'return true for any items array',
    source: 'function accept(items) { return true }',
    evidence: 'empty array returns true',
  })
  verifySessionClaim(session, {
    claim: 'done',
    supportingEvidenceIds: [],
    contradictingEvidenceIds: missing.evidenceId ? [missing.evidenceId] : [],
    workerText: 'done',
  })
  const pass = critique.ok
    && session.verificationState.projectReady === false
    && session.status === 'READY_REFUSED'
    && session.verificationState.claims.every(item => item.status !== 'PROVEN')
  return result('FIXTURE_G', pass, session.verificationState.refusal ?? 'none')
}

export function fixtureH(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-h',
    goal: 'Remember a reusable parse pattern.',
    now: '2026-09-22T00:00:00.000Z',
  })
  const hidden = rememberLesson(session, {
    pattern: 'repeated parse inside a loop',
    context: 'catalog lookup',
    failedApproach: 'GRAD_HIDDEN expected return is the sealed answer',
    evidence: ['source inspection'],
    applicability: 'parsers',
    antiPattern: 'hidden verifier answer',
    capabilityFamily: 'PLAN_TO_CODE_FIDELITY',
  })
  const kept = rememberLesson(session, {
    pattern: 'repeated parse inside a loop',
    context: 'move the parse before the iteration',
    successfulApproach: 'parse once before the loop',
    evidence: ['source inspection'],
    applicability: 'parsers',
    capabilityFamily: 'PLAN_TO_CODE_FIDELITY',
  })
  const retrieved = lessonsFor(session, { pattern: 'parse', capabilityFamily: 'PLAN_TO_CODE_FIDELITY' })
  const pass = hidden.ok === false
    && session.lessons.length === 1
    && kept.ok
    && retrieved.length === 1
    && retrieved[0].sameAnswer === false
    && retrieved[0].similarPattern === true
  return result('FIXTURE_H', pass, hidden.reason)
}

export function fixtureI(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-i',
    goal: 'Resume after a restart without repeating a mutation.',
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  const mutationId = queueMutation(session, 'replace the parse site')
  const first = applyMutation(session, mutationId)
  const nodes = session.reasoningGraph.nodes.length
  const restored = restoreSession(serializeSession(session))
  const second = applyMutation(restored, mutationId)
  const pass = first.applied
    && second.skipped
    && restored.appliedMutationIds.length === 1
    && restored.reasoningGraph.nodes.length === nodes
    && restored.selectedStrategy === session.selectedStrategy
  return result('FIXTURE_I', pass, `skipped=${second.skipped} nodes=${restored.reasoningGraph.nodes.length}`)
}

export function fixtureJ(): FixtureResult {
  const session = createFoundryReasoningSession({
    missionId: 'frk-j',
    goal: 'Keep state when the worker is down.',
    signals: { ambiguity: 'high', uncertaintyCount: 2 },
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  addSessionHypothesis(session, 'The store write is the cause.', ['write log'])
  const before = JSON.stringify({
    graph: session.reasoningGraph,
    hypotheses: session.hypotheses,
    evidence: session.evidence,
  })
  markWorkerUnavailable(session, 'No reasoning worker is configured.')
  const after = JSON.stringify({
    graph: session.reasoningGraph,
    hypotheses: session.hypotheses,
    evidence: session.evidence,
  })
  const pass = session.status === 'BLOCKED_PROVIDER'
    && session.stopReason === 'BLOCKED_PROVIDER'
    && before === after
  return result('FIXTURE_J', pass, session.status)
}

export function additionalKernelCases(): FixtureResult[] {
  const cases: FixtureResult[] = []
  const simple = createFoundryReasoningSession({ missionId: 'frk-depth', goal: 'Obvious rename.', now: '2026-09-22T00:00:00.000Z' })
  selectSessionStrategy(simple)
  cases.push(result('DEPTH_NOT_MAX', simple.selectedDepth === 'R0', simple.selectedDepth ?? 'none'))

  const deep = createFoundryReasoningSession({
    missionId: 'frk-r4',
    goal: 'Unresolved multi-component repair.',
    signals: { ambiguity: 'high', componentCount: 4, blastRadius: 'cross-layer', previousFailures: 2, budgetAllowsDeepSearch: true },
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(deep)
  cases.push(result('R4_LIMIT', deep.selectedDepth === 'R4' && deep.resourceState.limits.searchBranches <= 4 && deep.resourceState.limits.workerCalls <= 8, `${deep.selectedDepth} branches<=${deep.resourceState.limits.searchBranches}`))
  addSessionHypothesis(deep, 'One remaining explanation.')
  deep.contradictions = []
  deescalateSession(deep)
  cases.push(result('DEESCALATE', deep.selectedDepth === 'R1' && deep.depthHistory.includes('R4'), deep.depthHistory.join('→')))

  const decomposed = createFoundryReasoningSession({
    missionId: 'frk-split',
    goal: 'Split the change.',
    acceptanceConditions: ['Parent acceptance stays attached.'],
    signals: { separable: true, componentCount: 2, ambiguity: 'low' },
    now: '2026-09-22T00:00:00.000Z',
  })
  const children = decomposeSession(decomposed, ['route', 'store'])
  const summaries = decomposed.reasoningGraph.nodes.filter(node => node.type === 'SUBPROBLEM').map(node => node.summary).join(' ')
  cases.push(result('DECOMPOSE', children.length === 2 && summaries.includes('Parent acceptance stays attached.'), summaries))

  const cause = createFoundryReasoningSession({ missionId: 'frk-cause', goal: 'Symptom is in the UI.', now: '2026-09-22T00:00:00.000Z' })
  const evidence = addSessionEvidence(cause, { source: 'RUNTIME_OUTPUT', statement: 'The store writes the stale id.', actor: 'process.status', ref: 'log:12' })
  const rooted = recordRootCause(cause, {
    symptom: 'The panel shows the old id.',
    candidateCauses: ['render bug', 'stale store write'],
    evidenceIds: evidence.evidenceId ? [evidence.evidenceId] : [],
    rootCause: 'The store writes the stale id.',
    repairImplication: 'Repair the store, not the panel copy.',
  })
  const missingEvidence = recordRootCause(cause, { symptom: 'x', candidateCauses: ['y'], evidenceIds: [], rootCause: 'guess' })
  cases.push(result('ROOT_CAUSE', rooted.ok && cause.rootCause?.rootCause === 'The store writes the stale id.' && missingEvidence.ok === false, cause.rootCause?.repairImplication ?? 'none'))

  const design = createFoundryReasoningSession({ missionId: 'frk-arch', goal: 'Choose a storage shape.', signals: { designTask: true }, now: '2026-09-22T00:00:00.000Z' })
  selectSessionStrategy(design)
  addArchitectures(design, [
    {
      name: 'embedded',
      requirementsCoverage: 'misses the acceptance condition',
      complexity: 'small',
      dependencies: 'none',
      failureModes: 'data loss',
      operationalCost: 'low',
      migrationDifficulty: 'low',
      testability: 'high',
      securityImplications: 'local only',
      coversAcceptance: false,
    },
    {
      name: 'service',
      requirementsCoverage: 'covers the acceptance condition',
      complexity: 'moderate',
      dependencies: 'one local process',
      failureModes: 'process down',
      operationalCost: 'one process',
      migrationDifficulty: 'moderate',
      testability: 'contract tests',
      securityImplications: 'local socket',
      coversAcceptance: true,
    },
  ])
  cases.push(result('ARCHITECTURE', design.selectedStrategy === 'ARCHITECTURE_COMPARISON' && design.selectedArchitectureId !== null && !JSON.stringify(design.architectures).includes('"score"'), design.directionChanges.at(-1) ?? ''))

  const plans = createFoundryReasoningSession({ missionId: 'frk-plans', goal: 'Pick one plan.', signals: { wantsPlanSearch: true }, now: '2026-09-22T00:00:00.000Z' })
  selectSessionStrategy(plans)
  addCandidatePlans(plans, [
    { label: 'A', summary: 'rewrite the module', coversAcceptance: false },
    { label: 'B', summary: 'change the one call', coversAcceptance: true },
    { label: 'C', summary: 'add a framework', coversAcceptance: false },
  ])
  const chosen = chooseSessionPlan(plans)
  cases.push(result('PLAN_SEARCH', plans.selectedStrategy === 'PLAN_SEARCH' && chosen?.label === 'B' && plans.candidatePlans.every(item => item.executed === false) && plans.candidatePlans.filter(item => item.selected).length === 1, chosen?.label ?? 'none'))

  const counter = createFoundryReasoningSession({ missionId: 'frk-counter', goal: 'Check edges.', signals: { securitySensitive: true }, now: '2026-09-22T00:00:00.000Z' })
  selectSessionStrategy(counter)
  const questions = searchCounterexamples(counter)
  cases.push(result('COUNTEREXAMPLE', counter.selectedStrategy === 'COUNTEREXAMPLE_SEARCH' && questions.length === 8, String(questions.length)))

  const grounded = createFoundryReasoningSession({ missionId: 'frk-graph', goal: 'Ground the decision.', now: '2026-09-22T00:00:00.000Z' })
  const refused = declareDecision(grounded, { summary: 'certain', certainty: 'KNOWN' })
  const known = addSessionEvidence(grounded, { source: 'TEST_RESULT', statement: 'the test passed', actor: 'test.run', ref: 'suite' })
  const decided = declareDecision(grounded, { summary: 'the test passed', evidenceId: known.evidenceId, certainty: 'KNOWN' })
  const assumptionSession = createFoundryReasoningSession({
    missionId: 'frk-assume',
    goal: 'Track an open assumption.',
    assumptions: [{ statement: 'The clock is monotonic.', reason: 'single process', risk: 'restart', howToVerify: 'restart the process' }],
    now: '2026-09-22T00:00:00.000Z',
  })
  const openAssumption = assumptionSession.assumptions[0]
  const assumed = declareDecision(assumptionSession, { summary: 'timing is safe', assumptionId: openAssumption.assumptionId, certainty: 'KNOWN' })
  const marked = declareDecision(assumptionSession, { summary: 'timing is assumed', assumptionId: openAssumption.assumptionId, certainty: 'POSSIBLE' })
  const invariant = graphInvariant(grounded.reasoningGraph)
  const assumedGraph = graphInvariant(assumptionSession.reasoningGraph)
  cases.push(result('GRAPH_INVARIANT', refused.ok === false && decided.ok && assumed.ok === false && marked.ok && invariant.ok && assumedGraph.ok && assumptionSession.reasoningGraph.nodes.some(node => node.assumptionUnresolved), `${refused.reason} ${assumed.reason}`))

  const buckets = createFoundryReasoningSession({
    missionId: 'frk-buckets',
    goal: 'Separate fact classes.',
    knownFacts: ['The file exists.'],
    inferences: [{ statement: 'The loop is the hot path.', uncertainty: 'LIKELY' }],
    assumptions: [{ statement: 'Input is an array.', reason: 'caller', risk: 'null', howToVerify: 'read the caller' }],
    unknowns: ['Whether production data is empty.'],
    now: '2026-09-22T00:00:00.000Z',
  })
  const model = buckets.problemModel
  cases.push(result(
    'PROBLEM_MODEL',
    model.knownFacts[0]?.uncertainty === 'KNOWN'
      && model.inferences[0]?.uncertainty === 'LIKELY'
      && model.assumptions[0]?.status === 'OPEN'
      && model.unknowns[0]?.uncertainty === 'UNKNOWN',
    `${model.knownFacts.length}/${model.inferences.length}/${model.assumptions.length}/${model.unknowns.length}`,
  ))

  const blocked = createFoundryReasoningSession({ missionId: 'frk-budget', goal: 'Stay inside budget.', limits: { workerCalls: 1 }, now: '2026-09-22T00:00:00.000Z' })
  const firstCharge = chargeSession(blocked, 'workerCalls', 1)
  const secondCharge = chargeSession(blocked, 'workerCalls', 1)
  const raised = requestBudgetRaise(blocked)
  cases.push(result('BUDGET', firstCharge.ok && secondCharge.ok === false && raised.ok === false && raised.code === 'AUTOMATIC_BUDGET_INCREASE_REFUSED' && blocked.resourceState.limits.workerCalls === 1, raised.code))

  const loop = createFoundryReasoningSession({ missionId: 'frk-loop', goal: 'Stop.', limits: { maxSteps: 3 }, now: '2026-09-22T00:00:00.000Z' })
  runBoundedSession(loop)
  cases.push(result('BOUNDED_LOOP', loop.stopReason === 'BUDGET_EXHAUSTED' && loop.stepCount <= 3, `steps=${loop.stepCount}`))

  const meta = createFoundryReasoningSession({ missionId: 'frk-meta', goal: 'Switch when stuck.', signals: { componentCount: 3 }, now: '2026-09-22T00:00:00.000Z' })
  selectSessionStrategy(meta)
  meta.selectedStrategy = 'DIRECT'
  const decision = metaReason(meta)
  cases.push(result('META', decision === 'DECOMPOSE' && meta.metaDecisions.length === 1, decision))

  const tool = createFoundryReasoningSession({ missionId: 'frk-tool', goal: 'Read the source.', now: '2026-09-22T00:00:00.000Z' })
  const selectedTool = selectEvidenceTool(tool, 'read the parse site')
  cases.push(result('TOOL_SELECTION', selectedTool.executed === false && selectedTool.toolFamily === 'file.read', selectedTool.toolFamily))

  const practiced = createFoundryReasoningSession({ missionId: 'frk-practice', goal: 'Practice a gap.', now: '2026-09-22T00:00:00.000Z' })
  noteCapabilityFailure(practiced, 'AMBIGUITY_RESOLUTION', 'two hypotheses stayed open')
  noteCapabilitySuccess(practiced)
  noteCapabilitySuccess(practiced)
  noteCapabilitySuccess(practiced)
  const beforeDim = 1 + 1 + 1 + 1 + 1
  const afterDim = practiced.difficulty.ambiguity + practiced.difficulty.components + practiced.difficulty.constraints + practiced.difficulty.failureModes + practiced.difficulty.integrationDepth
  cases.push(result(
    'PRACTICE_AND_DIFFICULTY',
    practiced.practice.length === 1
      && practiced.practice[0].commanderProjectsBlocked === false
      && practiced.commanderProjectsBlocked === false
      && afterDim === beforeDim + 1
      && capabilityAtlasStatus() === 'EVALUATED',
    `dimensions=${afterDim} atlas=${capabilityAtlasStatus()}`,
  ))

  const routed = createFoundryReasoningSession({ missionId: 'frk-route', goal: 'Record routing evidence.', now: '2026-09-22T00:00:00.000Z' })
  selectSessionStrategy(routed)
  recordRoutingEvidence(routed, { problemFamily: 'localized-edit', provider: 'configured-worker', model: 'worker', result: 'proposal', verification: 'unresolved' })
  cases.push(result('ROUTING_EVIDENCE', routed.routingEvidence[0]?.policyChanged === false, routed.routingEvidence[0]?.provider ?? 'none'))

  const worker = createFoundryReasoningSession({ missionId: 'frk-worker', goal: 'Validate a proposal.', now: '2026-09-22T00:00:00.000Z' })
  const rejected = ingestWorkerOutput(worker, { task: 'repair', summary: 'please commit and push', declaredDone: true }, 'repair')
  const accepted = ingestWorkerOutput(worker, {
    task: 'hypotheses',
    summary: 'Two explanations remain.',
    hypotheses: [
      { claim: 'parse is inside the loop', predictedEvidence: ['source'] },
      { claim: 'parse is outside the loop', predictedEvidence: ['source'] },
    ],
  }, 'hypotheses')
  const proven = verifySessionClaim(worker, { claim: 'done', supportingEvidenceIds: [], contradictingEvidenceIds: [], workerText: 'done' })
  void proven
  cases.push(result('WORKER_VALIDATION', rejected.ok === false && accepted.ok && worker.hypotheses.length === 2 && worker.verificationState.claims.every(item => item.status !== 'PROVEN'), rejected.reason))

  const missingProv = addSessionEvidence(createFoundryReasoningSession({ missionId: 'frk-prov', goal: 'Need provenance.', now: '2026-09-22T00:00:00.000Z' }), {
    source: 'FILE_CONTENT',
    statement: 'bytes',
    actor: '',
    ref: '',
  })
  cases.push(result('PROVENANCE', missingProv.ok === false, missingProv.reason ?? 'ok'))

  const ready = createFoundryReasoningSession({
    missionId: 'frk-ready',
    goal: 'Prove the test.',
    acceptanceConditions: ['The test passed.'],
    now: '2026-09-22T00:00:00.000Z',
  })
  const testEvidence = addSessionEvidence(ready, { source: 'TEST_RESULT', statement: 'exit 0', actor: 'test.run', ref: 'npm test' })
  verifySessionClaim(ready, { claim: 'The test passed.', supportingEvidenceIds: testEvidence.evidenceId ? [testEvidence.evidenceId] : [], contradictingEvidenceIds: [] })
  refreshProjectReady(ready)
  cases.push(result('VERIFICATION_TRUTH', ready.verificationState.projectReady && ready.verificationState.claims[0]?.status === 'PROVEN', ready.verificationState.claims[0]?.status ?? 'none'))

  const privateSession = createFoundryReasoningSession({ missionId: 'frk-private', goal: '<thinking>secret chain of thought</thinking> Rename the variable.', now: '2026-09-22T00:00:00.000Z' })
  const serialized = serializeSession(privateSession)
  cases.push(result('NO_PRIVATE_REASONING', !serialized.includes('<thinking>') && !serialized.includes('chain of thought'), 'serialized'))

  return cases
}

export function runFixtureSuite(): FixtureResult[] {
  return [
    fixtureA(),
    fixtureB(),
    fixtureC(),
    fixtureD(),
    fixtureE(),
    fixtureF(),
    fixtureG(),
    fixtureH(),
    fixtureI(),
    fixtureJ(),
    ...additionalKernelCases(),
  ]
}

export function sessionSnapshot(session: FoundryReasoningSession): string {
  return serializeSession(session)
}

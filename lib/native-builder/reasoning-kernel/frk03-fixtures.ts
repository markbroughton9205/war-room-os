/**
 * FRK-03 fixtures. Session files stay in the caller-supplied directory.
 */
import { explainSession, serializeSession, restoreSession, createFoundryReasoningSession, markWorkerUnavailable, selectSessionStrategy } from './orchestrator'
import { reasoningPanelText } from './brief-view'
import { ensureLiveMissionReasoning, type ReasoningMissionHost } from './mission-lifecycle'
import {
  classifyEvidenceToolCost,
  collapseDepth,
  estimateEvidenceGain,
  preferEvidenceAction,
  profileFor,
  refuseDeepSearchWithoutBudget,
  respondToBlockingCritic,
  runMetaController,
  switchAfterRepeatedFailure,
} from './strategy-intelligence'
import { saveCanonicalSession, loadCanonicalSession } from './persistence'
import type { FoundryReasoningSession } from './types'

export type Frk03Result = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): Frk03Result {
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

export async function runFrk03Fixtures(root: string, sessionFileCount: (dir: string) => number): Promise<Frk03Result[]> {
  const results: Frk03Result[] = []
  const simple = sessionFor('frk03-a', 'Rename one local variable.')
  results.push(check('FIXTURE_A', simple.selectedStrategy === 'DIRECT' && simple.selectedDepth === 'R0', `${simple.selectedStrategy} ${simple.selectedDepth}`))

  const ambiguous = sessionFor('frk03-b', 'Three causes could explain the wrong total.', { ambiguity: 'high', uncertaintyCount: 2 })
  results.push(check('FIXTURE_B', ambiguous.selectedStrategy === 'HYPOTHESIS_COMPETITION' && ambiguous.selectedDepth === 'R2', `${ambiguous.selectedStrategy} ${ambiguous.selectedDepth}`))

  const repair = sessionFor('frk03-c', 'The same local patch failed again.')
  repair.signals.previousFailures = 2
  repair.signals.symptomMayDifferFromCause = true
  const before = repair.selectedStrategy
  const switched = switchAfterRepeatedFailure(repair)
  results.push(check('FIXTURE_C', before === 'DIRECT' && (switched === 'ROOT_CAUSE' || switched === 'REPAIR_LOOP'), `${before} -> ${switched}`))

  const verify = sessionFor('frk03-d', 'Inspect the response before editing.', { verificationFirst: true })
  results.push(check('FIXTURE_D', verify.selectedStrategy === 'VERIFICATION_FIRST', verify.selectedStrategy ?? 'none'))

  const layered = sessionFor('frk03-e', 'Split a cross-layer change.', { separable: true, componentCount: 3, blastRadius: 'cross-layer', ambiguity: 'low' })
  results.push(check('FIXTURE_E', layered.selectedStrategy === 'DECOMPOSE', layered.selectedStrategy ?? 'none'))

  const critic = sessionFor('frk03-f', 'The repair misses an empty shelf.', { regressionRisk: 'medium' })
  critic.criticFindings.push({
    findingId: 'critic-1',
    category: 'MISSING_EDGE_CASE',
    summary: 'empty shelf is untested',
    blocksAcceptance: true,
    resolved: false,
    sawSource: true,
  })
  const criticResult = respondToBlockingCritic(critic)
  results.push(check('FIXTURE_F', criticResult.depth === 'R3' && criticResult.branchOpened && critic.search.branches.some(item => item.kind === 'counterexample'), criticResult.depth))

  const drop = sessionFor('frk03-g', 'Evidence has collapsed the question.', { ambiguity: 'high', uncertaintyCount: 2 })
  const dropped = collapseDepth(drop)
  results.push(check('FIXTURE_G', drop.selectedDepth === 'R2' ? false : dropped === 'R1', `${drop.depthHistory.join('→')}`))

  const capped = sessionFor('frk03-h', 'Deep search is wanted but the budget is closed.', {
    ambiguity: 'high',
    componentCount: 4,
    blastRadius: 'cross-layer',
    previousFailures: 2,
    budgetAllowsDeepSearch: false,
  })
  const refused = refuseDeepSearchWithoutBudget(capped)
  results.push(check('FIXTURE_H', refused.refused && refused.depth !== 'R4', refused.depth ?? 'none'))

  const durable = sessionFor('frk03-i', 'Keep the strategy across restart.', { ambiguity: 'high', uncertaintyCount: 2 })
  const beforeDecision = durable.strategyDecisions.map(item => item.decisionId).join(',')
  await saveCanonicalSession(root, durable)
  const restored = await loadCanonicalSession(root, durable.sessionId)
  results.push(check(
    'FRK_03_STRATEGY_RESTART_RECOVERY',
    restored.selectedStrategy === durable.selectedStrategy
      && restored.selectedDepth === durable.selectedDepth
      && restored.strategyDecisions.map(item => item.decisionId).join(',') === beforeDecision
      && restored.strategyTrigger === durable.strategyTrigger,
    restored.selectedStrategy ?? 'none',
  ))

  const blocked = sessionFor('frk03-j', 'The worker dropped.', { ambiguity: 'medium', componentCount: 2 })
  const strategyBefore = blocked.selectedStrategy
  const decisionsBefore = blocked.strategyDecisions.length
  markWorkerUnavailable(blocked, 'worker unavailable')
  results.push(check('FIXTURE_J', blocked.status === 'BLOCKED_PROVIDER' && blocked.selectedStrategy === strategyBefore && blocked.strategyDecisions.length === decisionsBefore, blocked.status))

  const started = host('frk03-start', 'Attach reasoning when the mission starts.')
  const first = await ensureLiveMissionReasoning(started, 'START', root)
  const second = await ensureLiveMissionReasoning(started, 'START', root)
  const resumedHost: ReasoningMissionHost = {
    missionId: started.missionId,
    goal: started.goal,
    reasoningSessionId: started.reasoningSessionId,
    createdAt: started.createdAt,
  }
  const resumed = await ensureLiveMissionReasoning(resumedHost, 'RESUME', root)
  const missing: ReasoningMissionHost = { missionId: 'frk03-missing', goal: 'missing session', reasoningSessionId: 'frk-missing-session' }
  const untrusted = await ensureLiveMissionReasoning(missing, 'RESUME', root)
  results.push(check('LIVE_MISSION_REASONING_AUTO_ATTACH', first.ok && Boolean(started.reasoningSessionId) && Boolean(started.reasoningBrief?.strategy), started.reasoningStatus ?? 'none'))
  results.push(check('LIVE_MISSION_REASONING_RESUME', resumed.ok && resumedHost.reasoningSessionId === started.reasoningSessionId && resumed.status === 'RESUME', resumed.status))
  results.push(check('LIVE_MISSION_DUPLICATE_SESSION', second.duplicateSession === false && second.ok && sessionFileCount(root) >= 1 && started.reasoningSessionId === resumedHost.reasoningSessionId, String(sessionFileCount(root))))
  results.push(check('MISSING_SESSION_FAILS_CLOSED', untrusted.status === 'REASONING_STATE_UNTRUSTED' && missing.reasoningSessionId === 'frk-missing-session', untrusted.status))

  const meta = sessionFor('frk03-meta', 'Ask whether the strategy is working.')
  const metaResult = runMetaController(meta)
  const cappedMeta = sessionFor('frk03-meta-cap', 'Stop meta reasoning at the cap.')
  cappedMeta.metaSteps = 8
  const blockedMeta = runMetaController(cappedMeta)
  results.push(check('META_REASONING_CONTROLLER', metaResult.bounded && metaResult.decision === 'CONTINUE' && blockedMeta.decision === 'BLOCK', `${metaResult.decision}/${blockedMeta.decision}`))

  const read = { name: 'file.read', gain: estimateEvidenceGain({ discriminates: 2, known: true }), cost: classifyEvidenceToolCost('file.read') }
  const rewrite = { name: 'large rewrite', gain: estimateEvidenceGain({ discriminates: 0, known: true }), cost: classifyEvidenceToolCost('large rewrite') }
  const chosen = preferEvidenceAction(read, rewrite)
  results.push(check('EVIDENCE_GAIN_REASONING', read.gain === 'HIGH' && read.cost === 'CHEAP' && rewrite.cost === 'EXPENSIVE' && chosen.name === 'file.read', `${chosen.name} ${read.gain}`))

  const profile = profileFor('DIRECT')
  results.push(check('STRATEGY_PROFILE', profile.goodFor.includes('low ambiguity') && profile.resourceClass === 'CHEAP', profile.strategy))

  const panel = reasoningPanelText(explainSession(simple))
  results.push(check('STRATEGY_UI', panel.includes('Why:') && panel.includes('Previous:') && panel.includes('Trigger:') && panel.includes('DIRECT'), 'panel'))

  const roundTrip = restoreSession(serializeSession(durable))
  results.push(check('STRATEGY_DECISION_PERSISTED', roundTrip.strategyDecisions.length > 0 && roundTrip.strategyDecisions[0].selectedStrategy === durable.selectedStrategy, String(roundTrip.strategyDecisions.length)))
  return results
}

function host(missionId: string, goal: string): ReasoningMissionHost {
  return { missionId, goal, userRequest: goal, createdAt: '2026-09-22T00:00:00.000Z' }
}

/**
 * Adaptive strategy selection and a bounded meta-reasoning controller.
 * One decision per call. The controller does not call itself.
 */
import { escalateDepth, deescalateDepth, selectDepth } from './depth-controller'
import { applySearchBudget, openBranch } from './search'
import { nextSessionId } from './session'
import { selectStrategy } from './strategy-selector'
import { clipText } from './text'
import type { EvidenceGainEstimate, EvidenceToolCost, FoundryStrategyDecision, FoundryStrategyProfile, FrkMetaControllerResult } from './program-types'
import { FRK_META_DECISIONS, FRK_STRATEGIES, type FoundryReasoningSession, type FoundryReasoningStrategy, type FrkDepth, type FrkMetaDecision } from './types'

const META_STEP_CAP = 8

export const STRATEGY_PROFILES: FoundryStrategyProfile[] = [
  { strategy: 'DIRECT', goodFor: ['clear task', 'low ambiguity', 'low blast radius'], poorFor: ['several plausible causes', 'cross-layer scope'], ambiguityRange: 'low', componentRange: '1', crossLayerSuitability: 'no', uncertaintySuitability: 'low', failureHistorySuitability: 'none', securitySensitivity: 'avoid', regressionSensitivity: 'avoid', evidenceRequirement: 'local observation', verificationRequirement: 'one check', resourceClass: 'CHEAP' },
  { strategy: 'DECOMPOSE', goodFor: ['separable components', 'cross-layer scope'], poorFor: ['single local edit'], ambiguityRange: 'any', componentRange: '2+', crossLayerSuitability: 'yes', uncertaintySuitability: 'medium', failureHistorySuitability: 'none', securitySensitivity: 'neutral', regressionSensitivity: 'neutral', evidenceRequirement: 'component boundaries', verificationRequirement: 'per component', resourceClass: 'MODERATE' },
  { strategy: 'HYPOTHESIS_COMPETITION', goodFor: ['multiple plausible causes'], poorFor: ['already observed root cause'], ambiguityRange: 'high', componentRange: '1+', crossLayerSuitability: 'optional', uncertaintySuitability: 'high', failureHistorySuitability: 'some', securitySensitivity: 'neutral', regressionSensitivity: 'neutral', evidenceRequirement: 'discriminating observation', verificationRequirement: 'rejected alternatives', resourceClass: 'MODERATE' },
  { strategy: 'ROOT_CAUSE', goodFor: ['symptom differs from cause', 'repeated local failure'], poorFor: ['cause already observed'], ambiguityRange: 'medium', componentRange: '1+', crossLayerSuitability: 'optional', uncertaintySuitability: 'medium', failureHistorySuitability: 'repeated', securitySensitivity: 'neutral', regressionSensitivity: 'neutral', evidenceRequirement: 'causal observation', verificationRequirement: 'cause removed', resourceClass: 'MODERATE' },
  { strategy: 'ARCHITECTURE_COMPARISON', goodFor: ['multiple viable designs'], poorFor: ['one forced layout'], ambiguityRange: 'medium', componentRange: '2+', crossLayerSuitability: 'yes', uncertaintySuitability: 'medium', failureHistorySuitability: 'none', securitySensitivity: 'neutral', regressionSensitivity: 'preferred', evidenceRequirement: 'constraint coverage', verificationRequirement: 'one selected design', resourceClass: 'MODERATE' },
  { strategy: 'COUNTEREXAMPLE_SEARCH', goodFor: ['plausible solution', 'security or regression risk'], poorFor: ['trivial rename'], ambiguityRange: 'medium', componentRange: '1+', crossLayerSuitability: 'optional', uncertaintySuitability: 'medium', failureHistorySuitability: 'some', securitySensitivity: 'preferred', regressionSensitivity: 'preferred', evidenceRequirement: 'failing case', verificationRequirement: 'counterexample confirmed or refuted', resourceClass: 'MODERATE' },
  { strategy: 'VERIFICATION_FIRST', goodFor: ['cheap unknown observation'], poorFor: ['observation already in hand'], ambiguityRange: 'any', componentRange: '1+', crossLayerSuitability: 'optional', uncertaintySuitability: 'high', failureHistorySuitability: 'some', securitySensitivity: 'neutral', regressionSensitivity: 'neutral', evidenceRequirement: 'inspect before edit', verificationRequirement: 'observation recorded', resourceClass: 'CHEAP' },
  { strategy: 'PLAN_SEARCH', goodFor: ['several implementation approaches'], poorFor: ['one obvious edit'], ambiguityRange: 'low', componentRange: '2+', crossLayerSuitability: 'optional', uncertaintySuitability: 'medium', failureHistorySuitability: 'none', securitySensitivity: 'neutral', regressionSensitivity: 'neutral', evidenceRequirement: 'constraint comparison', verificationRequirement: 'one plan selected', resourceClass: 'MODERATE' },
  { strategy: 'REPAIR_LOOP', goodFor: ['verification or fidelity failed'], poorFor: ['no implementation yet'], ambiguityRange: 'any', componentRange: '1+', crossLayerSuitability: 'optional', uncertaintySuitability: 'medium', failureHistorySuitability: 'repeated', securitySensitivity: 'neutral', regressionSensitivity: 'preferred', evidenceRequirement: 'failed check', verificationRequirement: 'new check', resourceClass: 'EXPENSIVE' },
]

export function profileFor(strategy: FoundryReasoningStrategy): FoundryStrategyProfile {
  return STRATEGY_PROFILES.find(item => item.strategy === strategy) ?? STRATEGY_PROFILES[0]
}

export function classifyEvidenceToolCost(need: string): EvidenceToolCost {
  if (/build|rewrite|multi-file|replace|mutate|patch/i.test(need)) return 'EXPENSIVE'
  if (/test\.run|targeted test|suite/i.test(need)) return 'MODERATE'
  return 'CHEAP'
}

export function estimateEvidenceGain(input: { discriminates: number; known: boolean }): EvidenceGainEstimate {
  if (!input.known) return 'UNKNOWN'
  if (input.discriminates >= 2) return 'HIGH'
  if (input.discriminates === 1) return 'MEDIUM'
  return 'LOW'
}

export function preferEvidenceAction<T extends { gain: EvidenceGainEstimate; cost: EvidenceToolCost }>(left: T, right: T): T {
  const gainRank = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 }
  const costRank = { CHEAP: 0, MODERATE: 1, EXPENSIVE: 2 }
  if (gainRank[left.gain] !== gainRank[right.gain]) return gainRank[left.gain] > gainRank[right.gain] ? left : right
  return costRank[left.cost] <= costRank[right.cost] ? left : right
}

export function recordStrategyDecision(session: FoundryReasoningSession, input: {
  trigger: string
  selected: FoundryReasoningStrategy
  reason: string
  evidenceIds?: string[]
  gain?: EvidenceGainEstimate
  depthBefore: FrkDepth | null
  depthAfter: FrkDepth | null
}): FoundryStrategyDecision {
  const rejected = FRK_STRATEGIES
    .filter(strategy => strategy !== input.selected)
    .map(strategy => ({ strategy, reason: `${strategy} is a weaker fit for ${input.trigger}` }))
  const decision: FoundryStrategyDecision = {
    decisionId: nextSessionId(session, 'strategy-decision'),
    candidateStrategies: [...FRK_STRATEGIES],
    selectedStrategy: input.selected,
    selectionEvidenceIds: input.evidenceIds ?? [`signal:${input.trigger}`],
    rejectedStrategies: rejected,
    reasonForSelection: clipText(input.reason),
    expectedEvidenceGain: input.gain ?? 'UNKNOWN',
    resourceEstimate: profileFor(input.selected).resourceClass,
    trigger: clipText(input.trigger),
    depthBefore: input.depthBefore,
    depthAfter: input.depthAfter,
    timestamp: session.createdAt,
  }
  session.strategyDecisions.push(decision)
  session.strategyTrigger = decision.trigger
  return decision
}

function setDepth(session: FoundryReasoningSession, depth: FrkDepth): void {
  if (session.selectedDepth === depth) return
  session.selectedDepth = depth
  session.depthHistory.push(depth)
  if (depth === 'R4') session.resourceState.limits.workerCalls = Math.min(session.resourceState.limits.workerCalls, 8)
  applySearchBudget(session)
}

export function applySignalStrategy(session: FoundryReasoningSession, trigger: string): FoundryReasoningStrategy {
  const depthBefore = session.selectedDepth
  const previous = session.selectedStrategy
  const selected = selectStrategy(session.signals)
  const depth = selectDepth(session.signals)
  if (previous && previous !== selected) session.previousStrategy = previous
  session.selectedStrategy = selected
  setDepth(session, depth)
  recordStrategyDecision(session, {
    trigger,
    selected,
    reason: `${selected} matches the current problem signals.`,
    depthBefore,
    depthAfter: depth,
    gain: selected === 'VERIFICATION_FIRST' ? 'HIGH' : 'MEDIUM',
  })
  return selected
}

export function switchAfterRepeatedFailure(session: FoundryReasoningSession): FoundryReasoningStrategy {
  const previous = session.selectedStrategy ?? 'DIRECT'
  const next: FoundryReasoningStrategy = session.signals.symptomMayDifferFromCause ? 'ROOT_CAUSE' : 'REPAIR_LOOP'
  const depthBefore = session.selectedDepth
  session.previousStrategy = previous
  session.selectedStrategy = next
  const depth = escalateDepth(depthBefore ?? 'R0', 'repeated_repair', session.signals.budgetAllowsDeepSearch)
  setDepth(session, depth)
  recordStrategyDecision(session, {
    trigger: 'repeated-failure',
    selected: next,
    reason: `Repeated failure moved ${previous} to ${next}.`,
    depthBefore,
    depthAfter: depth,
    gain: 'MEDIUM',
  })
  session.directionChanges.push(`strategy ${previous} to ${next}`)
  return next
}

export function respondToBlockingCritic(session: FoundryReasoningSession): { depth: FrkDepth; branchOpened: boolean } {
  const depthBefore = session.selectedDepth ?? 'R0'
  const depth = escalateDepth(depthBefore, 'repeated_repair', session.signals.budgetAllowsDeepSearch)
  setDepth(session, depth)
  const branch = openBranch(session, {
    label: 'critic edge',
    kind: 'counterexample',
    reason: 'critic',
    scorecard: { requirementsCoverage: 'partial', estimatedToolCost: 'cheap' },
  })
  recordStrategyDecision(session, {
    trigger: 'critic-block',
    selected: session.selectedStrategy ?? 'COUNTEREXAMPLE_SEARCH',
    reason: 'A blocking critic finding escalated depth and opened a counterexample branch.',
    depthBefore,
    depthAfter: session.selectedDepth,
    gain: 'HIGH',
  })
  return { depth: session.selectedDepth ?? depth, branchOpened: branch.ok }
}

export function collapseDepth(session: FoundryReasoningSession): FrkDepth {
  const current = session.selectedDepth ?? 'R1'
  const next = deescalateDepth(current, true)
  setDepth(session, next)
  if (next !== current) session.directionChanges.push(`de-escalated to ${next}`)
  return next
}

export function refuseDeepSearchWithoutBudget(session: FoundryReasoningSession): { depth: FrkDepth | null; refused: boolean } {
  const wanted = session.signals.ambiguity === 'high'
    && session.signals.componentCount >= 3
    && session.signals.blastRadius === 'cross-layer'
    && session.signals.previousFailures >= 2
  const allowed = session.signals.budgetAllowsDeepSearch
  const depth = selectDepth(session.signals)
  setDepth(session, depth)
  return { depth, refused: wanted && !allowed && depth !== 'R4' }
}

export function runMetaController(session: FoundryReasoningSession): FrkMetaControllerResult {
  if (session.metaSteps >= META_STEP_CAP) {
    session.metaDecisions.push('BLOCK')
    return { decision: 'BLOCK', bounded: true }
  }
  session.metaSteps += 1
  const decision = chooseMeta(session)
  if (!FRK_META_DECISIONS.includes(decision)) {
    session.metaDecisions.push('BLOCK')
    return { decision: 'BLOCK', bounded: true }
  }
  session.metaDecisions.push(decision)
  return { decision, bounded: true }
}

function chooseMeta(session: FoundryReasoningSession): FrkMetaDecision {
  if (session.status === 'REASONING_STATE_UNTRUSTED') return 'BLOCK'
  if (session.selectedStrategy === 'DIRECT' && session.signals.previousFailures >= 2) return 'CHANGE_STRATEGY'
  if (session.signals.uncertaintyCount >= 2 && session.evidence.length === 0) return 'GATHER_EVIDENCE'
  if (session.signals.separable && session.signals.componentCount > 1 && session.selectedStrategy !== 'DECOMPOSE') return 'DECOMPOSE'
  if (session.hypotheses.length > 1 && session.hypotheses.filter(item => item.status === 'ACTIVE').length === 0) return 'MERGE_SUBPROBLEMS'
  if (session.search.branches.length >= session.search.budget.maxBranches && session.search.budget.maxBranches > 1) return 'SIMPLIFY'
  if (session.criticFindings.some(item => item.blocksAcceptance && !item.resolved)) return 'ESCALATE_DEPTH'
  if (session.selectedDepth && session.selectedDepth !== 'R0' && session.selectedDepth !== 'R1' && session.contradictions.every(item => item.resolved || !item.affectsAcceptance)) return 'DEESCALATE_DEPTH'
  return 'CONTINUE'
}

/**
 * Bounded reasoning search.
 * Branch comparison uses factual dimensions. It does not score intelligence.
 * Search does not grant tool authority and does not call a model.
 */
import { FOUNDRY_RESOURCE_DEFAULT_LIMITS } from '../foundryResourceGovernorTypes'
import { actionFingerprint } from '../foundryReplanEngine'
import { FOUNDRY_STAGNATION_THRESHOLDS } from '../foundryReplanTypes'
import { refuseBudgetIncrease } from './budget'
import { deescalateDepth } from './depth-controller'
import { notePractice } from './memory'
import { nextSessionId } from './session'
import { clipText } from './text'
import type {
  FoundryBranchScorecard,
  FoundryReasoningBranch,
  FoundryReasoningSession,
  FrkBranchKind,
  FrkBranchReason,
  FrkBranchStatus,
  FrkDepth,
  FrkToolCost,
} from './types'

export function branchCap(depth: FrkDepth | null): { maxBranches: number; maxDepth: number } {
  if (depth === 'R1') return { maxBranches: 2, maxDepth: 1 }
  if (depth === 'R2') return { maxBranches: 3, maxDepth: 2 }
  if (depth === 'R3') return { maxBranches: 4, maxDepth: 3 }
  if (depth === 'R4') return { maxBranches: 6, maxDepth: 4 }
  return { maxBranches: 1, maxDepth: 1 }
}

export function applySearchBudget(session: FoundryReasoningSession): void {
  const cap = branchCap(session.selectedDepth)
  session.search.budget.maxBranches = cap.maxBranches
  session.search.budget.maxDepth = cap.maxDepth
  session.search.budget.maxWorkerCalls = Math.min(
    session.resourceState.limits.workerCalls,
    FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxModelCalls,
  )
  session.search.budget.maxToolCalls = Math.min(
    session.resourceState.limits.toolCalls,
    FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxToolCalls,
  )
  session.search.budget.maxReplans = Math.min(
    session.resourceState.limits.replans,
    FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxTaskReplans,
  )
  session.search.budget.maxWallTimeMs = Math.min(
    session.resourceState.limits.wallTimeMs,
    FOUNDRY_RESOURCE_DEFAULT_LIMITS.maxWallClockMs,
  )
}

export function refuseSearchBudgetIncrease(session: FoundryReasoningSession) {
  return refuseBudgetIncrease(session.resourceState)
}

export function classifyToolCost(need: string): FrkToolCost {
  if (/patch|write|replace|mutate|edit/i.test(need)) return 'expensive'
  if (/test\.run|build|suite/i.test(need)) return 'moderate'
  return 'cheap'
}

export function factualScorecard(input?: Partial<FoundryBranchScorecard>): FoundryBranchScorecard {
  return {
    requirementsCoverage: input?.requirementsCoverage ?? 'partial',
    evidenceSupport: input?.evidenceSupport ?? 0,
    contradictions: input?.contradictions ?? 0,
    unresolvedAssumptions: input?.unresolvedAssumptions ?? 0,
    estimatedToolCost: input?.estimatedToolCost ?? 'moderate',
    riskFlags: input?.riskFlags ?? [],
    verificationCoverage: input?.verificationCoverage ?? 'none',
  }
}

function coverageRank(value: FoundryBranchScorecard['requirementsCoverage']): number {
  if (value === 'covered') return 2
  if (value === 'partial') return 1
  return 0
}

function costRank(value: FrkToolCost): number {
  if (value === 'cheap') return 0
  if (value === 'moderate') return 1
  return 2
}

export function factuallyBetter(left: FoundryBranchScorecard, right: FoundryBranchScorecard): boolean {
  const coverage = coverageRank(left.requirementsCoverage) - coverageRank(right.requirementsCoverage)
  if (coverage !== 0) return coverage > 0
  if (left.contradictions !== right.contradictions) return left.contradictions < right.contradictions
  if (left.evidenceSupport !== right.evidenceSupport) return left.evidenceSupport > right.evidenceSupport
  if (left.unresolvedAssumptions !== right.unresolvedAssumptions) return left.unresolvedAssumptions < right.unresolvedAssumptions
  if (left.riskFlags.length !== right.riskFlags.length) return left.riskFlags.length < right.riskFlags.length
  return costRank(left.estimatedToolCost) < costRank(right.estimatedToolCost)
}

function chainDepth(session: FoundryReasoningSession, parentBranchId: string | null): number {
  let depth = 0
  let cursor = parentBranchId
  const seen = new Set<string>()
  while (cursor) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    depth += 1
    cursor = session.search.branches.find(item => item.branchId === cursor)?.parentBranchId ?? null
  }
  return depth
}

export function openBranch(session: FoundryReasoningSession, input: {
  label: string
  kind: FrkBranchKind
  reason: FrkBranchReason
  parentBranchId?: string | null
  hypothesisIds?: string[]
  planId?: string | null
  assumptions?: string[]
  evidenceIds?: string[]
  predictedOutcome?: string | null
  scorecard?: Partial<FoundryBranchScorecard>
  proposedBy?: { provider: string; model: string } | null
  idempotencyKey?: string
}): { ok: boolean; reason: string; branch?: FoundryReasoningBranch; duplicate?: boolean } {
  const key = input.idempotencyKey ?? `${input.kind}:${input.label}`
  const existing = session.search.branches.find(item => item.idempotencyKey === key || item.branchId === key)
  if (existing) return { ok: true, reason: 'Existing branch reused.', branch: existing, duplicate: true }
  if (session.search.branches.length >= session.search.budget.maxBranches) {
    return { ok: false, reason: 'Search branch budget is exhausted.' }
  }
  if (chainDepth(session, input.parentBranchId ?? null) >= session.search.budget.maxDepth) {
    return { ok: false, reason: 'Search depth budget is exhausted.' }
  }
  const branch: FoundryReasoningBranch = {
    branchId: nextSessionId(session, 'branch'),
    parentBranchId: input.parentBranchId ?? null,
    label: clipText(input.label),
    kind: input.kind,
    hypothesisIds: input.hypothesisIds ?? [],
    planId: input.planId ?? null,
    assumptions: (input.assumptions ?? []).map(clipText),
    evidenceIds: input.evidenceIds ?? [],
    predictedOutcome: input.predictedOutcome ? clipText(input.predictedOutcome) : null,
    status: 'ACTIVE',
    resourceSpent: { workerCalls: 0, toolCalls: 0 },
    scorecard: factualScorecard(input.scorecard),
    rejectionReason: null,
    proposedBy: input.proposedBy ?? null,
    createdBecause: clipText(input.reason),
    idempotencyKey: key,
  }
  session.search.branches.push(branch)
  session.search.trace.push({ branchId: branch.branchId, decision: 'created', why: input.reason })
  const capability = input.kind === 'hypothesis'
    ? 'HYPOTHESIS_SEARCH'
    : input.kind === 'plan'
      ? 'PLAN_SEARCH'
      : input.kind === 'counterexample'
        ? 'COUNTEREXAMPLE_REASONING'
        : 'EVIDENCE_SELECTION'
  session.capabilitySignals.push({ capability, gap: false, evidence: branch.label })
  return { ok: true, reason: 'Branch opened.', branch }
}

export function rejectBranch(session: FoundryReasoningSession, branchId: string, why: string): void {
  const branch = session.search.branches.find(item => item.branchId === branchId)
  if (!branch || branch.status === 'REJECTED') return
  branch.status = 'REJECTED'
  branch.rejectionReason = clipText(why)
  session.search.trace.push({ branchId, decision: 'rejected', why: branch.rejectionReason })
  session.capabilitySignals.push({ capability: 'BRANCH_PRUNING', gap: false, evidence: branch.rejectionReason })
  if (session.search.selectedBranchId === branchId) session.search.selectedBranchId = null
}

export function weakenBranch(session: FoundryReasoningSession, branchId: string, why: string): void {
  const branch = session.search.branches.find(item => item.branchId === branchId)
  if (!branch || branch.status === 'REJECTED') return
  branch.status = 'WEAKENED'
  branch.scorecard.unresolvedAssumptions += 1
  session.search.trace.push({ branchId, decision: 'weakened', why: clipText(why) })
}

export function selectBestBranch(session: FoundryReasoningSession): FoundryReasoningBranch | null {
  const candidates = session.search.branches.filter(item => item.status === 'ACTIVE' || item.status === 'PROMISING' || item.status === 'WEAKENED' || item.status === 'SELECTED')
  if (!candidates.length) return null
  let best = candidates[0]
  for (const item of candidates.slice(1)) {
    if (factuallyBetter(item.scorecard, best.scorecard)) best = item
  }
  for (const item of session.search.branches) {
    if (item.branchId === best.branchId) item.status = 'SELECTED'
    else if (item.status === 'SELECTED') item.status = 'ACTIVE'
  }
  session.search.selectedBranchId = best.branchId
  session.currentPlan = session.candidatePlans.find(item => item.planId === best.planId) ?? session.currentPlan
  session.search.trace.push({
    branchId: best.branchId,
    decision: 'selected',
    why: 'Selected on requirement coverage, contradictions, evidence, risk, and tool cost.',
  })
  session.capabilitySignals.push({ capability: 'EVIDENCE_SELECTION', gap: false, evidence: best.label })
  if (best.scorecard.contradictions > 0) {
    session.verificationState.projectReady = false
    session.verificationState.refusal = 'Selected branch still has an unresolved contradiction.'
    session.status = 'READY_REFUSED'
  }
  return best
}

export function propagateBranchEvidence(session: FoundryReasoningSession, branchId: string, input: {
  evidenceId: string
  contradicts?: boolean
  supports?: boolean
}): void {
  const branch = session.search.branches.find(item => item.branchId === branchId)
  if (!branch) return
  if (!branch.evidenceIds.includes(input.evidenceId)) branch.evidenceIds.push(input.evidenceId)
  if (input.contradicts) {
    branch.scorecard.contradictions += 1
    for (const hypothesisId of branch.hypothesisIds) {
      const hypothesis = session.hypotheses.find(item => item.hypothesisId === hypothesisId)
      if (!hypothesis) continue
      hypothesis.status = 'REJECTED'
      hypothesis.confidenceClass = 'CONTRADICTED'
      if (!hypothesis.contradictingEvidence.includes(input.evidenceId)) hypothesis.contradictingEvidence.push(input.evidenceId)
    }
    rejectBranch(session, branchId, 'key hypothesis contradicted')
    session.verificationState.claims.forEach(claim => {
      if (branch.hypothesisIds.some(id => claim.claim.includes(id)) || claim.workerDeclaredSuccess) {
        if (!claim.contradictingEvidenceIds.includes(input.evidenceId)) claim.contradictingEvidenceIds.push(input.evidenceId)
        if (claim.status === 'PROVEN' || claim.status === 'SUPPORTED') claim.status = 'REFUTED'
      }
    })
    session.verificationState.projectReady = false
    if (!session.search.selectedBranchId) selectBestBranch(session)
    return
  }
  if (input.supports) {
    branch.scorecard.evidenceSupport += 1
    if (branch.status === 'ACTIVE') branch.status = 'PROMISING'
    for (const hypothesisId of branch.hypothesisIds) {
      const hypothesis = session.hypotheses.find(item => item.hypothesisId === hypothesisId)
      if (!hypothesis) continue
      if (!hypothesis.supportingEvidence.includes(input.evidenceId)) hypothesis.supportingEvidence.push(input.evidenceId)
      if (hypothesis.status === 'ACTIVE') hypothesis.status = 'SUPPORTED'
    }
  }
}

export function recordBranchFailure(session: FoundryReasoningSession, branchId: string, input: {
  planId: string
  editArea: string
  failure: string
}): { rejected: boolean; strategy: string | null } {
  const fingerprint = actionFingerprint({
    tool: input.editArea,
    args: { planId: input.planId, branchId },
    error: input.failure,
  })
  session.search.failureFingerprints.push(fingerprint)
  const repeats = session.search.failureFingerprints.filter(item => item === fingerprint).length
  if (repeats < FOUNDRY_STAGNATION_THRESHOLDS.identicalActionRepeats) {
    return { rejected: false, strategy: session.selectedStrategy }
  }
  rejectBranch(session, branchId, 'same failed strategy fingerprint repeated')
  const previous = session.selectedStrategy
  session.selectedStrategy = previous === 'REPAIR_LOOP' ? 'HYPOTHESIS_COMPETITION' : 'REPAIR_LOOP'
  session.resourceState.replans += 1
  session.search.repeatedFailedWithoutReplan = 0
  session.directionChanges.push(`stagnation rejected ${branchId} and changed strategy from ${previous ?? 'none'} to ${session.selectedStrategy}`)
  session.capabilitySignals.push({
    capability: 'SEARCH_STAGNATION_RECOVERY',
    gap: false,
    evidence: fingerprint,
  })
  session.capabilitySignals.push({ capability: 'STRATEGY_SWITCHING', gap: false, evidence: session.selectedStrategy })
  session.status = 'REPLANNING'
  return { rejected: true, strategy: session.selectedStrategy }
}

export function collapseSearch(session: FoundryReasoningSession): void {
  const selectedId = session.search.selectedBranchId
  if (!selectedId) return
  for (const branch of session.search.branches) {
    if (branch.branchId === selectedId || branch.status === 'REJECTED' || branch.status === 'EXHAUSTED') continue
    branch.status = 'REJECTED'
    branch.rejectionReason = 'evidence selected another branch'
    session.search.trace.push({ branchId: branch.branchId, decision: 'rejected', why: branch.rejectionReason })
  }
  const current = session.selectedDepth ?? 'R1'
  const next = deescalateDepth(current, true)
  if (next !== current) {
    session.selectedDepth = next
    session.depthHistory.push(next)
    applySearchBudget(session)
    session.directionChanges.push(`de-escalated to ${next}`)
  }
}

export function recordWorkerDisagreement(session: FoundryReasoningSession, input: {
  claims: [string, string]
  proposedBy?: [{ provider: string; model: string }, { provider: string; model: string }]
}): { first?: FoundryReasoningBranch; second?: FoundryReasoningBranch } {
  const first = openBranch(session, {
    label: input.claims[0],
    kind: 'hypothesis',
    reason: 'alternative',
    proposedBy: input.proposedBy?.[0] ?? null,
    idempotencyKey: `disagree:${input.claims[0]}`,
    scorecard: { requirementsCoverage: 'partial', estimatedToolCost: 'cheap' },
  })
  const second = openBranch(session, {
    label: input.claims[1],
    kind: 'hypothesis',
    reason: 'alternative',
    proposedBy: input.proposedBy?.[1] ?? null,
    idempotencyKey: `disagree:${input.claims[1]}`,
    scorecard: { requirementsCoverage: 'partial', estimatedToolCost: 'cheap' },
  })
  return { first: first.branch, second: second.branch }
}

export function openVerificationFirst(session: FoundryReasoningSession, assumption: string) {
  return openBranch(session, {
    label: `verify before edit: ${assumption}`,
    kind: 'verification',
    reason: 'alternative',
    assumptions: [assumption],
    scorecard: {
      requirementsCoverage: 'partial',
      estimatedToolCost: 'cheap',
      verificationCoverage: 'none',
    },
  })
}

export function branchIsProven(session: FoundryReasoningSession, branchId: string): boolean {
  const branch = session.search.branches.find(item => item.branchId === branchId)
  if (!branch || branch.status !== 'SELECTED') return false
  const linked = session.evidence.filter(item => branch.evidenceIds.includes(item.evidenceId))
  const tool = linked.some(item => item.authority === 'TOOL_RUNTIME')
  const onlyModel = linked.length > 0 && linked.every(item => item.authority === 'MODEL_ASSERTION')
  return tool && !onlyModel && branch.scorecard.contradictions === 0
}

export function noteRepeatedSelectionFailure(session: FoundryReasoningSession): void {
  const rejected = session.search.branches.filter(item => item.status === 'REJECTED').length
  if (rejected < 2) return
  session.practice.push(notePractice({
    practiceId: nextSessionId(session, 'practice'),
    capability: 'AMBIGUITY_RESOLUTION',
    chosen: 'practice branch selection on a disposable case',
    evidence: `${rejected} rejected branches`,
  }))
  session.commanderProjectsBlocked = false
}

export function branchStatusLine(branch: FoundryReasoningBranch): string {
  const note = branch.rejectionReason ?? (branch.status === 'WEAKENED' ? 'open assumption' : branch.createdBecause)
  return `${branch.label} — ${branch.status}${note ? `: ${note}` : ''}`
}

export function markBranch(session: FoundryReasoningSession, branchId: string, status: FrkBranchStatus, why?: string): void {
  const branch = session.search.branches.find(item => item.branchId === branchId)
  if (!branch) return
  branch.status = status
  if (why && status === 'REJECTED') branch.rejectionReason = clipText(why)
  if (why && status === 'WEAKENED') session.search.trace.push({ branchId, decision: 'weakened', why: clipText(why) })
}

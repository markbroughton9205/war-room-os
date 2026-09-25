/**
 * Reasoning session factory, restart serialization, and Commander brief.
 */
import { operationalRoleForReasoningRole } from '../foundryEngineeringReasoning'
import { createResourceState } from './budget'
import { createReasoningGraph } from './graph'
import { buildProblemModel } from './problem-model'
import { emptyCache, emptyEfficiency } from './program-types'
import { clipText } from './text'
import {
  FRK_REASONING_ROLES,
  FRK_SCHEMA_VERSION,
  type FoundryAssumption,
  type FoundryDepthSignals,
  type FoundryReasoningBrief,
  type FoundryReasoningSession,
  type FoundrySearchState,
  type FrkStopReason,
} from './types'

export const DEFAULT_SIGNALS: FoundryDepthSignals = {
  ambiguity: 'low',
  blastRadius: 'local',
  componentCount: 1,
  uncertaintyCount: 0,
  previousFailures: 0,
  securitySensitive: false,
  regressionRisk: 'low',
  separable: false,
  symptomMayDifferFromCause: false,
  designTask: false,
  wantsPlanSearch: false,
  verificationFirst: false,
  budgetAllowsDeepSearch: true,
}

export type CreateSessionInput = {
  sessionId?: string
  missionId: string
  goal: string
  subgoals?: string[]
  constraints?: string[]
  mustPreserve?: string[]
  mustNotDo?: string[]
  acceptanceConditions?: string[]
  knownFacts?: string[]
  inferences?: Array<{ statement: string; uncertainty?: 'LIKELY' | 'POSSIBLE'; derivedFrom?: string[] }>
  assumptions?: Array<Omit<FoundryAssumption, 'assumptionId' | 'status'> & { status?: FoundryAssumption['status'] }>
  unknowns?: string[]
  risks?: string[]
  dependencies?: string[]
  signals?: Partial<FoundryDepthSignals>
  now?: string
  limits?: Partial<FoundryReasoningSession['resourceState']['limits']>
}

export function nextSessionId(session: FoundryReasoningSession, prefix: string): string {
  session.seq += 1
  return `${prefix}-${session.seq}`
}

export function emptySearchState(): FoundrySearchState {
  return {
    branches: [],
    selectedBranchId: null,
    trace: [],
    budget: {
      maxBranches: 1,
      maxDepth: 1,
      maxWorkerCalls: 1,
      maxToolCalls: 1,
      maxReplans: 1,
      maxWallTimeMs: 1,
    },
    repeatedFailedWithoutReplan: 0,
    failureFingerprints: [],
    lifecycle: 'CREATE',
  }
}

export function touchSession(session: FoundryReasoningSession): void {
  session.updatedAt = session.createdAt
}

export function createFoundryReasoningSession(input: CreateSessionInput): FoundryReasoningSession {
  const now = input.now ?? new Date().toISOString()
  const session: FoundryReasoningSession = {
    schemaVersion: FRK_SCHEMA_VERSION,
    sessionId: input.sessionId ?? `frk-${input.missionId}`,
    missionId: input.missionId,
    seq: 0,
    problemModel: buildProblemModel({ goal: input.goal }),
    constraints: (input.constraints ?? []).map(clipText),
    acceptanceCriteria: (input.acceptanceConditions ?? []).map(clipText),
    unknowns: (input.unknowns ?? []).map(clipText),
    assumptions: [],
    hypotheses: [],
    evidence: [],
    evidenceRequests: [],
    reasoningGraph: createReasoningGraph(),
    selectedStrategy: null,
    candidatePlans: [],
    currentPlan: null,
    observations: [],
    contradictions: [],
    criticFindings: [],
    verificationState: { formsConsidered: [], claims: [], projectReady: false, refusal: null },
    lessons: [],
    rejectedLessons: [],
    capabilitySignals: [],
    resourceState: createResourceState(input.limits),
    selectedDepth: null,
    depthHistory: [],
    signals: { ...DEFAULT_SIGNALS, ...input.signals },
    predictions: [],
    pendingMutations: [],
    appliedMutationIds: [],
    routingEvidence: [],
    metaDecisions: [],
    toolSelections: [],
    roleAssignments: FRK_REASONING_ROLES.map(role => ({
      reasoningRole: role,
      operationalRole: operationalRoleForReasoningRole(role),
    })),
    directionChanges: [],
    architectures: [],
    selectedArchitectureId: null,
    rootCause: null,
    stagnation: { detected: false, fingerprint: null, repeats: 0, response: null },
    status: 'OPEN',
    stopReason: null,
    phase: 'UNDERSTAND',
    stepCount: 0,
    workerStatus: 'IDLE',
    difficulty: { ambiguity: 1, components: 1, constraints: 1, failureModes: 1, integrationDepth: 1, successStreak: 0 },
    practice: [],
    commanderProjectsBlocked: false,
    fidelity: { status: null, mismatch: null, reinspected: false },
    search: emptySearchState(),
    strategyDecisions: [],
    previousStrategy: null,
    strategyTrigger: null,
    metaSteps: 0,
    strategyLessons: [],
    workerEvidence: [],
    capabilityGaps: [],
    healthFindings: [],
    efficiency: emptyEfficiency(),
    derivedCache: emptyCache(),
    project: null,
    sovereignPolicy: 'DISABLED',
    createdAt: now,
    updatedAt: now,
  }
  const assumptions = (input.assumptions ?? []).map(item => {
    const assumptionId = nextSessionId(session, 'assumption')
    return {
      assumptionId,
      statement: clipText(item.statement),
      reason: clipText(item.reason),
      risk: clipText(item.risk),
      howToVerify: clipText(item.howToVerify),
      status: item.status ?? 'OPEN',
    }
  })
  session.problemModel = buildProblemModel({
    goal: input.goal,
    subgoals: input.subgoals,
    constraints: input.constraints,
    mustPreserve: input.mustPreserve,
    mustNotDo: input.mustNotDo,
    acceptanceConditions: input.acceptanceConditions,
    knownFacts: input.knownFacts,
    inferences: input.inferences,
    assumptions,
    unknowns: input.unknowns,
    risks: input.risks,
    dependencies: input.dependencies,
  })
  session.assumptions = assumptions
  return session
}

export function serializeSession(session: FoundryReasoningSession): string {
  return JSON.stringify(session)
}

export function restoreSession(payload: string): FoundryReasoningSession {
  const parsed = JSON.parse(payload) as FoundryReasoningSession
  if (parsed.schemaVersion !== FRK_SCHEMA_VERSION) {
    throw new Error('Reasoning session schema is not FRK-01.')
  }
  return parsed
}

export function stopSession(session: FoundryReasoningSession, reason: FrkStopReason): void {
  session.stopReason = reason
  if (reason === 'ACCEPTANCE_PROVEN') session.status = 'PROJECT_READY'
  else if (reason === 'BLOCKED_PROVIDER') session.status = 'BLOCKED_PROVIDER'
  else if (reason === 'BUDGET_EXHAUSTED' || reason === 'EVIDENCE_UNAVAILABLE' || reason === 'CAPABILITY_INSUFFICIENT' || reason === 'ENVIRONMENT_BLOCKED') session.status = 'BLOCKED'
  else if (reason === 'COMMANDER_DECISION') session.status = 'STOPPED'
  touchSession(session)
}

export function explainSession(session: FoundryReasoningSession): FoundryReasoningBrief {
  const selected = session.hypotheses.find(item => item.status === 'SUPPORTED')
  const active = session.hypotheses.filter(item => item.status === 'ACTIVE' || item.status === 'WEAKENED')
  const knownFacts = session.problemModel.knownFacts.map(item => item.statement)
  const unknowns = [
    ...session.problemModel.unknowns.map(item => item.statement),
    ...session.assumptions.filter(item => item.status === 'OPEN').map(item => item.statement),
  ]
  const evidence = session.evidence.map(item => `${item.source}: ${item.statement}`)
  const contradictions = session.contradictions.map(item => `${item.type}: ${item.summary}`)
  const selectedBranch = session.search.branches.find(item => item.branchId === session.search.selectedBranchId)
  const lastDecision = session.strategyDecisions.at(-1)
  const blocked = session.status === 'BLOCKED_PROVIDER'
    || session.status === 'BLOCKED_RESOURCE'
    || session.status === 'BLOCKED_EVIDENCE'
    || session.status === 'BLOCKED_CAPABILITY'
    || session.status === 'BLOCKED_COMMANDER'
    || session.status === 'BLOCKED'
    || session.status === 'READY_REFUSED'
    || session.status === 'REASONING_STATE_UNTRUSTED'
  return {
    problem: session.problemModel.goal,
    known: knownFacts,
    uncertain: unknowns,
    hypothesis: selected?.claim || active.map(item => item.claim).join(' | ') || 'none',
    plan: session.currentPlan?.summary ?? 'none',
    evidence,
    contradictions,
    directionChanges: session.directionChanges,
    unproven: session.verificationState.claims.filter(item => item.status !== 'PROVEN').map(item => item.claim),
    strategy: session.selectedStrategy ?? 'unselected',
    depth: session.selectedDepth ?? 'unselected',
    verification: session.verificationState.refusal ?? (session.verificationState.projectReady ? 'project ready' : 'not proven'),
    privateReasoningExposed: false,
    currentGoal: session.problemModel.goal,
    knownFacts,
    unknowns,
    activeHypotheses: active.map(item => item.claim),
    selectedPlan: selectedBranch?.label ?? session.currentPlan?.summary ?? 'none',
    latestEvidence: evidence.slice(-4),
    criticFindings: session.criticFindings.map(item => `${item.category}: ${item.summary}`),
    verificationState: session.verificationState.projectReady ? 'PROJECT_READY' : (session.verificationState.refusal ?? 'not proven'),
    blockedReason: blocked ? (session.verificationState.refusal ?? session.stopReason ?? session.status) : null,
    nextReasoningAction: blocked
      ? 'wait for the block to clear'
      : selectedBranch
        ? 'continue the selected branch'
        : 'gather discriminating evidence',
    status: session.status,
    searchBranches: session.search.branches.map(branch => ({
      label: branch.label,
      status: branch.status,
      note: branch.status === 'REJECTED'
        ? (branch.rejectionReason ?? 'rejected')
        : branch.status === 'WEAKENED'
          ? 'open assumption'
          : '',
    })),
    reasonForSelection: lastDecision?.reasonForSelection ?? 'unrecorded',
    previousStrategy: session.previousStrategy ?? 'none',
    strategyTrigger: session.strategyTrigger ?? lastDecision?.trigger ?? 'none',
  }
}

export function queueMutation(session: FoundryReasoningSession, summary: string): string {
  const mutationId = nextSessionId(session, 'mutation')
  session.pendingMutations.push({ mutationId, summary: clipText(summary), applied: false })
  return mutationId
}

export function applyMutation(session: FoundryReasoningSession, mutationId: string): { applied: boolean; skipped: boolean } {
  if (session.appliedMutationIds.includes(mutationId)) return { applied: false, skipped: true }
  const pending = session.pendingMutations.find(item => item.mutationId === mutationId)
  if (!pending) return { applied: false, skipped: true }
  pending.applied = true
  session.appliedMutationIds.push(mutationId)
  touchSession(session)
  return { applied: true, skipped: false }
}

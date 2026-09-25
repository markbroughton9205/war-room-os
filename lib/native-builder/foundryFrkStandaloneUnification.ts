/**
 * Canonical FRK ↔ Standalone Engineer execution path.
 * FRK owns reasoning. Tool Broker owns mutation. One mission record owns outcome.
 * Does not create a second broker, graph, mission engine, or action ledger.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadActiveResourceBudget } from './foundryContractStore'
import { classifyInFlightAction, loadDurableRuntimeAction, persistDurableRuntimeAction } from './foundryMissionRuntime'
import { actionFingerprint } from './foundryReplanEngine'
import { FOUNDRY_STAGNATION_THRESHOLDS } from './foundryReplanTypes'
import {
  authorizeResourceAction,
  beginResourceUsage,
  completeResourceUsage,
  ensureResourceBudget,
  refuseAutomaticBudgetIncrease,
} from './foundryResourceGovernor'
import { completeUnattendedDurableAction, unattendedToolBrokerWrite } from './foundryUnattendedEngineer'
import { bindPointerToMission, emptyPointer, projectPointer, refreshPointer } from './reasoning-kernel/attachment'
import { addGraphEdge, addGraphNode, edgeShell, nodeShell } from './reasoning-kernel/graph'
import { defaultReasoningRoot, ensureLiveMissionReasoning, type ReasoningMissionHost } from './reasoning-kernel/mission-lifecycle'
import {
  addCandidatePlans,
  addSessionContradiction,
  addSessionEvidence,
  addSessionHypothesis,
  applyMutation,
  chooseSessionPlan,
  createFoundryReasoningSession,
  markWorkerUnavailable,
  queueMutation,
  refreshProjectReady,
  selectSessionStrategy,
} from './reasoning-kernel/orchestrator'
import { loadCanonicalSession, saveCanonicalSession, saveMissionPointer } from './reasoning-kernel/persistence'
import { nextSessionId } from './reasoning-kernel/session'
import { clipText } from './reasoning-kernel/text'
import { FRK_COMMANDER_GATED_ACTIONS, type FoundryReasoningSession, type FoundryReasoningStrategy } from './reasoning-kernel/types'
import { inspectImplementationFidelity } from './reasoning-kernel/verifier'
import { ACCEPTED_WORKER_CAPABILITY_EVIDENCE } from './foundryWorkerRoutingEvidence'
import {
  STORED_DEFAULT_POLICY,
  persistRoutingDecision,
  recommendFoundryWorker,
  reconsiderFoundryRouting,
  resumeRoutingDecision,
  getCapabilityAwareRoutingMode,
  applyCapabilityAwareRouteOptions,
  type FoundryRoutingCandidate,
  type FoundryRoutingReconsideration,
  type FoundryWorkerRoutingDecision,
  type FoundryWorkerRoutingNeed,
} from './foundryWorkerRouting'
import type { FoundryWorkerTaskClass } from './foundryWorkerRoutingEvidence'
import type { FrkCapability, FrkDepth } from './reasoning-kernel/types'
import { pinOnlyWorkerCandidate } from './reasoning-kernel/wrim-worker'

export const SECOND_MISSION_TRUTH_COUNT = 0 as const
export const DUPLICATE_RESOURCE_ACCOUNTING_COUNT = 0 as const
export const FRK_DIRECT_WRITE_COUNT = 0 as const
export const PROVIDER_SPECIFIC_UNIFICATION_BRANCH_COUNT = 0 as const

export type FoundryUnifiedVerdict =
  | 'PROJECT_READY'
  | 'BLOCKED_PROVIDER'
  | 'BLOCKED_RESOURCE'
  | 'BLOCKED_EVIDENCE'
  | 'BLOCKED_CAPABILITY'
  | 'BLOCKED_COMMANDER'
  | 'REASONING_STATE_UNTRUSTED'
  | 'FAILED_VERIFICATION'
  | 'RUNNING'

export type FoundryExecutionIntent = {
  missionId: string
  reasoningSessionId: string
  planId: string | null
  branchId: string | null
  routingDecisionId: string | null
  workerIdentity: { provider: string | null; model: string | null }
  mutationId: string
  actionId: string
  actionType: 'file.write' | 'file.replace_unique' | 'inspect' | 'commit' | 'push' | 'deploy' | 'raise_budget' | 'install_software' | 'download_model'
  target: string
  content?: string
  matchText?: string
  replacementText?: string
  expectedEffect: string
  verificationIntent: string
  resourceCostClass: 'tool' | 'model' | 'test'
  authorityRequirement: 'TOOL_BROKER' | 'COMMANDER'
}

export type FoundryActionReceipt = {
  actionId: string
  missionId: string
  reasoningSessionId: string
  planId: string | null
  routingDecisionId: string | null
  workerIdentity: { provider: string | null; model: string | null }
  target: string
  result: string
  changed: boolean
  error: string | null
  timestamp: string
  reused: boolean
}

export type FoundryReplanDecision = 'CONTINUE' | 'CHANGE_STRATEGY' | 'CHANGE_BRANCH' | 'GATHER_EVIDENCE' | 'REPAIR' | 'ESCALATE_DEPTH' | 'DEESCALATE_DEPTH' | 'BLOCK'

export type FoundryWorkerRequirement = {
  capabilityFamilies: FrkCapability[]
  reasoningDepth: NonNullable<FrkDepth>
  ambiguity: 'low' | 'high'
  risk: 'low' | 'high'
  privacyRequirement: 'local' | 'any'
  localOnlyRequirement: boolean
  difficultyClass: string
  taskFamily: FoundryWorkerTaskClass
}

export type UnifiedRoutingInput = {
  pin?: { provider: string; model: string } | null
  localOnlyRequirement?: boolean
  remotePermitted?: boolean
  privacyRequirement?: 'local' | 'any'
  commanderPolicy?: 'LOCAL' | 'REMOTE' | 'AUTO'
  candidates?: FoundryRoutingCandidate[]
  forceDepth?: NonNullable<FrkDepth>
  forceFamilies?: FrkCapability[]
  forceAmbiguity?: 'low' | 'high'
  taskFamily?: FoundryWorkerTaskClass
  commanderRemoteApprovalRequired?: boolean
}

export type UnifiedLoopHost = ReasoningMissionHost & {
  currentAction?: string | null
  observations?: { at: string; text: string; source: string }[]
  unifiedVerdict?: FoundryUnifiedVerdict | null
  routingDecisionId?: string | null
  routingDecision?: FoundryWorkerRoutingDecision | null
  recommendedWorker?: { provider: string | null; model: string | null } | null
  actualWorker?: { provider: string | null; model: string | null; source: 'POLICY_LOCAL' | 'PINNED' | 'CAPABILITY' | 'NONE' } | null
  routingReconsideration?: FoundryRoutingReconsideration | null
  workerSwitchCount?: number
}

export type UnifiedLoop = {
  mission: UnifiedLoopHost
  session: FoundryReasoningSession
  workspaceRoot: string
  writeSet: string[]
  receipts: FoundryActionReceipt[]
  fingerprints: string[]
  replayedMutationCount: number
  repeatedFailedWithoutReplan: number
  lastFidelity: string | null
  lastReplan: FoundryReplanDecision | null
  verdict: FoundryUnifiedVerdict
  workerRequirement: FoundryWorkerRequirement | null
  routingDecision: FoundryWorkerRoutingDecision | null
  actualWorker: { provider: string | null; model: string | null; source: 'POLICY_LOCAL' | 'PINNED' | 'CAPABILITY' | 'NONE' }
  routingReconsideration: FoundryRoutingReconsideration | null
  workerSwitchCount: number
}

export type UnifiedCommanderView = {
  reasoningStrategy: string
  depth: string
  selectedPlan: string
  currentAction: string
  lastObservation: string
  contradictions: string[]
  verification: string
  verdict: FoundryUnifiedVerdict
  nextAction: string
  routingMode: string
  recommendedWorker: string
  actualWorker: string
  previousWorker: string
  policy: string
  workerSwitchCount: number
  fallbackAllowed: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

function bindSession(mission: UnifiedLoopHost, session: FoundryReasoningSession): void {
  bindPointerToMission(mission, projectPointer(session))
}

function evidenceLocalWorker(): { provider: string; model: string } {
  const row = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => item.historicalReliability === 'RELIABLE' && item.local)
  if (!row) throw new Error('missing local worker evidence')
  return { provider: row.provider, model: row.model }
}

function evidenceRemoteWorker(): { provider: string; model: string } {
  const row = ACCEPTED_WORKER_CAPABILITY_EVIDENCE.find(item => !item.local && item.rootCauseStatus === 'SUPPORTED')
  if (!row) throw new Error('missing remote worker evidence')
  return { provider: row.provider, model: row.model }
}

export function defaultRoutingCandidates(): FoundryRoutingCandidate[] {
  const local = evidenceLocalWorker()
  const remote = evidenceRemoteWorker()
  return [
    { provider: local.provider, model: local.model, local: true, callable: true, listedOnly: false },
    { provider: remote.provider, model: remote.model, local: false, callable: true, listedOnly: false },
  ]
}

export function workerRequirementFromSession(session: FoundryReasoningSession, input?: UnifiedRoutingInput): FoundryWorkerRequirement {
  const depth = input?.forceDepth ?? session.selectedDepth ?? 'R0'
  const openContradiction = session.contradictions.some(item => !item.resolved)
  const ambiguity = input?.forceAmbiguity
    ?? (depth === 'R3' || depth === 'R4' || session.selectedStrategy === 'HYPOTHESIS_COMPETITION' || openContradiction ? 'high' : 'low')
  const families = input?.forceFamilies ?? (() => {
    const next: FrkCapability[] = []
    if (depth === 'R0' || depth === 'R1') next.push('PLAN_TO_CODE_FIDELITY')
    if (ambiguity === 'high') next.push('AMBIGUITY_RESOLUTION')
    if (openContradiction || depth === 'R3' || depth === 'R4' || session.selectedStrategy === 'REPAIR_LOOP') next.push('ROOT_CAUSE_DIAGNOSIS')
    if (!next.length) next.push('PLAN_TO_CODE_FIDELITY')
    return [...new Set(next)]
  })()
  return {
    capabilityFamilies: families,
    reasoningDepth: depth,
    ambiguity,
    risk: depth === 'R3' || depth === 'R4' ? 'high' : 'low',
    privacyRequirement: input?.privacyRequirement ?? 'any',
    localOnlyRequirement: input?.localOnlyRequirement === true,
    difficultyClass: depth === 'R0' || depth === 'R1' ? 'localized' : 'hard-reasoning',
    taskFamily: input?.taskFamily ?? 'BUG_FIX',
  }
}

function routingCandidates(input?: UnifiedRoutingInput): FoundryRoutingCandidate[] {
  const base = input?.candidates ?? defaultRoutingCandidates()
  const extra = pinOnlyWorkerCandidate(input?.pin ?? null)
  if (!extra) return base
  if (base.some(item => item.provider === extra.provider && item.model === extra.model)) return base
  return [...base, extra]
}

function routingNeed(loop: UnifiedLoop, requirement: FoundryWorkerRequirement, input?: UnifiedRoutingInput): FoundryWorkerRoutingNeed {
  return {
    missionId: loop.mission.missionId,
    taskFamily: requirement.taskFamily,
    capabilityFamilies: requirement.capabilityFamilies,
    difficultyClass: requirement.difficultyClass,
    reasoningDepth: requirement.reasoningDepth,
    ambiguity: requirement.ambiguity,
    risk: requirement.risk,
    privacyRequirement: requirement.privacyRequirement,
    localOnlyRequirement: requirement.localOnlyRequirement,
    remotePermitted: input?.remotePermitted === true,
    commanderPolicy: input?.commanderPolicy ?? 'LOCAL',
    commanderRemoteApprovalRequired: input?.commanderRemoteApprovalRequired === true,
    pin: input?.pin ?? null,
    candidates: routingCandidates(input),
    callBudgetRemaining: Math.max(0, 6 - loop.session.resourceState.workerCalls),
    callBudgetCeiling: 6,
    wallTimeBudgetMs: 120000,
    switchCount: loop.workerSwitchCount,
    previousProvider: loop.actualWorker.provider,
    previousModel: loop.actualWorker.model,
    missionContractHash: 'contract-hash',
    acceptanceContractHash: 'acceptance-hash',
    toolAuthority: 'tool-broker',
    deployAuthority: false,
    now: nowIso(),
  }
}

function routingStoreRoot(): string | null {
  const root = defaultReasoningRoot()
  return root ? path.join(root, 'routing') : null
}

function applyRoutingDecision(loop: UnifiedLoop, decision: FoundryWorkerRoutingDecision, input?: UnifiedRoutingInput): void {
  const local = evidenceLocalWorker()
  const pin = input?.pin ?? null
  const mode = getCapabilityAwareRoutingMode()
  const enabled = mode === 'ENABLED'
  const selected = decision.outcome === 'SELECTED' && decision.selectedProvider
    ? { provider: decision.selectedProvider, model: decision.selectedModel }
    : null
  const actual = pin && decision.outcome === 'SELECTED'
    ? { provider: pin.provider, model: pin.model, source: 'PINNED' as const }
    : decision.outcome === 'BLOCKED_PROVIDER' || decision.outcome === 'BLOCKED_CAPABILITY' || decision.outcome === 'COMMANDER_DECISION_REQUIRED' || decision.outcome === 'BLOCKED_RESOURCE' || decision.outcome === 'BLOCKED_COMMANDER'
      ? { provider: null, model: null, source: 'NONE' as const }
      : enabled && selected
        ? { provider: selected.provider, model: selected.model, source: 'CAPABILITY' as const }
        : { provider: local.provider, model: local.model, source: 'POLICY_LOCAL' as const }
  loop.routingDecision = {
    ...decision,
    appliedToLiveRoute: enabled && actual.source !== 'NONE',
    routingMode: mode,
    actualProvider: actual.provider,
    actualModel: actual.model,
    reasoningSessionId: loop.session.sessionId,
  }
  loop.actualWorker = actual
  loop.workerSwitchCount = decision.switchCount ?? loop.workerSwitchCount
  loop.workerRequirement = workerRequirementFromSession(loop.session, input)
  loop.mission.routingDecisionId = decision.routingDecisionId
  loop.mission.routingDecision = loop.routingDecision
  loop.mission.recommendedWorker = { provider: decision.selectedProvider, model: decision.selectedModel }
  loop.mission.actualWorker = actual
  loop.mission.workerSwitchCount = loop.workerSwitchCount
  if (decision.outcome === 'BLOCKED_PROVIDER') {
    loop.session.status = 'BLOCKED_PROVIDER'
    loop.verdict = 'BLOCKED_PROVIDER'
  }
  if (decision.outcome === 'BLOCKED_RESOURCE') {
    loop.session.status = 'BLOCKED_RESOURCE'
    loop.verdict = 'BLOCKED_RESOURCE'
  }
  if (decision.outcome === 'BLOCKED_COMMANDER') {
    loop.session.status = 'BLOCKED_COMMANDER'
    loop.verdict = 'BLOCKED_COMMANDER'
  }
  if (decision.outcome === 'BLOCKED_CAPABILITY' || decision.outcome === 'COMMANDER_DECISION_REQUIRED') {
    loop.session.status = decision.outcome === 'COMMANDER_DECISION_REQUIRED' ? 'BLOCKED_COMMANDER' : 'BLOCKED_CAPABILITY'
    loop.verdict = decision.outcome === 'COMMANDER_DECISION_REQUIRED' ? 'BLOCKED_COMMANDER' : 'BLOCKED_CAPABILITY'
  }
  const store = routingStoreRoot()
  if (store) persistRoutingDecision(loop.routingDecision, store)
}

export async function attachFoundryMissionRouting(mission: UnifiedLoopHost, input?: UnifiedRoutingInput): Promise<FoundryWorkerRoutingDecision | null> {
  const root = defaultReasoningRoot()
  if (!mission.reasoningSessionId || !root) return null
  const session = await loadCanonicalSession(root, mission.reasoningSessionId)
  const loop: UnifiedLoop = {
    mission,
    session,
    workspaceRoot: '',
    writeSet: [],
    receipts: [],
    fingerprints: [],
    replayedMutationCount: 0,
    repeatedFailedWithoutReplan: 0,
    lastFidelity: null,
    lastReplan: null,
    verdict: 'RUNNING',
    ...emptyLoopFields(),
  }
  return recordWorkerRouting(loop, { remotePermitted: true, ...input })
}

export function recordShadowWorkerRouting(loop: UnifiedLoop, input?: UnifiedRoutingInput): FoundryWorkerRoutingDecision {
  return recordWorkerRouting(loop, input)
}

export function recordWorkerRouting(loop: UnifiedLoop, input?: UnifiedRoutingInput): FoundryWorkerRoutingDecision {
  if (input?.forceDepth) loop.session.selectedDepth = input.forceDepth
  const requirement = workerRequirementFromSession(loop.session, input)
  loop.workerRequirement = requirement
  const decision = recommendFoundryWorker(routingNeed(loop, requirement, input))
  applyRoutingDecision(loop, decision, input)
  return loop.routingDecision!
}

export function reconsiderShadowRouting(loop: UnifiedLoop, input: UnifiedRoutingInput & { failureType: string }): FoundryRoutingReconsideration {
  return reconsiderWorkerRouting(loop, input)
}

export function reconsiderWorkerRouting(loop: UnifiedLoop, input: UnifiedRoutingInput & { failureType: string }): FoundryRoutingReconsideration {
  const requirement = workerRequirementFromSession(loop.session, input)
  const result = reconsiderFoundryRouting({
    need: routingNeed(loop, requirement, input),
    previousProvider: loop.actualWorker.provider ?? evidenceLocalWorker().provider,
    previousModel: loop.actualWorker.model ?? evidenceLocalWorker().model,
    failureType: input.failureType,
    succeeded: false,
    switchCount: loop.workerSwitchCount,
  })
  applyRoutingDecision(loop, result.decision, input)
  loop.routingReconsideration = result.reconsideration
  loop.mission.routingReconsideration = result.reconsideration
  if (getCapabilityAwareRoutingMode() === 'SHADOW') {
    const local = evidenceLocalWorker()
    loop.actualWorker = { provider: local.provider, model: local.model, source: 'POLICY_LOCAL' }
    loop.mission.actualWorker = loop.actualWorker
    if (loop.routingDecision) loop.routingDecision.appliedToLiveRoute = false
  }
  return result.reconsideration
}

export function liveRouteOptionsFromLoop(loop: UnifiedLoop, pin?: { provider: string; model: string } | null): { missionId: string; pinProvider: string | null; pinModel: string | null } {
  return applyCapabilityAwareRouteOptions({
    missionId: loop.mission.missionId,
    pinProvider: pin?.provider ?? (loop.actualWorker.source === 'PINNED' ? loop.actualWorker.provider : null),
    pinModel: pin?.model ?? (loop.actualWorker.source === 'PINNED' ? loop.actualWorker.model : null),
  }, loop.routingDecision ?? {
    missionId: loop.mission.missionId,
    routingDecisionId: 'none',
    taskFamily: 'BUG_FIX',
    capabilityFamilies: [],
    difficultyClass: 'localized',
    reasoningDepth: 'R1',
    ambiguity: 'low',
    risk: 'low',
    privacyRequirement: 'any',
    localOnlyRequirement: false,
    selectedProvider: loop.actualWorker.provider,
    selectedModel: loop.actualWorker.model,
    workerClass: null,
    selectionEvidenceIds: [],
    rejectedCandidates: [],
    fallbackCandidates: [],
    policyBasis: STORED_DEFAULT_POLICY,
    resourceBasis: 'cost=UNKNOWN',
    availabilityBasis: 'loop',
    reason: 'loop',
    outcome: loop.actualWorker.provider ? 'SELECTED' : 'BLOCKED_CAPABILITY',
    commanderDecisionRequired: false,
    appliedToLiveRoute: loop.routingDecision?.appliedToLiveRoute === true,
    routingMode: getCapabilityAwareRoutingMode(),
    previousProvider: null,
    previousModel: null,
    trigger: 'loop',
    switchCount: loop.workerSwitchCount,
    fallbackExplicit: false,
    cost: 'UNKNOWN',
    missionContractHash: '',
    acceptanceContractHash: '',
    toolAuthority: 'tool-broker',
    deployAuthority: false,
    callBudgetCeiling: 6,
    timestamp: nowIso(),
  })
}

function emptyLoopFields(): Pick<UnifiedLoop, 'workerRequirement' | 'routingDecision' | 'actualWorker' | 'routingReconsideration' | 'workerSwitchCount'> {
  return {
    workerRequirement: null,
    routingDecision: null,
    actualWorker: { provider: null, model: null, source: 'NONE' },
    routingReconsideration: null,
    workerSwitchCount: 0,
  }
}

async function persist(loop: UnifiedLoop): Promise<void> {
  bindSession(loop.mission, loop.session)
  loop.mission.unifiedVerdict = loop.verdict
  const root = defaultReasoningRoot()
  if (!root) return
  const pointer = emptyPointer(loop.mission.missionId)
  refreshPointer(pointer, loop.session)
  await saveCanonicalSession(root, loop.session)
  await saveMissionPointer(root, pointer)
}

function mirrorGovernor(session: FoundryReasoningSession, missionId: string): void {
  const budget = loadActiveResourceBudget(missionId)
  if (!budget) return
  session.resourceState.workerCalls = budget.totals.modelCalls
  session.resourceState.tokens = budget.totals.totalTokens
  session.resourceState.toolCalls = budget.totals.toolCalls
  session.resourceState.tests = budget.totals.testRuns
  session.resourceState.builds = budget.totals.buildRuns
  session.resourceState.replans = budget.totals.taskReplans
  session.resourceState.wallTimeMs = budget.clock.activeExecutionMs
}

function chargeShared(loop: UnifiedLoop, kind: 'tool' | 'model' | 'test', actionId: string): { ok: boolean; reason: string } {
  ensureResourceBudget(loop.mission.missionId)
  const auth = authorizeResourceAction({ missionId: loop.mission.missionId, kind, createIfMissing: true })
  if (!auth.ok) {
    refuseAutomaticBudgetIncrease(loop.mission.missionId)
    loop.session.status = 'BLOCKED_RESOURCE'
    loop.verdict = 'BLOCKED_RESOURCE'
    loop.session.verificationState.refusal = auth.reason
    loop.session.verificationState.projectReady = false
    return { ok: false, reason: auth.code }
  }
  beginResourceUsage({ missionId: loop.mission.missionId, kind, actionId, tool: kind })
  completeResourceUsage({ actionId, missionId: loop.mission.missionId, ok: true, kind, tool: kind })
  mirrorGovernor(loop.session, loop.mission.missionId)
  return { ok: true, reason: 'ALLOWED' }
}

export function computeUnifiedVerdict(session: FoundryReasoningSession): FoundryUnifiedVerdict {
  if (session.status === 'BLOCKED_PROVIDER' || session.workerStatus === 'BLOCKED_PROVIDER') return 'BLOCKED_PROVIDER'
  if (session.status === 'BLOCKED_RESOURCE') return 'BLOCKED_RESOURCE'
  if (session.status === 'BLOCKED_COMMANDER') return 'BLOCKED_COMMANDER'
  if (session.status === 'REASONING_STATE_UNTRUSTED') return 'REASONING_STATE_UNTRUSTED'
  if (session.status === 'BLOCKED_CAPABILITY') return 'BLOCKED_CAPABILITY'
  if (session.status === 'BLOCKED_EVIDENCE' || session.status === 'READY_REFUSED') return 'BLOCKED_EVIDENCE'
  if (session.verificationState.refusal && /verif/i.test(session.verificationState.refusal) && !session.verificationState.projectReady) {
    return 'FAILED_VERIFICATION'
  }
  if (session.verificationState.projectReady && session.contradictions.every(item => !item.affectsAcceptance || item.resolved)) return 'PROJECT_READY'
  return 'RUNNING'
}

export function unifiedCommanderView(loop: UnifiedLoop): UnifiedCommanderView {
  const lastObs = loop.session.observations.at(-1)?.summary ?? loop.mission.observations?.at(-1)?.text ?? 'none'
  return {
    reasoningStrategy: loop.session.selectedStrategy ?? 'unselected',
    depth: loop.session.selectedDepth ?? 'unselected',
    selectedPlan: loop.session.currentPlan?.summary ?? 'none',
    currentAction: loop.mission.currentAction ?? loop.session.pendingMutations.find(item => !item.applied)?.summary ?? 'none',
    lastObservation: lastObs,
    contradictions: loop.session.contradictions.filter(item => !item.resolved).map(item => `${item.type}: ${item.summary}`),
    verification: loop.session.verificationState.projectReady ? 'PASS' : (loop.session.verificationState.refusal ?? 'not proven'),
    verdict: loop.verdict,
    nextAction: loop.session.status === 'REPLANNING' ? 'replan' : 'act',
    routingMode: getCapabilityAwareRoutingMode(),
    recommendedWorker: loop.routingDecision ? `${loop.routingDecision.selectedProvider}/${loop.routingDecision.selectedModel}` : 'none',
    actualWorker: `${loop.actualWorker.provider}/${loop.actualWorker.model}`,
    previousWorker: loop.routingDecision?.previousProvider ? `${loop.routingDecision.previousProvider}/${loop.routingDecision.previousModel}` : 'none',
    policy: STORED_DEFAULT_POLICY,
    workerSwitchCount: loop.workerSwitchCount,
    fallbackAllowed: loop.routingDecision?.fallbackExplicit === true,
  }
}

export async function startUnifiedStandaloneMission(input: {
  mission: UnifiedLoopHost
  workspaceRoot: string
  writeSet: string[]
  goal: string
  acceptance: string[]
  routing?: UnifiedRoutingInput
}): Promise<UnifiedLoop> {
  const attached = await ensureLiveMissionReasoning(input.mission, 'START')
  const root = defaultReasoningRoot()
  const session = input.mission.reasoningSessionId && root
    ? await loadCanonicalSession(root, input.mission.reasoningSessionId)
    : createFoundryReasoningSession({
      missionId: input.mission.missionId,
      goal: input.goal,
      acceptanceConditions: input.acceptance,
    })
  if (!session.selectedStrategy) selectSessionStrategy(session)
  if (!session.candidatePlans.length) {
    addCandidatePlans(session, [{ label: 'A', summary: clipText(input.goal), coversAcceptance: true }])
    chooseSessionPlan(session)
  }
  if (!session.hypotheses.length) addSessionHypothesis(session, input.goal, input.acceptance)
  ensureResourceBudget(input.mission.missionId)
  const loop: UnifiedLoop = {
    mission: input.mission,
    session,
    workspaceRoot: input.workspaceRoot,
    writeSet: input.writeSet,
    receipts: [],
    fingerprints: [],
    replayedMutationCount: 0,
    repeatedFailedWithoutReplan: 0,
    lastFidelity: null,
    lastReplan: null,
    verdict: attached.status === 'REASONING_STATE_UNTRUSTED' ? 'REASONING_STATE_UNTRUSTED' : 'RUNNING',
    ...emptyLoopFields(),
  }
  recordShadowWorkerRouting(loop, input.routing)
  await persist(loop)
  return loop
}

export async function resumeUnifiedStandaloneMission(mission: UnifiedLoopHost, workspaceRoot: string, writeSet: string[]): Promise<UnifiedLoop> {
  const resumed = await ensureLiveMissionReasoning(mission, 'RESUME')
  const root = defaultReasoningRoot()
  if (!root || !mission.reasoningSessionId) {
    mission.reasoningStatus = 'REASONING_STATE_UNTRUSTED'
    return {
      mission,
      session: createFoundryReasoningSession({ missionId: mission.missionId, goal: mission.goal || mission.missionId }),
      workspaceRoot,
      writeSet,
      receipts: [],
      fingerprints: [],
      replayedMutationCount: 0,
      repeatedFailedWithoutReplan: 0,
      lastFidelity: null,
      lastReplan: null,
      verdict: 'REASONING_STATE_UNTRUSTED',
      ...emptyLoopFields(),
    }
  }
  const session = await loadCanonicalSession(root, mission.reasoningSessionId)
  const stored = routingStoreRoot() ? resumeRoutingDecision(mission.missionId, routingStoreRoot()!, mission.routingDecision ?? null) : mission.routingDecision ?? null
  const loop: UnifiedLoop = {
    mission,
    session,
    workspaceRoot,
    writeSet,
    receipts: [],
    fingerprints: [],
    replayedMutationCount: 0,
    repeatedFailedWithoutReplan: 0,
    lastFidelity: null,
    lastReplan: null,
    verdict: resumed.status === 'REASONING_STATE_UNTRUSTED' ? 'REASONING_STATE_UNTRUSTED' : computeUnifiedVerdict(session),
    workerRequirement: workerRequirementFromSession(session),
    routingDecision: stored,
    actualWorker: mission.actualWorker ?? { provider: null, model: null, source: 'NONE' },
    routingReconsideration: mission.routingReconsideration ?? null,
    workerSwitchCount: stored?.switchCount ?? mission.workerSwitchCount ?? 0,
  }
  if (stored) {
    loop.mission.routingDecision = stored
    loop.mission.routingDecisionId = stored.routingDecisionId
    loop.mission.recommendedWorker = { provider: stored.selectedProvider, model: stored.selectedModel }
    if (stored.appliedToLiveRoute && stored.selectedProvider) {
      loop.actualWorker = {
        provider: stored.selectedProvider,
        model: stored.selectedModel,
        source: stored.workerClass === 'PINNED' ? 'PINNED' : 'CAPABILITY',
      }
      loop.mission.actualWorker = loop.actualWorker
    }
  }
  return loop
}

export function requestFrkMutation(loop: UnifiedLoop, summary: string, expectedEffect: string, target?: string): FoundryExecutionIntent {
  const mutationId = queueMutation(loop.session, summary)
  const planId = loop.session.currentPlan?.planId ?? null
  const actionId = nextSessionId(loop.session, 'action')
  loop.session.predictions.push({
    predictionId: nextSessionId(loop.session, 'prediction'),
    expectedFileChange: expectedEffect,
    expectedTestOutcome: 'acceptance holds',
    expectedRuntimeEffect: expectedEffect,
    possibleRegressions: [],
    compared: false,
    matched: null,
  })
  loop.session.toolSelections.push({
    selectionId: nextSessionId(loop.session, 'tool'),
    need: 'mutation',
    toolFamily: 'file.write',
    reason: mutationId,
    authority: 'TOOL_BROKER',
    executed: false,
  })
  addGraphNode(loop.session.reasoningGraph, nodeShell(actionId, 'ACTION', summary, 'POSSIBLE'))
  loop.mission.currentAction = summary
  return {
    missionId: loop.mission.missionId,
    reasoningSessionId: loop.session.sessionId,
    planId,
    branchId: loop.session.search.selectedBranchId,
    routingDecisionId: loop.routingDecision?.routingDecisionId ?? loop.mission.routingDecisionId ?? null,
    workerIdentity: { provider: loop.actualWorker.provider, model: loop.actualWorker.model },
    mutationId,
    actionId,
    actionType: 'file.write',
    target: target ?? loop.writeSet[0] ?? 'UNSET',
    expectedEffect,
    verificationIntent: 'reinspect disk against plan',
    resourceCostClass: 'tool',
    authorityRequirement: 'TOOL_BROKER',
  }
}

function gatedAction(actionType: FoundryExecutionIntent['actionType']): boolean {
  if (['commit', 'push', 'deploy', 'raise_budget', 'install_software', 'download_model'].includes(actionType)) return true
  return FRK_COMMANDER_GATED_ACTIONS.some(item => actionType.replace(/_/g, ' ').includes(item))
}

function resolveContent(intent: FoundryExecutionIntent, existing: string): { ok: boolean; content: string; error?: string } {
  if (intent.actionType === 'file.replace_unique') {
    const match = intent.matchText ?? ''
    const replacement = intent.replacementText ?? ''
    if (!match) return { ok: false, content: existing, error: 'MATCH_REQUIRED' }
    const parts = existing.split(match)
    if (parts.length !== 2) return { ok: false, content: existing, error: `MATCH_NOT_UNIQUE count=${parts.length - 1}` }
    return { ok: true, content: parts[0] + replacement + parts[1] }
  }
  if (typeof intent.content === 'string') return { ok: true, content: intent.content }
  return { ok: false, content: existing, error: 'CONTENT_REQUIRED' }
}

function reusedReceipt(intent: FoundryExecutionIntent, result: string): FoundryActionReceipt {
  return {
    actionId: intent.actionId,
    missionId: intent.missionId,
    reasoningSessionId: intent.reasoningSessionId,
    planId: intent.planId,
    routingDecisionId: intent.routingDecisionId,
    workerIdentity: intent.workerIdentity,
    target: intent.target,
    result,
    changed: false,
    error: null,
    timestamp: nowIso(),
    reused: true,
  }
}

export function ingestReceipt(loop: UnifiedLoop, intent: FoundryExecutionIntent, receipt: FoundryActionReceipt): void {
  if (!loop.receipts.some(item => item.actionId === receipt.actionId && item.timestamp === receipt.timestamp)) {
    loop.receipts.push(receipt)
  }
  const failed = Boolean(receipt.error)
  const evidence = addSessionEvidence(loop.session, {
    source: 'TOOL_OBSERVATION',
    statement: `${receipt.target} ${receipt.result}${failed ? ` error=${receipt.error}` : ''}`,
    actor: 'tool-broker',
    ref: receipt.actionId,
    supportsHypothesisIds: failed ? [] : loop.session.hypotheses.slice(0, 1).map(item => item.hypothesisId),
    contradictsHypothesisIds: failed ? loop.session.hypotheses.slice(0, 1).map(item => item.hypothesisId) : [],
  })
  const observationId = nextSessionId(loop.session, 'observation')
  const prediction = loop.session.predictions.find(item => !item.compared) ?? loop.session.predictions.at(-1)
  loop.session.observations.push({
    observationId,
    actionId: receipt.actionId,
    hypothesisId: loop.session.hypotheses[0]?.hypothesisId ?? null,
    planId: intent.planId,
    predictionId: prediction?.predictionId ?? null,
    summary: clipText(`${receipt.target}: ${receipt.result}`),
    evidenceId: evidence.evidenceId ?? null,
  })
  addGraphNode(loop.session.reasoningGraph, nodeShell(observationId, 'OBSERVATION', receipt.result, failed ? 'CONTRADICTED' : 'KNOWN'))
  addGraphEdge(loop.session.reasoningGraph, edgeShell(nextSessionId(loop.session, 'edge'), receipt.actionId, observationId, 'TESTS'))
  if (prediction) {
    prediction.compared = true
    const disk = existsSync(path.join(loop.workspaceRoot, receipt.target)) ? readFileSync(path.join(loop.workspaceRoot, receipt.target), 'utf8') : ''
    const needle = intent.expectedEffect.slice(0, 32)
    prediction.matched = !failed && Boolean(needle) && disk.includes(needle)
    if (prediction.matched === false) addSessionContradiction(loop.session, 'PREDICTION_MISMATCH', `expected ${intent.expectedEffect}`, true)
  }
  const selection = loop.session.toolSelections.find(item => item.reason === intent.mutationId)
  if (selection) selection.executed = !failed
  if (loop.session.currentPlan) loop.session.currentPlan.executed = !failed
  loop.mission.observations = loop.mission.observations ?? []
  loop.mission.observations.push({ at: receipt.timestamp, source: 'tool-broker', text: receipt.result })
  loop.mission.currentAction = failed ? `failed ${intent.actionType}` : `wrote ${intent.target}`
  loop.fingerprints.push(actionFingerprint({ tool: intent.actionType, args: intent.target, result: receipt.result, error: receipt.error ?? undefined }))
  loop.verdict = computeUnifiedVerdict(loop.session)
}

export async function executeUnifiedIntent(loop: UnifiedLoop, intent: FoundryExecutionIntent, options?: { skipReceipt?: boolean }): Promise<FoundryActionReceipt> {
  if (intent.reasoningSessionId !== loop.session.sessionId || intent.missionId !== loop.mission.missionId) {
    throw new Error('SECOND_MISSION_TRUTH')
  }
  if (gatedAction(intent.actionType)) {
    loop.session.status = 'BLOCKED_COMMANDER'
    loop.verdict = 'BLOCKED_COMMANDER'
    loop.session.verificationState.projectReady = false
    loop.session.verificationState.refusal = `Commander gate: ${intent.actionType}`
    const receipt: FoundryActionReceipt = {
      actionId: intent.actionId,
      missionId: intent.missionId,
      reasoningSessionId: intent.reasoningSessionId,
      planId: intent.planId,
      routingDecisionId: intent.routingDecisionId,
      workerIdentity: intent.workerIdentity,
      target: intent.target,
      result: 'BLOCKED_COMMANDER',
      changed: false,
      error: 'BLOCKED_COMMANDER',
      timestamp: nowIso(),
      reused: false,
    }
    loop.receipts.push(receipt)
    await persist(loop)
    return receipt
  }
  if (!loop.writeSet.includes(intent.target)) {
    return {
      actionId: intent.actionId,
      missionId: intent.missionId,
      reasoningSessionId: intent.reasoningSessionId,
      planId: intent.planId,
      routingDecisionId: intent.routingDecisionId,
      workerIdentity: intent.workerIdentity,
      target: intent.target,
      result: 'WRITE_SET_REFUSED',
      changed: false,
      error: 'WRITE_SET_REFUSED',
      timestamp: nowIso(),
      reused: false,
    }
  }
  if (loop.session.appliedMutationIds.includes(intent.mutationId)) {
    loop.replayedMutationCount = 0
    const receipt = reusedReceipt(intent, 'REUSED_COMPLETED_MUTATION')
    loop.receipts.push(receipt)
    await persist(loop)
    return receipt
  }
  const durable = loadDurableRuntimeAction(intent.actionId)
  if (durable?.state === 'COMPLETED') {
    loop.replayedMutationCount = 0
    applyMutation(loop.session, intent.mutationId)
    const receipt = reusedReceipt(intent, 'DURABLE_RESULT_REUSED')
    ingestReceipt(loop, intent, receipt)
    await persist(loop)
    return receipt
  }

  const charged = chargeShared(loop, intent.resourceCostClass, intent.actionId)
  if (!charged.ok) {
    const receipt: FoundryActionReceipt = {
      actionId: intent.actionId,
      missionId: intent.missionId,
      reasoningSessionId: intent.reasoningSessionId,
      planId: intent.planId,
      routingDecisionId: intent.routingDecisionId,
      workerIdentity: intent.workerIdentity,
      target: intent.target,
      result: 'BLOCKED_RESOURCE',
      changed: false,
      error: charged.reason,
      timestamp: nowIso(),
      reused: false,
    }
    loop.receipts.push(receipt)
    await persist(loop)
    return receipt
  }

  const dest = path.join(loop.workspaceRoot, intent.target)
  const existing = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  const resolved = resolveContent(intent, existing)
  if (!resolved.ok) {
    const receipt: FoundryActionReceipt = {
      actionId: intent.actionId,
      missionId: intent.missionId,
      reasoningSessionId: intent.reasoningSessionId,
      planId: intent.planId,
      routingDecisionId: intent.routingDecisionId,
      workerIdentity: intent.workerIdentity,
      target: intent.target,
      result: resolved.error ?? 'resolve failed',
      changed: false,
      error: resolved.error ?? 'resolve failed',
      timestamp: nowIso(),
      reused: false,
    }
    loop.receipts.push(receipt)
    await persist(loop)
    return receipt
  }

  const write = unattendedToolBrokerWrite({
    missionId: intent.missionId,
    actionId: intent.actionId,
    relPath: intent.target,
    content: resolved.content,
    workspaceRoot: loop.workspaceRoot,
  })
  if (options?.skipReceipt && write.ok) {
    const action = loadDurableRuntimeAction(intent.actionId)
    if (action) {
      action.state = 'STARTED'
      action.status = 'STARTED'
      action.finishedAt = null
      persistDurableRuntimeAction(action)
    }
  }
  const receipt: FoundryActionReceipt = {
    actionId: intent.actionId,
    missionId: intent.missionId,
    reasoningSessionId: intent.reasoningSessionId,
    planId: intent.planId,
    routingDecisionId: intent.routingDecisionId,
    workerIdentity: intent.workerIdentity,
    target: intent.target,
    result: write.reason,
    changed: write.ok && existing !== resolved.content,
    error: write.ok ? null : write.reason,
    timestamp: nowIso(),
    reused: write.reason === 'DURABLE_RESULT_REUSED',
  }
  if (!options?.skipReceipt && write.ok) applyMutation(loop.session, intent.mutationId)
  if (!options?.skipReceipt) ingestReceipt(loop, intent, receipt)
  else loop.receipts.push(receipt)
  await persist(loop)
  return receipt
}

export function reinspectAfterEdit(loop: UnifiedLoop, intent: FoundryExecutionIntent): { status: string; fidelity: string; reinspected: true } {
  const dest = path.join(loop.workspaceRoot, intent.target)
  const disk = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  const check = inspectImplementationFidelity({
    symptom: loop.session.problemModel.goal,
    constraints: loop.session.constraints,
    approach: intent.expectedEffect,
    files: { [intent.target]: disk },
  })
  loop.lastFidelity = check.status
  loop.session.fidelity = { status: check.status, mismatch: check.mismatch, reinspected: true }
  if (check.status === 'CONTRADICTED' || check.fidelity === 'MISMATCH') {
    addSessionContradiction(loop.session, 'PLAN_VS_CODE', check.mismatch || 'disk differs from plan', true)
    loop.session.verificationState.projectReady = false
  }
  return { status: check.status, fidelity: check.fidelity, reinspected: true }
}

export function decideUnifiedReplan(loop: UnifiedLoop, cause: 'ACTION_FAIL' | 'FIDELITY_MISMATCH' | 'VERIFIER_FAIL' | 'STAGNATION'): FoundryReplanDecision {
  const last = loop.fingerprints.at(-1)
  const repeats = last ? loop.fingerprints.filter(item => item === last).length : 0
  if (cause === 'STAGNATION' && repeats > FOUNDRY_STAGNATION_THRESHOLDS.identicalActionRepeats) {
    loop.repeatedFailedWithoutReplan = 0
    loop.lastReplan = 'CHANGE_STRATEGY'
    loop.session.previousStrategy = loop.session.selectedStrategy
    loop.session.selectedStrategy = 'REPAIR_LOOP'
    loop.session.status = 'REPLANNING'
    loop.session.directionChanges.push('stagnation: change strategy')
    loop.session.resourceState.replans += 1
    return 'CHANGE_STRATEGY'
  }
  if (cause === 'ACTION_FAIL') {
    loop.repeatedFailedWithoutReplan = 0
    loop.lastReplan = 'CHANGE_STRATEGY'
    loop.session.previousStrategy = loop.session.selectedStrategy
    loop.session.selectedStrategy = 'REPAIR_LOOP' as FoundryReasoningStrategy
    loop.session.status = 'REPLANNING'
    loop.session.directionChanges.push('tool failure: change strategy')
    return 'CHANGE_STRATEGY'
  }
  if (cause === 'FIDELITY_MISMATCH') {
    loop.lastReplan = 'REPAIR'
    loop.session.status = 'REPLANNING'
    loop.session.directionChanges.push('plan-to-code mismatch: repair')
    return 'REPAIR'
  }
  loop.lastReplan = 'GATHER_EVIDENCE'
  loop.session.status = 'REPLANNING'
  loop.session.verificationState.projectReady = false
  loop.session.verificationState.refusal = 'verifier failed after mutation'
  loop.session.directionChanges.push('verifier failed: reopen reasoning')
  return 'GATHER_EVIDENCE'
}

export function recordUnifiedVerification(loop: UnifiedLoop, input: { passed: boolean; detail: string; claim: string; resolveStaleMismatches?: boolean }): FoundryUnifiedVerdict {
  loop.session.verificationState.formsConsidered.push('source structure')
  loop.session.verificationState.claims.push({
    claimId: nextSessionId(loop.session, 'claim'),
    claim: clipText(input.claim),
    supportingEvidenceIds: input.passed ? loop.session.evidence.slice(-1).map(item => item.evidenceId) : [],
    contradictingEvidenceIds: input.passed ? [] : loop.session.evidence.slice(-1).map(item => item.evidenceId),
    status: input.passed ? 'PROVEN' : 'REFUTED',
    workerDeclaredSuccess: false,
  })
  if (!input.passed) {
    loop.session.verificationState.projectReady = false
    loop.session.verificationState.refusal = input.detail
    loop.verdict = 'FAILED_VERIFICATION'
    decideUnifiedReplan(loop, 'VERIFIER_FAIL')
    return loop.verdict
  }
  if (input.resolveStaleMismatches) {
    for (const item of loop.session.contradictions) {
      if (!item.resolved && (item.type === 'PREDICTION_MISMATCH' || item.type === 'PLAN_VS_CODE')) item.resolved = true
    }
  }
  if (loop.session.contradictions.some(item => item.affectsAcceptance && !item.resolved)) {
    refreshProjectReady(loop.session)
    loop.session.status = 'READY_REFUSED'
    loop.session.verificationState.projectReady = false
    loop.verdict = 'BLOCKED_EVIDENCE'
    return loop.verdict
  }
  loop.session.verificationState.refusal = null
  loop.session.verificationState.projectReady = true
  refreshProjectReady(loop.session)
  loop.verdict = computeUnifiedVerdict(loop.session)
  return loop.verdict
}

export async function blockProvider(loop: UnifiedLoop, reason: string): Promise<FoundryUnifiedVerdict> {
  markWorkerUnavailable(loop.session, reason)
  loop.verdict = 'BLOCKED_PROVIDER'
  await persist(loop)
  return loop.verdict
}

export async function reconcileUncertainAction(loop: UnifiedLoop, intent: FoundryExecutionIntent): Promise<FoundryActionReceipt> {
  const classification = classifyInFlightAction(intent.actionId)
  const dest = path.join(loop.workspaceRoot, intent.target)
  const disk = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  const expected = resolveContent(intent, disk)
  if (classification === 'CONFIRMED_COMPLETED') {
    loop.replayedMutationCount = 0
    return reusedReceipt(intent, 'REUSED_COMPLETED')
  }
  if (expected.ok && disk === expected.content) {
    completeUnattendedDurableAction(intent.actionId, { ok: true, summary: 'reconciled from disk' })
    applyMutation(loop.session, intent.mutationId)
    const receipt = reusedReceipt(intent, 'RECONCILED_DISK')
    ingestReceipt(loop, intent, receipt)
    await persist(loop)
    return receipt
  }
  return executeUnifiedIntent(loop, intent)
}

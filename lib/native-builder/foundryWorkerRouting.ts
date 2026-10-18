/**
 * Capability-aware worker selection.
 * SHADOW records a recommendation without changing the live route.
 * ENABLED applies the recommendation through FoundryModelRouter pins.
 * Stored default policy stays LOCAL. This module is not a second router.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foundryContractsRoot } from './foundryContractStore'
import type { FrkCapability } from './reasoning-kernel/types'
import {
  ACCEPTED_WORKER_CAPABILITY_EVIDENCE,
  type FoundryWorkerEvidenceRow,
  type FoundryWorkerRoutingClass,
  type FoundryWorkerTaskClass,
} from './foundryWorkerRoutingEvidence'

export const CAPABILITY_AWARE_ROUTING_MODES = ['SHADOW', 'ENABLED'] as const
export type CapabilityAwareRoutingMode = (typeof CAPABILITY_AWARE_ROUTING_MODES)[number]
export const STORED_DEFAULT_POLICY = 'LOCAL' as const
export const MAX_WORKER_SWITCHES_PER_MISSION = 1 as const
export const UNBOUNDED_WORKER_SWITCH_COUNT = 0 as const
export const BUDGET_RESET_ON_WORKER_SWITCH_COUNT = 0 as const
export const PROVIDER_SPECIFIC_ROUTING_BRANCH_COUNT = 0 as const
export const WORKER_SWITCH_AUTHORITY_EXPANSION_COUNT = 0 as const
export const MODEL_ROUTING_ENABLE_COUNT = 0 as const
export const COMPOSER_GLOBAL_DEFAULT = false
export const QWEN_REMOVED = false
export const ROUTING_FAIL_SAFE_MODE: CapabilityAwareRoutingMode = 'SHADOW'

export type FoundryWorkerRoutingOutcome =
  | 'SELECTED'
  | 'BLOCKED_PROVIDER'
  | 'BLOCKED_CAPABILITY'
  | 'BLOCKED_RESOURCE'
  | 'BLOCKED_COMMANDER'
  | 'COMMANDER_DECISION_REQUIRED'

export type FoundryRoutingCandidate = {
  provider: string
  model: string
  local: boolean
  callable: boolean
  listedOnly: boolean
}

export type FoundryWorkerRoutingNeed = {
  missionId: string
  taskFamily: FoundryWorkerTaskClass
  capabilityFamilies: FrkCapability[]
  difficultyClass: string
  reasoningDepth: 'R0' | 'R1' | 'R2' | 'R3' | 'R4'
  ambiguity: 'low' | 'high'
  risk: 'low' | 'high'
  privacyRequirement: 'local' | 'any'
  localOnlyRequirement: boolean
  remotePermitted: boolean
  commanderPolicy: 'LOCAL' | 'REMOTE' | 'AUTO'
  commanderRemoteApprovalRequired?: boolean
  pin: { provider: string; model: string } | null
  candidates: FoundryRoutingCandidate[]
  callBudgetRemaining: number
  callBudgetCeiling: number
  wallTimeBudgetMs: number | null
  switchCount?: number
  previousProvider?: string | null
  previousModel?: string | null
  missionContractHash: string
  acceptanceContractHash: string
  toolAuthority: string
  deployAuthority: false
  now: string
}

export type FoundryRejectedCandidate = {
  provider: string
  model: string
  reason: string
}

export type FoundryWorkerRoutingDecision = {
  missionId: string
  routingDecisionId: string
  taskFamily: FoundryWorkerTaskClass
  capabilityFamilies: FrkCapability[]
  difficultyClass: string
  reasoningDepth: FoundryWorkerRoutingNeed['reasoningDepth']
  ambiguity: 'low' | 'high'
  risk: 'low' | 'high'
  privacyRequirement: 'local' | 'any'
  localOnlyRequirement: boolean
  selectedProvider: string | null
  selectedModel: string | null
  workerClass: FoundryWorkerRoutingClass | null
  selectionEvidenceIds: string[]
  rejectedCandidates: FoundryRejectedCandidate[]
  fallbackCandidates: FoundryRejectedCandidate[]
  policyBasis: string
  resourceBasis: string
  availabilityBasis: string
  reason: string
  outcome: FoundryWorkerRoutingOutcome
  commanderDecisionRequired: boolean
  appliedToLiveRoute: boolean
  routingMode: CapabilityAwareRoutingMode
  previousProvider: string | null
  previousModel: string | null
  trigger: string
  switchCount: number
  fallbackExplicit: boolean
  cost: 'UNKNOWN'
  missionContractHash: string
  acceptanceContractHash: string
  toolAuthority: string
  deployAuthority: false
  callBudgetCeiling: number
  timestamp: string
  reasoningSessionId?: string | null
  actualProvider?: string | null
  actualModel?: string | null
}

export type FoundryRoutingReconsideration = {
  previousProvider: string
  previousModel: string
  failureType: string | null
  capabilityRequirement: FrkCapability[]
  reasoningDepth: FoundryWorkerRoutingNeed['reasoningDepth']
  remainingBudget: { calls: number; wallTimeMs: number | null; cost: 'UNKNOWN' }
  candidateWorkers: Array<{ provider: string; model: string }>
  decision: 'ESCALATE' | 'STAY' | 'BLOCKED_CAPABILITY' | 'BLOCKED_PROVIDER' | 'COMMANDER_DECISION_REQUIRED'
  evidenceIds: string[]
  missionContractHash: string
  acceptanceContractHash: string
  callBudgetCeiling: number
}

export type FoundryCapabilityTableRow = {
  capabilityFamily: string
  provider: string
  model: string
  evidenceLevel: string
  engineeringPassRate: string
  reasoningEvidence: string
  rootCauseEvidence: string
  productionEvidence: string
  availability: string
  eligible: boolean
}

const DEPTH_EVIDENCE_DEFAULTS = [
  { depth: 'R0', localFirst: true, requireSupportedRoot: false },
  { depth: 'R1', localFirst: true, requireSupportedRoot: false },
  { depth: 'R2', localFirst: true, requireSupportedRoot: false },
  { depth: 'R3', localFirst: false, requireSupportedRoot: true },
  { depth: 'R4', localFirst: false, requireSupportedRoot: true },
] as const

export type CapabilityAwareRoutingEnablement = {
  previousMode: CapabilityAwareRoutingMode
  mode: CapabilityAwareRoutingMode
  storedDefaultPolicy: typeof STORED_DEFAULT_POLICY
  enabledAt: string
  mission: string
  composerGlobalDefault: false
  qwenRemoved: false
}

function enablementPath(): string {
  return path.join(foundryContractsRoot(), 'capability-aware-routing.json')
}

export function loadRoutingEnablement(): CapabilityAwareRoutingEnablement | null {
  try {
    const raw = JSON.parse(readFileSync(enablementPath(), 'utf8')) as CapabilityAwareRoutingEnablement
    if (raw.mode === 'SHADOW' || raw.mode === 'ENABLED') return raw
    return null
  } catch {
    return null
  }
}

export function getCapabilityAwareRoutingMode(): CapabilityAwareRoutingMode {
  if (existsSync(enablementPath())) {
    const stored = loadRoutingEnablement()?.mode
    if (stored === 'SHADOW' || stored === 'ENABLED') return stored
    return ROUTING_FAIL_SAFE_MODE
  }
  const fromEnv = process.env.FOUNDRY_CAPABILITY_AWARE_ROUTING_MODE?.trim()
  if (fromEnv === 'SHADOW' || fromEnv === 'ENABLED') return fromEnv
  return ROUTING_FAIL_SAFE_MODE
}

/** Pre-enablement default. Live mode is getCapabilityAwareRoutingMode(). */
export const CAPABILITY_AWARE_ROUTING_MODE: CapabilityAwareRoutingMode = 'SHADOW'

function writeRoutingEnablement(mode: CapabilityAwareRoutingMode, input?: { at?: string; mission?: string }): CapabilityAwareRoutingEnablement {
  const previousMode = getCapabilityAwareRoutingMode()
  const record: CapabilityAwareRoutingEnablement = {
    previousMode,
    mode,
    storedDefaultPolicy: STORED_DEFAULT_POLICY,
    enabledAt: input?.at ?? new Date().toISOString(),
    mission: input?.mission ?? 'FOUNDRY_CAPABILITY_AWARE_ROUTING_ENABLEMENT_01',
    composerGlobalDefault: false,
    qwenRemoved: false,
  }
  mkdirSync(path.dirname(enablementPath()), { recursive: true })
  writeFileSync(enablementPath(), JSON.stringify(record, null, 2))
  return record
}

export function setCapabilityAwareRoutingMode(
  mode: CapabilityAwareRoutingMode,
  input?: { at?: string; mission?: string },
): { ok: true; mode: CapabilityAwareRoutingMode; previousMode: CapabilityAwareRoutingMode; policy: 'LOCAL' } {
  const next = mode === 'ENABLED' || mode === 'SHADOW' ? mode : ROUTING_FAIL_SAFE_MODE
  const record = writeRoutingEnablement(next, input)
  return { ok: true, mode: record.mode, previousMode: record.previousMode, policy: 'LOCAL' }
}

export function enableCapabilityAwareRouting(input?: { at?: string; mission?: string }): { ok: true; mode: 'ENABLED'; previousMode: CapabilityAwareRoutingMode; policy: 'LOCAL' } {
  const record = writeRoutingEnablement('ENABLED', {
    at: input?.at,
    mission: input?.mission ?? 'FOUNDRY_CAPABILITY_AWARE_ROUTING_ENABLEMENT_01',
  })
  return { ok: true, mode: 'ENABLED', previousMode: record.previousMode, policy: 'LOCAL' }
}

/** Commander kill switch. Persists SHADOW immediately. No rebuild. */
export function disableCapabilityAwareRouting(input?: { at?: string; mission?: string }): { ok: true; mode: 'SHADOW'; previousMode: CapabilityAwareRoutingMode; policy: 'LOCAL' } {
  const record = writeRoutingEnablement('SHADOW', {
    at: input?.at,
    mission: input?.mission ?? 'ROUTING_KILL_SWITCH',
  })
  return { ok: true, mode: 'SHADOW', previousMode: record.previousMode, policy: 'LOCAL' }
}

function sameIdentity(provider: string, model: string, otherProvider: string, otherModel: string): boolean {
  return provider === otherProvider && model === otherModel
}

function rowsFor(candidate: { provider: string; model: string }, evidence: FoundryWorkerEvidenceRow[]): FoundryWorkerEvidenceRow[] {
  return evidence.filter(item => sameIdentity(item.provider, item.model, candidate.provider, candidate.model) && item.rootCauseStatus !== 'EXCLUDED')
}

function familyRows(candidate: { provider: string; model: string }, family: FrkCapability, evidence: FoundryWorkerEvidenceRow[]): FoundryWorkerEvidenceRow[] {
  return rowsFor(candidate, evidence).filter(item => item.capabilityFamily === family)
}

function supported(candidate: { provider: string; model: string }, family: FrkCapability, evidence: FoundryWorkerEvidenceRow[]): boolean {
  return familyRows(candidate, family, evidence).some(item => item.engineeringPass && item.reasoningPass && item.rootCauseStatus === 'SUPPORTED')
}

function routineSufficient(candidate: { provider: string; model: string }, evidence: FoundryWorkerEvidenceRow[]): boolean {
  return rowsFor(candidate, evidence).some(item => item.engineeringPass && item.historicalReliability === 'RELIABLE')
}

function limitationText(candidate: { provider: string; model: string }, families: FrkCapability[], evidence: FoundryWorkerEvidenceRow[]): string {
  const limits = families.flatMap(family => familyRows(candidate, family, evidence)
    .filter(item => item.rootCauseStatus === 'PARTIAL' || item.rootCauseStatus === 'UNSUPPORTED' || item.rootCauseStatus === 'CONTRADICTED')
    .map(item => `${item.capabilityFamily} ${item.rootCauseStatus} n=${item.sampleSize} case=${item.caseId ?? 'historical'}`))
  return limits.join('; ')
}

function resourceBasis(need: FoundryWorkerRoutingNeed): string {
  return `callsRemaining=${need.callBudgetRemaining}; ceiling=${need.callBudgetCeiling}; wallTimeMs=${need.wallTimeBudgetMs ?? 'unset'}; cost=UNKNOWN`
}

function blocked(need: FoundryWorkerRoutingNeed, outcome: FoundryWorkerRoutingOutcome, reason: string, rejected: FoundryRejectedCandidate[], evidenceIds: string[]): FoundryWorkerRoutingDecision {
  return {
    missionId: need.missionId,
    routingDecisionId: `route-${need.missionId}`,
    taskFamily: need.taskFamily,
    capabilityFamilies: need.capabilityFamilies,
    difficultyClass: need.difficultyClass,
    reasoningDepth: need.reasoningDepth,
    ambiguity: need.ambiguity,
    risk: need.risk,
    privacyRequirement: need.privacyRequirement,
    localOnlyRequirement: need.localOnlyRequirement,
    selectedProvider: null,
    selectedModel: null,
    workerClass: null,
    selectionEvidenceIds: evidenceIds,
    rejectedCandidates: rejected,
    fallbackCandidates: [],
    policyBasis: 'precedence pin > commander policy > privacy > capability > availability > resource > local preference',
    resourceBasis: resourceBasis(need),
    availabilityBasis: 'callable flag supplied by the mission; listing alone is not availability',
    reason,
    outcome,
    commanderDecisionRequired: outcome === 'COMMANDER_DECISION_REQUIRED' || outcome === 'BLOCKED_CAPABILITY' || outcome === 'BLOCKED_COMMANDER',
    appliedToLiveRoute: false,
    routingMode: getCapabilityAwareRoutingMode(),
    previousProvider: need.previousProvider ?? null,
    previousModel: need.previousModel ?? null,
    trigger: 'initial',
    switchCount: need.switchCount ?? 0,
    fallbackExplicit: false,
    cost: 'UNKNOWN',
    missionContractHash: need.missionContractHash,
    acceptanceContractHash: need.acceptanceContractHash,
    toolAuthority: need.toolAuthority,
    deployAuthority: false,
    callBudgetCeiling: need.callBudgetCeiling,
    timestamp: need.now,
  }
}

function selectedDecision(
  need: FoundryWorkerRoutingNeed,
  candidate: FoundryRoutingCandidate,
  workerClass: FoundryWorkerRoutingClass,
  evidenceIds: string[],
  rejected: FoundryRejectedCandidate[],
  reason: string,
): FoundryWorkerRoutingDecision {
  return {
    ...blocked(need, 'SELECTED', reason, rejected, evidenceIds),
    selectedProvider: candidate.provider,
    selectedModel: candidate.model,
    workerClass,
    outcome: 'SELECTED',
    commanderDecisionRequired: false,
  }
}

export function recommendFoundryWorker(need: FoundryWorkerRoutingNeed, evidence: FoundryWorkerEvidenceRow[] = ACCEPTED_WORKER_CAPABILITY_EVIDENCE): FoundryWorkerRoutingDecision {
  if (need.callBudgetRemaining < 1) {
    return blocked(need, 'BLOCKED_RESOURCE', 'Remaining model-call budget is zero. Cost is UNKNOWN. No worker is selected. Budget ceiling is unchanged.', [], [])
  }
  if (need.pin) {
    const match = need.candidates.find(candidate => sameIdentity(candidate.provider, candidate.model, need.pin!.provider, need.pin!.model))
    const rejected = need.candidates
      .filter(candidate => !match || !sameIdentity(candidate.provider, candidate.model, match.provider, match.model))
      .map(candidate => ({ provider: candidate.provider, model: candidate.model, reason: 'PINNED_NO_SUBSTITUTION' }))
    if (!match || !match.callable || match.listedOnly) {
      return blocked(need, 'BLOCKED_PROVIDER', 'Pinned worker is not callable. No substitute worker is allowed.', rejected, [])
    }
    const ids = rowsFor(match, evidence).map(item => item.evidenceId)
    return selectedDecision(need, match, 'PINNED', ids, rejected, 'Pinned mission. Routing substitution is refused.')
  }

  const rejected: FoundryRejectedCandidate[] = []
  const callable = need.candidates.filter(candidate => {
    if (!candidate.callable || candidate.listedOnly) {
      rejected.push({ provider: candidate.provider, model: candidate.model, reason: candidate.listedOnly ? 'UNPROVEN_LISTING' : 'UNAVAILABLE' })
      return false
    }
    if (!rowsFor(candidate, evidence).length) {
      rejected.push({ provider: candidate.provider, model: candidate.model, reason: 'NO_CAPABILITY_EVIDENCE' })
      return false
    }
    return true
  })
  const evidenceExists = need.candidates.some(candidate => rowsFor(candidate, evidence).length > 0)
  const availabilityRejected = rejected.filter(item => item.reason === 'UNAVAILABLE' || item.reason === 'UNPROVEN_LISTING')
  if (!callable.length && evidenceExists && availabilityRejected.length) {
    return blocked(
      need,
      'BLOCKED_PROVIDER',
      'Local worker evidence exists, but the worker is not currently callable. Reconstruct availability from the live provider before routing.',
      rejected,
      [],
    )
  }
  const remoteAllowed = need.remotePermitted && !need.localOnlyRequirement && need.privacyRequirement !== 'local'
  const pool = callable.filter(candidate => {
    if (candidate.local) return true
    if (remoteAllowed) return true
    rejected.push({ provider: candidate.provider, model: candidate.model, reason: 'REMOTE_NOT_PERMITTED' })
    return false
  })
  const depth = DEPTH_EVIDENCE_DEFAULTS.find(item => item.depth === need.reasoningDepth) ?? DEPTH_EVIDENCE_DEFAULTS[1]
  const hard = !depth.localFirst || need.ambiguity === 'high' || depth.requireSupportedRoot
  const families = need.capabilityFamilies
  const limits = pool.map(candidate => limitationText(candidate, families, evidence)).filter(Boolean).join(' | ')

  if (!hard) {
    const localWorker = pool.find(candidate => candidate.local && routineSufficient(candidate, evidence))
    if (localWorker) {
      const ids = rowsFor(localWorker, evidence).filter(item => item.historicalReliability === 'RELIABLE').map(item => item.evidenceId)
      return selectedDecision(
        need,
        localWorker,
        need.reasoningDepth === 'R0' || need.reasoningDepth === 'R1' ? 'LOCAL_ROUTINE' : 'LOCAL_PREFERRED',
        ids,
        rejected,
        `Low-depth task stays on the local worker with accepted routine engineering evidence. ${limits}`.trim(),
      )
    }
  }

  const fullySupported = pool.filter(candidate => families.length > 0 && families.every(family => supported(candidate, family, evidence)))
  const localSupported = fullySupported.find(candidate => candidate.local)
  if (localSupported) {
    return selectedDecision(need, localSupported, 'LOCAL_PREFERRED', rowsFor(localSupported, evidence).map(item => item.evidenceId), rejected, 'Local worker has supported evidence for every required capability family.')
  }
  const remoteSupported = fullySupported.find(candidate => !candidate.local)
  if (remoteSupported && remoteAllowed) {
    if (need.commanderRemoteApprovalRequired) {
      return blocked(
        need,
        'BLOCKED_COMMANDER',
        'Remote escalation requires Commander approval. No silent worker switch.',
        rejected,
        families.flatMap(family => familyRows(remoteSupported, family, evidence).filter(item => item.rootCauseStatus === 'SUPPORTED').map(item => item.evidenceId)),
      )
    }
    return selectedDecision(
      need,
      remoteSupported,
      'STRONG_REASONING',
      families.flatMap(family => familyRows(remoteSupported, family, evidence).filter(item => item.rootCauseStatus === 'SUPPORTED').map(item => item.evidenceId)),
      rejected,
      `Required families have supported fixture evidence on this worker. Evidence limits remain: ${limits || 'none recorded'}. Sample sizes stay at the recorded n counts.`,
    )
  }

  if (need.localOnlyRequirement || need.privacyRequirement === 'local' || !remoteAllowed) {
    return blocked(
      need,
      'BLOCKED_CAPABILITY',
      `Local-only or local policy stands. Required capability evidence is insufficient. ${limits}`.trim(),
      rejected,
      [],
    )
  }

  return blocked(
    need,
    'COMMANDER_DECISION_REQUIRED',
    `Automatic preference withheld. Root-cause evidence is not supported for every required family. ${limits}`.trim(),
    rejected,
    [],
  )
}

export function reconsiderFoundryRouting(input: {
  need: FoundryWorkerRoutingNeed
  previousProvider: string
  previousModel: string
  failureType: string | null
  succeeded: boolean
  switchCount?: number
  evidence?: FoundryWorkerEvidenceRow[]
}): { reconsideration: FoundryRoutingReconsideration; decision: FoundryWorkerRoutingDecision } {
  const evidence = input.evidence ?? ACCEPTED_WORKER_CAPABILITY_EVIDENCE
  const remaining = { calls: input.need.callBudgetRemaining, wallTimeMs: input.need.wallTimeBudgetMs, cost: 'UNKNOWN' as const }
  const switchCount = input.switchCount ?? input.need.switchCount ?? 0
  const need: FoundryWorkerRoutingNeed = {
    ...input.need,
    switchCount,
    previousProvider: input.previousProvider,
    previousModel: input.previousModel,
    callBudgetCeiling: input.need.callBudgetCeiling,
  }
  const base = {
    previousProvider: input.previousProvider,
    previousModel: input.previousModel,
    failureType: input.failureType,
    capabilityRequirement: need.capabilityFamilies,
    reasoningDepth: need.reasoningDepth,
    remainingBudget: remaining,
    candidateWorkers: need.candidates.map(candidate => ({ provider: candidate.provider, model: candidate.model })),
    evidenceIds: [] as string[],
    missionContractHash: need.missionContractHash,
    acceptanceContractHash: need.acceptanceContractHash,
    callBudgetCeiling: need.callBudgetCeiling,
  }
  if (input.succeeded || !input.failureType) {
    const stay = recommendFoundryWorker({ ...need, reasoningDepth: 'R1', ambiguity: 'low', capabilityFamilies: ['PLAN_TO_CODE_FIDELITY'] }, evidence)
    return {
      reconsideration: { ...base, decision: 'STAY', evidenceIds: stay.selectionEvidenceIds },
      decision: stay.selectedProvider ? { ...stay, switchCount, trigger: 'stay-after-success', previousProvider: input.previousProvider, previousModel: input.previousModel } : selectedFromPrevious(need, input.previousProvider, input.previousModel),
    }
  }
  if (switchCount >= MAX_WORKER_SWITCHES_PER_MISSION) {
    const decision = blocked(need, 'BLOCKED_CAPABILITY', 'Worker switch limit reached. Automatic oscillation is refused. Budget ceiling is unchanged.', [], [])
    decision.switchCount = switchCount
    decision.trigger = 'switch-limit'
    return { reconsideration: { ...base, decision: 'BLOCKED_CAPABILITY' }, decision }
  }
  if (need.pin || need.localOnlyRequirement || !need.remotePermitted) {
    const decision = recommendFoundryWorker(need, evidence)
    return {
      reconsideration: { ...base, decision: need.pin ? 'BLOCKED_PROVIDER' : 'BLOCKED_CAPABILITY' },
      decision: { ...decision, switchCount, trigger: 'bounded-local-lock' },
    }
  }
  if (need.commanderRemoteApprovalRequired) {
    const decision = blocked(need, 'BLOCKED_COMMANDER', 'Remote escalation requires Commander approval. No silent worker switch.', [], [])
    decision.trigger = 'commander-gate'
    return { reconsideration: { ...base, decision: 'COMMANDER_DECISION_REQUIRED' }, decision }
  }
  const remote = need.candidates.find(candidate => !candidate.local && candidate.callable && !candidate.listedOnly)
  const recovery = remote && need.capabilityFamilies.some(family => familyRows(remote, family, evidence).some(item => item.engineeringPass))
  if (!remote || !recovery) {
    const decision = blocked(need, 'COMMANDER_DECISION_REQUIRED', 'Local worker failed and no remote worker has engineering evidence for the required family.', [], [])
    return { reconsideration: { ...base, decision: 'COMMANDER_DECISION_REQUIRED' }, decision }
  }
  const ids = need.capabilityFamilies.flatMap(family => familyRows(remote, family, evidence).filter(item => item.engineeringPass).map(item => item.evidenceId))
  const limits = limitationText(remote, need.capabilityFamilies, evidence)
  const decision = selectedDecision(
    need,
    remote,
    'STRONG_REASONING',
    ids,
    need.candidates.filter(candidate => candidate.local).map(candidate => ({ provider: candidate.provider, model: candidate.model, reason: 'BOUNDED_LOCAL_FAILURE' })),
    `Routing reconsideration after a bounded local failure. Contract hash and call ceiling stay unchanged. ${limits}`.trim(),
  )
  decision.switchCount = switchCount + 1
  decision.trigger = 'bounded-local-failure'
  decision.previousProvider = input.previousProvider
  decision.previousModel = input.previousModel
  decision.fallbackExplicit = true
  return { reconsideration: { ...base, decision: 'ESCALATE', evidenceIds: ids }, decision }
}

function selectedFromPrevious(need: FoundryWorkerRoutingNeed, provider: string, model: string): FoundryWorkerRoutingDecision {
  const candidate = need.candidates.find(item => sameIdentity(item.provider, item.model, provider, model))
  if (!candidate) return blocked(need, 'BLOCKED_PROVIDER', 'Previous worker is no longer a candidate.', [], [])
  return selectedDecision(need, candidate, 'LOCAL_ROUTINE', [], [], 'Previous worker succeeded. No additional worker call is required.')
}

export function capabilityRoutingTable(evidence: FoundryWorkerEvidenceRow[] = ACCEPTED_WORKER_CAPABILITY_EVIDENCE): FoundryCapabilityTableRow[] {
  const groups = new Map<string, FoundryWorkerEvidenceRow[]>()
  for (const item of evidence) {
    const key = `${item.capabilityFamily}\0${item.provider}\0${item.model}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].map(([, rows]) => {
    const sample = rows.reduce((sum, item) => sum + item.sampleSize, 0)
    const engineeringPasses = rows.filter(item => item.engineeringPass).length
    const reasoningPasses = rows.filter(item => item.reasoningPass).length
    const roots = rows.map(item => `${item.rootCauseStatus} n=${item.sampleSize}`).join(', ')
    const reliable = rows.some(item => item.historicalReliability === 'RELIABLE')
    return {
      capabilityFamily: rows[0].capabilityFamily,
      provider: rows[0].provider,
      model: rows[0].model,
      evidenceLevel: rows.some(item => item.productionProven) ? 'PRODUCTION_PROVEN' : reliable ? 'HISTORICAL_RELIABLE' : 'FIXTURE',
      engineeringPassRate: `n=${engineeringPasses}/${rows.length}; sample=${sample}`,
      reasoningEvidence: `n=${reasoningPasses}/${rows.length}`,
      rootCauseEvidence: roots,
      productionEvidence: 'none',
      availability: 'not-probed',
      eligible: rows.some(item => item.engineeringPass || item.historicalReliability === 'RELIABLE'),
    }
  })
}

export function shadowRouteOptions(missionId: string, pin: { provider: string; model: string } | null) {
  const stored = loadRoutingDecision(missionId)
  const advisory = commanderWorkerRoutingView(stored)
  return applyCapabilityAwareRouteOptions({
    missionId,
    pinProvider: pin?.provider ?? null,
    pinModel: pin?.model ?? null,
  }, stored ?? {
    missionId,
    routingDecisionId: `route-${missionId}`,
    taskFamily: 'BUG_FIX',
    capabilityFamilies: [],
    difficultyClass: advisory.mode,
    reasoningDepth: 'R1',
    ambiguity: 'low',
    risk: 'low',
    privacyRequirement: 'any',
    localOnlyRequirement: false,
    selectedProvider: null,
    selectedModel: null,
    workerClass: null,
    selectionEvidenceIds: [],
    rejectedCandidates: [],
    fallbackCandidates: [],
    policyBasis: advisory.policy,
    resourceBasis: 'cost=UNKNOWN',
    availabilityBasis: advisory.why,
    reason: advisory.why,
    outcome: 'SELECTED',
    commanderDecisionRequired: false,
    appliedToLiveRoute: false,
    routingMode: advisory.mode,
    previousProvider: null,
    previousModel: null,
    trigger: 'none',
    switchCount: 0,
    fallbackExplicit: false,
    cost: 'UNKNOWN',
    missionContractHash: '',
    acceptanceContractHash: '',
    toolAuthority: '',
    deployAuthority: false,
    callBudgetCeiling: 0,
    timestamp: '',
  })
}

export function applyCapabilityAwareRouteOptions<T extends { pinProvider?: string | null; pinModel?: string | null }>(
  options: T,
  decision: FoundryWorkerRoutingDecision,
): T {
  if (getCapabilityAwareRoutingMode() !== 'ENABLED') return options
  if (options.pinProvider) return options
  if (decision.outcome !== 'SELECTED' || !decision.selectedProvider) return options
  return { ...options, pinProvider: decision.selectedProvider, pinModel: decision.selectedModel }
}

export function applyShadowToRouteOptions<T extends { pinProvider?: string | null; pinModel?: string | null }>(
  options: T,
  decision: FoundryWorkerRoutingDecision,
): T {
  return applyCapabilityAwareRouteOptions(options, decision)
}

export function commanderWorkerRoutingView(decision?: FoundryWorkerRoutingDecision | null) {
  const mode = getCapabilityAwareRoutingMode()
  const recommended = decision?.selectedProvider ? `${decision.selectedProvider}/${decision.selectedModel}` : null
  const actual = decision?.actualProvider
    ? `${decision.actualProvider}/${decision.actualModel}`
    : mode === 'ENABLED' && decision?.appliedToLiveRoute === true
      ? recommended
      : recommended
  return {
    mode,
    recommendedWorker: recommended,
    selectedWorker: actual,
    previousWorker: decision?.previousProvider ? `${decision.previousProvider}/${decision.previousModel}` : null,
    why: decision?.reason
      ?? (mode === 'ENABLED'
        ? 'Stored policy LOCAL. Capability-aware routing may apply a stronger worker when evidence and policy justify it.'
        : 'Stored policy LOCAL. The capability recommendation is recorded and is not applied to this mission.'),
    capabilityEvidence: decision?.selectionEvidenceIds.length ? decision.selectionEvidenceIds.join(', ') : 'Fixture and historical engineering records. Production evidence is none.',
    policy: STORED_DEFAULT_POLICY,
    fallbackAllowed: decision?.fallbackExplicit === true,
    workerSwitchCount: decision?.switchCount ?? 0,
    routingMode: mode,
  }
}

export function routingCandidatesFromEvidence(input: {
  evidence?: FoundryWorkerEvidenceRow[]
  liveIdentities: Array<{ provider: string; model: string }>
}): FoundryRoutingCandidate[] {
  const evidence = input.evidence ?? ACCEPTED_WORKER_CAPABILITY_EVIDENCE
  const seen = new Set<string>()
  const out: FoundryRoutingCandidate[] = []
  for (const row of evidence) {
    if (row.provider === 'wrim') continue
    const key = `${row.provider}/${row.model}`
    if (seen.has(key)) continue
    seen.add(key)
    const live = input.liveIdentities.some(item => sameIdentity(item.provider, item.model, row.provider, row.model))
    out.push({ provider: row.provider, model: row.model, local: row.local, callable: live, listedOnly: !live })
  }
  return out
}

export function reconstructCallableCandidates(
  previous: FoundryRoutingCandidate[],
  liveIdentities: Array<{ provider: string; model: string }>,
): FoundryRoutingCandidate[] {
  return previous.map(candidate => {
    const live = liveIdentities.some(item => sameIdentity(item.provider, item.model, candidate.provider, candidate.model))
    return { ...candidate, callable: live, listedOnly: !live }
  })
}

function durableRoutingRoot(): string {
  return path.join(foundryContractsRoot(), 'routing')
}

export function persistRoutingDecision(decision: FoundryWorkerRoutingDecision, root?: string): void {
  const targets = [...new Set([root, durableRoutingRoot()].filter((item): item is string => Boolean(item)))]
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${decision.missionId}.json`), JSON.stringify(decision, null, 2))
  }
}

export function loadRoutingDecision(missionId: string, root?: string): FoundryWorkerRoutingDecision | null {
  const targets = [...new Set([root, durableRoutingRoot()].filter((item): item is string => Boolean(item)))]
  for (const dir of targets) {
    try {
      return JSON.parse(readFileSync(path.join(dir, `${missionId}.json`), 'utf8')) as FoundryWorkerRoutingDecision
    } catch {
      continue
    }
  }
  return null
}

export function resumeRoutingDecision(missionId: string, root: string, proposed: FoundryWorkerRoutingDecision | null): FoundryWorkerRoutingDecision | null {
  const stored = loadRoutingDecision(missionId, root) ?? loadRoutingDecision(missionId)
  if (!stored) return proposed
  return stored
}

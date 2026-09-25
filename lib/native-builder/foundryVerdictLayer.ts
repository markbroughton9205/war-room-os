/**
 * Independent Verdict Layer. Executors may propose completion; they cannot assign PASS.
 * REVIEWER findings are ingested here. VERIFIER produces evidence only.
 */
import { randomUUID } from 'node:crypto'
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import {
  classifyLegacyPreContract,
  type FoundryAcceptanceContract,
  type FoundryMissionContract,
  type FoundryReviewOutcome,
  type FoundryVerdictRecord,
  type FoundryVerdictResult,
} from './foundryContractTypes'
import { loadAcceptanceContract, loadMissionContract, loadVerdictRecord, saveVerdictRecord, appendContractEvent, listAcceptanceEvidence, listExecutionApprovals } from './foundryContractStore'
import { evaluateAllCriteria } from './foundryAcceptanceEvidence'
import { hashAcceptanceContract, hashMissionContract } from './foundryMissionContract'
import { FOUNDRY_COMMAND_CENTER_GOVERNANCE } from './foundryAgentTypes'
import { evaluateApprovalBinding } from './foundryExecutionApproval'

const PROTECTED_PRODUCT = /Harbor Desk|Lane & Box|Inventory Manager|\bTerra\b|\bWRIM\b/i

export function isStandaloneEngineerMission(mission: Pick<FoundryMissionRecord, 'engineeringClass'> | { engineeringClass?: string | null }): boolean {
  return mission.engineeringClass === 'STANDALONE_ENGINEER'
}

export function isStandaloneEngineerGraph(graph: Pick<FoundryCommandCenterGraph, 'engineeringClass'> | { engineeringClass?: string | null }): boolean {
  return graph.engineeringClass === 'STANDALONE_ENGINEER'
}

export function evaluateIndependentReview(graph: FoundryCommandCenterGraph): { outcome: FoundryReviewOutcome; reasons: string[] } {
  const reasons: string[] = []
  if (process.env.FOUNDRY_CC_INJECT_REVIEW_FAILURE === '1') {
    reasons.push('Injected reviewer defect.')
  }
  const testTasks = graph.tasks.filter(task => task.role === 'TEST')
  if (testTasks.some(task => task.tests.ok === false)) reasons.push('Tests failed.')
  if (testTasks.some(task => task.tests.ok == null) && isStandaloneEngineerGraph(graph)) {
    reasons.push('Required tests were not evaluated.')
  }
  const files = graph.workspaces.flatMap(ws => ws.filesChanged)
  if (files.some(file => PROTECTED_PRODUCT.test(file))) reasons.push('Diff scope includes a protected product path.')
  if (graph.preview && graph.preview.status === 'FAILED') reasons.push('Preview failed.')
  if (FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_COMMIT !== 0 || FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_PUSH !== 0 || FOUNDRY_COMMAND_CENTER_GOVERNANCE.AUTO_DEPLOY !== 0) {
    reasons.push('Governance allowed commit/push/deploy.')
  }
  for (const finding of graph.adversarialFindings ?? []) {
    if (finding.blocksReady && !finding.resolved) reasons.push(`Adversarial review: ${finding.kind}. ${finding.summary}`)
  }
  if (reasons.length) return { outcome: 'FAIL', reasons }
  if (!testTasks.length && isStandaloneEngineerGraph(graph)) return { outcome: 'INCONCLUSIVE', reasons: ['No TEST role evidence.'] }
  return { outcome: 'PASS', reasons: ['Independent review found no blocking defects.'] }
}

export type ExecutionGate = { ok: boolean; error?: string; missing: string[] }

export function canEnterExecution(input: {
  engineeringClass?: string | null
  planningMode?: boolean
  specApproved?: boolean
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
  approvedMissionHash?: string | null
  approvedAcceptanceHash?: string | null
  approvedSpecVersion?: string | null
  missionId?: string | null
  graphId?: string | null
}): ExecutionGate {
  if (classifyLegacyPreContract(input.engineeringClass) !== 'STANDALONE_ENGINEER') {
    return { ok: true, missing: [] }
  }
  const missing: string[] = []
  const missionContract = input.missionContract
  const acceptanceContract = input.acceptanceContract
  if (!missionContract || missionContract.status !== 'SEALED') missing.push('MISSION_CONTRACT_SEALED')
  if (!acceptanceContract || acceptanceContract.status !== 'SEALED') missing.push('ACCEPTANCE_CONTRACT_SEALED')
  if (input.specApproved !== true) missing.push('SPEC_APPROVED')
  if (missionContract?.status === 'SEALED') {
    if (hashMissionContract(missionContract) !== missionContract.contentHash) missing.push('MISSION_CONTRACT_HASH_MISMATCH')
  }
  if (acceptanceContract?.status === 'SEALED') {
    if (hashAcceptanceContract(acceptanceContract) !== acceptanceContract.contentHash) missing.push('ACCEPTANCE_CONTRACT_HASH_MISMATCH')
  }
  if (input.missionId) {
    const binding = evaluateApprovalBinding({
      engineeringClass: input.engineeringClass,
      missionId: input.missionId,
      graphId: input.graphId,
      missionContract,
      acceptanceContract,
    })
    if (!binding.ok) {
      for (const item of binding.missing) {
        if (!missing.includes(item)) missing.push(item)
      }
    }
  } else {
    if (missionContract && input.approvedMissionHash && input.approvedMissionHash !== missionContract.contentHash) missing.push('APPROVED_MISSION_HASH_MISMATCH')
    if (acceptanceContract && input.approvedAcceptanceHash && input.approvedAcceptanceHash !== acceptanceContract.contentHash) missing.push('APPROVED_ACCEPTANCE_HASH_MISMATCH')
    if (missionContract && input.approvedSpecVersion && input.approvedSpecVersion !== missionContract.specVersion) missing.push('SPEC_VERSION_MISMATCH')
  }
  if (missing.length) {
    const sealed = missionContract?.status === 'SEALED' && acceptanceContract?.status === 'SEALED'
    const reapproval = missing.some(item =>
      item.endsWith('_MISMATCH')
      || item.startsWith('APPROVAL_')
      || (item === 'EXECUTION_APPROVAL' && sealed),
    )
    return {
      ok: false,
      error: reapproval
        ? `REAPPROVAL_REQUIRED: ${missing.join(', ')}`
        : `STANDALONE_ENGINEER execution refused: ${missing.join(', ')}`,
      missing,
    }
  }
  return { ok: true, missing: [] }
}

export function canEnterExecutionFromGraph(graph: FoundryCommandCenterGraph): ExecutionGate {
  const missionContract = graph.missionContractId ? loadMissionContract(graph.missionContractId) : null
  const acceptanceContract = graph.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
  return canEnterExecution({
    engineeringClass: graph.engineeringClass,
    planningMode: graph.planningMode,
    specApproved: graph.specApproved,
    missionContract,
    acceptanceContract,
    approvedMissionHash: graph.missionContractHash,
    approvedAcceptanceHash: graph.acceptanceContractHash,
    approvedSpecVersion: graph.specVersion,
    missionId: graph.missionId,
    graphId: graph.graphId,
  })
}

export function canEnterExecutionFromMission(mission: FoundryMissionRecord): ExecutionGate {
  const missionContract = mission.missionContractId ? loadMissionContract(mission.missionContractId) : null
  const acceptanceContract = mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null
  return canEnterExecution({
    engineeringClass: mission.engineeringClass,
    planningMode: mission.planningMode,
    specApproved: mission.contractSpecApproved === true || (!mission.planningMode && mission.engineeringClass !== 'STANDALONE_ENGINEER'),
    missionContract,
    acceptanceContract,
    approvedMissionHash: mission.missionContractHash,
    approvedAcceptanceHash: mission.acceptanceContractHash,
    missionId: mission.missionId,
  })
}

export function standaloneEngineerBlocksMutation(mission: FoundryMissionRecord, tool: string): string | null {
  if (!isStandaloneEngineerMission(mission)) return null
  const gate = canEnterExecutionFromMission(mission)
  if (gate.ok) return null
  const sealed = gate.missing.includes('MISSION_CONTRACT_SEALED') === false && gate.missing.includes('ACCEPTANCE_CONTRACT_SEALED') === false
  if (sealed && gate.missing.some(item => item === 'EXECUTION_APPROVAL' || item.endsWith('_MISMATCH') || item.startsWith('APPROVAL_'))) {
    return `REAPPROVAL_REQUIRED: ${tool} blocked. ${gate.error}`
  }
  return `MUTATION_BEFORE_CONTRACT: ${tool} blocked. ${gate.error}`
}

export function evaluateVerdictLayer(input: {
  missionId: string
  graphId?: string | null
  engineeringClass?: string | null
  missionContract: FoundryMissionContract | null
  acceptanceContract: FoundryAcceptanceContract | null
  reviewOutcome?: FoundryReviewOutcome | null
  executorResult?: FoundryVerdictRecord['executorResult']
  unresolvedBlocker?: string | null
  mission?: FoundryMissionRecord | null
  recover?: boolean
}): FoundryVerdictRecord {
  const started = appendContractEvent(input.missionId, 'VERDICT_STARTED', 'Independent verdict evaluation started', input.mission)
  const previous = loadVerdictRecord(input.missionId)
  if (input.recover && previous?.midEvaluation) {
    return evaluateVerdictLayer({ ...input, recover: false })
  }
  saveVerdictRecord({
    schemaVersion: 1,
    verdictId: previous?.verdictId ?? `VD-${randomUUID()}`,
    missionId: input.missionId,
    graphId: input.graphId ?? previous?.graphId ?? null,
    missionContractId: input.missionContract?.missionContractId ?? previous?.missionContractId ?? '',
    acceptanceContractId: input.acceptanceContract?.acceptanceContractId ?? previous?.acceptanceContractId ?? '',
    missionContractHash: input.missionContract?.contentHash ?? previous?.missionContractHash ?? '',
    acceptanceContractHash: input.acceptanceContract?.contentHash ?? previous?.acceptanceContractHash ?? '',
    specVersion: input.missionContract?.specVersion ?? previous?.specVersion ?? '',
    result: previous?.result ?? 'INCONCLUSIVE',
    reasons: previous?.reasons ?? ['mid-evaluation'],
    missingCriterionIds: previous?.missingCriterionIds ?? [],
    failedCriterionIds: previous?.failedCriterionIds ?? [],
    inconclusiveCriterionIds: previous?.inconclusiveCriterionIds ?? [],
    staleEvidenceIds: previous?.staleEvidenceIds ?? [],
    reviewOutcome: input.reviewOutcome ?? previous?.reviewOutcome ?? null,
    executorResult: input.executorResult ?? previous?.executorResult ?? 'NONE',
    evaluatedAt: new Date().toISOString(),
    midEvaluation: true,
  })
  const reasons: string[] = []
  let result: FoundryVerdictResult = 'INCONCLUSIVE'
  const missingCriterionIds: string[] = []
  const failedCriterionIds: string[] = []
  const inconclusiveCriterionIds: string[] = []
  const staleEvidenceIds: string[] = []

  if (classifyLegacyPreContract(input.engineeringClass) !== 'STANDALONE_ENGINEER') {
    result = 'BLOCKED'
    reasons.push('LEGACY_PRE_CONTRACT is not eligible for Standalone Engineer PROJECT READY.')
  } else if (!input.missionContract || input.missionContract.status !== 'SEALED' || !input.acceptanceContract || input.acceptanceContract.status !== 'SEALED') {
    result = 'BLOCKED'
    reasons.push('Sealed MissionContract and AcceptanceContract are required.')
  } else if (hashMissionContract(input.missionContract) !== input.missionContract.contentHash || hashAcceptanceContract(input.acceptanceContract) !== input.acceptanceContract.contentHash) {
    result = 'FAIL'
    reasons.push('Contract hash mismatch.')
  } else {
    const rows = evaluateAllCriteria(input.missionContract, input.acceptanceContract)
    for (const row of rows) {
      const criterion = input.acceptanceContract.criteria.find(item => item.criterionId === row.criterionId)
      if (!criterion?.required) continue
      if (row.stale && row.evidenceId) staleEvidenceIds.push(row.evidenceId)
      if (row.satisfied) continue
      if (row.reason === 'UNBOUND_PASS_CANNOT_SATISFY_CRITERION') missingCriterionIds.push(row.criterionId)
      else if (row.reason === 'criterion FAIL') failedCriterionIds.push(row.criterionId)
      else if (row.reason === 'STALE_EVIDENCE_CANNOT_SATISFY_CRITERION') missingCriterionIds.push(row.criterionId)
      else inconclusiveCriterionIds.push(row.criterionId)
      reasons.push(`${row.criterionId}: ${row.reason}`)
    }
    if (input.reviewOutcome === 'FAIL') {
      failedCriterionIds.push('REVIEW')
      reasons.push('REVIEWER FAIL.')
    } else if (input.reviewOutcome === 'BLOCKED') {
      reasons.push('REVIEWER BLOCKED.')
    } else if (input.reviewOutcome === 'INCONCLUSIVE') {
      inconclusiveCriterionIds.push('REVIEW')
      reasons.push('REVIEWER INCONCLUSIVE.')
    }
    if (input.unresolvedBlocker) reasons.push(`Unresolved blocker: ${input.unresolvedBlocker}`)

    if (failedCriterionIds.length || input.reviewOutcome === 'FAIL') result = 'FAIL'
    else if (input.unresolvedBlocker || input.reviewOutcome === 'BLOCKED') result = 'BLOCKED'
    else if (missingCriterionIds.length || inconclusiveCriterionIds.length || input.reviewOutcome === 'INCONCLUSIVE') result = 'INCONCLUSIVE'
    else result = 'PASS'
    if (result === 'PASS') {
      const binding = evaluateApprovalBinding({
        engineeringClass: input.engineeringClass,
        missionId: input.missionId,
        graphId: input.graphId,
        missionContract: input.missionContract,
        acceptanceContract: input.acceptanceContract,
      })
      if (binding.approval && !binding.ok) {
        result = 'BLOCKED'
        reasons.push(binding.reason ?? 'Stale execution approval cannot produce Verdict PASS.')
      }
    }
  }

  const verdict: FoundryVerdictRecord = {
    schemaVersion: 1,
    verdictId: `VD-${randomUUID()}`,
    missionId: input.missionId,
    graphId: input.graphId ?? null,
    missionContractId: input.missionContract?.missionContractId ?? '',
    acceptanceContractId: input.acceptanceContract?.acceptanceContractId ?? '',
    missionContractHash: input.missionContract?.contentHash ?? '',
    acceptanceContractHash: input.acceptanceContract?.contentHash ?? '',
    specVersion: input.missionContract?.specVersion ?? '',
    result,
    reasons,
    missingCriterionIds,
    failedCriterionIds,
    inconclusiveCriterionIds,
    staleEvidenceIds,
    reviewOutcome: input.reviewOutcome ?? null,
    executorResult: input.executorResult ?? 'NONE',
    evaluatedAt: new Date().toISOString(),
    midEvaluation: false,
  }
  saveVerdictRecord(verdict)
  const eventType = result === 'PASS' ? 'VERDICT_PASS' : result === 'FAIL' ? 'VERDICT_FAIL' : 'VERDICT_BLOCKED'
  appendContractEvent(input.missionId, result === 'INCONCLUSIVE' ? 'VERDICT_BLOCKED' : eventType, `Verdict ${result}: ${reasons[0] ?? 'ok'}`, input.mission, {
    verdictId: verdict.verdictId,
    result,
  })
  void started
  return verdict
}

export function currentVerdict(missionId: string): FoundryVerdictRecord | null {
  return loadVerdictRecord(missionId)
}

export function missingAcceptanceEvidence(missionContract: FoundryMissionContract, acceptanceContract: FoundryAcceptanceContract): string[] {
  return evaluateAllCriteria(missionContract, acceptanceContract)
    .filter(row => !row.satisfied)
    .map(row => `${row.criterionId}:${row.reason}`)
}

export function canComplete(input: {
  engineeringClass?: string | null
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
  verdict?: FoundryVerdictRecord | null
  missionId?: string | null
  graphId?: string | null
}): ExecutionGate {
  if (classifyLegacyPreContract(input.engineeringClass) !== 'STANDALONE_ENGINEER') {
    return { ok: true, missing: [] }
  }
  const missing: string[] = []
  if (input.missionContract?.status !== 'SEALED') missing.push('MISSION_CONTRACT_SEALED')
  if (input.acceptanceContract?.status !== 'SEALED') missing.push('ACCEPTANCE_CONTRACT_SEALED')
  if (!input.verdict) missing.push('VERDICT')
  else if (input.verdict.result !== 'PASS') missing.push(`VERDICT_${input.verdict.result}`)
  if (input.verdict && input.missionContract && input.verdict.missionContractHash !== input.missionContract.contentHash) {
    missing.push('VERDICT_CONTRACT_GENERATION_MISMATCH')
  }
  if (input.missionId && listExecutionApprovals(input.missionId).length) {
    const binding = evaluateApprovalBinding({
      engineeringClass: input.engineeringClass,
      missionId: input.missionId,
      graphId: input.graphId,
      missionContract: input.missionContract ?? null,
      acceptanceContract: input.acceptanceContract ?? null,
    })
    if (!binding.ok) missing.push('REAPPROVAL_REQUIRED')
  }
  if (missing.length) {
    return { ok: false, error: `COMPLETE refused: ${missing.join(', ')}`, missing }
  }
  return { ok: true, missing: [] }
}

export function projectReadyFromVerdict(input: {
  engineeringClass?: string | null
  tasksComplete: boolean
  previewUrl?: string | null
  verdict: FoundryVerdictRecord | null
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
}): boolean {
  if (classifyLegacyPreContract(input.engineeringClass) !== 'STANDALONE_ENGINEER') {
    return input.tasksComplete && Boolean(input.previewUrl)
  }
  return canComplete({
    engineeringClass: 'STANDALONE_ENGINEER',
    missionContract: input.missionContract,
    acceptanceContract: input.acceptanceContract,
    verdict: input.verdict,
  }).ok === true
}

/** Executors may propose. They cannot write VERDICT=PASS. */
export function proposeExecutorComplete(missionId: string, kind: 'PROPOSED_COMPLETE' | 'PROPOSED_READY' = 'PROPOSED_COMPLETE'): FoundryVerdictRecord {
  const existing = loadVerdictRecord(missionId)
  const missionContract = existing?.missionContractId ? loadMissionContract(existing.missionContractId) : null
  const acceptanceContract = existing?.acceptanceContractId ? loadAcceptanceContract(existing.acceptanceContractId) : null
  return evaluateVerdictLayer({
    missionId,
    graphId: existing?.graphId,
    engineeringClass: 'STANDALONE_ENGINEER',
    missionContract,
    acceptanceContract,
    reviewOutcome: existing?.reviewOutcome ?? null,
    executorResult: kind,
  })
}

export function recoverVerdictState(missionId: string): FoundryVerdictRecord | null {
  const existing = loadVerdictRecord(missionId)
  if (!existing) return null
  if (!existing.midEvaluation) return existing
  const missionContract = existing.missionContractId ? loadMissionContract(existing.missionContractId) : null
  const acceptanceContract = existing.acceptanceContractId ? loadAcceptanceContract(existing.acceptanceContractId) : null
  return evaluateVerdictLayer({
    missionId,
    graphId: existing.graphId,
    engineeringClass: missionContract?.engineeringClass ?? 'STANDALONE_ENGINEER',
    missionContract,
    acceptanceContract,
    reviewOutcome: existing.reviewOutcome,
    executorResult: existing.executorResult,
    recover: true,
  })
}

export { listAcceptanceEvidence }

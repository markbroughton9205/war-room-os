/**
 * Acceptance evidence records and criterion satisfaction rules.
 * A required criterion is satisfied only by current-generation PASS evidence.
 */
import { randomUUID } from 'node:crypto'
import { FOUNDRY_CONTRACT_SCHEMA_VERSION, type FoundryAcceptanceContract, type FoundryAcceptanceEvidence, type FoundryEvidenceStatus, type FoundryMissionContract } from './foundryContractTypes'
import { foundryContentHash } from './foundryContractHash'
import { appendContractEvent, listAcceptanceEvidence, saveAcceptanceEvidence } from './foundryContractStore'
import type { FoundryMissionRecord } from './foundryMissionTypes'

export type RecordEvidenceInput = {
  criterionId: string
  missionId: string
  taskId?: string | null
  evidenceType: FoundryAcceptanceEvidence['evidenceType']
  producer: string
  artifactReference?: string | null
  commandReference?: string | null
  result: string
  status: FoundryEvidenceStatus
  missionContract: FoundryMissionContract
  acceptanceContract: FoundryAcceptanceContract
  now?: string
}

export function evidenceMaterial(input: Pick<FoundryAcceptanceEvidence, 'criterionId' | 'missionId' | 'evidenceType' | 'result' | 'artifactReference' | 'commandReference' | 'producer' | 'status'>): unknown {
  return {
    criterionId: input.criterionId,
    missionId: input.missionId,
    evidenceType: input.evidenceType,
    producer: input.producer,
    artifactReference: input.artifactReference,
    commandReference: input.commandReference,
    result: input.result,
    status: input.status,
  }
}

export function recordAcceptanceEvidence(input: RecordEvidenceInput, mission?: FoundryMissionRecord | null): FoundryAcceptanceEvidence {
  if (input.missionContract.status !== 'SEALED' || input.acceptanceContract.status !== 'SEALED') {
    throw new Error('Evidence can only bind to SEALED contracts.')
  }
  if (!input.acceptanceContract.criteria.some(item => item.criterionId === input.criterionId)) {
    throw new Error(`Criterion ${input.criterionId} is not in the sealed AcceptanceContract.`)
  }
  const timestamp = input.now ?? new Date().toISOString()
  const evidence: FoundryAcceptanceEvidence = {
    schemaVersion: FOUNDRY_CONTRACT_SCHEMA_VERSION,
    evidenceId: `EV-${randomUUID()}`,
    criterionId: input.criterionId,
    missionId: input.missionId,
    taskId: input.taskId ?? null,
    evidenceType: input.evidenceType,
    producer: input.producer,
    timestamp,
    artifactReference: input.artifactReference ?? null,
    commandReference: input.commandReference ?? null,
    result: input.result,
    contentHash: '',
    status: input.status,
    missionContractId: input.missionContract.missionContractId,
    acceptanceContractId: input.acceptanceContract.acceptanceContractId,
    missionContractHash: input.missionContract.contentHash,
    acceptanceContractHash: input.acceptanceContract.contentHash,
    specVersion: input.missionContract.specVersion,
    superseded: false,
  }
  evidence.contentHash = foundryContentHash(evidenceMaterial(evidence))
  saveAcceptanceEvidence(evidence)
  appendContractEvent(
    input.missionId,
    'ACCEPTANCE_EVIDENCE_RECORDED',
    `${input.criterionId} ${input.status} by ${input.producer}`,
    mission,
    { criterionId: input.criterionId, evidenceId: evidence.evidenceId, status: input.status },
  )
  if (input.status === 'PASS' || input.status === 'FAIL') {
    appendContractEvent(
      input.missionId,
      input.status === 'PASS' ? 'CRITERION_PASSED' : 'CRITERION_FAILED',
      `${input.criterionId} ${input.status}`,
      mission,
      { criterionId: input.criterionId, evidenceId: evidence.evidenceId },
    )
  }
  return evidence
}

export function supersedeEvidenceForContract(missionId: string, previousMissionContractId: string, previousAcceptanceContractId?: string): void {
  for (const item of listAcceptanceEvidence(missionId)) {
    const stale = item.missionContractId === previousMissionContractId
      || (previousAcceptanceContractId != null && item.acceptanceContractId === previousAcceptanceContractId)
    if (!stale || item.superseded) continue
    saveAcceptanceEvidence({ ...item, superseded: true })
  }
}

export type CriterionSatisfaction = {
  criterionId: string
  satisfied: boolean
  reason: string
  evidenceId: string | null
  stale: boolean
}

export function evidenceIsCurrentGeneration(
  evidence: FoundryAcceptanceEvidence,
  missionContract: FoundryMissionContract,
  acceptanceContract: FoundryAcceptanceContract,
): boolean {
  return (
    evidence.superseded !== true
    && evidence.missionContractId === missionContract.missionContractId
    && evidence.acceptanceContractId === acceptanceContract.acceptanceContractId
    && evidence.missionContractHash === missionContract.contentHash
    && evidence.acceptanceContractHash === acceptanceContract.contentHash
    && evidence.specVersion === missionContract.specVersion
  )
}

export function satisfyCriterion(input: {
  criterionId: string
  required: boolean
  evidence: FoundryAcceptanceEvidence[]
  missionContract: FoundryMissionContract
  acceptanceContract: FoundryAcceptanceContract
}): CriterionSatisfaction {
  const matching = input.evidence.filter(item => item.criterionId === input.criterionId)
  if (!matching.length) {
    return {
      criterionId: input.criterionId,
      satisfied: false,
      reason: input.required ? 'UNBOUND_PASS_CANNOT_SATISFY_CRITERION' : 'optional criterion has no evidence',
      evidenceId: null,
      stale: false,
    }
  }
  const current = matching.filter(item => evidenceIsCurrentGeneration(item, input.missionContract, input.acceptanceContract))
  const stale = matching.filter(item => !evidenceIsCurrentGeneration(item, input.missionContract, input.acceptanceContract))
  if (!current.length && stale.length) {
    return {
      criterionId: input.criterionId,
      satisfied: false,
      reason: 'STALE_EVIDENCE_CANNOT_SATISFY_CRITERION',
      evidenceId: stale[0].evidenceId,
      stale: true,
    }
  }
  const pass = current.find(item => item.status === 'PASS')
  const fail = current.find(item => item.status === 'FAIL')
  if (fail && !pass) {
    return { criterionId: input.criterionId, satisfied: false, reason: 'criterion FAIL', evidenceId: fail.evidenceId, stale: false }
  }
  if (pass) {
    return { criterionId: input.criterionId, satisfied: true, reason: 'PASS evidence bound', evidenceId: pass.evidenceId, stale: false }
  }
  const inconclusive = current.find(item => item.status === 'INCONCLUSIVE')
  return {
    criterionId: input.criterionId,
    satisfied: false,
    reason: 'criterion INCONCLUSIVE',
    evidenceId: inconclusive?.evidenceId ?? current[0]?.evidenceId ?? null,
    stale: false,
  }
}

export function evaluateAllCriteria(missionContract: FoundryMissionContract, acceptanceContract: FoundryAcceptanceContract, evidence?: FoundryAcceptanceEvidence[]): CriterionSatisfaction[] {
  const items = evidence ?? listAcceptanceEvidence(missionContract.missionId)
  return acceptanceContract.criteria.map(criterion => satisfyCriterion({
    criterionId: criterion.criterionId,
    required: criterion.required,
    evidence: items,
    missionContract,
    acceptanceContract,
  }))
}

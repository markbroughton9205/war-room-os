/**
 * Derive Ra'el production state from persisted truth.
 * Never from button labels or CTA copy.
 */
import { HVS_FACE_REFERENCE_REQUIRED, readFaceReferenceSet } from '../digital-human/face-reference'
import type {
  HvsCharacterBuildOperation,
  HvsCharacterProductionStage,
  HvsCharacterProductionState,
  HvsCharacterStageReceipt,
  HvsLikenessProductionState,
} from './types'
import { HVS_LIKENESS_PRODUCTION_STATES } from './types'

const STAGE_TO_STATE: Record<HvsCharacterProductionStage, HvsCharacterProductionState> = {
  PREREQUISITES: 'CHARACTER_PREPARING',
  FACE_REFERENCES: 'CHARACTER_PREPARING',
  METAHUMAN_FOUNDATION: 'CHARACTER_PREPARING',
  CONFORM: 'CHARACTER_CONFORMING',
  ASSEMBLY: 'CHARACTER_ASSEMBLING',
  BODY_BIND: 'BODY_BINDING',
  CAMERA_BIND: 'CAMERA_BINDING',
  VALIDATION: 'VALIDATING',
  PREVIEW: 'PREVIEW_PREPARING',
}

export function acceptedFaceCount(projectId: string): { accepted: number; required: number; complete: boolean; status: string } {
  const set = readFaceReferenceSet(projectId)
  const accepted = HVS_FACE_REFERENCE_REQUIRED.filter(type => set.stills[type]?.accepted).length
  return {
    accepted,
    required: HVS_FACE_REFERENCE_REQUIRED.length,
    complete: accepted === HVS_FACE_REFERENCE_REQUIRED.length && set.status === 'REFERENCE CAPTURED',
    status: set.status,
  }
}

export function lastValidReceipt(receipts: HvsCharacterStageReceipt[]): HvsCharacterStageReceipt | null {
  return [...receipts].reverse().find(item => item.status === 'COMPLETE' || item.status === 'SKIPPED') ?? null
}

export function nextIncompleteStage(receipts: HvsCharacterStageReceipt[], stages: readonly HvsCharacterProductionStage[]): HvsCharacterProductionStage | null {
  for (const stage of stages) {
    const receipt = receipts.find(item => item.stage === stage)
    if (!receipt || receipt.status === 'FAILED' || receipt.status === 'PENDING' || receipt.status === 'RUNNING') return stage
    if (receipt.status === 'BLOCKED') return stage
  }
  return null
}

export function inferredLikenessState(operation: HvsCharacterBuildOperation | null): HvsLikenessProductionState | null {
  if (!operation) return null
  if (operation.likenessState) return operation.likenessState
  const conform = operation.receipts.find(item => item.stage === 'CONFORM')
  if (conform?.status === 'COMPLETE') return 'LIKELINESS_COMPLETE'
  if (conform?.status === 'BLOCKED' || operation.keepLocal) return 'LIKELINESS_APPROVAL_REQUIRED'
  return null
}

export function deriveProductionState(input: {
  faceComplete: boolean
  faceAccepted: number
  operation: HvsCharacterBuildOperation | null
  takeConnected: boolean
}): HvsCharacterProductionState {
  const op = input.operation
  const likeness = inferredLikenessState(op)
  if (op?.status === 'FAILED') return 'CHARACTER_ERROR'
  if (likeness && likeness !== 'LIKELINESS_COMPLETE' && HVS_LIKENESS_PRODUCTION_STATES.includes(likeness)) {
    if (op?.status === 'COMPLETE') return 'CHARACTER_READY'
    return likeness
  }
  if (op?.status === 'BLOCKED') {
    if (op.lastErrorCode === 'LIKELINESS_APPROVAL_REQUIRED' || likeness === 'LIKELINESS_APPROVAL_REQUIRED') {
      return 'LIKELINESS_APPROVAL_REQUIRED'
    }
    return 'CHARACTER_BLOCKED'
  }
  if (op?.status === 'COMPLETE') return 'CHARACTER_READY'
  if (op?.status === 'RUNNING' || op?.status === 'PENDING') {
    if (op.currentStage) return STAGE_TO_STATE[op.currentStage]
    return 'CHARACTER_PREPARING'
  }
  if (!input.faceComplete) {
    return input.faceAccepted > 0 ? 'REFERENCES_IN_PROGRESS' : 'REFERENCES_REQUIRED'
  }
  if (!input.takeConnected) return 'REFERENCES_COMPLETE'
  return 'CHARACTER_READY_TO_BUILD'
}

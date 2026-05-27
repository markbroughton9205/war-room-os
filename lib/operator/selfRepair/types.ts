/**
 * Self-repair upgrade loop — lifecycle and repair plan types (session-local).
 * Detect → Propose → Approve → Apply/Hand off → Validate → Learn. No silent mutation.
 */

export type RepairLifecycleState =
  | 'DETECTED'
  | 'PROPOSED'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'HANDED_OFF'
  | 'APPLIED'
  | 'VALIDATED'
  | 'FAILED'
  | 'ARCHIVED'

export type RepairRisk = 'low' | 'medium' | 'high'

export type RepairSourceType = 'gap' | 'inbox'

export type RepairPlan = {
  id: string
  sourceId: string
  sourceType: RepairSourceType
  title: string
  files: string[]
  expectedBehavior: string
  validationCommands: string[]
  rollback: string
  risk: RepairRisk
  cursorCommand: string
  createdAt: string
  updatedAt: string
}

export type RepairHistoryEntry = {
  state: RepairLifecycleState
  at: string
  note?: string
}

export type RepairValidationResult = {
  verified: boolean
  checkedAt: string
  evidence: string[]
  gapStillOpen?: boolean
  knownGapVerified?: boolean
}

export type SelfRepairRecord = {
  id: string
  plan: RepairPlan
  state: RepairLifecycleState
  gapId: string
  history: RepairHistoryEntry[]
  validation?: RepairValidationResult
  lessonCandidateId?: string
}

export type SelfRepairSnapshot = {
  version: 1
  records: SelfRepairRecord[]
  lastUpdatedAt?: string
}

export const SELF_REPAIR_STORAGE_KEY = 'war-room-self-repair-records'

export const REPAIR_LIFECYCLE_ORDER: RepairLifecycleState[] = [
  'DETECTED',
  'PROPOSED',
  'APPROVED',
  'IN_PROGRESS',
  'HANDED_OFF',
  'APPLIED',
  'VALIDATED',
  'FAILED',
  'ARCHIVED',
]

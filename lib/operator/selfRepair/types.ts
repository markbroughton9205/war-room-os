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

/** 'cannot_verify' means authoritative runtime data could not be refreshed/read before
 * evaluation — distinct from both 'verified' and 'failed' so a refresh failure is never
 * silently reported as either a pass or a fail. */
export type RepairValidationOutcome = 'verified' | 'failed' | 'cannot_verify'

export type RepairValidationResult = {
  outcome: RepairValidationOutcome
  checkedAt: string
  evidence: string[]
  gapStillOpen: boolean | null
  knownGapVerified: boolean
}

/** Shape persisted by sessionStorage before the `outcome` field existed — pre-existing browser
 * sessions may still hold records exactly like this. Never re-write stored data into this shape;
 * it exists only so display logic can recognize and truthfully render what's already there. */
export type LegacyRepairValidationResult = {
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

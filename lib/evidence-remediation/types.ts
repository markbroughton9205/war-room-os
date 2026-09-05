import type { LearningEvidence, TrainingCandidate } from '@/lib/active-learning/types'
import type { Wave4DatasetRecord } from '@/lib/training-checkpoint/types'

export type AuditEvent = {
  at: string; actor: string; category: string; message: string
  metadata: Record<string, unknown>; previousHash: string; hash: string
}

export type AuditBoundaryCause = 'concurrent_append_fork' | 'missing_predecessor' | 'genesis_midstream' | 'content_hash_corruption'
export type AuditBoundary = { eventIndex: number; eventHash: string; declaredPreviousHash: string; sequentialPreviousHash: string; cause: AuditBoundaryCause }
export type AuditVerification = {
  eventCount: number; intactSequentialLinks: number; legitimateSegmentBoundaries: number
  corruptEvents: number; missingPredecessors: number; boundaries: AuditBoundary[]
  originalLedgerHash: string; segmentManifestHash: string
}

export type LifecycleClass = 'commander_resolved' | 'verification_failed' | 'awaiting_review' | 'planning_blocked' | 'patch_application_failed' | 'no_terminal_outcome'
export type LifecycleClassification = { repairId: string; class: LifecycleClass; eventHashes: string[]; reasons: string[] }
export type MaterializedCodeOperatorRecord = { evidence: LearningEvidence; candidate: TrainingCandidate; datasetRecord: Wave4DatasetRecord }


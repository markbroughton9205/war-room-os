export const EXPLICIT_MEMORY_WRITE_APPROVAL_TEXT =
  'I APPROVE THIS MEMORY WRITE' as const

export type MemoryScope =
  | 'global_war_room'
  | 'council_entity'
  | 'project'
  | 'operator'
  | 'session'
  | 'validation'

export type MemoryType =
  | 'lesson'
  | 'operator_preference'
  | 'project_fact'
  | 'routing_correction'
  | 'safety_policy'
  | 'validation_result'
  | 'architecture_decision'

export type MemorySource =
  | 'commander_message'
  | 'provider_result'
  | 'validation_report'
  | 'operator_note'
  | 'architecture_decision'
  | 'manual_entry'

export type MemoryProposedBy =
  | 'commander'
  | 'council_entity'
  | 'system_validator'
  | 'operator'

export type MemoryEvidenceType =
  | 'commander_statement'
  | 'test_result'
  | 'commit_hash'
  | 'validation_report'
  | 'manual_note'

export type MemoryConfidence = 'low' | 'medium' | 'high'
export type MemoryRiskLevel = 'low' | 'medium' | 'high'
export type PrivacySensitivity = 'low' | 'medium' | 'high'

export type MemoryEvidence = {
  evidenceId: string
  evidenceType: MemoryEvidenceType
  reference: string
  summary: string
}

export type MemoryWriteProposal = {
  proposalId: string
  source: MemorySource
  proposedBy: MemoryProposedBy
  memoryType: MemoryType
  memoryScope: MemoryScope
  targetEntityId: string | null
  content: string
  rationale: string
  evidence: MemoryEvidence[]
  confidence: MemoryConfidence
  riskLevel: MemoryRiskLevel
  privacySensitivity: PrivacySensitivity
  proposedAt: string
}

export type MemoryReviewChecklist = {
  scopeVerified: boolean
  evidenceAttached: boolean
  duplicateChecked: boolean
  conflictChecked: boolean
  privacyChecked: boolean
  rollbackPlanCreated: boolean
  commanderApprovalRequired: true
}

export type StagedMemoryWrite = {
  stagedWriteId: string
  proposalId: string
  status:
    | 'pending_review'
    | 'approved_for_commit'
    | 'committed'
    | 'rejected'
    | 'discarded'
  normalizedContent: string
  memoryFingerprint: string
  duplicateOfMemoryId: string | null
  conflictsWithMemoryIds: string[]
  requiresSecondConfirmation: true
  reviewChecklist: MemoryReviewChecklist
  createdAt: string
}

export type ExplicitMemoryWriteApproval = {
  approvalId: string
  proposalId: string
  stagedWriteId: string | null
  approvalKind: 'memory_write'
  approvalText: typeof EXPLICIT_MEMORY_WRITE_APPROVAL_TEXT
  approvedBy: 'commander'
  approvedAt: string
  expiresAt: string
  memoryScope: MemoryScope
  targetEntityId: string | null
  approvedMemoryType: MemoryType
  maxWrites: 1
  allowOverwrite: false
  allowCrossScopeWrite: false
  allowAutoMode: false
  allowProviderAuthoredMemory: false
  allowUnreviewedWrite: false
  nonce: string
  approvalTokenHash: string
  consumed: boolean
}

export type MemoryApprovalInvalidReason =
  | 'approval_missing'
  | 'wrong_approval_kind'
  | 'wrong_approval_text'
  | 'wrong_approver'
  | 'approval_expired'
  | 'approval_consumed'
  | 'proposal_mismatch'
  | 'staged_write_mismatch'
  | 'memory_scope_mismatch'
  | 'target_entity_mismatch'
  | 'memory_type_mismatch'
  | 'max_writes_mismatch'
  | 'unsafe_allow_flag'
  | 'structural_invalid'

export type MemoryApprovalVerificationResult =
  | {
      valid: true
      approval: ExplicitMemoryWriteApproval
      reason: null
      message: string
    }
  | {
      valid: false
      approval: ExplicitMemoryWriteApproval | null
      reason: MemoryApprovalInvalidReason
      message: string
    }

export type MemoryRollbackPlan = {
  rollbackPlanId: string
  proposalId: string
  stagedWriteId: string
  targetMemoryId: string | null
  rollbackStrategy:
    | 'mark_revoked'
    | 'mark_superseded'
    | 'append_correction'
    | 'no_op_uncommitted'
  reversible: true
  reason: string
  expectedEffect: string
  createdAt: string
}

export type MemoryRollbackResult = {
  rollbackResultId: string
  rollbackPlanId: string
  targetMemoryId: string | null
  status:
    | 'rolled_back'
    | 'not_committed'
    | 'rollback_blocked'
    | 'rollback_failed'
  memoryStoreChanged: boolean
  auditEventId: string
  message: string
  createdAt: string
}

export type MemoryWriteCommitStatus =
  | 'committed'
  | 'rejected'
  | 'blocked'
  | 'approval_missing'
  | 'approval_invalid'
  | 'approval_expired'
  | 'approval_consumed'
  | 'duplicate_detected'
  | 'conflict_detected'
  | 'partial_failure'

export type MemoryWriteCommitResult = {
  commitResultId: string
  proposalId: string
  stagedWriteId: string
  approvalId: string | null
  memoryId: string | null
  status: MemoryWriteCommitStatus
  memoryStoreChanged: boolean
  approvalConsumed: boolean
  rollbackPlan: MemoryRollbackPlan
  auditEventId: string | null
  errorMessage: string | null
  createdAt: string
}

export type FakeMemoryRecordStatus =
  | 'pending'
  | 'committed'
  | 'revoked'
  | 'superseded'
  | 'rejected'
  | 'discarded'

export type FakeMemoryRecord = {
  memoryId: string
  proposalId: string
  stagedWriteId: string
  memoryType: MemoryType
  memoryScope: MemoryScope
  targetEntityId: string | null
  content: string
  fingerprint: string
  status: FakeMemoryRecordStatus
  createdAt: string
  updatedAt: string
}

export type MemoryAuditEvent = {
  auditEventId: string
  eventType:
    | 'memory_staged'
    | 'memory_commit_attempted'
    | 'memory_committed'
    | 'memory_commit_rejected'
    | 'memory_partial_failure'
    | 'memory_rollback_planned'
    | 'memory_rolled_back'
  proposalId: string
  stagedWriteId: string | null
  memoryId: string | null
  message: string
  createdAt: string
}

export type FakeMemoryStoreSnapshot = {
  records: FakeMemoryRecord[]
  auditEvents: MemoryAuditEvent[]
}

export type FakeMemoryStoreMode =
  | 'normal'
  | 'throw_after_audit_before_memory'
  | 'throw_after_memory_before_commit_audit'
  | 'throw_before_any_write'

export type MemoryIntegrityReport = {
  consistent: boolean
  issueIds: string[]
  message: string
}

export type MemoryWriteValidationResult = {
  caseId: string
  description: string
  expectedStatus: MemoryWriteCommitStatus | MemoryRollbackResult['status'] | 'staged'
  observedStatus: MemoryWriteCommitStatus | MemoryRollbackResult['status'] | 'staged'
  expectedStoreChanged: boolean
  observedStoreChanged: boolean
  expectedMemoryCount: number
  observedMemoryCount: number
  expectedApprovalConsumed: boolean
  observedApprovalConsumed: boolean
  integrityConsistent: boolean
  result: 'PASS' | 'FAIL'
  notes: string[]
}

export type MemoryCommitInput = {
  proposal: MemoryWriteProposal
  stagedWrite: StagedMemoryWrite
  approval: unknown
  now?: string
  autoModeEnabled?: boolean
}

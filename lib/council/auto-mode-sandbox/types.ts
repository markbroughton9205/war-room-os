export type AutoSandboxActionType =
  | 'mark_reminder_read'
  | 'tag_memory'
  | 'summarize_text'
  | 'format_text'
  | string

export type ActionRequest = {
  actionType: AutoSandboxActionType
  targetType: string
  targetId: string | null
  parameters: Record<string, unknown>
  bundledActions: ActionRequest[]
}

export type AutoEligibilityStatus =
  | 'eligible'
  | 'not_eligible'

export type AutoEligibilityReason =
  | 'allowed_single_reversible_action'
  | 'unknown_action_type'
  | 'wrong_target_type'
  | 'missing_target_id'
  | 'unexpected_parameter'
  | 'missing_required_parameter'
  | 'unsafe_parameter_content'
  | 'semantic_change_risk'
  | 'source_requests_external_action'
  | 'scope_not_allowed'
  | 'bundles_manual_by_default'
  | 'bundled_action_not_independently_eligible'
  | 'duplicate_bundled_action'

export type AutoEligibilityDecision = {
  decisionId: string
  actionType: string
  status: AutoEligibilityStatus
  autoEligible: boolean
  reason: AutoEligibilityReason
  message: string
  independentlyEligible: boolean
  checkedBundledActions: AutoEligibilityDecision[]
  decisionPath: string[]
  createdAt: string
}

export type AutoSandboxKillSwitchState = {
  killSwitchId: string
  engaged: boolean
  reason: string | null
  updatedAt: string
}

export type AutoSandboxRecordStatus =
  | 'active'
  | 'applied'
  | 'rolled_back'

export type FakeReminderRecord = {
  reminderId: string
  read: boolean
  updatedAt: string
}

export type FakeMemoryTagRecord = {
  memoryId: string
  tags: string[]
  updatedAt: string
}

export type FakeGeneratedArtifact = {
  artifactId: string
  actionType: 'summarize_text' | 'format_text'
  targetId: string
  content: string
  status: AutoSandboxRecordStatus
  createdAt: string
  updatedAt: string
}

export type AutoSandboxAuditEvent = {
  auditEventId: string
  eventType:
    | 'eligibility_checked'
    | 'execution_blocked'
    | 'checkpoint_created'
    | 'action_applied'
    | 'rollback_applied'
    | 'claim_reality_checked'
  actionType: string
  targetId: string | null
  message: string
  createdAt: string
}

export type AutoSandboxSnapshot = {
  reminders: FakeReminderRecord[]
  memoryTags: FakeMemoryTagRecord[]
  generatedArtifacts: FakeGeneratedArtifact[]
  auditEvents: AutoSandboxAuditEvent[]
}

export type AutoSandboxCheckpoint = {
  checkpointId: string
  actionType: string
  targetId: string | null
  beforeSnapshot: AutoSandboxSnapshot
  createdAt: string
}

export type AutoSandboxRollbackPlan = {
  rollbackPlanId: string
  checkpointId: string
  actionType: string
  targetId: string | null
  rollbackAvailable: boolean
  expectedReversal: string
  createdAt: string
}

export type AutoSandboxExecutionStatus =
  | 'applied'
  | 'blocked'
  | 'rolled_back'
  | 'claim_mismatch'

export type AutoSandboxExecutionResult = {
  executionId: string
  status: AutoSandboxExecutionStatus
  actionRequest: ActionRequest
  eligibilityDecision: AutoEligibilityDecision
  killSwitchEngaged: boolean
  sandboxChanged: boolean
  appliedActionIds: string[]
  checkpoint: AutoSandboxCheckpoint | null
  rollbackPlan: AutoSandboxRollbackPlan | null
  rollbackResult: AutoSandboxRollbackResult | null
  claimRealityReport: ClaimRealityReport | null
  message: string
  createdAt: string
}

export type AutoSandboxRollbackResult = {
  rollbackResultId: string
  rollbackPlanId: string
  status: 'rolled_back' | 'not_available' | 'failed'
  sandboxChanged: boolean
  message: string
  createdAt: string
}

export type ClaimRealityIssue = {
  issueId: string
  severity: 'low' | 'medium' | 'high'
  message: string
}

export type ClaimRealityReport = {
  reportId: string
  executionId: string
  claimMatchesReality: boolean
  claimedSandboxChanged: boolean
  observedSandboxChanged: boolean
  claimedAppliedActionCount: number
  observedAppliedActionCount: number
  issues: ClaimRealityIssue[]
  createdAt: string
}

export type AutoModeValidationResult = {
  caseId: string
  description: string
  expectedEligible: boolean
  observedEligible: boolean
  expectedReason?: AutoEligibilityReason
  observedReason: AutoEligibilityReason
  expectedSandboxChanged?: boolean
  observedSandboxChanged?: boolean
  expectedClaimMatchesReality?: boolean
  observedClaimMatchesReality?: boolean
  result: 'PASS' | 'FAIL'
  notes: string[]
}

export type AutoModeGateValidationResult = {
  gateId: string
  description: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

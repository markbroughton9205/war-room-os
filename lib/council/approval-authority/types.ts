export const EXPLICIT_EXECUTION_APPROVALS_TABLE = 'explicit_execution_approvals'

export type ExplicitExecutionApprovalStatus = 'active' | 'expired' | 'consumed' | 'revoked'

export type ApprovalAuthorityBasis = 'configured_commander_user_id' | 'legacy_pre_46p'

export type ApprovalIssuanceRoute = 'operator_approval_surface' | 'legacy_unknown'

export type ExplicitExecutionApproval = {
  approval_id: string
  exact_approved_text: string
  commander_input: string
  approved_by: string
  action_type: string
  target_system: string
  target_id: string
  single_use: boolean
  nonce: string
  created_at: string
  updated_at: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  revoked_reason: string | null
  status: ExplicitExecutionApprovalStatus
  issued_by_user_id?: string | null
  authority_basis?: ApprovalAuthorityBasis | null
  issuance_route?: ApprovalIssuanceRoute | null
}

export type IssueApprovalInput = {
  exact_approved_text: string
  commander_input: string
  approved_by: string
  action_type: string
  target_system: string
  target_id: string
  issued_by_user_id?: string | null
  authority_basis?: ApprovalAuthorityBasis | null
  issuance_route?: ApprovalIssuanceRoute | null
  ttlMs?: number
  now?: string
}

export type IssueApprovalResult = {
  ok: boolean
  status: 'issued' | 'duplicate_nonce' | 'write_failed'
  approval: ExplicitExecutionApproval | null
  errorMessage: string | null
}

export type ConsumeApprovalStatus =
  | 'consumed'
  | 'invalid_approval_id'
  | 'not_found'
  | 'already_consumed'
  | 'expired'
  | 'revoked'
  | 'not_active'
  | 'action_type_mismatch'
  | 'target_system_mismatch'
  | 'target_id_mismatch'
  | 'exact_text_mismatch'
  | 'consume_failed'

export type ConsumeApprovalResult = {
  ok: boolean
  status: ConsumeApprovalStatus
  approval: ExplicitExecutionApproval | null
  errorMessage: string | null
}

export type RevokeApprovalResult = {
  ok: boolean
  status: 'revoked' | 'not_found' | 'already_consumed' | 'already_revoked' | 'not_active' | 'revoke_failed'
  approval: ExplicitExecutionApproval | null
  errorMessage: string | null
}

export type ApprovalAuthorityValidationResult = {
  caseId: string
  description: string
  expected: string
  observed: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

export type ApprovalAuthoritySecurityTelemetryCategory =
  | 'malformed_approval_id_probe'

export type ApprovalAuthoritySecurityTelemetryEvent = {
  category: ApprovalAuthoritySecurityTelemetryCategory
  approvalId: string
  operation: 'consumeIfValid' | 'revoke' | 'getById'
  createdAt: string
}

export type ApprovalAuthoritySecurityTelemetrySink = {
  record(event: ApprovalAuthoritySecurityTelemetryEvent): void
}

export const EXPLICIT_EXECUTION_APPROVALS_TABLE = 'explicit_execution_approvals'

export type ExplicitExecutionApprovalStatus = 'active' | 'expired' | 'consumed' | 'revoked'

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
}

export type IssueApprovalInput = {
  exact_approved_text: string
  commander_input: string
  approved_by: string
  action_type: string
  target_system: string
  target_id: string
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

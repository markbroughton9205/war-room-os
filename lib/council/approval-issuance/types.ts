import type { IssueApprovalInput, IssueApprovalResult } from '../approval-authority/types'
import type { ApprovalIssuanceTemplateVersion } from './templates'

export type ApprovalIssueMode = 'preview' | 'issue'

export type ApprovalIssueRequestBody = {
  mode?: ApprovalIssueMode
  templateVersion?: ApprovalIssuanceTemplateVersion
  targetId?: string
  commanderInput?: string
  ttlSeconds?: number
  confirmed?: boolean
  exactApprovedText?: string
  issued_by_user_id?: string
  authority_basis?: string
  issuance_route?: string
}

export type ApprovalIssueResponseStatus =
  | 'previewed'
  | 'issued'
  | 'environment_blocked'
  | 'commander_config_unavailable'
  | 'unauthenticated'
  | 'commander_mismatch'
  | 'invalid_request'
  | 'unknown_template'
  | 'unconfirmed'
  | 'exact_text_mismatch'
  | 'issue_failed'

export type ApprovalIssueResponse = {
  ok: boolean
  status: ApprovalIssueResponseStatus
  safeSummary: string
  exactApprovedText: string | null
  approvalId: string | null
  targetId: string | null
  actionType: 'mark_apple_reminder_read'
  targetSystem: 'apple_reminders'
  templateVersion: ApprovalIssuanceTemplateVersion | null
  issuedByUserId: string | null
  authorityBasis: 'configured_commander_user_id' | null
  issuanceRoute: 'operator_approval_surface' | null
  expiresAt: string | null
}

export type ApprovalIssuerUser = {
  id: string
  email?: string | null
}

export type ApprovalIssuerAuthResult =
  | {
      user: ApprovalIssuerUser | null
      errorMessage: string | null
    }

export type ApprovalIssuerAuthority = {
  issue(input: IssueApprovalInput): Promise<IssueApprovalResult>
}

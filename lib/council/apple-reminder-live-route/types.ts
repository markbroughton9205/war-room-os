import type {
  AppleReminderActionPacket,
  AppleReminderConsumedApprovalSnapshot,
} from '../apple-reminders-bridge'
import type {
  AutoModeSingleUseLedger,
  LedgerReceiptVerificationResult,
  LedgerWriteResult,
} from '../auto-mode-ledger'
import type { AppleReminderLedgerReceiptVerifier } from '../auto-mode-ledger'

export const APPLE_REMINDER_LIVE_ROUTE_FLAG =
  'WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE' as const
export const LIVE_APPLE_REMINDER_EXECUTION_FLAG =
  'WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION' as const

export const APPLE_REMINDER_LIVE_EXACT_APPROVED_TEXT =
  'I APPROVE MARKING THIS APPLE REMINDER READ' as const

export type AppleReminderLiveRouteFlagState = {
  routeEnabled: boolean
  liveExecutionEnabled: boolean
}

export type AppleReminderLiveRouteEnv = {
  WAR_ROOM_ENABLE_46N_APPLE_REMINDER_LIVE_ROUTE?: string
  WAR_ROOM_ENABLE_LIVE_APPLE_REMINDER_EXECUTION?: string
}

export type IssueApplePacketCommand = {
  command: 'issue_apple_reminder_packet'
  approvalId: string
  reminderId: string
  exactApprovedText: string
  confirmed: true
}

export type SubmitApplePacketReceiptCommand = {
  command: 'submit_apple_reminder_receipt'
  packet: AppleReminderActionPacket
  receiptText: string
}

export type AppleReminderLiveRouteRequest =
  | IssueApplePacketCommand
  | SubmitApplePacketReceiptCommand

export type AppleReminderLiveRouteBlockedReason =
  | 'route_disabled'
  | 'invalid_request'
  | 'not_confirmed'
  | 'missing_reminder_id'
  | 'missing_approval_id'
  | 'approval_not_found'
  | 'approval_not_active'
  | 'approval_revoked'
  | 'approval_already_consumed'
  | 'approval_expired'
  | 'approval_not_single_use'
  | 'approval_action_type_mismatch'
  | 'approval_target_system_mismatch'
  | 'approval_reminder_mismatch'
  | 'approval_text_mismatch'
  | 'approval_consume_failed'
  | 'packet_creation_blocked'
  | 'ledger_issue_failed'
  | 'receipt_parse_failed'
  | 'ledger_verification_failed'

/**
 * A pre-existing ExplicitExecutionApproval record, issued and persisted
 * separately before this route ever runs. Nothing in this route creates
 * approvals.
 *
 * consumeIfValid is a single atomic check-and-consume operation, not
 * separate get-then-mark calls -- mirroring AutoModeSingleUseLedger's
 * consumePacket, for the same reason: two concurrent requests loading the
 * same "active" approval and both proceeding is the exact TOCTOU race
 * Gate 12 was built to catch. That must not be reintroduced here.
 */
export type AppleApprovalConsumeInput = {
  approvalId: string
  reminderId: string
  exactApprovedText: string
  now: string
}

export type AppleApprovalConsumeStatus =
  | 'consumed'
  | 'not_found'
  | 'not_active'
  | 'already_consumed'
  | 'expired'
  | 'revoked'
  | 'action_type_mismatch'
  | 'target_system_mismatch'
  | 'reminder_mismatch'
  | 'text_mismatch'
  | 'consume_failed'

export type AppleApprovalConsumeResult = {
  ok: boolean
  status: AppleApprovalConsumeStatus
  authorizationSnapshot: AppleReminderConsumedApprovalSnapshot | null
  errorMessage: string | null
}

export type AppleApprovalConsumer = {
  consumeForAppleReminderRead(input: AppleApprovalConsumeInput): Promise<AppleApprovalConsumeResult>
}

export type AppleReminderLiveRouteAuditRecord = {
  auditId: string
  requestId: string
  command: AppleReminderLiveRouteRequest['command'] | 'unknown'
  routeFlagState: AppleReminderLiveRouteFlagState
  approvalId: string | null
  packetId: string | null
  packetCreated: boolean
  ledgerWriteAttempted: boolean
  ledgerStatus: string | null
  receiptVerificationStatus: LedgerReceiptVerificationResult['status'] | null
  status: 'blocked' | 'issued' | 'verified' | 'rejected'
  blockedReason: AppleReminderLiveRouteBlockedReason | null
  notes: string[]
  createdAt: string
}

export type AppleReminderLiveRouteResponse = {
  requestId: string
  status: 'blocked' | 'issued' | 'verified' | 'rejected'
  packet: AppleReminderActionPacket | null
  shortcutUrl: string | null
  verification: LedgerReceiptVerificationResult | null
  auditRecord: AppleReminderLiveRouteAuditRecord
  safeSummary: string
  recommendedNextAction: string
}

export type AppleReminderLiveRouteOptions = {
  env?: AppleReminderLiveRouteEnv
  approvalConsumer: AppleApprovalConsumer
  ledger: AutoModeSingleUseLedger
  receiptVerifier: AppleReminderLedgerReceiptVerifier
  now?: string
}

export type AppleReminderLiveRouteValidationResult = {
  caseId: string
  description: string
  expected: string
  observed: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

export type { LedgerWriteResult, AppleReminderConsumedApprovalSnapshot }

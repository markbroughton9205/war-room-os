export type AutoModeLedgerEntryKind =
  | 'action_packet'
  | 'verification_receipt'
  | 'rollback_packet'
  | 'rollback_receipt'

export type AutoModeLedgerStatus =
  | 'issued'
  | 'consumed'
  | 'rejected'
  | 'expired'
  | 'rollback_issued'
  | 'rollback_consumed'

export type AutoModeLedgerActionType = 'mark_apple_reminder_read'

export type RegisteredFutureLiveActionType =
  | 'mark_apple_reminder_unread'
  | 'create_apple_reminder_draft_packet'
  | 'add_apple_note_draft_packet'
  | 'create_calendar_event_draft_packet'
  | 'create_text_message_draft_packet'

export type AutoModeSingleUseLedgerEntry = {
  ledgerId: string
  packetId: string
  approvalId: string
  explicitExecutionApprovalId: string
  receiptId: string | null
  rollbackPacketId: string | null
  rollbackReceiptId: string | null
  nonce: string
  actionType: AutoModeLedgerActionType
  targetSystem: 'apple_reminders'
  targetId: string
  ledgerEntryKind: AutoModeLedgerEntryKind
  status: AutoModeLedgerStatus
  createdAt: string
  expiresAt: string
  consumedAt: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  verificationHash: string | null
  metadata: {
    bridge: 'iphone_shortcut'
    singleUse: true
    manualExecutionRequired: true
    sourcePhase: '46L'
  }
}

export type LedgerWriteResult = {
  ok: boolean
  status:
    | 'issued'
    | 'duplicate_packet'
    | 'duplicate_nonce'
    | 'expired_before_issue'
    | 'write_failed'
  ledgerEntry: AutoModeSingleUseLedgerEntry | null
  errorMessage: string | null
}

export type LedgerConsumeResult = {
  ok: boolean
  status:
    | 'consumed'
    | 'already_consumed'
    | 'expired'
    | 'packet_not_found'
    | 'nonce_mismatch'
    | 'receipt_replay'
    | 'ledger_write_conflict'
    | 'consume_failed'
  ledgerEntry: AutoModeSingleUseLedgerEntry | null
  errorMessage: string | null
}

export type AutoModeSingleUseLedger = {
  issuePacket(entry: AutoModeSingleUseLedgerEntry): Promise<LedgerWriteResult>
  consumePacket(input: {
    packetId: string
    nonce: string
    receiptId: string
    now: string
  }): Promise<LedgerConsumeResult>
  issueRollbackPacket(entry: AutoModeSingleUseLedgerEntry): Promise<LedgerWriteResult>
  consumeRollbackPacket(input: {
    rollbackPacketId: string
    nonce: string
    rollbackReceiptId: string
    now: string
  }): Promise<LedgerConsumeResult>
  getByPacketId(packetId: string): Promise<AutoModeSingleUseLedgerEntry | null>
  getByNonce(nonce: string): Promise<AutoModeSingleUseLedgerEntry | null>
  getByReceiptId(receiptId: string): Promise<AutoModeSingleUseLedgerEntry | null>
}

export type LedgerReceiptVerificationResult = {
  status:
    | 'verified_clean'
    | 'ledger_rejected'
    | 'receipt_rejected'
    | 'claim_reality_mismatch'
    | 'rollback_required'
  ledgerStatus: LedgerConsumeResult['status']
  ledgerEntry: AutoModeSingleUseLedgerEntry | null
  receiptAccepted: boolean
  issues: string[]
}

export type LiveFeatureRegistryEntry = {
  actionType: AutoModeLedgerActionType | RegisteredFutureLiveActionType
  targetSystem:
    | 'apple_reminders'
    | 'apple_notes'
    | 'apple_calendar'
    | 'apple_messages'
  executionBridge:
    | 'iphone_shortcut'
    | 'server_oauth_rest_future'
  enabled: boolean
  executionAllowed: boolean
  draftOnly: boolean
  sendsMessage: false
  mutatesRealSystem: boolean
  requiresDurableLedger: true
  requiresExplicitExecutionApproval: true
  requiresManualTrigger: true
  notes: string
}

export type LiveFeatureReadinessResult = {
  ready: boolean
  executableLiveActions: AutoModeLedgerActionType[]
  disabledFutureActions: RegisteredFutureLiveActionType[]
  violations: string[]
}

export type LedgerValidationResult = {
  caseId: string
  description: string
  expected: string
  observed: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

export type LedgerGateValidationResult = {
  gateId: string
  description: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

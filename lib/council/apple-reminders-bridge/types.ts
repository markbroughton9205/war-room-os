export const APPLE_REMINDERS_SHORTCUT_NAME = 'War Room Mark Reminder Read'
export const APPLE_REMINDER_PACKET_VERSION = '46K.apple-reminder-action-packet.v1'
export const APPLE_REMINDER_RECEIPT_VERSION = '46K.apple-reminder-shortcut-receipt.v1'
export const APPLE_REMINDER_ROLLBACK_PACKET_VERSION = '46K.apple-reminder-rollback-packet.v1'
export const APPLE_REMINDER_ROLLBACK_RECEIPT_VERSION = '46K.apple-reminder-rollback-receipt.v1'

export type AppleReminderActionPacketVersion = typeof APPLE_REMINDER_PACKET_VERSION
export type AppleReminderShortcutReceiptVersion = typeof APPLE_REMINDER_RECEIPT_VERSION

export type AppleReminderLiveActionType = 'mark_apple_reminder_read'

export type BlockedAppleReminderActionType =
  | 'create_apple_reminder'
  | 'delete_apple_reminder'
  | 'edit_apple_reminder_title'
  | 'edit_apple_reminder_notes'
  | 'edit_apple_reminder_due_date'
  | 'move_apple_reminder'
  | 'clear_completed_reminders'
  | 'bulk_complete_reminders'
  | 'send_reminder_notification'
  | 'share_reminder'
  | 'sync_reminders'
  | 'read_all_reminders'
  | 'export_reminders'
  | 'unknown_reminder_action'
  | 'message_send'
  | 'memory_commit'
  | 'database_mutation'
  | 'provider_call'
  | 'google_tasks_action'
  | 'google_calendar_action'

export type AppleReminderChangedPath =
  | 'appleReminders.reminder.completed'
  | 'appleReminders.reminder.status'
  | 'appleReminders.reminder.completionDate'

export type AppleReminderActionPacketStatus =
  | 'prepared'
  | 'expired'
  | 'used'
  | 'rejected'
  | 'receipt_verified'
  | 'receipt_mismatch'
  | 'rollback_requested'
  | 'rollback_verified'
  | 'rollback_failed'

export type AppleReminderObservedStatus =
  | 'open'
  | 'incomplete'
  | 'not_completed'
  | 'completed'
  | 'unknown'

export type AppleReminderShortcutReceiptStatus =
  | 'completed'
  | 'blocked_by_shortcut'
  | 'packet_invalid'
  | 'packet_expired'
  | 'reminder_not_found'
  | 'before_state_unreadable'
  | 'after_state_unreadable'
  | 'mutation_failed'
  | 'rollback_completed'
  | 'rollback_failed'
  | 'user_cancelled'
  | 'shortcut_error'

export type AppleReminderReceiptVerificationStatus =
  | 'verified_clean'
  | 'rejected'
  | 'claim_reality_mismatch'
  | 'rollback_required'

export type AppleReminderRollbackVerificationStatus =
  | 'rollback_verified'
  | 'rollback_failed'
  | 'rollback_unverified'

export type AppleReminderPacketSignature = {
  signatureScheme: 'deterministic_validation_placeholder' | 'hmac_sha256_future'
  signedFields: string[]
  signatureValue: string
  keyId: string | null
  note: string
}

export type AppleRemindersBridgePolicy = {
  bridgeSupported: true
  iphoneShortcutBridgeEnabled: boolean
  appleRemindersBridgeEnabled: boolean
  realAutoModeEnabled: false
  realAutoModeEnableAttemptRejected: boolean
  serverSideAppleCredentialsAllowed: false
  directServerReminderMutationAllowed: false
  backgroundAutomationAllowed: false
  allowedLiveActionTypes: AppleReminderLiveActionType[]
  blockedReminderActionTypes: BlockedAppleReminderActionType[]
}

export type AppleReminderExplicitBridgeApproval = {
  approvalPattern: 'ExplicitExecutionApproval'
  approvalId: string
  exactApprovedText: string
  commanderInput: string
  actionType: AppleReminderLiveActionType
  targetSystem: 'apple_reminders'
  reminderId: string
  singleUse: true
  nonce: string
  createdAt: string
  expiresAt: string
  consumedAt: string | null
  status: 'active' | 'expired' | 'consumed' | 'rejected'
}

export type AppleReminderConsumedApprovalSnapshot = {
  snapshotKind: 'ConsumedApprovalSnapshot'
  approvalPattern: 'ExplicitExecutionApproval'
  approvalId: string
  exactApprovedText: string
  commanderInput: string
  actionType: AppleReminderLiveActionType
  targetSystem: 'apple_reminders'
  reminderId: string
  singleUse: true
  nonce: string
  createdAt: string
  expiresAt: string
  consumedAt: string
  consumedStatus: 'consumed'
  validAt: string
  reusableAuthority: false
  source: 'supabase_approval_authority'
}

export type AppleReminderAuthorizationInput =
  | AppleReminderExplicitBridgeApproval
  | AppleReminderConsumedApprovalSnapshot

export type AppleReminderRollbackPlan = {
  rollbackPlanId: string
  packetId: string
  actionType: 'rollback_mark_apple_reminder_read'
  targetSystem: 'apple_reminders'
  executionBridge: 'iphone_shortcut'
  reminderId: string
  reminderListId: string | null
  reminderListName: string | null
  rollbackStrategy: 'restore_incomplete_status'
  expectedStateAfterRollback: {
    completed: false
    status: 'open' | 'incomplete' | 'not_completed'
    completionDate: null
  }
  requiresManualShortcutRun: true
  requiresReadAfterRollback: true
  reversible: true
  createdAt: string
  expiresAt: string
}

export type AppleReminderActionPacket = {
  packetVersion: AppleReminderActionPacketVersion
  packetId: string
  approvalId: string
  explicitExecutionApprovalId: string
  source: 'auto_mode_gate' | 'execution_gate' | 'operator_request' | 'system_validation'
  commanderId: 'mark'
  commanderInput: string
  exactApprovedText: string
  actionType: AppleReminderLiveActionType
  label: string
  description: string
  scope: {
    targetSystem: 'apple_reminders'
    executionBridge: 'iphone_shortcut'
    shortcutName: typeof APPLE_REMINDERS_SHORTCUT_NAME
    reminderListId: string | null
    reminderListName: string | null
    reminderId: string
    reminderTitleHash: string | null
    singleReminderOnly: true
  }
  constraints: {
    singleUse: true
    expiresAt: string
    createdAt: string
    nonce: string
    requiresManualShortcutRun: true
    requiresReadBeforeWrite: true
    requiresReadAfterWrite: true
    requiresVerificationReceipt: true
    requiresRollbackPlan: true
    allowServerSideAppleCredentials: false
    allowDirectServerMutation: false
    allowBackgroundAutomation: false
    allowBundledActions: false
  }
  eligibilitySnapshot: {
    autoEligible: true
    autoModeActionAllowed: true
    riskLevel: 'low'
    privacySensitivity: 'low'
    estimatedCostClass: 'none'
    reversible: true
    fakeSandboxOnly: false
    liveTargetAllowed: true
    detectedAllowedSignals: string[]
    detectedBlockedSignals: []
    bundledBlockedActionTypes: []
    failedCriteria: []
  }
  approvalSnapshot: {
    approvalPattern: 'ExplicitExecutionApproval'
    exactTextMatched: true
    scopedToSingleAction: true
    scopedToSingleTarget: true
    expiresAt: string
    singleUseNonce: string
    approvalCreatedAt: string
  }
  expectedMutation: {
    expectedChangedSystem: 'apple_reminders'
    expectedChangedPaths: AppleReminderChangedPath[]
    expectedBeforeStatus: 'open' | 'incomplete' | 'not_completed'
    expectedAfterStatus: 'read' | 'complete' | 'completed'
    noOtherReminderMayChange: true
  }
  rollbackPlan: AppleReminderRollbackPlan
  integrityRequirements: {
    verifyPacketIdMatchesReceipt: true
    verifyApprovalIdMatchesReceipt: true
    verifyNonceMatchesReceipt: true
    verifyShortcutNameMatches: true
    verifyReminderIdMatches: true
    verifyReadBeforeWriteObserved: true
    verifyReadAfterWriteObserved: true
    verifyBeforeWasIncomplete: true
    verifyAfterIsCompleted: true
    verifyNoBundledAction: true
    verifySingleReminderOnly: true
    verifyReceiptCreatedBeforeExpiration: true
  }
  signature: AppleReminderPacketSignature
  status: AppleReminderActionPacketStatus
}

export type AppleShortcutInputPayload = {
  kind: 'war_room_apple_reminder_action_packet'
  packet: AppleReminderActionPacket
}

export type AppleShortcutBridgeUrl = {
  shortcutName: typeof APPLE_REMINDERS_SHORTCUT_NAME
  mode: 'manual_run_shortcut_url' | 'x_callback_url_preview'
  url: string
  encodedPacketText: string
  decodedPacketText: string
  packetId: string
  approvalId: string
  actionType: AppleReminderLiveActionType
  reminderId: string
  createdAt: string
  expiresAt: string
  warnings: string[]
}

export type AppleReminderObservation = {
  readSucceeded: boolean
  exists: boolean
  status: AppleReminderObservedStatus
  completed: boolean
  completionDate: string | null
  observedAt: string
}

export type AppleReminderShortcutReceipt = {
  receiptVersion: AppleReminderShortcutReceiptVersion
  receiptId: string
  packetId: string
  approvalId: string
  explicitExecutionApprovalId: string
  nonce: string
  shortcut: {
    shortcutName: typeof APPLE_REMINDERS_SHORTCUT_NAME
    shortcutVersion: string
    deviceKind: 'iphone'
    executedManually: true
    backgroundAutomationUsed: false
  }
  action: {
    actionType: AppleReminderLiveActionType
    targetSystem: 'apple_reminders'
    reminderListId: string | null
    reminderListName: string | null
    reminderId: string
    reminderTitleHash: string | null
    singleReminderOnly: true
  }
  observedBefore: AppleReminderObservation
  mutation: {
    attempted: boolean
    succeeded: boolean
    changedPathsClaimed: AppleReminderChangedPath[]
    errorMessage: string | null
    mutatedAt: string | null
  }
  observedAfter: AppleReminderObservation
  rollback: {
    rollbackAvailable: boolean
    rollbackPlanId: string
    rollbackRequested: boolean
    rollbackAttempted: boolean
    rollbackSucceeded: boolean | null
    observedAfterRollback: AppleReminderRollbackObservation | null
  }
  receiptStatus: AppleReminderShortcutReceiptStatus
  createdAt: string
}

export type AppleReminderRollbackObservation = {
  readSucceeded: boolean
  exists: boolean
  status: AppleReminderObservedStatus
  completed: boolean
  completionDate: string | null
  observedAt: string
}

export type AppleReminderRollbackPacket = {
  packetVersion: typeof APPLE_REMINDER_ROLLBACK_PACKET_VERSION
  rollbackPacketId: string
  originalPacketId: string
  originalReceiptId: string
  rollbackPlan: AppleReminderRollbackPlan
  nonce: string
  exactApprovedText: string
  createdAt: string
  expiresAt: string
  signature: AppleReminderPacketSignature
}

export type AppleReminderRollbackReceipt = {
  receiptVersion: typeof APPLE_REMINDER_ROLLBACK_RECEIPT_VERSION
  rollbackReceiptId: string
  rollbackPacketId: string
  originalPacketId: string
  rollbackPlanId: string
  nonce: string
  shortcut: {
    shortcutName: typeof APPLE_REMINDERS_SHORTCUT_NAME
    shortcutVersion: string
    deviceKind: 'iphone'
    executedManually: true
    backgroundAutomationUsed: false
  }
  action: {
    actionType: 'rollback_mark_apple_reminder_read'
    targetSystem: 'apple_reminders'
    reminderId: string
    singleReminderOnly: true
  }
  observedAfterRollback: AppleReminderRollbackObservation
  rollbackStatus: 'rollback_completed' | 'rollback_failed' | 'rollback_unverified' | 'user_cancelled' | 'shortcut_error'
  errorMessage: string | null
  createdAt: string
}

export type AppleReminderPacketCreationInput = {
  policy: AppleRemindersBridgePolicy
  approval: AppleReminderAuthorizationInput | null
  commanderInput: string
  exactApprovedText: string
  reminderId: string | null
  reminderListId?: string | null
  reminderListName?: string | null
  reminderTitleHash?: string | null
  actionType: string
  blockedSignals?: BlockedAppleReminderActionType[]
  createdAt?: string
  expiresAt?: string
  packetId?: string
}

export type AppleReminderPacketCreationResult = {
  status: 'packet_created' | 'blocked'
  packet: AppleReminderActionPacket | null
  blockedReason: string | null
  shortcutUrlCreated: boolean
  packetCreated: boolean
  notes: string[]
}

export type AppleShortcutReceiptParseResult = {
  status: 'parsed' | 'rejected'
  receipt: AppleReminderShortcutReceipt | null
  error: string | null
}

export type AppleReminderReceiptVerificationResult = {
  status: AppleReminderReceiptVerificationStatus
  packetId: string
  receiptId: string | null
  accepted: boolean
  rollbackRequired: boolean
  verifiedChangedPaths: AppleReminderChangedPath[]
  issues: string[]
  createdAt: string
}

export type AppleReminderRollbackVerificationResult = {
  status: AppleReminderRollbackVerificationStatus
  accepted: boolean
  issues: string[]
  createdAt: string
}

export type AppleReminderBridgeValidationResult = {
  caseId: string
  description: string
  expected: string
  observed: string
  result: 'PASS' | 'FAIL' | 'LIMITATION_ACCEPTED'
  notes: string[]
}

export type AppleReminderBridgeGateValidationResult = {
  gateId: string
  description: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

import {
  APPLE_REMINDER_PACKET_VERSION,
  APPLE_REMINDERS_SHORTCUT_NAME,
  type AppleReminderActionPacket,
  type AppleReminderAuthorizationInput,
  type AppleReminderConsumedApprovalSnapshot,
  type AppleReminderExplicitBridgeApproval,
  type AppleReminderPacketCreationInput,
  type AppleReminderPacketCreationResult,
  type AppleReminderPacketSignature,
  type AppleRemindersBridgePolicy,
  type BlockedAppleReminderActionType,
} from './types'

export const BLOCKED_APPLE_REMINDER_ACTION_TYPES: BlockedAppleReminderActionType[] = [
  'create_apple_reminder',
  'delete_apple_reminder',
  'edit_apple_reminder_title',
  'edit_apple_reminder_notes',
  'edit_apple_reminder_due_date',
  'move_apple_reminder',
  'clear_completed_reminders',
  'bulk_complete_reminders',
  'send_reminder_notification',
  'share_reminder',
  'sync_reminders',
  'read_all_reminders',
  'export_reminders',
  'unknown_reminder_action',
  'message_send',
  'memory_commit',
  'database_mutation',
  'provider_call',
  'google_tasks_action',
  'google_calendar_action',
]

const DEFAULT_TIME = '2026-07-07T12:00:00.000Z'
const DEFAULT_EXPIRY = '2026-07-07T12:05:00.000Z'

export function createAppleRemindersBridgePolicy(input: {
  iphoneShortcutBridgeEnabled?: boolean
  appleRemindersBridgeEnabled?: boolean
  realAutoModeEnabledAttempted?: boolean
  allowedLiveActionTypes?: string[]
} = {}): AppleRemindersBridgePolicy {
  return {
    bridgeSupported: true,
    iphoneShortcutBridgeEnabled: input.iphoneShortcutBridgeEnabled === true,
    appleRemindersBridgeEnabled: input.appleRemindersBridgeEnabled === true,
    realAutoModeEnabled: false,
    realAutoModeEnableAttemptRejected: input.realAutoModeEnabledAttempted === true,
    serverSideAppleCredentialsAllowed: false,
    directServerReminderMutationAllowed: false,
    backgroundAutomationAllowed: false,
    allowedLiveActionTypes: input.allowedLiveActionTypes?.includes('mark_apple_reminder_read')
      ? ['mark_apple_reminder_read']
      : [],
    blockedReminderActionTypes: [...BLOCKED_APPLE_REMINDER_ACTION_TYPES],
  }
}

export class AppleReminderActionPacketFactory {
  create(input: AppleReminderPacketCreationInput): AppleReminderPacketCreationResult {
    const createdAt = input.createdAt ?? DEFAULT_TIME
    const expiresAt = input.expiresAt ?? DEFAULT_EXPIRY
    const notes = [
      '46K prepares a manual iPhone Shortcut packet only.',
      'Server-side Apple reminder mutation is not allowed.',
    ]
    const blockedReason = this.findBlockedReason(input, createdAt)

    if (blockedReason) {
      return {
        status: 'blocked',
        packet: null,
        blockedReason,
        shortcutUrlCreated: false,
        packetCreated: false,
        notes,
      }
    }

    const authorization = input.approval
    const packetId = input.packetId ?? `apple_packet_${authorization?.nonce ?? 'nonce'}_${input.reminderId}`
    const rollbackPlan = {
      rollbackPlanId: `rollback_plan_${packetId}`,
      packetId,
      actionType: 'rollback_mark_apple_reminder_read' as const,
      targetSystem: 'apple_reminders' as const,
      executionBridge: 'iphone_shortcut' as const,
      reminderId: input.reminderId ?? '',
      reminderListId: input.reminderListId ?? null,
      reminderListName: input.reminderListName ?? null,
      rollbackStrategy: 'restore_incomplete_status' as const,
      expectedStateAfterRollback: {
        completed: false as const,
        status: 'incomplete' as const,
        completionDate: null,
      },
      requiresManualShortcutRun: true as const,
      requiresReadAfterRollback: true as const,
      reversible: true as const,
      createdAt,
      expiresAt,
    }
    const signature = this.createPlaceholderSignature({
      packetId,
      approvalId: authorization?.approvalId ?? '',
      reminderId: input.reminderId ?? '',
      nonce: authorization?.nonce ?? '',
      expiresAt,
    })
    const packet: AppleReminderActionPacket = {
      packetVersion: APPLE_REMINDER_PACKET_VERSION,
      packetId,
      approvalId: authorization?.approvalId ?? '',
      explicitExecutionApprovalId: authorization?.approvalId ?? '',
      source: 'auto_mode_gate',
      commanderId: 'mark',
      commanderInput: input.commanderInput,
      exactApprovedText: input.exactApprovedText,
      actionType: 'mark_apple_reminder_read',
      label: 'Mark Apple reminder read',
      description: 'Manual iPhone Shortcut packet for one Apple Reminders completion action.',
      scope: {
        targetSystem: 'apple_reminders',
        executionBridge: 'iphone_shortcut',
        shortcutName: APPLE_REMINDERS_SHORTCUT_NAME,
        reminderListId: input.reminderListId ?? null,
        reminderListName: input.reminderListName ?? null,
        reminderId: input.reminderId ?? '',
        reminderTitleHash: input.reminderTitleHash ?? null,
        singleReminderOnly: true,
      },
      constraints: {
        singleUse: true,
        expiresAt,
        createdAt,
        nonce: authorization?.nonce ?? '',
        requiresManualShortcutRun: true,
        requiresReadBeforeWrite: true,
        requiresReadAfterWrite: true,
        requiresVerificationReceipt: true,
        requiresRollbackPlan: true,
        allowServerSideAppleCredentials: false,
        allowDirectServerMutation: false,
        allowBackgroundAutomation: false,
        allowBundledActions: false,
      },
      eligibilitySnapshot: {
        autoEligible: true,
        autoModeActionAllowed: true,
        riskLevel: 'low',
        privacySensitivity: 'low',
        estimatedCostClass: 'none',
        reversible: true,
        fakeSandboxOnly: false,
        liveTargetAllowed: true,
        detectedAllowedSignals: ['mark_apple_reminder_read'],
        detectedBlockedSignals: [],
        bundledBlockedActionTypes: [],
        failedCriteria: [],
      },
      approvalSnapshot: {
        approvalPattern: 'ExplicitExecutionApproval',
        exactTextMatched: true,
        scopedToSingleAction: true,
        scopedToSingleTarget: true,
        expiresAt: authorization?.expiresAt ?? expiresAt,
        singleUseNonce: authorization?.nonce ?? '',
        approvalCreatedAt: authorization?.createdAt ?? createdAt,
      },
      expectedMutation: {
        expectedChangedSystem: 'apple_reminders',
        expectedChangedPaths: [
          'appleReminders.reminder.completed',
          'appleReminders.reminder.status',
          'appleReminders.reminder.completionDate',
        ],
        expectedBeforeStatus: 'incomplete',
        expectedAfterStatus: 'completed',
        noOtherReminderMayChange: true,
      },
      rollbackPlan,
      integrityRequirements: {
        verifyPacketIdMatchesReceipt: true,
        verifyApprovalIdMatchesReceipt: true,
        verifyNonceMatchesReceipt: true,
        verifyShortcutNameMatches: true,
        verifyReminderIdMatches: true,
        verifyReadBeforeWriteObserved: true,
        verifyReadAfterWriteObserved: true,
        verifyBeforeWasIncomplete: true,
        verifyAfterIsCompleted: true,
        verifyNoBundledAction: true,
        verifySingleReminderOnly: true,
        verifyReceiptCreatedBeforeExpiration: true,
      },
      signature,
      status: 'prepared',
    }

    return {
      status: 'packet_created',
      packet,
      blockedReason: null,
      shortcutUrlCreated: false,
      packetCreated: true,
      notes,
    }
  }

  private findBlockedReason(
    input: AppleReminderPacketCreationInput,
    createdAt: string
  ): string | null {
    if (!input.policy.iphoneShortcutBridgeEnabled || !input.policy.appleRemindersBridgeEnabled) {
      return 'Bridge disabled.'
    }

    if (input.policy.realAutoModeEnabled !== false) {
      return 'Global real Auto Mode must remain false.'
    }

    if (input.policy.realAutoModeEnableAttemptRejected) {
      return 'Attempted global real Auto Mode enablement is rejected in 46K.'
    }

    if (!input.policy.allowedLiveActionTypes.includes('mark_apple_reminder_read')) {
      return 'mark_apple_reminder_read is not in allowed live actions.'
    }

    if (input.actionType !== 'mark_apple_reminder_read') {
      return `${input.actionType} is not allowed in 46K.`
    }

    if (input.blockedSignals && input.blockedSignals.length > 0) {
      return `Blocked bundled signal detected: ${input.blockedSignals[0]}.`
    }

    if (!input.reminderId || input.reminderId.trim().length === 0) {
      return 'Missing reminderId.'
    }

    if (input.reminderId.includes(',')) {
      return 'Multiple reminder IDs are not allowed.'
    }

    if (!input.approval) {
      return 'Missing ExplicitExecutionApproval.'
    }

    return this.findAuthorizationBlockedReason(input.approval, input, createdAt)
  }

  private findAuthorizationBlockedReason(
    authorization: AppleReminderAuthorizationInput,
    input: AppleReminderPacketCreationInput,
    createdAt: string
  ): string | null {
    if (authorization.approvalPattern !== 'ExplicitExecutionApproval') {
      return 'Approval object is not ExplicitExecutionApproval.'
    }

    if (isConsumedApprovalSnapshot(authorization)) {
      return this.findConsumedSnapshotBlockedReason(authorization, input, createdAt)
    }

    return this.findActiveApprovalBlockedReason(authorization, input, createdAt)
  }

  private findActiveApprovalBlockedReason(
    approval: AppleReminderExplicitBridgeApproval,
    input: AppleReminderPacketCreationInput,
    createdAt: string
  ): string | null {
    if (approval.status !== 'active' || approval.consumedAt !== null) {
      return 'Approval is not active single-use approval.'
    }

    return this.findSharedAuthorizationBlockedReason(approval, input, createdAt)
  }

  private findConsumedSnapshotBlockedReason(
    snapshot: AppleReminderConsumedApprovalSnapshot,
    input: AppleReminderPacketCreationInput,
    createdAt: string
  ): string | null {
    if (snapshot.consumedStatus !== 'consumed' || !snapshot.consumedAt) {
      return 'Authorization snapshot is not consumed.'
    }

    if (snapshot.reusableAuthority !== false) {
      return 'Authorization snapshot cannot be reusable authority.'
    }

    if (snapshot.source !== 'supabase_approval_authority') {
      return 'Authorization snapshot source mismatch.'
    }

    return this.findSharedAuthorizationBlockedReason(snapshot, input, createdAt)
  }

  private findSharedAuthorizationBlockedReason(
    authorization: AppleReminderAuthorizationInput,
    input: AppleReminderPacketCreationInput,
    createdAt: string
  ): string | null {
    if (authorization.singleUse !== true) {
      return 'Approval is not marked single-use.'
    }

    if (new Date(authorization.expiresAt).getTime() <= new Date(createdAt).getTime()) {
      return 'Approval expired.'
    }

    if (input.exactApprovedText !== authorization.exactApprovedText) {
      return 'Approval text mismatch.'
    }

    if (input.commanderInput !== authorization.commanderInput) {
      return 'Commander input mismatch.'
    }

    if (authorization.actionType !== 'mark_apple_reminder_read') {
      return 'Approval action mismatch.'
    }

    if (authorization.targetSystem !== 'apple_reminders') {
      return 'Approval target system mismatch.'
    }

    if (authorization.reminderId !== input.reminderId) {
      return 'Approval reminder target mismatch.'
    }

    return null
  }

  private createPlaceholderSignature(input: {
    packetId: string
    approvalId: string
    reminderId: string
    nonce: string
    expiresAt: string
  }): AppleReminderPacketSignature {
    const signedFields = ['packetId', 'approvalId', 'reminderId', 'nonce', 'expiresAt']
    const signatureValue = [
      input.packetId,
      input.approvalId,
      input.reminderId,
      input.nonce,
      input.expiresAt,
    ].join('|')

    return {
      signatureScheme: 'deterministic_validation_placeholder',
      signedFields,
      signatureValue: `placeholder:${signatureValue}`,
      keyId: null,
      note: 'Deterministic validation material only. No cryptographic secret is introduced in 46K.',
    }
  }
}

function isConsumedApprovalSnapshot(
  authorization: AppleReminderAuthorizationInput
): authorization is AppleReminderConsumedApprovalSnapshot {
  return 'snapshotKind' in authorization && authorization.snapshotKind === 'ConsumedApprovalSnapshot'
}

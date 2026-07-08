import {
  APPLE_REMINDER_RECEIPT_VERSION,
  APPLE_REMINDER_ROLLBACK_RECEIPT_VERSION,
  APPLE_REMINDERS_SHORTCUT_NAME,
  type AppleReminderActionPacket,
  type AppleReminderExplicitBridgeApproval,
  type AppleReminderPacketCreationInput,
  type AppleReminderRollbackPacket,
  type AppleReminderRollbackReceipt,
  type AppleReminderShortcutReceipt,
} from './types'
import { createAppleRemindersBridgePolicy } from './AppleReminderActionPacket'

export const FIXTURE_TIME = '2026-07-07T12:00:00.000Z'
export const FIXTURE_EXPIRY = '2026-07-07T12:05:00.000Z'

export function createValidApproval(
  overrides: Partial<AppleReminderExplicitBridgeApproval> = {}
): AppleReminderExplicitBridgeApproval {
  return {
    approvalPattern: 'ExplicitExecutionApproval',
    approvalId: 'approval_46k_valid',
    exactApprovedText: 'I APPROVE THIS APPLE REMINDER ACTION',
    commanderInput: 'Mark this Apple reminder read.',
    actionType: 'mark_apple_reminder_read',
    targetSystem: 'apple_reminders',
    reminderId: 'apple_reminder_1',
    singleUse: true,
    nonce: 'nonce_46k_valid',
    createdAt: FIXTURE_TIME,
    expiresAt: FIXTURE_EXPIRY,
    consumedAt: null,
    status: 'active',
    ...overrides,
  }
}

export function createValidPacketInput(
  overrides: Partial<AppleReminderPacketCreationInput> = {}
): AppleReminderPacketCreationInput {
  const approval = createValidApproval()

  return {
    policy: createAppleRemindersBridgePolicy({
      iphoneShortcutBridgeEnabled: true,
      appleRemindersBridgeEnabled: true,
      allowedLiveActionTypes: ['mark_apple_reminder_read'],
    }),
    approval,
    commanderInput: approval.commanderInput,
    exactApprovedText: approval.exactApprovedText,
    reminderId: approval.reminderId,
    reminderListId: 'list_1',
    reminderListName: 'War Room',
    reminderTitleHash: 'title_hash_1',
    actionType: 'mark_apple_reminder_read',
    createdAt: FIXTURE_TIME,
    expiresAt: FIXTURE_EXPIRY,
    packetId: 'apple_packet_46k_valid',
    ...overrides,
  }
}

export function createValidReceipt(
  packet: AppleReminderActionPacket,
  overrides: Partial<AppleReminderShortcutReceipt> = {}
): AppleReminderShortcutReceipt {
  return {
    receiptVersion: APPLE_REMINDER_RECEIPT_VERSION,
    receiptId: 'receipt_46k_valid',
    packetId: packet.packetId,
    approvalId: packet.approvalId,
    explicitExecutionApprovalId: packet.explicitExecutionApprovalId,
    nonce: packet.constraints.nonce,
    shortcut: {
      shortcutName: APPLE_REMINDERS_SHORTCUT_NAME,
      shortcutVersion: '1.0',
      deviceKind: 'iphone',
      executedManually: true,
      backgroundAutomationUsed: false,
    },
    action: {
      actionType: 'mark_apple_reminder_read',
      targetSystem: 'apple_reminders',
      reminderListId: packet.scope.reminderListId,
      reminderListName: packet.scope.reminderListName,
      reminderId: packet.scope.reminderId,
      reminderTitleHash: packet.scope.reminderTitleHash,
      singleReminderOnly: true,
    },
    observedBefore: {
      readSucceeded: true,
      exists: true,
      status: 'incomplete',
      completed: false,
      completionDate: null,
      observedAt: '2026-07-07T12:00:10.000Z',
    },
    mutation: {
      attempted: true,
      succeeded: true,
      changedPathsClaimed: [
        'appleReminders.reminder.completed',
        'appleReminders.reminder.status',
        'appleReminders.reminder.completionDate',
      ],
      errorMessage: null,
      mutatedAt: '2026-07-07T12:00:20.000Z',
    },
    observedAfter: {
      readSucceeded: true,
      exists: true,
      status: 'completed',
      completed: true,
      completionDate: '2026-07-07T12:00:20.000Z',
      observedAt: '2026-07-07T12:00:25.000Z',
    },
    rollback: {
      rollbackAvailable: true,
      rollbackPlanId: packet.rollbackPlan.rollbackPlanId,
      rollbackRequested: false,
      rollbackAttempted: false,
      rollbackSucceeded: null,
      observedAfterRollback: null,
    },
    receiptStatus: 'completed',
    createdAt: '2026-07-07T12:00:30.000Z',
    ...overrides,
  }
}

export function createValidRollbackReceipt(
  packet: AppleReminderRollbackPacket,
  overrides: Partial<AppleReminderRollbackReceipt> = {}
): AppleReminderRollbackReceipt {
  return {
    receiptVersion: APPLE_REMINDER_ROLLBACK_RECEIPT_VERSION,
    rollbackReceiptId: 'rollback_receipt_46k_valid',
    rollbackPacketId: packet.rollbackPacketId,
    originalPacketId: packet.originalPacketId,
    rollbackPlanId: packet.rollbackPlan.rollbackPlanId,
    nonce: packet.nonce,
    shortcut: {
      shortcutName: APPLE_REMINDERS_SHORTCUT_NAME,
      shortcutVersion: '1.0',
      deviceKind: 'iphone',
      executedManually: true,
      backgroundAutomationUsed: false,
    },
    action: {
      actionType: 'rollback_mark_apple_reminder_read',
      targetSystem: 'apple_reminders',
      reminderId: packet.rollbackPlan.reminderId,
      singleReminderOnly: true,
    },
    observedAfterRollback: {
      readSucceeded: true,
      exists: true,
      completed: false,
      status: 'incomplete',
      completionDate: null,
      observedAt: '2026-07-07T12:03:00.000Z',
    },
    rollbackStatus: 'rollback_completed',
    errorMessage: null,
    createdAt: '2026-07-07T12:03:10.000Z',
    ...overrides,
  }
}

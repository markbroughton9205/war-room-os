import {
  APPLE_REMINDER_ROLLBACK_PACKET_VERSION,
  type AppleReminderPacketSignature,
  type AppleReminderRollbackPacket,
  type AppleReminderShortcutReceipt,
} from './types'

export class AppleReminderRollbackPlanner {
  createRollbackPacket(input: {
    originalReceipt: AppleReminderShortcutReceipt
    exactApprovedText: string
    nonce: string
    createdAt?: string
    expiresAt?: string
  }): AppleReminderRollbackPacket {
    const createdAt = input.createdAt ?? '2026-07-07T12:02:00.000Z'
    const expiresAt = input.expiresAt ?? '2026-07-07T12:07:00.000Z'
    const rollbackPacketId = `rollback_packet_${input.originalReceipt.packetId}`

    return {
      packetVersion: APPLE_REMINDER_ROLLBACK_PACKET_VERSION,
      rollbackPacketId,
      originalPacketId: input.originalReceipt.packetId,
      originalReceiptId: input.originalReceipt.receiptId,
      rollbackPlan: {
        rollbackPlanId: input.originalReceipt.rollback.rollbackPlanId,
        packetId: input.originalReceipt.packetId,
        actionType: 'rollback_mark_apple_reminder_read',
        targetSystem: 'apple_reminders',
        executionBridge: 'iphone_shortcut',
        reminderId: input.originalReceipt.action.reminderId,
        reminderListId: input.originalReceipt.action.reminderListId,
        reminderListName: input.originalReceipt.action.reminderListName,
        rollbackStrategy: 'restore_incomplete_status',
        expectedStateAfterRollback: {
          completed: false,
          status: 'incomplete',
          completionDate: null,
        },
        requiresManualShortcutRun: true,
        requiresReadAfterRollback: true,
        reversible: true,
        createdAt,
        expiresAt,
      },
      nonce: input.nonce,
      exactApprovedText: input.exactApprovedText,
      createdAt,
      expiresAt,
      signature: this.createPlaceholderSignature(rollbackPacketId, input.nonce, expiresAt),
    }
  }

  private createPlaceholderSignature(
    rollbackPacketId: string,
    nonce: string,
    expiresAt: string
  ): AppleReminderPacketSignature {
    return {
      signatureScheme: 'deterministic_validation_placeholder',
      signedFields: ['rollbackPacketId', 'nonce', 'expiresAt'],
      signatureValue: `placeholder:${rollbackPacketId}|${nonce}|${expiresAt}`,
      keyId: null,
      note: 'Deterministic rollback validation material only. No cryptographic secret is introduced in 46K.',
    }
  }
}

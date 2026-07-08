import {
  APPLE_REMINDERS_SHORTCUT_NAME,
  type AppleReminderRollbackPacket,
  type AppleReminderRollbackReceipt,
  type AppleReminderRollbackVerificationResult,
} from './types'

export class AppleReminderRollbackVerifier {
  verify(
    packet: AppleReminderRollbackPacket,
    receipt: AppleReminderRollbackReceipt,
    verifiedAt = '2026-07-07T12:03:00.000Z'
  ): AppleReminderRollbackVerificationResult {
    const issues: string[] = []

    if (receipt.rollbackPacketId !== packet.rollbackPacketId) issues.push('rollbackPacketId mismatch')
    if (receipt.originalPacketId !== packet.originalPacketId) issues.push('originalPacketId mismatch')
    if (receipt.rollbackPlanId !== packet.rollbackPlan.rollbackPlanId) issues.push('rollbackPlanId mismatch')
    if (receipt.nonce !== packet.nonce) issues.push('nonce mismatch')
    if (receipt.shortcut.shortcutName !== APPLE_REMINDERS_SHORTCUT_NAME) issues.push('Shortcut name mismatch')
    if (!receipt.shortcut.executedManually) issues.push('Shortcut was not manual')
    if (receipt.shortcut.backgroundAutomationUsed) issues.push('Background automation was used')
    if (receipt.action.actionType !== 'rollback_mark_apple_reminder_read') issues.push('Wrong rollback action')
    if (receipt.action.targetSystem !== 'apple_reminders') issues.push('Wrong rollback target')
    if (receipt.action.reminderId !== packet.rollbackPlan.reminderId) issues.push('Rollback reminder mismatch')
    if (!receipt.action.singleReminderOnly) issues.push('Rollback was not single-reminder scoped')
    if (!receipt.observedAfterRollback.readSucceeded) issues.push('Read after rollback failed')
    if (!receipt.observedAfterRollback.exists) issues.push('Reminder missing after rollback')
    if (receipt.observedAfterRollback.completed) issues.push('Reminder still completed after rollback')
    if (receipt.observedAfterRollback.completionDate !== null) issues.push('Completion date still present')

    if (issues.length === 0 && receipt.rollbackStatus === 'rollback_completed') {
      return {
        status: 'rollback_verified',
        accepted: true,
        issues,
        createdAt: verifiedAt,
      }
    }

    return {
      status: receipt.observedAfterRollback.readSucceeded ? 'rollback_failed' : 'rollback_unverified',
      accepted: false,
      issues,
      createdAt: verifiedAt,
    }
  }
}

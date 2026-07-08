import {
  APPLE_REMINDERS_SHORTCUT_NAME,
  type AppleReminderActionPacket,
  type AppleReminderChangedPath,
  type AppleReminderReceiptVerificationResult,
  type AppleReminderShortcutReceipt,
} from './types'

export class AppleReminderReceiptVerifier {
  verify(
    packet: AppleReminderActionPacket,
    receipt: AppleReminderShortcutReceipt,
    verifiedAt = '2026-07-07T12:01:00.000Z'
  ): AppleReminderReceiptVerificationResult {
    const issues: string[] = []

    if (receipt.packetId !== packet.packetId) issues.push('packetId mismatch')
    if (receipt.approvalId !== packet.approvalId) issues.push('approvalId mismatch')
    if (receipt.explicitExecutionApprovalId !== packet.explicitExecutionApprovalId) {
      issues.push('explicitExecutionApprovalId mismatch')
    }
    if (receipt.nonce !== packet.constraints.nonce) issues.push('nonce mismatch')
    if (receipt.shortcut.shortcutName !== APPLE_REMINDERS_SHORTCUT_NAME) {
      issues.push('Shortcut name mismatch')
    }
    if (!receipt.shortcut.executedManually) issues.push('Shortcut was not executed manually')
    if (receipt.shortcut.backgroundAutomationUsed) issues.push('Background automation was used')
    if (receipt.action.reminderId !== packet.scope.reminderId) issues.push('reminderId mismatch')
    if (!receipt.action.singleReminderOnly) issues.push('Receipt was not scoped to one reminder')
    if (receipt.action.actionType !== 'mark_apple_reminder_read') issues.push('Wrong action type')
    if (receipt.action.targetSystem !== 'apple_reminders') issues.push('Wrong target system')
    if (new Date(receipt.createdAt).getTime() > new Date(packet.constraints.expiresAt).getTime()) {
      issues.push('Receipt created after packet expiration')
    }
    if (!receipt.observedBefore.readSucceeded) issues.push('Before-state read failed')
    if (!receipt.observedAfter.readSucceeded) issues.push('After-state read failed')
    if (!receipt.observedBefore.exists) issues.push('Reminder did not exist before mutation')
    if (!receipt.observedAfter.exists) issues.push('Reminder did not exist after mutation')
    if (receipt.observedBefore.completed) issues.push('Reminder was already completed before mutation')
    if (!receipt.observedAfter.completed) issues.push('Reminder was not completed after mutation')
    if (!receipt.mutation.attempted) issues.push('Mutation was not attempted')
    if (!receipt.mutation.succeeded) issues.push('Mutation did not succeed')

    const unexpectedClaimedPath = receipt.mutation.changedPathsClaimed.find(
      path => !packet.expectedMutation.expectedChangedPaths.includes(path)
    )
    if (unexpectedClaimedPath) issues.push(`Unexpected changed path: ${unexpectedClaimedPath}`)

    const verifiedChangedPaths = this.deriveChangedPaths(receipt)
    const missingRealityPath = receipt.mutation.changedPathsClaimed.find(
      path => !verifiedChangedPaths.includes(path)
    )
    if (missingRealityPath) {
      issues.push(`Claimed path not proven by before/after reality: ${missingRealityPath}`)
    }

    const status = this.resolveStatus(issues, receipt, verifiedChangedPaths)

    return {
      status,
      packetId: packet.packetId,
      receiptId: receipt.receiptId,
      accepted: status === 'verified_clean',
      rollbackRequired: receipt.observedAfter.completed && issues.length > 0,
      verifiedChangedPaths,
      issues,
      createdAt: verifiedAt,
    }
  }

  private deriveChangedPaths(receipt: AppleReminderShortcutReceipt): AppleReminderChangedPath[] {
    const paths: AppleReminderChangedPath[] = []

    if (receipt.observedBefore.completed !== receipt.observedAfter.completed) {
      paths.push('appleReminders.reminder.completed')
    }

    if (receipt.observedBefore.status !== receipt.observedAfter.status) {
      paths.push('appleReminders.reminder.status')
    }

    if (receipt.observedBefore.completionDate !== receipt.observedAfter.completionDate) {
      paths.push('appleReminders.reminder.completionDate')
    }

    return paths
  }

  private resolveStatus(
    issues: string[],
    receipt: AppleReminderShortcutReceipt,
    verifiedChangedPaths: AppleReminderChangedPath[]
  ): AppleReminderReceiptVerificationResult['status'] {
    if (
      receipt.receiptStatus === 'completed' &&
      receipt.mutation.succeeded &&
      receipt.observedBefore.readSucceeded &&
      receipt.observedAfter.readSucceeded &&
      !receipt.observedBefore.completed &&
      receipt.observedAfter.completed &&
      issues.length === 0
    ) {
      return 'verified_clean'
    }

    if (this.hasHardRejectionIssue(issues)) {
      return 'rejected'
    }

    if (
      receipt.receiptStatus === 'completed' ||
      receipt.mutation.succeeded ||
      receipt.observedAfter.completed ||
      verifiedChangedPaths.length > 0
    ) {
      return 'claim_reality_mismatch'
    }

    return 'rejected'
  }

  private hasHardRejectionIssue(issues: string[]): boolean {
    return issues.some(issue =>
      [
        'packetId mismatch',
        'approvalId mismatch',
        'explicitExecutionApprovalId mismatch',
        'nonce mismatch',
        'Shortcut name mismatch',
        'Shortcut was not executed manually',
        'Background automation was used',
        'reminderId mismatch',
        'Receipt was not scoped to one reminder',
        'Wrong action type',
        'Wrong target system',
        'Receipt created after packet expiration',
        'Before-state read failed',
        'After-state read failed',
        'Reminder did not exist before mutation',
        'Reminder did not exist after mutation',
        'Reminder was already completed before mutation',
      ].includes(issue)
    )
  }
}

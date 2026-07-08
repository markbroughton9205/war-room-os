import {
  APPLE_REMINDER_RECEIPT_VERSION,
  APPLE_REMINDERS_SHORTCUT_NAME,
  type AppleReminderShortcutReceipt,
  type AppleShortcutReceiptParseResult,
} from './types'

export class AppleShortcutReceiptParser {
  parse(receiptText: string): AppleShortcutReceiptParseResult {
    try {
      const parsed = JSON.parse(receiptText) as Partial<AppleReminderShortcutReceipt>
      const missing = this.findMissingField(parsed)

      if (missing) {
        return reject(`Missing receipt field: ${missing}.`)
      }

      if (parsed.receiptVersion !== APPLE_REMINDER_RECEIPT_VERSION) {
        return reject('Wrong receipt version.')
      }

      if (parsed.shortcut?.shortcutName !== APPLE_REMINDERS_SHORTCUT_NAME) {
        return reject('Wrong Shortcut name.')
      }

      if (parsed.action?.actionType !== 'mark_apple_reminder_read') {
        return reject('Wrong receipt action.')
      }

      if (parsed.action?.targetSystem !== 'apple_reminders') {
        return reject('Wrong receipt target system.')
      }

      return {
        status: 'parsed',
        receipt: parsed as AppleReminderShortcutReceipt,
        error: null,
      }
    } catch {
      return reject('Receipt text is not valid JSON.')
    }
  }

  private findMissingField(receipt: Partial<AppleReminderShortcutReceipt>): string | null {
    if (!receipt.receiptVersion) return 'receiptVersion'
    if (!receipt.receiptId) return 'receiptId'
    if (!receipt.packetId) return 'packetId'
    if (!receipt.approvalId) return 'approvalId'
    if (!receipt.explicitExecutionApprovalId) return 'explicitExecutionApprovalId'
    if (!receipt.nonce) return 'nonce'
    if (!receipt.shortcut) return 'shortcut'
    if (!receipt.action) return 'action'
    if (!receipt.observedBefore) return 'observedBefore'
    if (!receipt.mutation) return 'mutation'
    if (!receipt.observedAfter) return 'observedAfter'
    if (!receipt.rollback) return 'rollback'
    if (!receipt.receiptStatus) return 'receiptStatus'
    if (!receipt.createdAt) return 'createdAt'
    return null
  }
}

function reject(error: string): AppleShortcutReceiptParseResult {
  return {
    status: 'rejected',
    receipt: null,
    error,
  }
}

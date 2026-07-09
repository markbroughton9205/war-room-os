import {
  AppleReminderReceiptVerifier,
  type AppleReminderActionPacket,
  type AppleReminderShortcutReceipt,
} from '../apple-reminders-bridge'
import type {
  AutoModeSingleUseLedger,
  LedgerReceiptVerificationResult,
} from './types'

export class AppleReminderLedgerReceiptVerifier {
  constructor(
    private readonly ledger: AutoModeSingleUseLedger,
    private readonly receiptVerifier: AppleReminderReceiptVerifier = new AppleReminderReceiptVerifier()
  ) {}

  async verifyWithLedger(input: {
    packet: AppleReminderActionPacket
    receipt: AppleReminderShortcutReceipt
    now: string
  }): Promise<LedgerReceiptVerificationResult> {
    const consume = await this.ledger.consumePacket({
      packetId: input.packet.packetId,
      nonce: input.receipt.nonce,
      receiptId: input.receipt.receiptId,
      now: input.now,
    })

    if (!consume.ok) {
      return {
        status: 'ledger_rejected',
        ledgerStatus: consume.status,
        ledgerEntry: consume.ledgerEntry,
        receiptAccepted: false,
        issues: [consume.errorMessage ?? consume.status],
      }
    }

    if (consume.ledgerEntry?.targetId !== input.receipt.action.reminderId) {
      return {
        status: 'ledger_rejected',
        ledgerStatus: 'ledger_write_conflict',
        ledgerEntry: consume.ledgerEntry,
        receiptAccepted: false,
        issues: ['Ledger targetId mismatch.'],
      }
    }

    if (consume.ledgerEntry?.actionType !== input.receipt.action.actionType) {
      return {
        status: 'ledger_rejected',
        ledgerStatus: 'ledger_write_conflict',
        ledgerEntry: consume.ledgerEntry,
        receiptAccepted: false,
        issues: ['Ledger actionType mismatch.'],
      }
    }

    const receiptResult = this.receiptVerifier.verify(input.packet, input.receipt, input.now)

    if (!receiptResult.accepted) {
      return {
        status: receiptResult.status === 'claim_reality_mismatch'
          ? 'claim_reality_mismatch'
          : receiptResult.rollbackRequired
            ? 'rollback_required'
            : 'receipt_rejected',
        ledgerStatus: consume.status,
        ledgerEntry: consume.ledgerEntry,
        receiptAccepted: false,
        issues: receiptResult.issues,
      }
    }

    return {
      status: 'verified_clean',
      ledgerStatus: consume.status,
      ledgerEntry: consume.ledgerEntry,
      receiptAccepted: true,
      issues: [],
    }
  }
}

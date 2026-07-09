import { AppleReminderLedgerReceiptVerifier } from './AppleReminderLedgerReceiptVerifier'
import { createSupabaseSingleUseLedger } from './SupabaseSingleUseLedger'

export function createLiveAppleReminderLedgerReceiptVerifier(): AppleReminderLedgerReceiptVerifier {
  return new AppleReminderLedgerReceiptVerifier(createSupabaseSingleUseLedger())
}

import { NextResponse } from 'next/server'

import { handleAppleReminderLiveCommand } from '@/lib/council/apple-reminder-live-route'
import { createLiveAppleApprovalConsumer } from '@/lib/council/apple-reminder-live-route/AppleApprovalConsumer'
import {
  createLiveAppleReminderLedgerReceiptVerifier,
  createSupabaseSingleUseLedger,
} from '@/lib/council/auto-mode-ledger'

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    body = null
  }

  const response = await handleAppleReminderLiveCommand(body, {
    approvalConsumer: createLiveAppleApprovalConsumer(),
    ledger: createSupabaseSingleUseLedger(),
    receiptVerifier: createLiveAppleReminderLedgerReceiptVerifier(),
  })

  return NextResponse.json(response)
}

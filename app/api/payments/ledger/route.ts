import { NextResponse } from 'next/server'
import { listDepositRecords } from '@/lib/payments/depositStore'
import { recordPaymentGuardFindings } from '@/lib/payments/paymentAudit'
import { runPaymentGuard } from '@/lib/payments/redSentinelPaymentGuard'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { requireCommanderSession } from '@/lib/security/commanderSession'

export const dynamic = 'force-dynamic'

function persistenceLabel(value: 'supabase' | 'session-only') {
  return value === 'supabase' ? 'Supabase persistent' : 'Session-only fallback'
}

export async function GET() {
  // Wave 1 repair, audit finding P1-3: this route had no auth check at all beyond the app-wide
  // "any authenticated user" middleware gate, despite exposing the full deposit ledger.
  const commander = await requireCommanderSession('Payment ledger')
  if (!commander.ok) return commander.response

  const listed = await listDepositRecords()
  const deposits = listed.data
  const guard = await runPaymentGuard(deposits)
  const sup = tryWarRoomSupabase()
  await recordPaymentGuardFindings(sup.ok ? sup.client : null, guard.findings)
  return NextResponse.json({
    tool: 'payment-ledger',
    status: 'complete',
    persistence: listed.persistence,
    persistenceLabel: persistenceLabel(listed.persistence),
    message: listed.message,
    ledger: deposits,
    redSentinel: guard,
  })
}

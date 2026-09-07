import { NextResponse } from 'next/server'
import { emitEvent } from '@/lib/events/bus'
import { recordDepositNotification } from '@/lib/payments/depositStore'
import { recordPaymentAudit } from '@/lib/payments/paymentAudit'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { requireCommanderSession } from '@/lib/security/commanderSession'

export const dynamic = 'force-dynamic'

function persistenceLabel(value: 'supabase' | 'session-only') {
  return value === 'supabase' ? 'Supabase persistent' : 'Session-only fallback'
}

export async function POST(req: Request) {
  // Wave 1 repair, audit finding P1-3: despite the webhook-sounding name, this route has no
  // signature/service-secret verification, so it was never a genuine external webhook — it only
  // relied on the app-wide "any authenticated user" gate. Narrowed to Commander-only, matching the
  // rest of the payments surface. If a real external webhook integration is ever added here, it
  // needs its own signature verification, not a relaxation of this check.
  const commander = await requireCommanderSession('Deposit notification')
  if (!commander.ok) return commander.response

  const sup = tryWarRoomSupabase()
  let depositId = ''
  try {
    const body = await req.json() as { depositId?: string }
    depositId = typeof body.depositId === 'string' ? body.depositId : ''
  } catch {
    return NextResponse.json({ tool: 'deposit-notifications', status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!depositId) {
    return NextResponse.json({ tool: 'deposit-notifications', status: 'error', message: 'depositId is required.' }, { status: 400 })
  }

  const queued = await recordDepositNotification(depositId, 'queued', 'Deposit notification queued for Ra’el.')
  if (!queued.data) {
    return NextResponse.json({ tool: 'deposit-notifications', status: 'error', message: 'Deposit not found.' }, { status: 404 })
  }
  const sentResult = await recordDepositNotification(depositId, 'sent', 'Ra’el notified.')
  const sent = sentResult.data ?? queued.data

  await emitEvent({
    supabase: sup.ok ? sup.client : null,
    type: 'income.deposit.notified',
    source: 'worker',
    correlationId: sent.depositId,
    payload: { depositId: sent.depositId, notificationStatus: sent.notificationStatus },
  })
  await recordPaymentAudit(sup.ok ? sup.client : null, 'Ra’el notified', { depositId: sent.depositId })

  return NextResponse.json({
    tool: 'deposit-notifications',
    status: 'sent',
    persistence: sentResult.persistence,
    persistenceLabel: persistenceLabel(sentResult.persistence),
    message: sentResult.message,
    deposit: sent,
  })
}

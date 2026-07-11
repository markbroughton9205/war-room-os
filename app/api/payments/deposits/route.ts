import { NextResponse } from 'next/server'
import { emitEvent } from '@/lib/events/bus'
import { createExpectedDepositRecord, getDepositRecord, listDepositRecords, updateDepositRecord } from '@/lib/payments/depositStore'
import { recordPaymentAudit, recordPaymentGuardFindings } from '@/lib/payments/paymentAudit'
import { runPaymentGuard } from '@/lib/payments/redSentinelPaymentGuard'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { assertActionRouteAuthorized } from '@/lib/security/actionRouteGuard'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'

export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function persistenceLabel(value: 'supabase' | 'session-only') {
  return value === 'supabase' ? 'Supabase persistent' : 'Session-only fallback'
}

export async function GET() {
  const listed = await listDepositRecords()
  const deposits = listed.data
  const guard = await runPaymentGuard(deposits)
  const sup = tryWarRoomSupabase()
  await recordPaymentGuardFindings(sup.ok ? sup.client : null, guard.findings)

  return NextResponse.json({
    tool: 'deposit-ledger',
    status: 'complete',
    persistence: listed.persistence,
    persistenceLabel: persistenceLabel(listed.persistence),
    message: listed.message,
    deposits,
    expected: deposits.filter(deposit => deposit.depositStatus === 'expected' || deposit.depositStatus === 'pending_proof'),
    confirmed: deposits.filter(deposit => deposit.depositStatus === 'confirmed' || deposit.depositStatus === 'notified'),
    proofNeeded: deposits.filter(deposit => deposit.proofRequired && deposit.proofStatus === 'required'),
    redSentinel: guard,
  })
}

export async function POST(req: Request) {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  const unauthorized = await assertActionRouteAuthorized(req)
  if (unauthorized) return unauthorized

  const sup = tryWarRoomSupabase()
  let body: Record<string, unknown>
  try {
    const raw = await req.json()
    body = isRecord(raw) ? raw : {}
  } catch {
    return NextResponse.json({ tool: 'deposit-ledger', status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }

  const created = await createExpectedDepositRecord({
    opportunityId: typeof body.opportunityId === 'string' ? body.opportunityId : null,
    incomeWorkerId: typeof body.incomeWorkerId === 'string' ? body.incomeWorkerId : null,
    platformProvider: typeof body.platformProvider === 'string' ? body.platformProvider : 'manual_proof',
    payerPlatformName: typeof body.payerPlatformName === 'string' ? body.payerPlatformName : 'Unknown platform',
    expectedAmount: typeof body.expectedAmount === 'string' || typeof body.expectedAmount === 'number' ? body.expectedAmount : null,
    currency: typeof body.currency === 'string' ? body.currency : 'USD',
    expectedDate: typeof body.expectedDate === 'string' ? body.expectedDate : null,
    proofRequired: body.proofRequired !== false,
  })
  const deposit = created.data

  await emitEvent({
    supabase: sup.ok ? sup.client : null,
    type: 'income.deposit.expected',
    source: 'worker',
    correlationId: deposit.depositId,
    payload: deposit as unknown as Record<string, unknown>,
  })
  await recordPaymentAudit(sup.ok ? sup.client : null, 'Deposit expected', { depositId: deposit.depositId, opportunityId: deposit.opportunityId })

  return NextResponse.json({
    tool: 'deposit-ledger',
    status: 'created',
    persistence: created.persistence,
    persistenceLabel: persistenceLabel(created.persistence),
    message: created.message,
    deposit,
  }, { status: 201 })
}

export async function PATCH(req: Request) {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  const unauthorized = await assertActionRouteAuthorized(req)
  if (unauthorized) return unauthorized

  const sup = tryWarRoomSupabase()
  let body: Record<string, unknown>
  try {
    const raw = await req.json()
    body = isRecord(raw) ? raw : {}
  } catch {
    return NextResponse.json({ tool: 'deposit-ledger', status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }

  const depositId = typeof body.depositId === 'string' ? body.depositId : ''
  const requestedStatus = typeof body.depositStatus === 'string' ? body.depositStatus : ''
  if (!depositId || requestedStatus !== 'confirmed') {
    return NextResponse.json({ tool: 'deposit-ledger', status: 'error', message: 'Only deposit confirmation updates are supported here.' }, { status: 400 })
  }

  const currentResult = await getDepositRecord(depositId)
  const current = currentResult.data
  if (!current) {
    return NextResponse.json({ tool: 'deposit-ledger', status: 'error', message: 'Deposit not found.' }, { status: 404 })
  }

  const manualConfirmation = body.manualRaelConfirmation === true
  if (current.proofRequired && current.proofStatus !== 'submitted' && current.proofStatus !== 'verified' && !manualConfirmation) {
    return NextResponse.json({
      tool: 'deposit-ledger',
      status: 'blocked',
      message: 'Deposit confirmation requires proof or manual Ra’el confirmation.',
      deposit: current,
      persistence: currentResult.persistence,
      persistenceLabel: persistenceLabel(currentResult.persistence),
    }, { status: 409 })
  }

  const listed = await listDepositRecords()
  const guard = await runPaymentGuard(listed.data)
  await recordPaymentGuardFindings(sup.ok ? sup.client : null, guard.findings)
  if (guard.blocksConfirmation) {
    await updateDepositRecord(depositId, { riskStatus: 'blocked' })
    return NextResponse.json({
      tool: 'deposit-ledger',
      status: 'blocked',
      message: 'Red Sentinel Payment Guard blocked confirmation pending review.',
      redSentinel: guard,
      persistence: listed.persistence,
      persistenceLabel: persistenceLabel(listed.persistence),
    }, { status: 409 })
  }

  const confirmedResult = await updateDepositRecord(depositId, {
    depositStatus: 'confirmed',
    confirmedAmount: typeof body.confirmedAmount === 'number' ? body.confirmedAmount : current.expectedAmount,
    confirmedDate: new Date().toISOString(),
    proofStatus: manualConfirmation && current.proofStatus !== 'verified' ? 'verified' : current.proofStatus,
  })
  const confirmed = confirmedResult.data

  if (!confirmed) {
    return NextResponse.json({ tool: 'deposit-ledger', status: 'error', message: 'Deposit not found.' }, { status: 404 })
  }

  await emitEvent({
    supabase: sup.ok ? sup.client : null,
    type: 'income.deposit.confirmed',
    source: 'worker',
    correlationId: confirmed.depositId,
    payload: confirmed as unknown as Record<string, unknown>,
  })
  await recordPaymentAudit(sup.ok ? sup.client : null, 'Deposit confirmed', { depositId: confirmed.depositId, opportunityId: confirmed.opportunityId })

  return NextResponse.json({
    tool: 'deposit-ledger',
    status: 'confirmed',
    persistence: confirmedResult.persistence,
    persistenceLabel: persistenceLabel(confirmedResult.persistence),
    message: confirmedResult.message,
    deposit: confirmed,
  })
}

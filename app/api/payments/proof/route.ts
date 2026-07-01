import { NextResponse } from 'next/server'
import { emitEvent } from '@/lib/events/bus'
import { submitDepositProofRecord } from '@/lib/payments/depositStore'
import { recordPaymentAudit } from '@/lib/payments/paymentAudit'
import { normalizeProofMetadata, proofMetadataHasSensitiveKeys } from '@/lib/payments/payoutProof'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { assertActionRouteAuthorized } from '@/lib/security/actionRouteGuard'

export const dynamic = 'force-dynamic'

function persistenceLabel(value: 'supabase' | 'session-only') {
  return value === 'supabase' ? 'Supabase persistent' : 'Session-only fallback'
}

export async function POST(req: Request) {
  const unauthorized = assertActionRouteAuthorized(req)
  if (unauthorized) return unauthorized

  const sup = tryWarRoomSupabase()
  let body: Record<string, unknown>
  try {
    const raw = await req.json()
    body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  } catch {
    return NextResponse.json({ tool: 'deposit-proof', status: 'error', message: 'Invalid JSON body.' }, { status: 400 })
  }

  const depositId = typeof body.depositId === 'string' ? body.depositId : ''
  if (!depositId) {
    return NextResponse.json({ tool: 'deposit-proof', status: 'error', message: 'depositId is required.' }, { status: 400 })
  }

  if (proofMetadataHasSensitiveKeys(body.proofMetadata)) {
    return NextResponse.json({
      tool: 'deposit-proof',
      status: 'blocked',
      message: 'Proof metadata cannot include bank credentials, card data, passwords, or identity secrets.',
    }, { status: 400 })
  }

  const updated = await submitDepositProofRecord(depositId, {
    proofUrl: typeof body.proofUrl === 'string' ? body.proofUrl : null,
    proofMetadata: normalizeProofMetadata(body.proofMetadata),
  })
  const deposit = updated.data

  if (!deposit) {
    return NextResponse.json({ tool: 'deposit-proof', status: 'error', message: 'Deposit not found.' }, { status: 404 })
  }

  await emitEvent({
    supabase: sup.ok ? sup.client : null,
    type: 'income.deposit.proof_submitted',
    source: 'worker',
    correlationId: deposit.depositId,
    payload: { depositId: deposit.depositId, proofStatus: deposit.proofStatus },
  })
  await recordPaymentAudit(sup.ok ? sup.client : null, 'Deposit proof submitted', { depositId: deposit.depositId })

  return NextResponse.json({
    tool: 'deposit-proof',
    status: 'proof_submitted',
    persistence: updated.persistence,
    persistenceLabel: persistenceLabel(updated.persistence),
    message: updated.message,
    deposit,
  })
}

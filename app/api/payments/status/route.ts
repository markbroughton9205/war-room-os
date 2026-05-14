import { NextResponse } from 'next/server'
import { getPaymentProviderReadiness } from '@/lib/payments/providers'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    tool: 'deposit-payout-notifications',
    status: 'ready',
    providers: getPaymentProviderReadiness(),
    protections: {
      noMovementActions: true,
      credentialsStored: false,
      proofRequiredForConfirmation: true,
      redSentinelGuard: true,
    },
  })
}

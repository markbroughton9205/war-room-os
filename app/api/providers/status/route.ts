import { NextResponse } from 'next/server'

import { getProviderRuntimeHealth } from '@/lib/providers/health'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('refresh') === '1'
  const status = await getProviderRuntimeHealth({ force })
  return NextResponse.json(status, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-provider-runtime': status.signalAvailability.liveSignalsAvailable ? 'signals-available' : 'signals-unavailable',
    },
  })
}

import { NextResponse } from 'next/server'

import { getRssIngestionRuntimeStatus } from '@/lib/signals/rss/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const status = await getRssIngestionRuntimeStatus()
    return NextResponse.json(status, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-rss-health': status.aggregateHealth,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'RSS runtime status failed.',
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}

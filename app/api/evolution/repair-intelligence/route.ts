import { NextResponse } from 'next/server'

import { collectRepairIntelligence } from '@/lib/evolution/repairIntelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const snapshot = await collectRepairIntelligence(req)
    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-evolution-readiness': String(snapshot.scores.overall),
        'x-war-room-db-mutation': 'false',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Repair intelligence aggregation failed.',
        generatedAt: new Date().toISOString(),
      },
      { status: 503, headers: { 'cache-control': 'no-store', 'x-war-room-db-mutation': 'false' } },
    )
  }
}

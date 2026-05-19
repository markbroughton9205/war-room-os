import { NextResponse } from 'next/server'

import { collectPriorityEngine } from '@/lib/priority-engine/collect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const snapshot = await collectPriorityEngine(req)
    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-priority': snapshot.highestLeverageAction ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Priority engine failed.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}

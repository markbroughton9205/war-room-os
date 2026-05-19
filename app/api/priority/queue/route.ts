import { NextResponse } from 'next/server'

import { collectPriorityEngine } from '@/lib/priority-engine/collect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const snapshot = await collectPriorityEngine(req)
  return NextResponse.json(
    {
      generatedAt: snapshot.generatedAt,
      highestLeverageAction: snapshot.highestLeverageAction,
      actions: snapshot.actionQueue,
      guardrails: snapshot.guardrails,
    },
    {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-priority-queue': snapshot.actionQueue.length ? 'available' : 'empty',
      },
    },
  )
}

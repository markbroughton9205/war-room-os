import { NextResponse } from 'next/server'

import { collectQueueSnapshot } from '@/lib/queues'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const snapshot = await collectQueueSnapshot(req, 'operator_priority_queue')
  return NextResponse.json(snapshot, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-operator-queue': snapshot.items.length ? 'available' : 'empty',
    },
  })
}

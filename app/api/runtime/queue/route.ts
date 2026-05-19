import { NextResponse } from 'next/server'

import { collectQueueSnapshot } from '@/lib/queues'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const snapshot = await collectQueueSnapshot(req, 'runtime_queue')
  return NextResponse.json(snapshot, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-runtime-queue': snapshot.items.length ? 'available' : 'empty',
    },
  })
}

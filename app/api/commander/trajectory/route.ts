import { NextResponse } from 'next/server'

import { listCommanderSnapshot } from '@/lib/commander'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await listCommanderSnapshot()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceAvailable: snapshot.persistenceAvailable,
    persistenceNote: snapshot.persistenceNote,
    metrics: snapshot.metrics,
    momentum: snapshot.momentum,
    lifePositioning: snapshot.lifePositioning,
    trajectory: snapshot.trajectory,
    reviews: snapshot.reviews,
    guardrails: snapshot.guardrails,
  }, {
    headers: {
      'x-war-room-commander-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
    },
  })
}

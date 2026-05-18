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
    highestLeverageMove: snapshot.highestLeverageMove,
    metrics: snapshot.metrics,
    patterns: snapshot.patterns,
    realityCorrectionAlerts: snapshot.realityCorrectionAlerts,
    integrations: snapshot.integrations,
    guardrails: snapshot.guardrails,
  }, {
    headers: {
      'x-war-room-commander-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
    },
  })
}

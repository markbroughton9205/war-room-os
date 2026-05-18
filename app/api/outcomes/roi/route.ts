import { NextResponse } from 'next/server'

import { listOutcomeSnapshot } from '@/lib/outcomes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await listOutcomeSnapshot()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceAvailable: snapshot.persistenceAvailable,
    persistenceNote: snapshot.persistenceNote,
    roiTrends: snapshot.roiTrends,
    highestLeverageCategories: snapshot.highestLeverageCategories,
    compoundingPatterns: snapshot.compoundingPatterns,
    failurePatterns: snapshot.failurePatterns,
    timeWastePatterns: snapshot.timeWastePatterns,
    realityCorrectionAlerts: snapshot.realityCorrectionAlerts,
    guardrails: snapshot.guardrails,
  }, {
    headers: {
      'x-war-room-outcomes-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
    },
  })
}

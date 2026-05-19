import { NextResponse } from 'next/server'

import { runSchemaSweep, sanitizePersistenceNote } from '@/lib/schema-sweep'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await runSchemaSweep()
  return NextResponse.json({
    generatedAt: snapshot.generatedAt,
    persistenceHealth: snapshot.persistenceHealth,
    persistenceNote: sanitizePersistenceNote(snapshot.persistenceNote),
    summary: snapshot.summary,
    affectedFeatures: snapshot.affectedFeatures,
    missingTables: snapshot.tables.filter(table => table.status === 'missing'),
    missingPolicies: snapshot.tables.filter(table => table.rlsStatus === 'missing' || table.policyStatus === 'missing'),
    migrationStatus: snapshot.migrations,
    repairPacketAvailable: snapshot.summary.repairPacketAvailable,
    repairPacket: snapshot.repairPacket,
    validationChecklist: snapshot.validationChecklist,
    connectedSurfaces: snapshot.connectedSurfaces,
    guardrails: snapshot.guardrails,
  }, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-schema-status': snapshot.persistenceHealth,
      'x-war-room-db-mutation': 'false',
    },
  })
}

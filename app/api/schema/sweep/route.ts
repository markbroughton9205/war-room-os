import { NextResponse } from 'next/server'

import { runSchemaSweepApi, sanitizeSchemaError } from '@/lib/schema-sweep'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function sweepResponse() {
  try {
    const result = await runSchemaSweepApi()
    return NextResponse.json({
      status: result.status,
      missingTables: result.missingTables,
      missingColumns: result.missingColumns,
      missingIndexes: result.missingIndexes,
      missingConstraints: result.missingConstraints,
      checkedAt: result.checkedAt,
      recommendedNextAction: result.recommendedNextAction,
      introspectionMode: result.introspectionMode,
      introspectionNote: result.introspectionNote,
      migrations: result.migrations,
      repairPacketAvailable: result.repairPacketAvailable,
    }, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-schema-sweep': result.status,
        'x-war-room-schema-repair': result.repairPacketAvailable ? 'advisory-only' : 'none',
        'x-war-room-db-mutation': 'false',
      },
    })
  } catch {
    return NextResponse.json({
      status: 'error',
      missingTables: [],
      missingColumns: [],
      missingIndexes: [],
      missingConstraints: [],
      checkedAt: new Date().toISOString(),
      recommendedNextAction: sanitizeSchemaError(null),
    }, {
      status: 500,
      headers: {
        'cache-control': 'no-store',
        'x-war-room-schema-sweep': 'error',
        'x-war-room-db-mutation': 'false',
      },
    })
  }
}

export async function GET() {
  return sweepResponse()
}

export async function POST() {
  return sweepResponse()
}

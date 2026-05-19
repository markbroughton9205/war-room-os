import { NextResponse } from 'next/server'

import { runSchemaSweep } from '@/lib/schema-sweep'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await runSchemaSweep()
  return NextResponse.json(snapshot, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-schema-sweep': snapshot.persistenceHealth,
      'x-war-room-schema-repair': snapshot.repairPacket.advisoryOnly ? 'advisory-only' : 'unknown',
    },
  })
}

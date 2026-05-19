import { NextResponse } from 'next/server'

import { listMissionSnapshot } from '@/lib/missions/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await listMissionSnapshot()
  return NextResponse.json(snapshot, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-mission-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
    },
  })
}

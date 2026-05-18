import { NextResponse } from 'next/server'

import { listPersistedSignalSnapshot } from '@/lib/signals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function limitFromUrl(req: Request): number {
  const value = new URL(req.url).searchParams.get('limit')
  const parsed = value ? Number(value) : 40
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.round(parsed))) : 40
}

export async function GET(req: Request) {
  const snapshot = await listPersistedSignalSnapshot(limitFromUrl(req))
  return NextResponse.json(snapshot, {
    headers: {
      'x-war-room-signal-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
    },
  })
}

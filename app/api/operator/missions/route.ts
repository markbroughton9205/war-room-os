import { NextResponse } from 'next/server'

import { collectOperatorDeck } from '@/lib/operator/deckPersistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const snapshot = await collectOperatorDeck(req)
  return NextResponse.json(
    {
      generatedAt: snapshot.generatedAt,
      missions: snapshot.missions,
      guardrails: snapshot.guardrails,
    },
    {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-operator-missions': snapshot.missions.length ? 'available' : 'unavailable',
      },
    },
  )
}

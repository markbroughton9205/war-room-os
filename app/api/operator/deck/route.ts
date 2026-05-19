import { NextResponse } from 'next/server'

import { collectOperatorDeck } from '@/lib/operator/deckPersistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const snapshot = await collectOperatorDeck(req)
    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-operator-deck': snapshot.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        persistenceAvailable: false,
        realtimeAvailable: false,
        stateLabel: 'UNAVAILABLE',
        actionQueue: [],
        financialTelemetry: [],
        missions: [],
        lastPacket: null,
        recentActivity: [],
        integrations: {
          liveCouncil: 'UNAVAILABLE',
          babyAiObserver: 'UNAVAILABLE',
          revenueEngine: 'UNAVAILABLE',
          signalRadar: 'UNAVAILABLE',
          growthCalendar: 'UNAVAILABLE',
          outcomeLedger: 'UNAVAILABLE',
          commanderOs: 'UNAVAILABLE',
          approvalQueue: 'UNAVAILABLE',
        },
        guardrails: {
          noFakeEarnings: true,
          noFakeBalances: true,
          noHiddenActions: true,
          noAutonomousSpending: true,
          noAutomaticEmailSending: true,
          commanderApprovalRequired: true,
        },
      },
      { status: 200, headers: { 'cache-control': 'no-store', 'x-war-room-operator-deck': 'unavailable' } },
    )
  }
}

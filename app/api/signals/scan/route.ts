import { NextResponse } from 'next/server'

import { runSignalScan } from '@/lib/signals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({
    error: 'Use POST to run an explicit bounded cloud-source signal scan.',
    approvalRequired: true,
    canExecuteExternalActions: false,
  }, { status: 405 })
}

export async function POST() {
  try {
    const snapshot = await runSignalScan()
    return NextResponse.json(snapshot, {
      headers: {
        'x-war-room-signal-persistence': snapshot.persistenceAvailable ? 'available' : 'unavailable',
        'x-war-room-signal-scan': snapshot.latestScan?.status ?? 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Signal scan failed.',
        approvalRequired: true,
        canExecuteExternalActions: false,
      },
      { status: 500 },
    )
  }
}

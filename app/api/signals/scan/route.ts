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
    const message = error instanceof Error ? error.message : 'Signal scan failed.'
    const migrationRequired = /schema cache|could not find table|relation .*war_room_signal_|war_room_signal_sources/i.test(message)
    return NextResponse.json(
      {
        error: migrationRequired
          ? 'MIGRATION_REQUIRED: Phase 14 signal tables are missing from Supabase schema cache. Apply supabase/war_room_phase14_signals.sql or the phase17 patch, then reload PostgREST schema.'
          : message,
        migrationStatus: migrationRequired ? 'MIGRATION_REQUIRED' : 'UNAVAILABLE',
        approvalRequired: true,
        canExecuteExternalActions: false,
      },
      { status: migrationRequired ? 503 : 500 },
    )
  }
}

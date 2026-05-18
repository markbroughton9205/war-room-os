import { NextResponse } from 'next/server'
import { collectRuntimeReliabilitySnapshot } from '@/lib/runtime/operationalReliability'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const persist = url.searchParams.get('persist') !== '0'
    const forceProviders = url.searchParams.get('refresh') === '1'
    const snapshot = await collectRuntimeReliabilitySnapshot(req, { persist, forceProviders })
    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-runtime-snapshots': snapshot.persistence.snapshotsPersisted ? 'persisted' : 'not-persisted',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Runtime snapshots failed',
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}

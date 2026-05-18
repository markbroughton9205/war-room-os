import { NextResponse } from 'next/server'

import { collectCanonicalRuntimeStatus } from '@/lib/runtime/canonicalStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const status = await collectCanonicalRuntimeStatus(req)
    return NextResponse.json(status, {
      headers: {
        'cache-control': 'no-store',
        'x-war-room-canonical-runtime': status.summary.health,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Canonical runtime status failed.',
        generatedAt: new Date().toISOString(),
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}

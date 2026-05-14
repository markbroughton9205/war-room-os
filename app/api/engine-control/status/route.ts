import { NextResponse } from 'next/server'

import { buildEngineControlStatusResponse, collectEngineStatuses } from '@/lib/engine-control/status'
import { buildToolRoutingSnapshotFromOrigin, requestOriginFromHeaders } from '@/lib/engine-control/tool-snapshot'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const origin = await requestOriginFromHeaders()
    const tools = await buildToolRoutingSnapshotFromOrigin(origin)
    const engines = await collectEngineStatuses(tools)
    return NextResponse.json(buildEngineControlStatusResponse(engines))
  } catch (error) {
    return NextResponse.json(
      {
        engines: [],
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'Engine status collection failed.',
      },
      { status: 500 },
    )
  }
}

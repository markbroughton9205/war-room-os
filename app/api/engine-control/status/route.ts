import { NextResponse } from 'next/server'

import { buildEngineControlStatusResponse, collectEngineStatuses } from '@/lib/engine-control/status'
import { buildToolRoutingSnapshotFromOrigin, requestOriginFromHeaders } from '@/lib/engine-control/tool-snapshot'
import type { EngineControlStatusResponse } from '@/lib/engine-control/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const origin = await requestOriginFromHeaders()
    const tools = await buildToolRoutingSnapshotFromOrigin(origin)
    const engines = await collectEngineStatuses(tools)
    return NextResponse.json(buildEngineControlStatusResponse(engines))
  } catch (error) {
    const timestamp = new Date().toISOString()
    const payload: EngineControlStatusResponse & { message: string } = {
      engines: [],
      configuredProviders: [],
      reachableProviders: [],
      functionalProviders: [],
      routingReadiness: 'unavailable',
      approvalRequired: true,
      timestamp,
      checkedAt: timestamp,
      degradedReason: error instanceof Error ? error.message : 'Engine status collection failed.',
      message: error instanceof Error ? error.message : 'Engine status collection failed.',
    }
    return NextResponse.json(
      payload,
      { status: 500 },
    )
  }
}

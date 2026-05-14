import { NextResponse } from 'next/server'

import { collectDeployStatus } from '@/lib/deploy/status'
import { summarizeEnvReadinessGroups } from '@/lib/deploy/envReadiness'
import type { DeployEngineSummary, DeployInternetSummary, DeployStatusResponse } from '@/lib/deploy/types'
import { collectEngineStatuses } from '@/lib/engine-control/status'
import type { EngineStatus } from '@/lib/engine-control/types'
import { buildToolRoutingSnapshotFromOrigin, requestOriginFromHeaders } from '@/lib/engine-control/tool-snapshot'
import { buildWarRoomInternetLayerStatus } from '@/lib/internet/warRoomInternetStatus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toEngineSummary(engines: EngineStatus[]): DeployEngineSummary[] {
  return engines.map(e => ({
    id: e.id,
    category: e.category,
    configured: e.configured,
    reachable: e.reachable,
    functional: e.functional,
  }))
}

function toInternetSummary(layer: Awaited<ReturnType<typeof buildWarRoomInternetLayerStatus>>): DeployInternetSummary {
  const { lastChecked, tavily, firecrawl, grok, gemini, fetch } = layer
  return { lastChecked, tavily, firecrawl, grok, gemini, fetch }
}

export async function GET() {
  try {
    const origin = await requestOriginFromHeaders()
    const tools = await buildToolRoutingSnapshotFromOrigin(origin)
    const [core, engines, internetLayer, groups] = await Promise.all([
      collectDeployStatus(),
      collectEngineStatuses(tools),
      buildWarRoomInternetLayerStatus(),
      Promise.resolve(summarizeEnvReadinessGroups()),
    ])

    const payload: DeployStatusResponse = {
      ...core,
      runtime: 'nodejs',
      engines: toEngineSummary(engines),
      internet: toInternetSummary(internetLayer),
      envReadiness: { source: 'process.env', groups },
    }

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Deploy status failed',
        checkedAt: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { executeResearch } from '@/lib/research-engine/core/execute'
import { getTerraLayerDefinition, TERRA_LAYER_CATALOG } from '@/lib/terra/layerCatalog'
import { projectTerraIntelligenceEvents } from '@/lib/terra/projectTerraIntelligenceEvent'
import { isPublicTerraLayer } from '@/lib/terra/publicLayers'
import { classifyTerraLayerLiveStatus, classifyTerraLayerRootCause } from '@/lib/terra/layerLiveStatus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Terra's generic multi-layer data route. Public Earth-observation layers do not require a
 * Commander session. Protected layers (OpenSky, credentialed AIS, Commander-private) still do.
 * 403 (wrong identity) still blocks.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ layerId: string }> }) {
  const { layerId } = await context.params
  const commander = await requireCommanderSession('Terra layer data')
  let requestedBy = 'terra-public-layer'
  if (commander.ok) {
    requestedBy = commander.userId
  } else if (commander.response.status === 403) {
    return commander.response
  } else if (!isPublicTerraLayer(layerId)) {
    return commander.response
  }
  const layer = getTerraLayerDefinition(layerId)
  if (!layer) {
    return NextResponse.json(
      { tool: 'terra-layers', status: 'error', liveStatus: 'UNAVAILABLE', rootCause: 'UNKNOWN', layerId, features: [], skippedCount: 0, fetchedAt: new Date().toISOString(), fromCache: false, error: { message: `Unknown Terra layer "${layerId}". Known layers: ${TERRA_LAYER_CATALOG.map(l => l.id).join(', ')}.` } },
      { status: 404 },
    )
  }

  const queryText = request.nextUrl.searchParams.get('q') ?? layer.defaultQueryText
  const startedAt = new Date().toISOString()
  const { summary } = await executeResearch({
    text: queryText,
    intent: null,
    providers: [layer.providerId],
    maxResults: 100,
    dateFrom: null,
    dateTo: null,
    requireCurrent: true,
    requestedBy,
    requestedAt: startedAt,
  })

  const providerResponse = summary.providerResponses.find(response => response.provider === layer.providerId) ?? null

  if (!providerResponse || !providerResponse.ok) {
    const error = providerResponse?.error ?? { provider: layer.providerId, category: 'unknown', message: `${layer.providerId} did not respond.`, httpStatus: null }
    const rootCause = classifyTerraLayerRootCause({
      httpStatus: error.httpStatus,
      category: error.category,
      message: error.message,
    })
    return NextResponse.json({
      tool: 'terra-layers',
      status: 'error',
      liveStatus: classifyTerraLayerLiveStatus({ feedState: 'error', rootCause }),
      rootCause,
      layerId: layer.id,
      features: [],
      skippedCount: 0,
      fetchedAt: summary.completedAt,
      fromCache: false,
      error,
    })
  }

  const { events, skippedCount } = await layer.normalize(providerResponse)
  const features = projectTerraIntelligenceEvents(events)
  const emptyHealthy = features.length === 0
  const rootCause = emptyHealthy ? 'EMPTY_HEALTHY_RESULT' : null
  const liveStatus = classifyTerraLayerLiveStatus({
    feedState: emptyHealthy ? 'empty' : 'live',
    fromCache: providerResponse.fromCache,
    rootCause,
    featureCount: features.length,
  })

  return NextResponse.json({
    tool: 'terra-layers',
    status: emptyHealthy ? 'empty' : 'success',
    liveStatus,
    rootCause,
    layerId: layer.id,
    features,
    skippedCount,
    fetchedAt: summary.completedAt,
    fromCache: providerResponse.fromCache,
    error: null,
  })
}

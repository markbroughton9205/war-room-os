import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { executeResearch } from '@/lib/research-engine/core/execute'
import { getTerraLayerDefinition, TERRA_LAYER_CATALOG } from '@/lib/terra/layerCatalog'
import { projectTerraIntelligenceEvents } from '@/lib/terra/projectTerraIntelligenceEvent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Terra's generic multi-layer data route (Phase 3) — replaces the Phase 1/2
 * app/api/terra/earthquakes/route.ts single-layer route. One route serves every entry in
 * TERRA_LAYER_CATALOG through the same code path: it calls executeResearch(), the exact same
 * Research Engine entry point every other caller (including app/api/research/search/route.ts)
 * uses, scoped to that layer's one providerId, then runs the layer's own `normalize` function.
 * Adding a new layer means adding one lib/terra/layerCatalog.ts entry — never a new route file,
 * never new per-provider branching here.
 *
 * `?q=` optionally overrides the layer's documented defaultQueryText (e.g. a different USGS water
 * site number, or a different OpenSky bounding box); omitted, the catalog's own default is used —
 * the same "fixed, documented default" convention usgs_earthquake_feed's adapter already
 * established, not a new pattern.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ layerId: string }> }) {
  const commander = await requireCommanderSession('Terra layer data')
  if (!commander.ok) return commander.response

  const { layerId } = await context.params
  const layer = getTerraLayerDefinition(layerId)
  if (!layer) {
    return NextResponse.json(
      { tool: 'terra-layers', status: 'error', layerId, features: [], skippedCount: 0, fetchedAt: new Date().toISOString(), fromCache: false, error: { message: `Unknown Terra layer "${layerId}". Known layers: ${TERRA_LAYER_CATALOG.map(l => l.id).join(', ')}.` } },
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
    requestedBy: commander.userId,
    requestedAt: startedAt,
  })

  const providerResponse = summary.providerResponses.find(response => response.provider === layer.providerId) ?? null

  if (!providerResponse || !providerResponse.ok) {
    return NextResponse.json({
      tool: 'terra-layers',
      status: 'error',
      layerId: layer.id,
      features: [],
      skippedCount: 0,
      fetchedAt: summary.completedAt,
      fromCache: false,
      error: providerResponse?.error ?? { provider: layer.providerId, category: 'unknown', message: `${layer.providerId} did not respond.`, httpStatus: null },
    })
  }

  const { events, skippedCount } = await layer.normalize(providerResponse)
  const features = projectTerraIntelligenceEvents(events)

  return NextResponse.json({
    tool: 'terra-layers',
    status: features.length === 0 ? 'empty' : 'success',
    layerId: layer.id,
    features,
    skippedCount,
    fetchedAt: summary.completedAt,
    fromCache: providerResponse.fromCache,
    error: null,
  })
}

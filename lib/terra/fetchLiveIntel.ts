import 'server-only'

import { executeResearch } from '@/lib/research-engine/core/execute'
import { providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { settlementStore } from '@/lib/settlement-intelligence/store'
import { getTerraLayerDefinition } from '@/lib/terra/layerCatalog'
import {
  composeTerraLiveIntel,
  listMaritimeLiveProviderStatuses,
  type TerraLiveFreshness,
  type TerraLiveIntelSnapshot,
  type TerraLiveLayerId,
  type TerraLiveProviderStatus,
} from '@/lib/terra/liveGeoIntelligence'
import type { TerraTimeWindow } from '@/lib/terra/types'
import type { TerraIntelligenceEvent } from '@/lib/terra/types'

const DIGITRAFFIC_EXAMPLE_BBOX = '59.0,24.0,60.5,26.0'

async function loadLayerEvents(layerId: string, queryText: string, requestedBy: string): Promise<{
  events: TerraIntelligenceEvent[]
  fromCache: boolean
  ok: boolean
  error: string | null
}> {
  const layer = getTerraLayerDefinition(layerId)
  if (!layer) return { events: [], fromCache: false, ok: false, error: `Unknown layer ${layerId}` }
  const startedAt = new Date().toISOString()
  try {
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
      return {
        events: [],
        fromCache: false,
        ok: false,
        error: providerResponse?.error?.message ?? `${layer.providerId} did not respond.`,
      }
    }
    const { events } = await layer.normalize(providerResponse)
    return { events, fromCache: providerResponse.fromCache, ok: true, error: null }
  } catch (error) {
    return { events: [], fromCache: false, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function implementedFreshness(id: string, fetchOk: boolean, fromCache: boolean, delayed: boolean): TerraLiveFreshness {
  const env = providerEnvDescriptor(id as 'digitraffic_marine')
  if (!env?.implemented) return 'NOT_CONFIGURED'
  if (!fetchOk && delayed) return 'DELAYED'
  if (!fetchOk) return 'UNAVAILABLE'
  if (fromCache) return 'CACHED'
  return 'LIVE'
}

export async function fetchTerraLiveIntel(opts: {
  requestedBy: string
  bbox?: string | null
  layers?: TerraLiveLayerId[]
  timeWindow?: TerraTimeWindow
  now?: string
}): Promise<TerraLiveIntelSnapshot> {
  const now = opts.now ?? new Date().toISOString()
  const layers = opts.layers?.length ? opts.layers : (['vessels', 'intelligence_events', 'settlement_events', 'other'] as TerraLiveLayerId[])
  const bbox = opts.bbox?.trim() || DIGITRAFFIC_EXAMPLE_BBOX

  const vesselPromise = layers.includes('vessels')
    ? loadLayerEvents('digitraffic_marine', bbox, opts.requestedBy)
    : Promise.resolve({ events: [], fromCache: false, ok: false, error: 'layer not requested' as string | null })
  const intelPromise = layers.includes('intelligence_events')
    ? loadLayerEvents('usgs_earthquake_feed', '', opts.requestedBy)
    : Promise.resolve({ events: [], fromCache: false, ok: false, error: 'layer not requested' as string | null })

  const [vessels, intel] = await Promise.all([vesselPromise, intelPromise])
  const events = [...vessels.events, ...intel.events]
  const settlements = layers.includes('settlement_events') ? settlementStore.list() : []

  const vesselFreshness = layers.includes('vessels')
    ? implementedFreshness('digitraffic_marine', vessels.ok, vessels.fromCache, false)
    : 'UNAVAILABLE'

  const providers: TerraLiveProviderStatus[] = listMaritimeLiveProviderStatuses({
    digitrafficObjectCount: vessels.events.length,
    digitrafficFreshness: vesselFreshness,
  })

  const intelEnv = providerEnvDescriptor('usgs_earthquake_feed')
  providers.push({
    id: 'usgs_earthquake_feed',
    displayName: intelEnv?.displayName ?? 'USGS Real-Time Earthquake Feeds',
    layer: 'intelligence_events',
    implemented: intelEnv?.implemented ?? true,
    configurationState: intelEnv?.implemented ? 'ENABLED' : 'NOT_CONFIGURED',
    freshness: layers.includes('intelligence_events')
      ? implementedFreshness('usgs_earthquake_feed', intel.ok, intel.fromCache, false)
      : 'UNAVAILABLE',
    reason: intel.error ?? 'USGS earthquake feed',
    objectCount: intel.events.length,
  })

  providers.push({
    id: 'settlement_intelligence',
    displayName: 'Settlement Intelligence',
    layer: 'settlement_events',
    implemented: true,
    configurationState: 'ENABLED',
    freshness: 'UNAVAILABLE',
    reason: 'Settlement records have no projectable coordinates; coordinates are never invented.',
    objectCount: 0,
  })

  return composeTerraLiveIntel({
    now,
    events,
    settlements,
    layers,
    timeWindow: opts.timeWindow ?? null,
    freshnessDefaults: {
      implemented: true,
      configuredForLive: true,
      fetchOk: true,
      delayedFeed: false,
      now,
    },
    providerStatuses: providers,
  })
}

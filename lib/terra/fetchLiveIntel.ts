import 'server-only'

import { executeResearch } from '@/lib/research-engine/core/execute'
import { isProviderEnvSatisfied, providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { settlementStore } from '@/lib/settlement-intelligence/store'
import { getTerraLayerDefinition } from '@/lib/terra/layerCatalog'
import {
  composeTerraLiveIntel,
  type TerraLiveFreshness,
  type TerraLiveIntelSnapshot,
  type TerraLiveLayerId,
  type TerraLiveProviderStatus,
} from '@/lib/terra/liveGeoIntelligence'
import {
  DIGITRAFFIC_MARINE_COVERAGE_BBOX,
  BARENTSWATCH_AIS_COVERAGE_BBOX,
  parseTerraMaritimeBboxQuery,
  rectanglesIntersect,
} from '@/lib/terra/maritimeBoundingBox'
import { listMaritimeLiveProviderStatuses as listMaritimeStatuses, type MaritimeRuntimeHint } from '@/lib/terra/maritimeProviderStatus'
import { ownSensorHasFreshFeed } from '@/lib/terra/maritimeOwnSensorStore'
import { normalizeDigitrafficMarineVessels } from '@/lib/terra/normalizeDigitrafficMarineVessels'
import type { TerraTimeWindow } from '@/lib/terra/types'
import type { TerraIntelligenceEvent } from '@/lib/terra/types'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'

const DIGITRAFFIC_EXAMPLE_BBOX = '59.0,24.0,60.5,26.0'

async function loadProviderEvents(providerId: ResearchProviderId, queryText: string, requestedBy: string): Promise<{
  events: TerraIntelligenceEvent[]
  fromCache: boolean
  ok: boolean
  notConfigured: boolean
  error: string | null
  historical: boolean
}> {
  const startedAt = new Date().toISOString()
  try {
    const { summary } = await executeResearch({
      text: queryText,
      intent: null,
      providers: [providerId],
      maxResults: 100,
      dateFrom: null,
      dateTo: null,
      requireCurrent: providerId !== 'noaa_access_ais',
      requestedBy,
      requestedAt: startedAt,
    })
    const providerResponse = summary.providerResponses.find(response => response.provider === providerId) ?? null
    if (!providerResponse) {
      const rejected = summary.route.rejectedProviders.find(row => row.provider === providerId)
      const notConfigured = Boolean(rejected?.reason.includes('not configured') || rejected?.reason.includes('environment'))
      return { events: [], fromCache: false, ok: false, notConfigured, error: rejected?.reason ?? `${providerId} did not respond.`, historical: false }
    }
    if (!providerResponse.ok) {
      const notConfigured = providerResponse.error?.category === 'not_configured'
      return { events: [], fromCache: false, ok: false, notConfigured, error: providerResponse.error?.message ?? `${providerId} did not respond.`, historical: false }
    }
    if (providerId === 'noaa_access_ais') {
      return { events: [], fromCache: providerResponse.fromCache, ok: true, notConfigured: false, error: null, historical: true }
    }
    const layer = getTerraLayerDefinition(providerId) ?? getTerraLayerDefinition('digitraffic_marine')
    const { events } = providerId === 'usgs_earthquake_feed' && layer
      ? await layer.normalize(providerResponse)
      : normalizeDigitrafficMarineVessels(providerResponse.documents)
    return { events, fromCache: providerResponse.fromCache, ok: true, notConfigured: false, error: null, historical: events.some(event => event.provenance.isHistorical) }
  } catch (error) {
    return { events: [], fromCache: false, ok: false, notConfigured: false, error: error instanceof Error ? error.message : String(error), historical: false }
  }
}

function freshnessFromFetch(result: { ok: boolean; fromCache: boolean; notConfigured: boolean; events: TerraIntelligenceEvent[]; historical: boolean }, fallback: TerraLiveFreshness): TerraLiveFreshness {
  if (result.notConfigured) return fallback
  if (!result.ok) return 'UNAVAILABLE'
  if (result.historical) return 'HISTORICAL'
  if (result.events.length === 0) return 'EMPTY'
  if (result.fromCache) return 'CACHED'
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
  const view = parseTerraMaritimeBboxQuery(bbox)

  const digitrafficCovered = Boolean(view && rectanglesIntersect(view, DIGITRAFFIC_MARINE_COVERAGE_BBOX))
  const barentsCovered = Boolean(view && rectanglesIntersect(view, BARENTSWATCH_AIS_COVERAGE_BBOX))
  const barentsEnv = providerEnvDescriptor('barentswatch_ais')
  const aisstreamEnv = providerEnvDescriptor('aisstream')
  const aishubEnv = providerEnvDescriptor('aishub_marine')
  const barentsReady = Boolean(barentsEnv && isProviderEnvSatisfied(barentsEnv))
  const aisstreamReady = Boolean(aisstreamEnv && isProviderEnvSatisfied(aisstreamEnv))
  const aishubReady = Boolean(aishubEnv && isProviderEnvSatisfied(aishubEnv))
  const sensorPresent = ownSensorHasFreshFeed()

  const vesselPromise = layers.includes('vessels') && digitrafficCovered
    ? loadProviderEvents('digitraffic_marine', bbox, opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: false, error: null as string | null, historical: false, skipped: true })
  const barentsPromise = layers.includes('vessels') && barentsReady && barentsCovered
    ? loadProviderEvents('barentswatch_ais', bbox, opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !barentsReady, error: null as string | null, historical: false, skipped: true })
  const aisstreamPromise = layers.includes('vessels') && aisstreamReady && Boolean(view)
    ? loadProviderEvents('aisstream', bbox, opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !aisstreamReady, error: null as string | null, historical: false, skipped: true })
  const aishubPromise = layers.includes('vessels') && aishubReady && Boolean(view)
    ? loadProviderEvents('aishub_marine', bbox, opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !aishubReady, error: null as string | null, historical: false, skipped: true })
  const sensorPromise = layers.includes('vessels') && sensorPresent && Boolean(view)
    ? loadProviderEvents('ais_catcher_own_sensor', bbox, opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !sensorPresent, error: null as string | null, historical: false, skipped: true })
  const intelPromise = layers.includes('intelligence_events')
    ? loadProviderEvents('usgs_earthquake_feed', '', opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: false, notConfigured: false, error: 'layer not requested' as string | null, historical: false })

  const [vessels, barents, aisstream, aishub, sensor, intel] = await Promise.all([vesselPromise, barentsPromise, aisstreamPromise, aishubPromise, sensorPromise, intelPromise])
  const events = [...vessels.events, ...barents.events, ...aisstream.events, ...aishub.events, ...sensor.events, ...intel.events]
  const settlements = layers.includes('settlement_events') ? settlementStore.list() : []

  let digitrafficFreshness: TerraLiveFreshness = 'READY'
  if (!layers.includes('vessels')) digitrafficFreshness = 'DISABLED'
  else if (!digitrafficCovered) digitrafficFreshness = 'NO_COVERAGE'
  else digitrafficFreshness = freshnessFromFetch(vessels, 'UNAVAILABLE')

  const runtime: Record<string, MaritimeRuntimeHint> = {
    digitraffic_marine: { objectCount: vessels.events.length, fetchFreshness: digitrafficFreshness },
    barentswatch_ais: {
      objectCount: barents.events.length,
      credentialsPresent: barentsReady,
      fetchFreshness: !barentsReady ? 'NEEDS_CREDENTIALS' : !barentsCovered ? 'NO_COVERAGE' : freshnessFromFetch(barents, 'NEEDS_CREDENTIALS'),
    },
    aisstream: {
      objectCount: aisstream.events.length,
      credentialsPresent: aisstreamReady,
      fetchFreshness: !aisstreamReady ? 'NEEDS_CREDENTIALS' : freshnessFromFetch(aisstream, 'NEEDS_CREDENTIALS'),
    },
    aishub_marine: {
      objectCount: aishub.events.length,
      credentialsPresent: aishubReady,
      fetchFreshness: !aishubReady ? 'NEEDS_CREDENTIALS' : freshnessFromFetch(aishub, 'NEEDS_CREDENTIALS'),
    },
    noaa_access_ais: { fetchFreshness: 'HISTORICAL', objectCount: 0 },
    ais_catcher_own_sensor: {
      objectCount: sensor.events.length,
      sensorPresent,
      fetchFreshness: sensorPresent ? freshnessFromFetch(sensor, 'NEEDS_LOCAL_SENSOR') : 'NEEDS_LOCAL_SENSOR',
    },
    commercial_satellite_ais: { fetchFreshness: 'NEEDS_COMMERCIAL_ACCOUNT' },
  }

  const providers: TerraLiveProviderStatus[] = listMaritimeStatuses(runtime)

  const intelEnv = providerEnvDescriptor('usgs_earthquake_feed')
  providers.push({
    id: 'usgs_earthquake_feed',
    displayName: intelEnv?.displayName ?? 'USGS Real-Time Earthquake Feeds',
    layer: 'intelligence_events',
    implemented: intelEnv?.implemented ?? true,
    configurationState: intelEnv?.implemented ? 'ENABLED' : 'NOT_IMPLEMENTED',
    freshness: layers.includes('intelligence_events')
      ? freshnessFromFetch(intel, 'UNAVAILABLE')
      : 'DISABLED',
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

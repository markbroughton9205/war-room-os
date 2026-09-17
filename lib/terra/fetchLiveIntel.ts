import 'server-only'

import { executeResearch } from '@/lib/research-engine/core/execute'
import { isProviderEnvSatisfied, providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { CACHE_TTL, withCache } from '@/lib/research-engine/cache/ttlCache'
import { settlementStore } from '@/lib/settlement-intelligence/store'
import { fetchTrustedPublicNewsFeeds } from '@/lib/research/publicRssFeeds'
import { getTerraLayerDefinition } from '@/lib/terra/layerCatalog'
import {
  composeTerraLiveIntel,
  type TerraLiveFreshness,
  type TerraLiveIntelSnapshot,
  type TerraLiveLayerId,
  type TerraLiveProviderStatus,
} from '@/lib/terra/liveGeoIntelligence'
import { composeLiveIntelPanel, type TerraLiveIntelNewsSeed } from '@/lib/terra/liveIntelPanelModel'
import { validateYoutubeVideoId } from '@/lib/terra/liveIntelMedia'
import { loadVerifiedVideoNewsSeeds } from '@/lib/terra/fetchVerifiedVideoIntel'
import { youtubeApiKeyIsConfigured } from '@/lib/terra/youtubeDataApi'
import { loadTerraLocalIntel } from '@/lib/terra/localSources'
import { summarizeLocalRuntimeHealth } from '@/lib/terra/localSources/match'
import { classifyVerifiedVideoSeeds, localContextFromTerraLocation } from '@/lib/terra/localVideoClassification'
import {
  DIGITRAFFIC_MARINE_COVERAGE_BBOX,
  BARENTSWATCH_AIS_COVERAGE_BBOX,
  parseTerraMaritimeBboxQuery,
  rectanglesIntersect,
} from '@/lib/terra/maritimeBoundingBox'
import { listMaritimeLiveProviderStatuses as listMaritimeStatuses, type MaritimeRuntimeHint } from '@/lib/terra/maritimeProviderStatus'
import { ownSensorHasFreshFeed } from '@/lib/terra/maritimeOwnSensorStore'
import { normalizeDigitrafficMarineVessels } from '@/lib/terra/normalizeDigitrafficMarineVessels'
import { TERRA_EVENT_INTELLIGENCE_PROVIDERS } from '@/lib/terra/relatedIntelligence'
import type { TerraTimeWindow } from '@/lib/terra/types'
import type { TerraIntelligenceEvent } from '@/lib/terra/types'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import { nasaFirmsLiveProviderStatus } from '@/lib/terra/nasaFirmsStatus'

const EARTH_INTEL_LAYERS: { layerId: string; query: string }[] = [
  { layerId: 'usgs_earthquake_feed', query: '' },
  { layerId: 'nhc_current_storms', query: '' },
  { layerId: 'nasa_eonet_wildfires', query: 'wildfires' },
  { layerId: 'nasa_eonet_volcanoes', query: 'volcanoes' },
  { layerId: 'nasa_eonet_floods', query: 'floods' },
  { layerId: 'nws_severe_weather_alerts', query: 'alerts severe' },
  { layerId: 'tsunami_gov', query: '' },
]

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
      maxResults: 40,
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

async function loadCatalogLayer(layerId: string, queryText: string, requestedBy: string): Promise<{
  events: TerraIntelligenceEvent[]
  fromCache: boolean
  ok: boolean
  notConfigured: boolean
  error: string | null
  historical: boolean
  providerId: ResearchProviderId | null
  displayName: string
  layerId: string
}> {
  const layer = getTerraLayerDefinition(layerId)
  if (!layer) {
    return { events: [], fromCache: false, ok: false, notConfigured: false, error: `Unknown Terra layer ${layerId}`, historical: false, providerId: null, displayName: layerId, layerId }
  }
  const startedAt = new Date().toISOString()
  try {
    const { summary } = await executeResearch({
      text: queryText || layer.defaultQueryText,
      intent: null,
      providers: [layer.providerId],
      maxResults: 40,
      dateFrom: null,
      dateTo: null,
      requireCurrent: true,
      requestedBy,
      requestedAt: startedAt,
    })
    const providerResponse = summary.providerResponses.find(response => response.provider === layer.providerId) ?? null
    if (!providerResponse) {
      const rejected = summary.route.rejectedProviders.find(row => row.provider === layer.providerId)
      const notConfigured = Boolean(rejected?.reason.includes('not configured') || rejected?.reason.includes('environment'))
      return { events: [], fromCache: false, ok: false, notConfigured, error: rejected?.reason ?? `${layer.providerId} did not respond.`, historical: false, providerId: layer.providerId, displayName: layer.label, layerId }
    }
    if (!providerResponse.ok) {
      const notConfigured = providerResponse.error?.category === 'not_configured'
      return { events: [], fromCache: false, ok: false, notConfigured, error: providerResponse.error?.message ?? `${layer.providerId} did not respond.`, historical: false, providerId: layer.providerId, displayName: layer.label, layerId }
    }
    const { events } = await layer.normalize(providerResponse)
    return {
      events,
      fromCache: providerResponse.fromCache,
      ok: true,
      notConfigured: false,
      error: null,
      historical: events.some(event => event.provenance.isHistorical),
      providerId: layer.providerId,
      displayName: layer.label,
      layerId,
    }
  } catch (error) {
    return { events: [], fromCache: false, ok: false, notConfigured: false, error: error instanceof Error ? error.message : String(error), historical: false, providerId: layer.providerId, displayName: layer.label, layerId }
  }
}

function freshnessFromFetch(result: { ok: boolean; fromCache: boolean; notConfigured: boolean; events: TerraIntelligenceEvent[]; historical: boolean; error?: string | null }, fallback: TerraLiveFreshness): TerraLiveFreshness {
  if (result.notConfigured) return fallback
  if (!result.ok) {
    if (/429|rate limit/i.test(result.error ?? '')) return 'RATE_LIMITED'
    if (/token request failed|unauthorized|401|403/i.test(result.error ?? '')) return 'AUTH_FAILED'
    return 'UNAVAILABLE'
  }
  if (result.historical) return 'HISTORICAL'
  if (result.fromCache) return 'CACHED'
  if (result.events.length === 0) return 'LIVE'
  return 'LIVE'
}

function mergeLocalMix(
  mix: { key: string; label: string; count: number }[],
  videoSeeds: TerraLiveIntelNewsSeed[],
): { key: string; label: string; count: number }[] {
  if (!videoSeeds.length) return mix
  const rows = mix.map(row => ({ ...row }))
  const tv = rows.find(row => row.key === 'TV')
  if (tv) tv.count += videoSeeds.length
  else rows.push({ key: 'TV', label: 'TV', count: videoSeeds.length })
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

async function loadNewsSeeds(opts: {
  requestedBy: string
  allowCredentialedProviders: boolean
  place?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  zoom?: string | null
  lat?: number | null
  lon?: number | null
}): Promise<{
  seeds: TerraLiveIntelNewsSeed[]
  localVideoSeeds: TerraLiveIntelNewsSeed[]
  coverage: 'LIVE' | 'CACHED' | 'PARTIAL' | 'AUTH_REQUIRED' | 'UNAVAILABLE' | 'NO_COVERAGE'
  reason: string
  conflictCoverage: 'LIVE' | 'CACHED' | 'PARTIAL' | 'AUTH_REQUIRED' | 'UNAVAILABLE' | 'NO_COVERAGE'
  conflictReason: string
  providers: TerraLiveProviderStatus[]
}> {
  const providers: TerraLiveProviderStatus[] = []
  const [rss, video] = await Promise.all([
    withCache('terra-live-intel:public-rss', CACHE_TTL.webSearch, () => fetchTrustedPublicNewsFeeds({
      categories: ['world', 'news', 'science'],
      maxCombinedResults: 24,
    })),
    loadVerifiedVideoNewsSeeds(),
  ])
  const rssValue = rss.value
  providers.push({
    id: 'public_rss',
    displayName: 'Trusted public news RSS',
    layer: 'intelligence_events',
    implemented: true,
    configurationState: 'ENABLED',
    freshness: rssValue.ok ? (rss.fromCache ? 'CACHED' : 'LIVE') : 'UNAVAILABLE',
    reason: rssValue.ok ? 'Credential-free BBC/Al Jazeera/DW/regional RSS fallback.' : (rssValue.error ?? 'Public RSS returned no items.'),
    objectCount: rssValue.results.length,
  })

  const seeds: TerraLiveIntelNewsSeed[] = rssValue.results.map(item => ({
    id: `rss:${item.url}`,
    title: item.title,
    summary: item.snippet || null,
    url: item.url,
    sourceName: item.source,
    provider: 'public_rss',
    publishedAt: item.publishedAt ?? null,
    retrievedAt: item.retrievedAt,
    fromCache: rss.fromCache,
    contentType: 'web_page',
    geography: null,
    reliability: item.reliability,
    feedName: item.source,
    categories: item.categories,
    declaredLanguage: item.language ?? null,
  }))
  const videoContext = localContextFromTerraLocation({
    latitude: opts.lat,
    longitude: opts.lon,
    place: opts.place,
    city: opts.city,
    county: opts.county,
    state: opts.state,
    country: opts.country,
    countryCode: opts.countryCode,
  })
  const classifiedVideo = classifyVerifiedVideoSeeds(video.seeds, videoContext)
  seeds.push(...classifiedVideo.globalSeeds)
  for (const row of video.providers) {
    providers.push({
      id: row.id,
      displayName: row.displayName,
      layer: 'intelligence_events',
      implemented: true,
      configurationState: 'ENABLED',
      freshness: row.freshness,
      reason: row.reason,
      objectCount: row.objectCount,
      transport: row.transport ?? undefined,
      credentialsPresent: youtubeApiKeyIsConfigured(),
    })
  }

  const localPlaceHint = [opts.city, opts.county, opts.state, opts.place].filter(value => value?.trim()).join(' ') || null

  const exaEnv = providerEnvDescriptor('exa')
  const reliefEnv = providerEnvDescriptor('reliefweb')
  const exaReady = Boolean(exaEnv && isProviderEnvSatisfied(exaEnv))
  const reliefReady = Boolean(reliefEnv && isProviderEnvSatisfied(reliefEnv))
  const researchProviders = TERRA_EVENT_INTELLIGENCE_PROVIDERS.filter(id => {
    if (id === 'exa') return opts.allowCredentialedProviders && exaReady
    if (id === 'reliefweb') return reliefReady
    return false
  })

  if (!opts.allowCredentialedProviders && exaReady) {
    providers.push({
      id: 'exa',
      displayName: exaEnv?.displayName ?? 'Exa',
      layer: 'intelligence_events',
      implemented: true,
      configurationState: 'ENABLED',
      freshness: 'AUTH_REQUIRED',
      reason: 'Exa requires an authenticated Commander session (EXA_API_KEY is not used without a session).',
      objectCount: 0,
      credentialsPresent: true,
    })
  } else if (!exaReady) {
    providers.push({
      id: 'exa',
      displayName: exaEnv?.displayName ?? 'Exa',
      layer: 'intelligence_events',
      implemented: Boolean(exaEnv?.implemented),
      configurationState: 'CREDENTIAL_REQUIRED',
      freshness: 'NEEDS_CREDENTIALS',
      reason: 'EXA_API_KEY is not configured.',
      objectCount: 0,
      credentialsPresent: false,
    })
  }

  if (researchProviders.length) {
    const queryText = localPlaceHint
      ? `current world headlines humanitarian conflict reports ${localPlaceHint}`
      : 'current world headlines humanitarian conflict reports'
    const startedAt = new Date().toISOString()
    try {
      const { summary, documents } = await executeResearch({
        text: queryText,
        intent: null,
        providers: researchProviders,
        maxResults: 12,
        dateFrom: null,
        dateTo: null,
        requireCurrent: true,
        requestedBy: opts.requestedBy,
        requestedAt: startedAt,
      })
      for (const response of summary.providerResponses) {
        providers.push({
          id: response.provider,
          displayName: providerEnvDescriptor(response.provider)?.displayName ?? response.provider,
          layer: 'intelligence_events',
          implemented: true,
          configurationState: response.error?.category === 'not_configured' ? 'CREDENTIAL_REQUIRED' : 'ENABLED',
          freshness: !response.ok
            ? (response.error?.category === 'not_configured' ? 'NEEDS_CREDENTIALS' : /401|403|unauthorized/i.test(response.error?.message ?? '') ? 'AUTH_FAILED' : 'UNAVAILABLE')
            : response.documents.length === 0
              ? 'EMPTY'
              : response.fromCache ? 'CACHED' : 'LIVE',
          reason: response.error?.message ?? `${response.provider} event intelligence`,
          objectCount: response.documents.length,
          credentialsPresent: response.provider === 'exa' ? exaReady : undefined,
        })
      }
      for (const rejected of summary.route.rejectedProviders) {
        if (providers.some(row => row.id === rejected.provider)) continue
        providers.push({
          id: rejected.provider,
          displayName: providerEnvDescriptor(rejected.provider)?.displayName ?? rejected.provider,
          layer: 'intelligence_events',
          implemented: true,
          configurationState: 'CREDENTIAL_REQUIRED',
          freshness: 'NEEDS_CREDENTIALS',
          reason: rejected.reason,
          objectCount: 0,
        })
      }
      for (const document of documents) {
        seeds.push({
          id: document.id,
          title: document.title,
          summary: document.contentSnippet ?? document.summary,
          url: document.canonicalUrl ?? document.sourceUrl,
          sourceName: document.sourceName,
          provider: document.provider,
          publishedAt: document.publishedAt,
          retrievedAt: document.retrievedAt,
          fromCache: false,
          contentType: document.contentType,
          geography: typeof document.geography === 'string' ? document.geography : null,
          reliability: document.provider === 'reliefweb' ? 'HIGH' : 'MEDIUM',
          feedName: document.sourceName,
        declaredLanguage: document.language ?? null,
        youtubeVideoId: validateYoutubeVideoId(
          document.identifiers?.youtubeVideoId
          ?? document.identifiers?.youtube_id
          ?? document.identifiers?.youtubeId
          ?? null,
        ),
      })
      }
    } catch (error) {
      providers.push({
        id: 'terra-event-intelligence',
        displayName: 'Terra event intelligence',
        layer: 'intelligence_events',
        implemented: true,
        configurationState: 'ENABLED',
        freshness: 'UNAVAILABLE',
        reason: error instanceof Error ? error.message : String(error),
        objectCount: 0,
      })
    }
  } else if (!reliefReady) {
    providers.push({
      id: 'reliefweb',
      displayName: reliefEnv?.displayName ?? 'ReliefWeb API v2',
      layer: 'intelligence_events',
      implemented: true,
      configurationState: 'CREDENTIAL_REQUIRED',
      freshness: 'NEEDS_CREDENTIALS',
      reason: 'RELIEFWEB_APPNAME is not configured. Conflict reporting stays unavailable rather than invented.',
      objectCount: 0,
      credentialsPresent: false,
    })
  }

  const rssOk = rssValue.ok
  const researchOk = providers.some(row => (row.id === 'exa' || row.id === 'reliefweb') && (row.freshness === 'LIVE' || row.freshness === 'CACHED'))
  const localProvider = providers.find(row => row.id === 'google_news_local')
  const localFailed = Boolean(localProvider && localProvider.freshness === 'UNAVAILABLE')
  const coverage = localFailed && (rssOk || researchOk)
    ? 'PARTIAL'
    : rssOk && researchOk ? 'PARTIAL' : rssOk || researchOk ? (rss.fromCache ? 'CACHED' : 'LIVE') : 'UNAVAILABLE'
  const conflictProvider = providers.find(row => row.id === 'reliefweb')
  const conflictCoverage = conflictProvider
    ? (conflictProvider.freshness === 'LIVE' || conflictProvider.freshness === 'CACHED' ? conflictProvider.freshness : conflictProvider.freshness === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : conflictProvider.freshness === 'EMPTY' ? 'NO_COVERAGE' : 'UNAVAILABLE')
    : 'NO_COVERAGE'
  return {
    seeds,
    localVideoSeeds: classifiedVideo.localSeeds,
    coverage,
    reason: rssOk ? 'Public RSS plus any configured Exa/ReliefWeb adapters.' : (rssValue.error ?? 'Headline sources unavailable.'),
    conflictCoverage,
    conflictReason: conflictProvider?.reason ?? 'No wired conflict-zone or ACLED/UCDP dataset. ReliefWeb humanitarian reports are the only conflict-capable adapter.',
    providers,
  }
}

export async function fetchTerraLiveIntel(opts: {
  requestedBy: string
  bbox?: string | null
  layers?: TerraLiveLayerId[]
  timeWindow?: TerraTimeWindow
  now?: string
  lat?: number | null
  lon?: number | null
  place?: string | null
  nativePlaceName?: string | null
  englishPlaceName?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  reverseSublocalityLabel?: string | null
  zoom?: string | null
  allowCredentialedProviders?: boolean
  authState?: 'AUTHENTICATED' | 'AUTH_REQUIRED'
  includeNews?: boolean
}): Promise<TerraLiveIntelSnapshot> {
  const now = opts.now ?? new Date().toISOString()
  const layers = opts.layers?.length ? opts.layers : (['vessels', 'intelligence_events', 'settlement_events', 'other'] as TerraLiveLayerId[])
  const bbox = opts.bbox?.trim() || null
  const view = bbox ? parseTerraMaritimeBboxQuery(bbox) : null
  const allowCredentialed = opts.allowCredentialedProviders !== false
  const nwsQuery = typeof opts.lat === 'number' && typeof opts.lon === 'number'
    ? `alerts severe near ${opts.lat},${opts.lon}`
    : 'alerts severe'

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
    ? loadProviderEvents('digitraffic_marine', bbox ?? '', opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: false, error: null as string | null, historical: false, skipped: true })
  const barentsPromise = layers.includes('vessels') && allowCredentialed && barentsReady && barentsCovered
    ? loadProviderEvents('barentswatch_ais', bbox ?? '', opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !barentsReady, error: null as string | null, historical: false, skipped: true })
  const aisstreamPromise = layers.includes('vessels') && allowCredentialed && aisstreamReady && Boolean(view)
    ? loadProviderEvents('aisstream', bbox ?? '', opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !aisstreamReady, error: null as string | null, historical: false, skipped: true })
  const aishubPromise = layers.includes('vessels') && allowCredentialed && aishubReady && Boolean(view)
    ? loadProviderEvents('aishub_marine', bbox ?? '', opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !aishubReady, error: null as string | null, historical: false, skipped: true })
  const sensorPromise = layers.includes('vessels') && sensorPresent && Boolean(view)
    ? loadProviderEvents('ais_catcher_own_sensor', bbox ?? '', opts.requestedBy)
    : Promise.resolve({ events: [] as TerraIntelligenceEvent[], fromCache: false, ok: true, notConfigured: !sensorPresent, error: null as string | null, historical: false, skipped: true })

  const earthPromise = layers.includes('intelligence_events')
    ? Promise.all(EARTH_INTEL_LAYERS.map(entry => loadCatalogLayer(
      entry.layerId,
      entry.layerId === 'nws_severe_weather_alerts' ? nwsQuery : entry.query,
      opts.requestedBy,
    )))
    : Promise.resolve([])

  const newsPromise = opts.includeNews === false
    ? Promise.resolve(null)
    : loadNewsSeeds({
      requestedBy: opts.requestedBy,
      allowCredentialedProviders: allowCredentialed,
      place: opts.place,
      city: opts.city,
      county: opts.county,
      state: opts.state,
      country: opts.country,
      countryCode: opts.countryCode,
      zoom: opts.zoom,
      lat: opts.lat,
      lon: opts.lon,
    })

  const [vessels, barents, aisstream, aishub, sensor, earthLayers, news] = await Promise.all([
    vesselPromise,
    barentsPromise,
    aisstreamPromise,
    aishubPromise,
    sensorPromise,
    earthPromise,
    newsPromise,
  ])

  const intelEvents = earthLayers.flatMap(layer => layer.events)
  const events = [...vessels.events, ...barents.events, ...aisstream.events, ...aishub.events, ...sensor.events, ...intelEvents]
  const settlements = layers.includes('settlement_events') ? settlementStore.list() : []

  let digitrafficFreshness: TerraLiveFreshness = 'READY'
  if (!layers.includes('vessels')) digitrafficFreshness = 'DISABLED'
  else if (!view) digitrafficFreshness = 'NO_COVERAGE'
  else if (!digitrafficCovered) digitrafficFreshness = 'NO_COVERAGE'
  else digitrafficFreshness = freshnessFromFetch(vessels, 'UNAVAILABLE')

  const runtime: Record<string, MaritimeRuntimeHint> = {
    digitraffic_marine: { objectCount: vessels.events.length, fetchFreshness: digitrafficFreshness },
    barentswatch_ais: {
      objectCount: barents.events.length,
      credentialsPresent: barentsReady,
      fetchFreshness: !allowCredentialed && barentsReady
        ? 'AUTH_REQUIRED'
        : !barentsReady ? 'NEEDS_CREDENTIALS' : !barentsCovered || !view ? 'NO_COVERAGE' : freshnessFromFetch(barents, 'NEEDS_CREDENTIALS'),
    },
    aisstream: {
      objectCount: aisstream.events.length,
      credentialsPresent: aisstreamReady,
      fetchFreshness: !allowCredentialed && aisstreamReady
        ? 'AUTH_REQUIRED'
        : !aisstreamReady ? 'NEEDS_CREDENTIALS' : !view ? 'NO_COVERAGE' : freshnessFromFetch(aisstream, 'NEEDS_CREDENTIALS'),
    },
    aishub_marine: {
      objectCount: aishub.events.length,
      credentialsPresent: aishubReady,
      fetchFreshness: !allowCredentialed && aishubReady
        ? 'AUTH_REQUIRED'
        : !aishubReady ? 'NEEDS_CREDENTIALS' : !view ? 'NO_COVERAGE' : freshnessFromFetch(aishub, 'NEEDS_CREDENTIALS'),
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

  for (const layer of earthLayers) {
    providers.push({
      id: layer.layerId,
      displayName: layer.displayName,
      layer: 'intelligence_events',
      implemented: true,
      configurationState: 'ENABLED',
      freshness: layers.includes('intelligence_events') ? freshnessFromFetch(layer, 'UNAVAILABLE') : 'DISABLED',
      reason: layer.error ?? layer.displayName,
      objectCount: layer.events.length,
    })
  }

  providers.push(nasaFirmsLiveProviderStatus())

  if (news) providers.push(...news.providers)

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

  const snapshot = composeTerraLiveIntel({
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

  let localIntelInput: import('@/lib/terra/liveIntelPanelModel').TerraLiveIntelLocalInput | null = null
  if (typeof opts.lat === 'number' && typeof opts.lon === 'number') {
    const report = await loadTerraLocalIntel({
      latitude: opts.lat,
      longitude: opts.lon,
      place: opts.place,
      city: opts.city,
      county: opts.county,
      state: opts.state,
      country: opts.country,
      countryCode: opts.countryCode,
      zoom: opts.zoom,
      objects: snapshot.objects,
      now,
    })
    providers.push({
      id: 'terra_local_sources',
      displayName: 'Terra local sources',
      layer: 'intelligence_events',
      implemented: true,
      configurationState: 'ENABLED',
      freshness: report.health === 'ACTIVE' || report.health === 'STALE'
        ? (report.health === 'STALE' ? 'STALE' : 'LIVE')
        : report.health === 'AUTH_REQUIRED' || report.health === 'BLOCKED'
          ? 'AUTH_REQUIRED'
          : report.health === 'RATE_LIMITED'
            ? 'RATE_LIMITED'
            : report.coverage === 'NO_COVERAGE'
              ? 'NO_COVERAGE'
              : 'UNAVAILABLE',
      reason: report.reason,
      objectCount: report.qualified.length,
    })
    localIntelInput = {
      seeds: [
        ...report.qualified.map(item => ({
        id: `local:${item.sourceId}:${item.url ?? item.title}`,
        title: item.title,
        summary: item.summary,
        url: item.url,
        sourceName: item.sourceName,
        provider: 'terra_local_source',
        publishedAt: item.publishedAt,
        retrievedAt: item.retrievedAt,
        contentType: 'web_page',
        geography: item.geography,
        reliability: 'MEDIUM' as const,
        feedName: item.sourceName,
        declaredLanguage: item.language,
        localSourceType: item.sourceType,
        localServiceArea: item.serviceArea,
        localRelevance: item.qualification.relevance,
      })),
        ...(news?.localVideoSeeds ?? []),
      ],
      coverage: (news?.localVideoSeeds.length && report.coverage === 'NO_COVERAGE') ? 'SPARSE' : report.coverage,
      health: report.health,
      mix: mergeLocalMix(report.mix, news?.localVideoSeeds ?? []),
      shortLabel: report.context.shortLabel,
      rejectedCount: report.rejected.length,
      reason: report.reason,
      runtimeHealth: summarizeLocalRuntimeHealth(report.sourceRuntime),
    }
  }

  const panel = composeLiveIntelPanel({
    now,
    objects: snapshot.objects,
    news: news?.seeds ?? [],
    newsCoverage: news?.coverage,
    newsReason: news?.reason,
    conflictCoverage: news?.conflictCoverage,
    conflictReason: news?.conflictReason,
    latitude: opts.lat,
    longitude: opts.lon,
    place: opts.place,
    nativePlaceName: opts.nativePlaceName,
    englishPlaceName: opts.englishPlaceName,
    city: opts.city,
    county: opts.county,
    state: opts.state,
    country: opts.country,
    countryCode: opts.countryCode,
    reverseSublocalityLabel: opts.reverseSublocalityLabel,
    zoomLevel: opts.zoom === 'PLANET' || opts.zoom === 'COUNTRY' || opts.zoom === 'CITY' || opts.zoom === 'NEIGHBORHOOD' || opts.zoom === 'STREET' || opts.zoom === 'FEATURE'
      ? opts.zoom
      : undefined,
    authState: opts.authState ?? 'AUTHENTICATED',
    providers,
    localIntel: localIntelInput,
  })

  return {
    ...snapshot,
    authState: opts.authState ?? 'AUTHENTICATED',
    providers,
    panel,
  }
}

import { pathToFileURL } from 'node:url'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { SettlementRecord } from '@/lib/settlement-intelligence/types'
import {
  collapseLiveGeoDuplicates,
  composeTerraLiveIntel,
  filterLiveGeoByTimeWindow,
  isValidLiveCoordinate,
  listMaritimeLiveProviderStatuses,
  liveLayerForKind,
  maritimeProviderLiveStatus,
  normalizeLiveGeoFromEvidence,
  normalizeLiveGeoFromEvent,
  normalizeLiveGeoFromFeature,
  normalizeLiveGeoFromSettlement,
  resolveTerraLiveFreshness,
  stripLiveIntelSecrets,
  type TerraLiveGeoObject,
} from './liveGeoIntelligence'
import { getMaritimeSourceRecord } from './maritimeSourceRegistry'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'
import type { TerraIntelligenceEvent } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-09T20:00:00.000Z'

function vesselEvent(overrides: Partial<TerraIntelligenceEvent> = {}): TerraIntelligenceEvent {
  return {
    id: 'vessel-230123456',
    domain: 'other',
    kind: 'vessel_position',
    providerId: 'digitraffic_marine',
    layerClass: 'observed',
    title: 'FINNMAID',
    summary: 'Under way using engine',
    observedAt: '2026-09-09T19:59:50.000Z',
    publishedAt: null,
    updatedAt: null,
    temporalStatus: 'current',
    geography: { kind: 'point', longitude: 24.95, latitude: 60.15, altitude: null, coordinateOrigin: 'source_embedded' },
    geoResolution: null,
    evidence: null,
    properties: { mmsi: '230123456', country: 'FI' },
    provenance: {
      provider: 'digitraffic_marine',
      sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230123456',
      retrievedAt: NOW,
      fromCache: false,
      isHistorical: false,
    },
    rawReference: { documentId: 'digitraffic_marine:230123456', providerRecordId: '230123456', canonicalUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230123456' },
    ...overrides,
  }
}

function quakeEvent(overrides: Partial<TerraIntelligenceEvent> = {}): TerraIntelligenceEvent {
  return {
    id: 'usgs-ci123',
    domain: 'hazards',
    kind: 'earthquake',
    providerId: 'usgs_earthquake_feed',
    layerClass: 'observed',
    title: 'M 5.1 - 10 km W of Example',
    summary: null,
    observedAt: '2026-09-09T18:00:00.000Z',
    publishedAt: '2026-09-09T18:01:00.000Z',
    updatedAt: null,
    temporalStatus: 'current',
    geography: { kind: 'point', longitude: -118.2, latitude: 34.05, altitude: -10000, coordinateOrigin: 'observed' },
    geoResolution: null,
    evidence: null,
    properties: { mag: 5.1, region: 'California' },
    provenance: {
      provider: 'usgs_earthquake_feed',
      sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/ci123',
      retrievedAt: NOW,
      fromCache: false,
      isHistorical: false,
    },
    rawReference: { documentId: 'usgs_earthquake_feed:ci123', providerRecordId: 'ci123', canonicalUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/ci123' },
    ...overrides,
  }
}

const LIVE_DEFAULTS = {
  implemented: true,
  configuredForLive: true,
  fetchOk: true,
  delayedFeed: false,
  now: NOW,
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check(
    '01_valid_geo_normalization',
    (() => {
      const object = normalizeLiveGeoFromEvent(vesselEvent(), LIVE_DEFAULTS)
      return Boolean(object && object.latitude === 60.15 && object.longitude === 24.95 && object.layer === 'vessels')
    })(),
    'vessel event projects to live geo object',
  ))

  results.push(check(
    '02_invalid_coordinates_rejected',
    normalizeLiveGeoFromEvent(vesselEvent({
      geography: { kind: 'point', longitude: 200, latitude: 60, altitude: null, coordinateOrigin: 'source_embedded' },
    }), LIVE_DEFAULTS) === null
      && !isValidLiveCoordinate(91, 0)
      && !isValidLiveCoordinate(0, 181),
    'out-of-range coordinates skipped',
  ))

  results.push(check(
    '03_provider_provenance_retained',
    normalizeLiveGeoFromEvent(vesselEvent(), LIVE_DEFAULTS)?.provider === 'digitraffic_marine',
    'provider id retained',
  ))

  results.push(check(
    '04_publisher_source_family_retained',
    (() => {
      const object = normalizeLiveGeoFromEvent(vesselEvent({
        properties: { mmsi: '230123456', sourceFamily: 'fintraffic', publisherFamily: 'digitraffic' },
      }), LIVE_DEFAULTS)
      return object?.sourceFamily === 'fintraffic' && object.publisherFamily === 'digitraffic'
    })(),
    'source/publisher families retained',
  ))

  results.push(check(
    '05_evidence_id_retained',
    normalizeLiveGeoFromEvent(vesselEvent(), LIVE_DEFAULTS)?.evidenceId === 'digitraffic_marine:230123456',
    'document id retained as evidence id',
  ))

  results.push(check(
    '06_live_status_truthful',
    resolveTerraLiveFreshness({ ...LIVE_DEFAULTS, fromCache: false, isHistorical: false, observedAt: NOW, fetchOk: true }) === 'LIVE'
      && resolveTerraLiveFreshness({ ...LIVE_DEFAULTS, implemented: true, configuredForLive: true, fetchOk: true, fromCache: false, isHistorical: false, observedAt: NOW }) === 'LIVE',
    'fresh uncached fetch is LIVE',
  ))

  results.push(check(
    '07_cached_status_truthful',
    resolveTerraLiveFreshness({ ...LIVE_DEFAULTS, fromCache: true, isHistorical: false, observedAt: NOW, fetchOk: true }) === 'CACHED',
    'cached response is CACHED not LIVE',
  ))

  results.push(check(
    '08_stale_state_truthful',
    resolveTerraLiveFreshness({
      ...LIVE_DEFAULTS,
      fromCache: false,
      isHistorical: true,
      observedAt: '2026-08-01T00:00:00.000Z',
      fetchOk: true,
    }) === 'STALE'
      && resolveTerraLiveFreshness({
        ...LIVE_DEFAULTS,
        fromCache: false,
        isHistorical: false,
        observedAt: '2026-09-09T19:00:00.000Z',
        fetchOk: true,
        staleAfterMs: 10 * 60 * 1000,
      }) === 'STALE',
    'historical and aged observations are STALE',
  ))

  results.push(check(
    '09_unavailable_provider_isolated',
    resolveTerraLiveFreshness({ ...LIVE_DEFAULTS, fetchOk: false, delayedFeed: false, fromCache: false, isHistorical: false, observedAt: null }) === 'UNAVAILABLE'
      && resolveTerraLiveFreshness({ ...LIVE_DEFAULTS, fetchOk: false, delayedFeed: true, fromCache: false, isHistorical: false, observedAt: NOW }) === 'DELAYED',
    'failed fetch is UNAVAILABLE; retained prior data is DELAYED',
  ))

  results.push(check(
    '10_maritime_normalization',
    liveLayerForKind('vessel_position') === 'vessels'
      && normalizeLiveGeoFromEvent(vesselEvent(), LIVE_DEFAULTS)?.type === 'vessel_position',
    'vessels layer + vessel_position type',
  ))

  results.push(check(
    '11_event_normalization',
    liveLayerForKind('earthquake') === 'intelligence_events'
      && normalizeLiveGeoFromEvent(quakeEvent(), LIVE_DEFAULTS)?.layer === 'intelligence_events',
    'earthquakes land on intelligence_events',
  ))

  results.push(check(
    '12_duplicate_event_collapse',
    (() => {
      const google: TerraLiveGeoObject = {
        ...normalizeLiveGeoFromEvent(quakeEvent(), LIVE_DEFAULTS)!,
        id: 'google-copy',
        provider: 'google_web_search',
        discoveryProvenance: { discoveredVia: 'GOOGLE_WEB', alsoDiscoveredVia: [], upstreamEngines: ['google'], storageOrigin: null },
      }
      const searx: TerraLiveGeoObject = {
        ...google,
        id: 'searx-copy',
        provider: 'searxng',
        discoveryProvenance: { discoveredVia: 'SEARXNG', alsoDiscoveredVia: [], upstreamEngines: ['bing'], storageOrigin: null },
      }
      const collapsed = collapseLiveGeoDuplicates([google, searx])
      return collapsed.length === 1 && collapsed[0]!.discoveryProvenance.alsoDiscoveredVia.includes('SEARXNG')
    })(),
    'same evidence id from two discovery providers collapses',
  ))

  results.push(check(
    '13_time_window_filtering',
    (() => {
      const live = normalizeLiveGeoFromEvent(vesselEvent(), LIVE_DEFAULTS)!
      const old = normalizeLiveGeoFromEvent(vesselEvent({
        id: 'old-vessel',
        observedAt: '2026-09-01T00:00:00.000Z',
        rawReference: { documentId: 'old', providerRecordId: 'old', canonicalUrl: null },
      }), LIVE_DEFAULTS)!
      const windowed = filterLiveGeoByTimeWindow([live, old], NOW, { lookbackMs: 6 * 3_600_000, lookaheadMs: 0 })
      return windowed.length === 1 && windowed[0]!.id === 'vessel-230123456'
    })(),
    '6h window keeps current vessel, drops week-old',
  ))

  results.push(check(
    '14_layer_filtering',
    composeTerraLiveIntel({
      now: NOW,
      events: [vesselEvent(), quakeEvent()],
      layers: ['vessels'],
      freshnessDefaults: LIVE_DEFAULTS,
    }).objects.every(object => object.layer === 'vessels'),
    'layer filter returns only vessels',
  ))

  results.push(check(
    '15_deterministic_ordering',
    (() => {
      const a = normalizeLiveGeoFromEvent(quakeEvent({ id: 'a', observedAt: '2026-09-09T17:00:00.000Z' }), LIVE_DEFAULTS)!
      const b = normalizeLiveGeoFromEvent(vesselEvent({ id: 'b' }), LIVE_DEFAULTS)!
      const first = composeTerraLiveIntel({ now: NOW, events: [quakeEvent({ id: 'a', observedAt: '2026-09-09T17:00:00.000Z' }), vesselEvent({ id: 'b' })], freshnessDefaults: LIVE_DEFAULTS })
      const second = composeTerraLiveIntel({ now: NOW, events: [vesselEvent({ id: 'b' }), quakeEvent({ id: 'a', observedAt: '2026-09-09T17:00:00.000Z' })], freshnessDefaults: LIVE_DEFAULTS })
      return first.objects.map(o => o.id).join(',') === second.objects.map(o => o.id).join(',')
        && a.id === 'a' && b.id === 'b'
    })(),
    'compose order is stable regardless of input order',
  ))

  results.push(check(
    '16_event_browser_cap',
    (() => {
      const events = Array.from({ length: 40 }, (_, index) => vesselEvent({
        id: `v-${String(index).padStart(3, '0')}`,
        rawReference: { documentId: `doc-${index}`, providerRecordId: String(index), canonicalUrl: null },
      }))
      const snapshot = composeTerraLiveIntel({ now: NOW, events, cap: 10, perLayerCap: 10, freshnessDefaults: LIVE_DEFAULTS })
      return snapshot.objects.length === 10 && snapshot.truncated
    })(),
    'browser cap truncates deterministically',
  ))

  results.push(check(
    '17_provider_failure_does_not_break_globe',
    (() => {
      const snapshot = composeTerraLiveIntel({
        now: NOW,
        events: [quakeEvent()],
        freshnessDefaults: { ...LIVE_DEFAULTS, fetchOk: true },
        providerStatuses: [
          { id: 'digitraffic_marine', displayName: 'Digitraffic', layer: 'vessels', implemented: true, configurationState: 'ENABLED', freshness: 'UNAVAILABLE', reason: 'upstream 503', objectCount: 0 },
          { id: 'usgs_earthquake_feed', displayName: 'USGS', layer: 'intelligence_events', implemented: true, configurationState: 'ENABLED', freshness: 'LIVE', reason: 'ok', objectCount: 1 },
        ],
      })
      return snapshot.objects.length === 1 && snapshot.objects[0]!.layer === 'intelligence_events'
        && snapshot.providers.find(p => p.id === 'digitraffic_marine')?.freshness === 'UNAVAILABLE'
    })(),
    'failed maritime provider isolated; intel objects remain',
  ))

  const barents = getMaritimeSourceRecord('barentswatch_ais')!
  const aisstream = getMaritimeSourceRecord('aisstream')!
  const aishub = getMaritimeSourceRecord('aishub_marine')!
  const noaa = getMaritimeSourceRecord('noaa_access_ais')!
  results.push(check(
    '18_unconfigured_provider_not_reported_live',
    maritimeProviderLiveStatus(barents).freshness === 'NOT_CONFIGURED'
      && maritimeProviderLiveStatus(aisstream).freshness === 'NOT_CONFIGURED'
      && maritimeProviderLiveStatus(aishub).freshness === 'NOT_CONFIGURED'
      && maritimeProviderLiveStatus(noaa).freshness === 'NOT_CONFIGURED'
      && listMaritimeLiveProviderStatuses().every(row => row.freshness !== 'LIVE' || row.id === 'digitraffic_marine'),
    'registered-but-not-enabled AIS providers stay NOT_CONFIGURED',
  ))

  results.push(check(
    '19_no_secrets_in_browser_payload',
    (() => {
      const dirty = {
        title: 'ok',
        apiKey: 'sk-secret',
        authorization: 'Bearer abc',
        commander: 'user-1',
        requestedBy: 'commander-id',
        nested: { token: 'xai-secret', note: 'safe' },
      }
      const clean = stripLiveIntelSecrets(dirty) as Record<string, unknown>
      const nested = clean.nested as Record<string, unknown>
      return !('apiKey' in clean) && !('authorization' in clean) && !('commander' in clean) && !('requestedBy' in clean)
        && !('token' in nested) && nested.note === 'safe'
    })(),
    'secret keys stripped from payload',
  ))

  results.push(check(
    '20_existing_terra_route_projection_still_works',
    (() => {
      const feature = projectTerraIntelligenceEventToGeoFeature(vesselEvent())
      const object = feature ? normalizeLiveGeoFromFeature(feature, LIVE_DEFAULTS) : null
      return Boolean(feature && object && feature.latitude === 60.15 && object.provider === 'digitraffic_marine')
    })(),
    'TerraGeoFeature projection still feeds live intel',
  ))

  const evidence: IntelligenceEvidenceItem = {
    id: 'ev-1',
    source_id: 'reuters',
    source_type: 'search',
    source_label: 'Reuters',
    verified_level: 'unverified',
    title: 'Quake near city',
    url: 'https://www.reuters.com/example',
    claim: 'An earthquake occurred',
    content: 'An earthquake occurred',
    observed_at: NOW,
    published_at: NOW,
    confidence: 0.4,
    confidence_tier: 'emerging',
    corroboration_count: 1,
    freshness: 'live',
    source_reputation: 0.8,
    contradiction_flags: [],
    evidence_density: 0.2,
    related_evidence_links: [],
    weak_signal: false,
    source_family: 'reuters',
    publisher_family: 'reuters',
    discovered_via: 'GOOGLE',
    also_discovered_via: ['SEARXNG'],
    region: 'NORTH_AMERICA',
    country: 'US',
  }
  results.push(check(
    'evidence_without_coordinates_is_not_plotted',
    normalizeLiveGeoFromEvidence(evidence, { ...LIVE_DEFAULTS, fromCache: false, isHistorical: false, observedAt: NOW }) === null,
    'search/evidence without lat/lng is skipped',
  ))
  results.push(check(
    'evidence_with_real_coordinates_is_plotted',
    Boolean(normalizeLiveGeoFromEvidence({ ...evidence, latitude: 34.05, longitude: -118.2 } as IntelligenceEvidenceItem & { latitude: number; longitude: number }, { ...LIVE_DEFAULTS, fromCache: false, isHistorical: false, observedAt: NOW })),
    'evidence with explicit coordinates plots',
  ))

  const settlement: SettlementRecord = {
    id: 'set-1',
    name: 'Example Settlement',
    defendant: 'Acme',
    aggregatorUrl: 'https://example.com/listing',
    officialUrl: null,
    officialSourceState: 'AGGREGATOR_ONLY',
    terms: {
      settlementName: 'Example Settlement',
      defendant: 'Acme',
      caseNumber: null,
      court: 'Northern District of California',
      administrator: null,
      classDefinition: null,
      claimDeadline: null,
      exclusionDeadline: null,
      objectionDeadline: null,
      finalApprovalAt: null,
      claimFormUrl: null,
      officialNoticeUrl: null,
      faqUrl: null,
      settlementAgreementUrl: null,
      settlementFund: null,
      estimatedBenefit: null,
      claimTiers: [],
      documentationRequirement: 'DOCUMENTATION_REQUIREMENT_UNKNOWN',
      documentationEvidence: null,
      paymentMethod: null,
    },
    deadlineState: 'OPEN',
    priority: 'REVIEW',
    eligibilityState: 'UNKNOWN_FACTS_REQUIRED',
    eligibilityQuestions: [],
    workflowState: 'DISCOVERED',
    provenance: [],
    discoveredAt: NOW,
    updatedAt: NOW,
    claimSubmitted: false,
    cashReceived: false,
  }
  results.push(check(
    'settlement_without_coordinates_is_not_fabricated',
    normalizeLiveGeoFromSettlement(settlement) === null,
    'court name is not geocoded into a fake point',
  ))

  results.push(check(
    'unconfigured_never_live_even_with_objects',
    resolveTerraLiveFreshness({
      implemented: false,
      configuredForLive: false,
      fetchOk: true,
      fromCache: false,
      isHistorical: false,
      delayedFeed: false,
      observedAt: NOW,
      now: NOW,
    }) === 'NOT_CONFIGURED',
    'adapter existence without implementation is not LIVE',
  ))

  return results
}

export function runLiveGeoIntelligenceValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLiveGeoIntelligenceValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra live geo intelligence: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

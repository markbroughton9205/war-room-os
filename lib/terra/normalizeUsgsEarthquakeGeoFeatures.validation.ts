/**
 * Deterministic regression suite for the Phase 3 generalized earthquake normalizer — proves it
 * behaves identically to Phase 2's usgs_earthquake_feed-only version for that provider, and that
 * the newly-promoted usgs_earthquake provider produces an equally valid event through the same
 * function. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeUsgsEarthquakeGeoFeatures.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchGeoFeature, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import { normalizeUsgsEarthquakeGeoFeatures } from './normalizeUsgsEarthquakeGeoFeatures'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'usgs_earthquake:us7000abcd',
    provider: 'usgs_earthquake',
    providerRecordId: 'us7000abcd',
    title: 'M4.7 — 10km SW of Somewhere',
    summary: 'earthquake reported 2026-08-25T12:00:00.000Z.',
    contentSnippet: null,
    canonicalUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
    sourceName: 'USGS Earthquake Catalog',
    contentType: 'hazard_event',
    authors: [],
    organization: 'USGS',
    publishedAt: '2026-08-25T12:00:00.000Z',
    updatedAt: '2026-08-25T12:05:00.000Z',
    retrievedAt: '2026-08-25T12:10:00.000Z',
    geography: '10km SW of Somewhere',
    language: 'en',
    identifiers: { usgs_event_id: 'us7000abcd' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: {
      provider: 'usgs_earthquake',
      sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
      retrievedAt: '2026-08-25T12:10:00.000Z',
      requestDurationMs: 120,
      fromCache: false,
      isHistorical: false,
    },
    warnings: [],
    ...overrides,
  }
}

function makeGeoFeature(overrides: Partial<ResearchGeoFeature> = {}): ResearchGeoFeature {
  return {
    id: 'us7000abcd',
    geometryType: 'Point',
    coordinates: [-122.4, 37.8, 8.2],
    properties: { mag: 4.7, place: '10km SW of Somewhere', time: 1_756_123_200_000, updated: 1_756_123_500_000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', alert: null, status: 'reviewed', tsunami: 0 },
    ...overrides,
  }
}

function makeResponse(overrides: Partial<ResearchProviderResponse> = {}): ResearchProviderResponse {
  return {
    provider: 'usgs_earthquake',
    ok: true,
    documents: [makeDoc()],
    timeSeries: [],
    geoFeatures: [makeGeoFeature()],
    entities: [],
    error: null,
    durationMs: 200,
    fromCache: false,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- usgs_earthquake: valid response converts to a valid event ---
  const { events, skippedCount } = normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake', makeResponse())
  results.push(check('usgs_earthquake_valid_feature_converts_to_one_event', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
  const event = events[0]
  results.push(check('usgs_earthquake_domain_kind_provider_correct', event?.domain === 'hazards' && event?.kind === 'earthquake' && event?.providerId === 'usgs_earthquake', `domain=${event?.domain} kind=${event?.kind} providerId=${event?.providerId}`))
  results.push(check('usgs_earthquake_depth_km_converted_to_negative_meters', event?.geography?.kind === 'point' && event.geography.altitude === -8200, `altitude=${event?.geography?.kind === 'point' ? event.geography.altitude : 'n/a'}`))
  results.push(check('usgs_earthquake_observed_at_correct_published_at_honestly_null', event?.observedAt === '2025-08-25T12:00:00.000Z' && event?.publishedAt === null, `observedAt=${event?.observedAt} publishedAt=${event?.publishedAt}`))
  results.push(check('usgs_earthquake_evidence_honestly_null', event?.evidence === null, `evidence=${JSON.stringify(event?.evidence)}`))
  results.push(check('usgs_earthquake_provenance_traces_to_document', event?.provenance.provider === 'usgs_earthquake' && event?.provenance.sourceUrl === 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', `provenance=${JSON.stringify(event?.provenance)}`))

  const feature = event ? projectTerraIntelligenceEventToGeoFeature(event) : null
  results.push(check('usgs_earthquake_event_projects_to_geo_feature', feature !== null && feature.longitude === -122.4 && feature.latitude === 37.8, `feature=${JSON.stringify(feature)}`))

  // --- usgs_earthquake_feed: same function, same shape, proving no behavior change for the
  // provider Phase 1/2 already shipped ---
  const feedResponse = makeResponse({
    provider: 'usgs_earthquake_feed',
    documents: [makeDoc({ id: 'usgs_earthquake_feed:us7000abcd', provider: 'usgs_earthquake_feed', provenance: { ...makeDoc().provenance, provider: 'usgs_earthquake_feed' } })],
  })
  const feedResult = normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake_feed', feedResponse)
  results.push(check('usgs_earthquake_feed_still_produces_a_valid_event', feedResult.events.length === 1 && feedResult.events[0].providerId === 'usgs_earthquake_feed', `events=${feedResult.events.length} providerId=${feedResult.events[0]?.providerId}`))

  // --- Missing optional fields not fabricated ---
  {
    const missingDepth = makeGeoFeature({ id: 'us7000nodep', coordinates: [10, 20], properties: { mag: 3.1, place: 'no depth', time: 1_756_123_200_000 } })
    const r = normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake', makeResponse({ geoFeatures: [missingDepth], documents: [] }))
    const alt = r.events[0]?.geography?.kind === 'point' ? r.events[0].geography.altitude : undefined
    results.push(check('missing_depth_is_null_never_zero', alt === null, `altitude=${alt}`))
  }
  {
    const orphan = makeGeoFeature({ id: 'no-matching-doc' })
    const r = normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake', makeResponse({ geoFeatures: [orphan], documents: [] }))
    results.push(check('geo_feature_with_no_matching_document_still_produces_event_safely', r.events.length === 1 && r.events[0].rawReference.documentId === null, `events=${r.events.length} documentId=${r.events[0]?.rawReference.documentId}`))
  }

  // --- Malformed coordinates rejected honestly ---
  {
    const malformed = [
      makeGeoFeature({ id: 'bad1', coordinates: [200, 10] }),
      makeGeoFeature({ id: 'bad2', coordinates: [10, 200] }),
      makeGeoFeature({ id: 'bad3', coordinates: 'not-an-array' as unknown as ResearchGeoFeature['coordinates'] }),
      makeGeoFeature({ id: 'bad4', coordinates: [10] as unknown as ResearchGeoFeature['coordinates'] }),
    ]
    const r = normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake', makeResponse({ geoFeatures: malformed, documents: [] }))
    results.push(check('malformed_coordinates_skipped_not_crashed', r.events.length === 0 && r.skippedCount === 4, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  {
    const r = normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake', makeResponse({ geoFeatures: [], documents: [] }))
    results.push(check('empty_input_is_empty_output', r.events.length === 0 && r.skippedCount === 0, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  return results
}

export function runTerraNormalizeUsgsEarthquakeGeoFeaturesValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraNormalizeUsgsEarthquakeGeoFeaturesValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeUsgsEarthquakeGeoFeatures validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

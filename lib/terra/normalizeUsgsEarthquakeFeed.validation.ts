/**
 * Focused regression suite proving the Phase 2 earthquake migration: a real
 * usgs_earthquake_feed Research Engine response converts into a valid TerraIntelligenceEvent,
 * and that event projects into the same TerraGeoFeature shape Phase 1's rendering
 * (TerraEarthquakeLayer.tsx) already expects — end to end, provenance included. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeUsgsEarthquakeFeed.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchGeoFeature } from '@/lib/research-engine/core/types'
import { normalizeUsgsEarthquakeFeed } from './normalizeUsgsEarthquakeFeed'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'usgs_earthquake_feed:us7000abcd',
    provider: 'usgs_earthquake_feed',
    providerRecordId: 'us7000abcd',
    title: 'M4.7 — 10km SW of Somewhere',
    summary: 'earthquake reported 2026-08-25T12:00:00.000Z; feed=4.5_day.',
    contentSnippet: null,
    canonicalUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
    sourceName: 'USGS Real-Time Earthquake Feeds',
    contentType: 'hazard_event_feed',
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
      provider: 'usgs_earthquake_feed',
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
    properties: { mag: 4.7, place: '10km SW of Somewhere', time: 1_756_123_200_000, updated: 1_756_123_500_000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd', alert: null, status: 'reviewed', tsunami: 0, sig: 340 },
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- 1. Raw response converts into a valid TerraIntelligenceEvent ---
  const { events, skippedCount } = normalizeUsgsEarthquakeFeed([makeGeoFeature()], [makeDoc()])
  results.push(check('valid_feature_converts_to_one_event', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
  const event = events[0]
  results.push(check('event_domain_kind_provider_are_correct', event?.domain === 'hazards' && event?.kind === 'earthquake' && event?.providerId === 'usgs_earthquake_feed', `domain=${event?.domain} kind=${event?.kind} providerId=${event?.providerId}`))
  results.push(check('event_layer_class_is_observed_not_a_later_phase_class', event?.layerClass === 'observed', `layerClass=${event?.layerClass}`))
  results.push(check('event_geography_is_a_point_with_correct_coordinates', event?.geography?.kind === 'point' && event.geography.longitude === -122.4 && event.geography.latitude === 37.8, `geography=${JSON.stringify(event?.geography)}`))
  results.push(check('depth_km_converted_to_negative_meters_altitude', event?.geography?.kind === 'point' && event.geography.altitude === -8200, `altitude=${event?.geography?.kind === 'point' ? event.geography.altitude : 'n/a'}`))
  results.push(check('observed_at_is_the_real_event_time_published_at_is_honestly_null', event?.observedAt === '2025-08-25T12:00:00.000Z' && event?.publishedAt === null, `observedAt=${event?.observedAt} publishedAt=${event?.publishedAt}`))
  results.push(check('temporal_status_is_current_not_historical', event?.temporalStatus === 'current', `temporalStatus=${event?.temporalStatus}`))
  results.push(check('evidence_is_honestly_null_not_a_fabricated_score', event?.evidence === null, `evidence=${JSON.stringify(event?.evidence)}`))
  results.push(check('magnitude_preserved_in_properties_not_reinterpreted', event?.properties.mag === 4.7, `properties.mag=${event?.properties.mag}`))

  // --- 3. Provenance survives the source-document -> event transformation ---
  results.push(check('event_provenance_traces_to_source_document', event?.provenance.provider === 'usgs_earthquake_feed' && event?.provenance.sourceUrl === 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd' && event?.provenance.fromCache === false, `provenance=${JSON.stringify(event?.provenance)}`))
  results.push(check('raw_reference_traces_to_document_and_provider_record_id', event?.rawReference.documentId === 'usgs_earthquake_feed:us7000abcd' && event?.rawReference.providerRecordId === 'us7000abcd', `rawReference=${JSON.stringify(event?.rawReference)}`))

  // --- 2 & 6. Event projects into the same usable geographic representation Phase 1's
  // rendering (TerraEarthquakeLayer.tsx) already expects, and provenance survives that second
  // transformation too. ---
  const feature = event ? projectTerraIntelligenceEventToGeoFeature(event) : null
  results.push(check('event_with_point_geography_projects_to_a_geo_feature', feature !== null, `feature=${JSON.stringify(feature)}`))
  results.push(check('projected_feature_id_and_event_id_match', feature?.id === event?.id && feature?.eventId === event?.id, `feature.id=${feature?.id} feature.eventId=${feature?.eventId} event.id=${event?.id}`))
  results.push(check('projected_feature_has_the_lon_lat_pair_the_globe_needs', feature?.longitude === -122.4 && feature?.latitude === 37.8, `lon=${feature?.longitude} lat=${feature?.latitude}`))
  results.push(check('projected_feature_still_carries_magnitude_for_marker_scaling', feature?.properties.mag === 4.7, `properties.mag=${feature?.properties.mag}`))
  results.push(check('provenance_survives_the_second_transformation_unchanged', JSON.stringify(feature?.provenance) === JSON.stringify(event?.provenance), `feature.provenance=${JSON.stringify(feature?.provenance)}`))

  // --- 4. Missing optional source fields do not get fabricated ---
  {
    const missingDepth = makeGeoFeature({ id: 'us7000nodep', coordinates: [10, 20] as unknown as ResearchGeoFeature['coordinates'], properties: { mag: 3.1, place: 'no depth', time: 1_756_123_200_000 } })
    const { events: e2 } = normalizeUsgsEarthquakeFeed([missingDepth], [])
    const alt = e2[0]?.geography?.kind === 'point' ? e2[0].geography.altitude : undefined
    results.push(check('missing_depth_is_null_never_defaulted_to_zero', alt === null, `altitude=${alt}`))
  }
  {
    const orphanGeoFeature = makeGeoFeature({ id: 'no-matching-doc' })
    const { events: e3 } = normalizeUsgsEarthquakeFeed([orphanGeoFeature], [])
    results.push(check('geo_feature_with_no_matching_document_still_produces_an_event_safely', e3.length === 1 && e3[0].rawReference.documentId === null, `events=${e3.length} documentId=${e3[0]?.rawReference.documentId}`))
  }

  // --- 5. Malformed coordinates are rejected honestly (never crash, never a fabricated point) ---
  {
    const malformed = [
      makeGeoFeature({ id: 'bad1', coordinates: [200, 10] }), // lon out of range
      makeGeoFeature({ id: 'bad2', coordinates: [10, 200] }), // lat out of range
      makeGeoFeature({ id: 'bad3', coordinates: 'not-an-array' as unknown as ResearchGeoFeature['coordinates'] }),
      makeGeoFeature({ id: 'bad4', coordinates: [10] as unknown as ResearchGeoFeature['coordinates'] }), // too short
    ]
    const { events: e4, skippedCount: s4 } = normalizeUsgsEarthquakeFeed(malformed, [])
    results.push(check('malformed_coordinates_are_skipped_not_crashed_and_not_faked', e4.length === 0 && s4 === 4, `events=${e4.length} skipped=${s4}`))
  }

  {
    const { events: e5, skippedCount: s5 } = normalizeUsgsEarthquakeFeed([], [])
    results.push(check('empty_input_is_empty_output_not_an_error', e5.length === 0 && s5 === 0, `events=${e5.length} skipped=${s5}`))
  }

  return results
}

export function runTerraNormalizeUsgsEarthquakeFeedValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraNormalizeUsgsEarthquakeFeedValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeUsgsEarthquakeFeed validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

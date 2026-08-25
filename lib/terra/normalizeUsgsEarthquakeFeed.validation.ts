/**
 * Focused regression suite for Terra's usgs_earthquake_feed normalization boundary — the one
 * piece of pure transformation logic Phase 1 introduces. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeUsgsEarthquakeFeed.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchGeoFeature } from '@/lib/research-engine/core/types'
import { normalizeUsgsEarthquakeFeed } from './normalizeUsgsEarthquakeFeed'

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

  {
    const { features, skippedCount } = normalizeUsgsEarthquakeFeed([makeGeoFeature()], [makeDoc()])
    results.push(check('valid_feature_is_projected', features.length === 1 && skippedCount === 0, `features=${features.length} skipped=${skippedCount}`))
    const f = features[0]
    results.push(check('longitude_latitude_preserved', f?.longitude === -122.4 && f?.latitude === 37.8, `lon=${f?.longitude} lat=${f?.latitude}`))
    results.push(check('depth_km_converted_to_negative_meters_altitude', f?.altitude === -8200, `altitude=${f?.altitude}`))
    results.push(check('provider_id_and_kind_are_usgs_earthquake_feed', f?.providerId === 'usgs_earthquake_feed' && f?.kind === 'usgs_earthquake_feed', `providerId=${f?.providerId} kind=${f?.kind}`))
    results.push(check('title_prefers_matched_document', f?.title === 'M4.7 — 10km SW of Somewhere', `title=${f?.title}`))
    results.push(check('magnitude_preserved_in_properties_not_reinterpreted', f?.properties.mag === 4.7, `properties.mag=${f?.properties.mag}`))
    results.push(check('provenance_traces_to_source_document', f?.provenance.provider === 'usgs_earthquake_feed' && f?.provenance.sourceUrl === 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd' && f?.provenance.fromCache === false, `provenance=${JSON.stringify(f?.provenance)}`))
    results.push(check('raw_reference_traces_to_document_id', f?.rawReference.documentId === 'usgs_earthquake_feed:us7000abcd', `documentId=${f?.rawReference.documentId}`))
  }

  {
    const missingDepth = makeGeoFeature({ id: 'us7000nodep', coordinates: [10, 20] as unknown as ResearchGeoFeature['coordinates'], properties: { mag: 3.1, place: 'no depth', time: 1_756_123_200_000 } })
    const { features } = normalizeUsgsEarthquakeFeed([missingDepth], [])
    results.push(check('missing_depth_is_null_never_defaulted_to_zero', features[0]?.altitude === null, `altitude=${features[0]?.altitude}`))
  }

  {
    const malformed = [
      makeGeoFeature({ id: 'bad1', coordinates: [200, 10] }), // lon out of range
      makeGeoFeature({ id: 'bad2', coordinates: [10, 200] }), // lat out of range
      makeGeoFeature({ id: 'bad3', coordinates: 'not-an-array' as unknown as ResearchGeoFeature['coordinates'] }),
      makeGeoFeature({ id: 'bad4', coordinates: [10] as unknown as ResearchGeoFeature['coordinates'] }), // too short
    ]
    const { features, skippedCount } = normalizeUsgsEarthquakeFeed(malformed, [])
    results.push(check('malformed_coordinates_are_skipped_not_crashed', features.length === 0 && skippedCount === 4, `features=${features.length} skipped=${skippedCount}`))
  }

  {
    const orphanGeoFeature = makeGeoFeature({ id: 'no-matching-doc' })
    const { features } = normalizeUsgsEarthquakeFeed([orphanGeoFeature], [])
    results.push(check('geo_feature_with_no_matching_document_still_projects_safely', features.length === 1 && features[0].rawReference.documentId === null, `features=${features.length} documentId=${features[0]?.rawReference.documentId}`))
  }

  {
    const { features, skippedCount } = normalizeUsgsEarthquakeFeed([], [])
    results.push(check('empty_input_is_empty_output_not_an_error', features.length === 0 && skippedCount === 0, `features=${features.length} skipped=${skippedCount}`))
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

/**
 * Deterministic regression suite for the usgs_water station normalizer — one event per monitoring
 * station, latest-valued reading extraction, honest handling of an all-null series, malformed
 * coordinate rejection. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeUsgsWaterStations.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchGeoFeature, ResearchProviderResponse, ResearchTimeSeries } from '@/lib/research-engine/core/types'
import { normalizeUsgsWaterStations } from './normalizeUsgsWaterStations'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'usgs_water:USGS-01646500',
    provider: 'usgs_water',
    providerRecordId: 'USGS-01646500',
    title: 'USGS-01646500 POTOMAC RIVER NEAR WASH, DC LITTLE FALLS PUMP STA',
    summary: 'Gage height (ft) — 5 recent readings.',
    contentSnippet: null,
    canonicalUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-01646500',
    sourceUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-01646500',
    sourceName: 'USGS Water Data',
    contentType: 'water_monitoring_station',
    authors: [],
    organization: 'USGS',
    publishedAt: null,
    updatedAt: '2026-08-25T11:00:00.000Z',
    retrievedAt: '2026-08-25T12:10:00.000Z',
    geography: 'lat 38.9497, lon -77.1281',
    language: 'en',
    identifiers: { monitoring_location_id: 'USGS-01646500' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: {
      provider: 'usgs_water',
      sourceUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-01646500',
      retrievedAt: '2026-08-25T12:10:00.000Z',
      requestDurationMs: 150,
      fromCache: false,
      isHistorical: false,
    },
    warnings: [],
    ...overrides,
  }
}

function makeGeoFeature(overrides: Partial<ResearchGeoFeature> = {}): ResearchGeoFeature {
  return {
    id: 'USGS-01646500',
    geometryType: 'Point',
    coordinates: [-77.1281, 38.9497],
    properties: { monitoring_location_id: 'USGS-01646500' },
    ...overrides,
  }
}

function makeSeries(overrides: Partial<ResearchTimeSeries> = {}): ResearchTimeSeries {
  return {
    seriesId: 'USGS-01646500:00065',
    title: 'Gage height, ft',
    unit: 'ft',
    frequency: 'daily',
    points: [
      { date: '2026-08-21', value: 2.1, note: null },
      { date: '2026-08-23', value: 2.4, note: null },
      { date: '2026-08-22', value: 2.3, note: null },
    ],
    ...overrides,
  }
}

function makeResponse(overrides: Partial<ResearchProviderResponse> = {}): ResearchProviderResponse {
  return {
    provider: 'usgs_water',
    ok: true,
    documents: [makeDoc()],
    timeSeries: [makeSeries()],
    geoFeatures: [makeGeoFeature()],
    entities: [],
    error: null,
    durationMs: 210,
    fromCache: false,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const { events, skippedCount } = normalizeUsgsWaterStations(makeResponse())
  results.push(check('valid_station_converts_to_one_event', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
  const event = events[0]
  results.push(check('domain_kind_provider_correct', event?.domain === 'hazards' && event?.kind === 'water_gauge_reading' && event?.providerId === 'usgs_water', `domain=${event?.domain} kind=${event?.kind} providerId=${event?.providerId}`))
  results.push(check('geography_point_matches_station_coordinates', event?.geography?.kind === 'point' && event.geography.longitude === -77.1281 && event.geography.latitude === 38.9497, `geography=${JSON.stringify(event?.geography)}`))
  results.push(check('altitude_is_null_no_depth_dimension_for_a_station', event?.geography?.kind === 'point' && event.geography.altitude === null, `altitude=${event?.geography?.kind === 'point' ? event.geography.altitude : 'n/a'}`))
  // Points arrive out of order in the fixture (21, 23, 22) — proves the "most recent by date, not
  // by array order" logic, not an already-sorted-input assumption.
  results.push(check('latest_reading_is_the_chronologically_last_not_the_last_array_element', event?.properties.latestValueDate === '2026-08-23' && event?.properties.latestValue === 2.4, `date=${event?.properties.latestValueDate} value=${event?.properties.latestValue}`))
  results.push(check('observed_at_is_the_latest_reading_date_not_the_query_window', event?.observedAt === '2026-08-23', `observedAt=${event?.observedAt}`))
  results.push(check('evidence_honestly_null', event?.evidence === null, `evidence=${JSON.stringify(event?.evidence)}`))
  results.push(check('full_point_series_preserved_in_properties', Array.isArray(event?.properties.points) && (event?.properties.points as unknown[]).length === 3, `points=${JSON.stringify(event?.properties.points)}`))
  results.push(check('provenance_traces_to_document', event?.provenance.provider === 'usgs_water' && event?.provenance.sourceUrl === 'https://waterdata.usgs.gov/monitoring-location/USGS-01646500', `provenance=${JSON.stringify(event?.provenance)}`))

  const feature = event ? projectTerraIntelligenceEventToGeoFeature(event) : null
  results.push(check('event_projects_to_geo_feature', feature !== null && feature.longitude === -77.1281 && feature.latitude === 38.9497, `feature=${JSON.stringify(feature)}`))

  // --- All-null series: no fabricated reading ---
  {
    const allNullSeries = makeSeries({ points: [{ date: '2026-08-21', value: null, note: 'ice affected' }, { date: '2026-08-22', value: null, note: 'ice affected' }] })
    const r = normalizeUsgsWaterStations(makeResponse({ timeSeries: [allNullSeries] }))
    results.push(check('all_null_series_yields_null_latest_value_not_fabricated', r.events[0]?.properties.latestValue === null && r.events[0]?.observedAt === null, `latestValue=${r.events[0]?.properties.latestValue} observedAt=${r.events[0]?.observedAt}`))
  }

  // --- No document at all (defensive fallback path) ---
  {
    const r = normalizeUsgsWaterStations(makeResponse({ documents: [] }))
    results.push(check('missing_document_falls_back_to_a_synthetic_title_not_a_crash', r.events.length === 1 && r.events[0].title === 'USGS monitoring station USGS-01646500', `title=${r.events[0]?.title}`))
  }

  // --- Malformed coordinates rejected honestly ---
  {
    const malformed = [
      makeGeoFeature({ id: 'bad1', coordinates: [200, 10] }),
      makeGeoFeature({ id: 'bad2', coordinates: [10, 200] }),
      makeGeoFeature({ id: 'bad3', coordinates: 'nope' as unknown as ResearchGeoFeature['coordinates'] }),
    ]
    const r = normalizeUsgsWaterStations(makeResponse({ geoFeatures: malformed }))
    results.push(check('malformed_coordinates_skipped_not_crashed', r.events.length === 0 && r.skippedCount === 3, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  {
    const r = normalizeUsgsWaterStations(makeResponse({ geoFeatures: [], documents: [], timeSeries: [] }))
    results.push(check('empty_input_is_empty_output', r.events.length === 0 && r.skippedCount === 0, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  return results
}

export function runTerraNormalizeUsgsWaterStationsValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraNormalizeUsgsWaterStationsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeUsgsWaterStations validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

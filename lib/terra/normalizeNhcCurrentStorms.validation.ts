/**
 * Deterministic regression suite for the NHC active-storm normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeNhcCurrentStorms.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchGeoFeature, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import { normalizeNhcCurrentStorms } from './normalizeNhcCurrentStorms'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'nhc_current_storms:ep092026',
    provider: 'nhc_current_storms',
    providerRecordId: 'ep092026',
    title: 'TS Iselle',
    summary: 'TS Iselle — max sustained wind 45 kt, pressure 996 mb.',
    contentSnippet: null,
    canonicalUrl: 'https://www.nhc.noaa.gov/text/MIATCPEP4.shtml',
    sourceUrl: 'https://www.nhc.noaa.gov/text/MIATCPEP4.shtml',
    sourceName: 'NOAA National Hurricane Center',
    contentType: 'tropical_cyclone_advisory',
    authors: [],
    organization: 'NOAA/NHC',
    publishedAt: '2026-08-26T03:00:00.000Z',
    updatedAt: '2026-08-26T03:00:00.000Z',
    retrievedAt: '2026-08-26T03:05:00.000Z',
    geography: null,
    language: 'en',
    identifiers: { nhc_storm_id: 'ep092026', basin: 'EP', classification: 'TS' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'nhc_current_storms', sourceUrl: 'https://www.nhc.noaa.gov/text/MIATCPEP4.shtml', retrievedAt: '2026-08-26T03:05:00.000Z', requestDurationMs: 200, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function makeGeoFeature(overrides: Partial<ResearchGeoFeature> = {}): ResearchGeoFeature {
  return {
    id: 'ep092026',
    geometryType: 'Point',
    coordinates: [-122.5, 21.3],
    properties: { name: 'Iselle', classification: 'TS', intensityKt: 45, pressureMb: 996, basin: 'EP', movementDir: 285, movementSpeedKt: 9, lastUpdate: '2026-08-26T03:00:00.000Z' },
    ...overrides,
  }
}

function makeResponse(overrides: Partial<ResearchProviderResponse> = {}): ResearchProviderResponse {
  return { provider: 'nhc_current_storms', ok: true, documents: [makeDoc()], timeSeries: [], geoFeatures: [makeGeoFeature()], entities: [], error: null, durationMs: 150, fromCache: false, ...overrides }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const { events, skippedCount } = normalizeNhcCurrentStorms(makeResponse())
  results.push(check('active_storm_converts_to_one_event', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
  const event = events[0]
  results.push(check('event_kind_domain_provider_correct', event?.kind === 'tropical_cyclone' && event?.domain === 'hazards' && event?.providerId === 'nhc_current_storms', `kind=${event?.kind} domain=${event?.domain} providerId=${event?.providerId}`))
  results.push(check('geography_coordinate_origin_is_observed', event?.geography?.coordinateOrigin === 'observed', `coordinateOrigin=${event?.geography?.coordinateOrigin}`))
  results.push(check('geography_point_matches_real_position', event?.geography?.kind === 'point' && event.geography.longitude === -122.5 && event.geography.latitude === 21.3, `geography=${JSON.stringify(event?.geography)}`))
  results.push(check('classification_intensity_pressure_preserved_verbatim', event?.properties.classification === 'TS' && event?.properties.intensityKt === 45 && event?.properties.pressureMb === 996, `properties=${JSON.stringify(event?.properties)}`))
  results.push(check('evidence_honestly_null', event?.evidence === null, `evidence=${JSON.stringify(event?.evidence)}`))
  results.push(check('provenance_traces_to_document', event?.provenance.provider === 'nhc_current_storms' && event?.provenance.sourceUrl === 'https://www.nhc.noaa.gov/text/MIATCPEP4.shtml', `provenance=${JSON.stringify(event?.provenance)}`))

  const feature = event ? projectTerraIntelligenceEventToGeoFeature(event) : null
  results.push(check('event_projects_to_geo_feature_correctly', feature?.longitude === -122.5 && feature?.latitude === 21.3 && feature?.geometryKind === 'point', `feature=${JSON.stringify(feature)}`))

  {
    const malformed = makeGeoFeature({ id: 'bad', coordinates: [200, 10] })
    const r = normalizeNhcCurrentStorms(makeResponse({ geoFeatures: [malformed], documents: [] }))
    results.push(check('malformed_coordinates_are_skipped_not_fabricated', r.events.length === 0 && r.skippedCount === 1, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  {
    const r = normalizeNhcCurrentStorms(makeResponse({ geoFeatures: [], documents: [] }))
    results.push(check('no_active_storms_is_an_honest_empty_result', r.events.length === 0 && r.skippedCount === 0, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  {
    // No forecast track/track cone fabricated — the event carries no synthetic track geometry.
    const r = normalizeNhcCurrentStorms(makeResponse())
    results.push(check('no_forecast_track_is_fabricated', r.events[0]?.geography?.kind === 'point', `geography.kind=${r.events[0]?.geography?.kind}`))
  }

  return results
}

export function runTerraNormalizeNhcCurrentStormsValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraNormalizeNhcCurrentStormsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeNhcCurrentStorms validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

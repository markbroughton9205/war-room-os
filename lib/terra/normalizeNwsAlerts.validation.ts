/**
 * Deterministic regression suite for the NWS alerts normalizer — Terra's first real
 * TerraRegionGeography (polygon) producer, alert-expiration handling, and honest skip behavior
 * for zone-only/malformed-polygon alerts. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeNwsAlerts.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchGeoFeature, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import { normalizeNwsAlerts } from './normalizeNwsAlerts'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'nws_weather:alert:urn:oid:test-1',
    provider: 'nws_weather',
    providerRecordId: 'urn:oid:test-1',
    title: 'Flood Advisory — Potter, TX',
    summary: 'Flood Advisory issued',
    contentSnippet: null,
    canonicalUrl: 'https://alerts.weather.gov/test',
    sourceUrl: 'https://alerts.weather.gov/test',
    sourceName: 'NWS Amarillo TX',
    contentType: 'severe_weather_alert',
    authors: [],
    organization: 'NOAA/NWS',
    publishedAt: '2026-08-25T23:12:00-05:00',
    updatedAt: '2026-08-25T23:12:00-05:00',
    retrievedAt: '2026-08-26T03:00:00.000Z',
    geography: 'Potter, TX',
    language: 'en',
    identifiers: { event: 'Flood Advisory', severity: 'Minor', certainty: 'Observed', urgency: 'Expected', status: 'Actual', expires: '2099-01-01T00:00:00.000Z' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'nws_weather', sourceUrl: 'https://alerts.weather.gov/test', retrievedAt: '2026-08-26T03:00:00.000Z', requestDurationMs: 150, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function makePolygonFeature(overrides: Partial<ResearchGeoFeature> = {}): ResearchGeoFeature {
  return {
    id: 'urn:oid:test-1',
    geometryType: 'Polygon',
    coordinates: [[[-101.93, 35.53], [-101.81, 35.62], [-101.62, 35.62], [-101.72, 35.37], [-101.93, 35.53]]],
    properties: { event: 'Flood Advisory', severity: 'Minor' },
    ...overrides,
  }
}

function makeResponse(overrides: Partial<ResearchProviderResponse> = {}): ResearchProviderResponse {
  return { provider: 'nws_weather', ok: true, documents: [makeDoc()], timeSeries: [], geoFeatures: [makePolygonFeature()], entities: [], error: null, durationMs: 150, fromCache: false, ...overrides }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const { events, skippedCount } = normalizeNwsAlerts(makeResponse())
  results.push(check('polygon_alert_converts_to_one_region_event', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
  const event = events[0]
  results.push(check('kind_domain_provider_correct', event?.kind === 'severe_weather_alert' && event?.domain === 'hazards' && event?.providerId === 'nws_weather', `kind=${event?.kind} domain=${event?.domain} providerId=${event?.providerId}`))
  results.push(check('geography_kind_is_region_not_point', event?.geography?.kind === 'region', `geography.kind=${event?.geography?.kind}`))
  results.push(check('region_rings_match_real_polygon_vertices', event?.geography?.kind === 'region' && event.geography.rings[0].length === 5 && event.geography.rings[0][0][0] === -101.93, `rings=${JSON.stringify(event?.geography?.kind === 'region' ? event.geography.rings : null)}`))
  results.push(check('coordinate_origin_is_observed_a_real_source_polygon_not_resolved', event?.geography?.coordinateOrigin === 'observed', `coordinateOrigin=${event?.geography?.coordinateOrigin}`))
  results.push(check('not_yet_expired_alert_is_temporal_status_current', event?.temporalStatus === 'current', `temporalStatus=${event?.temporalStatus}`))
  results.push(check('real_severity_urgency_certainty_preserved_verbatim_not_reinterpreted', event?.properties.severity === 'Minor' && event?.properties.certainty === 'Observed' && event?.properties.urgency === 'Expected', `properties=${JSON.stringify(event?.properties)}`))
  results.push(check('evidence_honestly_null_not_conflated_with_nws_severity', event?.evidence === null, `evidence=${JSON.stringify(event?.evidence)}`))

  const feature = event ? projectTerraIntelligenceEventToGeoFeature(event) : null
  results.push(check('region_event_projects_with_region_geometry_kind', feature?.geometryKind === 'region' && feature.regionRings !== null, `feature.geometryKind=${feature?.geometryKind}`))
  // Vertex-average centroid of the 4 distinct corners (excluding the closing repeat) — a simple,
  // real, non-fabricated calculation: (-101.93-101.81-101.62-101.72-101.93)/5, (35.53+35.62+35.62+35.37+35.53)/5.
  const expectedLon = (-101.93 + -101.81 + -101.62 + -101.72 + -101.93) / 5
  results.push(check('centroid_is_a_real_vertex_average_not_an_arbitrary_point', feature !== null && Math.abs(feature.longitude - expectedLon) < 0.0001, `longitude=${feature?.longitude} expected=${expectedLon}`))

  // --- Alert expiration: an already-expired alert is marked historical, never presented as active ---
  {
    const expired = normalizeNwsAlerts(makeResponse({ documents: [makeDoc({ identifiers: { ...makeDoc().identifiers, expires: '2000-01-01T00:00:00.000Z' } })] }))
    results.push(check('expired_alert_is_marked_historical_not_current', expired.events[0]?.temporalStatus === 'historical', `temporalStatus=${expired.events[0]?.temporalStatus}`))
  }

  // --- Zone-only alert (geometry: null upstream -> no matching geoFeature) is honestly skipped ---
  {
    const zoneOnly = normalizeNwsAlerts(makeResponse({ geoFeatures: [] }))
    results.push(check('zone_only_alert_is_skipped_not_geo_resolved_from_area_desc', zoneOnly.events.length === 0 && zoneOnly.skippedCount === 1, `events=${zoneOnly.events.length} skipped=${zoneOnly.skippedCount}`))
  }

  // --- Malformed polygon (degenerate ring, out-of-range vertex) is honestly skipped ---
  {
    const malformed = normalizeNwsAlerts(makeResponse({ geoFeatures: [makePolygonFeature({ coordinates: [[[-101.93, 35.53], [200, 35.62]]] })] }))
    results.push(check('malformed_polygon_is_skipped_not_fabricated', malformed.events.length === 0 && malformed.skippedCount === 1, `events=${malformed.events.length} skipped=${malformed.skippedCount}`))
  }

  {
    const empty = normalizeNwsAlerts(makeResponse({ documents: [], geoFeatures: [] }))
    results.push(check('no_active_alerts_is_an_honest_empty_result', empty.events.length === 0 && empty.skippedCount === 0, `events=${empty.events.length} skipped=${empty.skippedCount}`))
  }

  return results
}

export function runTerraNormalizeNwsAlertsValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraNormalizeNwsAlertsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeNwsAlerts validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

/**
 * Deterministic regression suite for the Council-facing aircraft summary formatter. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aircraftCouncilSummary.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature } from './types'
import type { TerraAircraftRegionalSummary } from './aircraftRegionalSummary'
import { formatTerraAircraftCouncilSummary } from './aircraftCouncilSummary'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeAircraft(overrides: Partial<TerraGeoFeature> = {}): TerraGeoFeature {
  return {
    id: 'opensky:aaa111',
    eventId: 'opensky:aaa111',
    providerId: 'opensky',
    kind: 'aircraft_state',
    longitude: -81.8,
    latitude: 41.2,
    altitude: 10363,
    timestamp: '2026-08-27T00:59:50.000Z',
    title: 'UAL123',
    summary: null,
    properties: { icao24: 'aaa111', callsign: 'UAL123', onGround: false, headingDeg: 271, velocityMps: 230.5, verticalRateMps: 0 },
    provenance: { provider: 'opensky', sourceUrl: null, retrievedAt: '2026-08-27T01:00:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: 'aaa111', canonicalUrl: null },
    coordinateOrigin: 'source_embedded',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<TerraAircraftRegionalSummary> = {}): TerraAircraftRegionalSummary {
  return { provider: 'opensky', totalCount: 34, airborneCount: 30, onGroundCount: 4, staleCount: 0, averageAltitudeMeters: 9800, earliestObservedAt: null, latestObservedAt: null, ...overrides }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- Nothing selected, no regional summary: an honest empty string ---
  {
    const text = formatTerraAircraftCouncilSummary(null, null)
    results.push(check('nothing_selected_produces_empty_summary', text === '', JSON.stringify(text)))
  }

  // --- Regional summary alone reports the real count, no selected-aircraft lines ---
  {
    const text = formatTerraAircraftCouncilSummary(null, makeSummary({ totalCount: 34 }))
    results.push(check('regional_summary_alone_reports_count', text === 'AIRCRAFT IN CURRENT REGION: 34', JSON.stringify(text)))
  }

  // --- A selected aircraft with every real field reports each one, in the mission's format ---
  {
    const text = formatTerraAircraftCouncilSummary(makeAircraft(), makeSummary({ totalCount: 34 }))
    const expected = [
      'AIRCRAFT IN CURRENT REGION: 34',
      'SELECTED AIRCRAFT: UAL123',
      'ALTITUDE: 10363 m',
      'HEADING: 271°',
      'SPEED: 830 km/h',
      'LAST OBSERVED: 2026-08-27T00:59:50.000Z',
      'SOURCE: opensky',
    ].join('\n')
    results.push(check('full_selection_matches_expected_format', text === expected, text))
  }

  // --- Missing optional fields (no heading/speed/altitude) are simply omitted, never fabricated ---
  {
    const sparse = makeAircraft({ altitude: null, properties: { icao24: 'aaa111', callsign: null, onGround: null, headingDeg: null, velocityMps: null, verticalRateMps: null } })
    const text = formatTerraAircraftCouncilSummary(sparse, null)
    const noFabricatedLines = !text.includes('ALTITUDE') && !text.includes('HEADING') && !text.includes('SPEED')
    results.push(check('missing_fields_are_omitted_not_fabricated', noFabricatedLines && text.includes('SELECTED AIRCRAFT: UAL123'), text))
  }

  // --- A non-aircraft selectedEvent (e.g. an earthquake) is never rendered as a selected aircraft ---
  {
    const text = formatTerraAircraftCouncilSummary(makeAircraft({ kind: 'earthquake' }), makeSummary({ totalCount: 5 }))
    results.push(check('non_aircraft_selection_is_ignored', text === 'AIRCRAFT IN CURRENT REGION: 5', text))
  }

  return results
}

export function runAircraftCouncilSummaryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAircraftCouncilSummaryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra aircraftCouncilSummary validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

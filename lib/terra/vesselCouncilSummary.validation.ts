/**
 * Deterministic regression suite for the Council-facing vessel summary formatter. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/vesselCouncilSummary.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature } from './types'
import type { TerraVesselRegionalSummary } from './vesselRegionalSummary'
import { formatTerraVesselCouncilSummary } from './vesselCouncilSummary'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeVessel(overrides: Partial<TerraGeoFeature> = {}): TerraGeoFeature {
  return {
    id: 'digitraffic_marine:230123456',
    eventId: 'digitraffic_marine:230123456',
    providerId: 'digitraffic_marine',
    kind: 'vessel_position',
    longitude: 24.95,
    latitude: 60.15,
    altitude: null,
    timestamp: '2026-08-27T00:59:50.000Z',
    title: 'FINNMAID',
    summary: null,
    properties: { mmsi: '230123456', imo: '9264727', shipTypeLabel: 'Passenger', speedKnots: 14.2, navStatLabel: 'Under way using engine', destination: 'HELSINKI' },
    provenance: { provider: 'digitraffic_marine', sourceUrl: null, retrievedAt: '2026-08-27T01:00:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: '230123456', canonicalUrl: null },
    coordinateOrigin: 'source_embedded',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<TerraVesselRegionalSummary> = {}): TerraVesselRegionalSummary {
  return { provider: 'digitraffic_marine', totalCount: 12, movingCount: 9, stationaryCount: 3, staleCount: 0, averageSpeedKnots: 8.5, earliestObservedAt: null, latestObservedAt: null, ...overrides }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- Nothing selected, no summary, no coverage state: an honest empty string ---
  {
    const text = formatTerraVesselCouncilSummary(null, null, null)
    results.push(check('nothing_selected_produces_empty_summary', text === '', JSON.stringify(text)))
  }

  // --- Coverage state is always surfaced when provided, even before any vessel data ---
  {
    const text = formatTerraVesselCouncilSummary(null, null, 'NO_COVERAGE')
    results.push(check('no_coverage_state_is_reported_even_with_no_summary', text === 'MARITIME COVERAGE: NO AIS COVERAGE HERE', text))
  }

  // --- Mission-critical: NO_COVERAGE and a genuinely empty regional summary must read differently ---
  {
    const noCoverageText = formatTerraVesselCouncilSummary(null, makeSummary({ totalCount: 0, movingCount: 0, stationaryCount: 0 }), 'NO_COVERAGE')
    const noVesselsText = formatTerraVesselCouncilSummary(null, makeSummary({ totalCount: 0, movingCount: 0, stationaryCount: 0 }), 'NO_VESSELS_OBSERVED')
    results.push(check('no_coverage_and_no_vessels_observed_produce_distinct_text', noCoverageText !== noVesselsText, `${noCoverageText} | ${noVesselsText}`))
    results.push(check('no_coverage_text_names_coverage_not_vessel_count', noCoverageText.includes('NO AIS COVERAGE'), noCoverageText))
  }

  // --- Regional summary alone reports real counts, no selected-vessel lines ---
  {
    const text = formatTerraVesselCouncilSummary(null, makeSummary(), 'LIVE_DATA_PRESENT')
    const expected = ['MARITIME COVERAGE: LIVE', 'VESSELS IN CURRENT REGION: 12', 'MOVING: 9 · STATIONARY: 3'].join('\n')
    results.push(check('regional_summary_alone_matches_expected_format', text === expected, text))
  }

  // --- A selected vessel with every real field reports each one ---
  {
    const text = formatTerraVesselCouncilSummary(makeVessel(), makeSummary(), 'LIVE_DATA_PRESENT')
    results.push(check('selected_vessel_reports_name', text.includes('SELECTED VESSEL: FINNMAID'), text))
    results.push(check('selected_vessel_reports_mmsi_and_imo', text.includes('MMSI: 230123456') && text.includes('IMO: 9264727'), text))
    results.push(check('selected_vessel_reports_type_speed_navstatus_destination', text.includes('TYPE: Passenger') && text.includes('SPEED: 14.2 kn') && text.includes('NAV STATUS: Under way using engine') && text.includes('DESTINATION: HELSINKI'), text))
    results.push(check('selected_vessel_reports_source', text.includes('SOURCE: digitraffic_marine'), text))
  }

  // --- Missing optional fields (no IMO/destination) are simply omitted, never fabricated ---
  {
    const sparse = makeVessel({ properties: { mmsi: '999999999' } })
    const text = formatTerraVesselCouncilSummary(sparse, null, null)
    const noFabricatedLines = !text.includes('IMO') && !text.includes('DESTINATION') && !text.includes('TYPE')
    results.push(check('missing_fields_are_omitted_not_fabricated', noFabricatedLines && text.includes('SELECTED VESSEL:'), text))
  }

  // --- A non-vessel selectedEvent (e.g. an aircraft) is never rendered as a selected vessel ---
  {
    const text = formatTerraVesselCouncilSummary(makeVessel({ kind: 'aircraft_state' }), makeSummary({ totalCount: 5 }), 'LIVE_DATA_PRESENT')
    results.push(check('non_vessel_selection_is_ignored', !text.includes('SELECTED VESSEL'), text))
  }

  return results
}

export function runVesselCouncilSummaryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runVesselCouncilSummaryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra vesselCouncilSummary validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

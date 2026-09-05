/**
 * Deterministic regression suite for the aircraft regional summary. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aircraftRegionalSummary.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature } from './types'
import { summarizeTerraAircraftFeatures } from './aircraftRegionalSummary'

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
    altitude: 10000,
    timestamp: '2026-08-27T00:59:55.000Z',
    title: 'UAL123',
    summary: null,
    properties: { icao24: 'aaa111', callsign: 'UAL123', onGround: false, headingDeg: 271, velocityMps: 230, verticalRateMps: 0 },
    provenance: { provider: 'opensky', sourceUrl: null, retrievedAt: '2026-08-27T01:00:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: 'aaa111', canonicalUrl: null },
    coordinateOrigin: 'source_embedded',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    pathCoordinates: null,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const now = '2026-08-27T01:00:00.000Z'

  // --- Empty set is an honest zeroed summary, never fabricated activity ---
  {
    const summary = summarizeTerraAircraftFeatures([], now)
    results.push(check('empty_set_is_honest_zeros', summary.totalCount === 0 && summary.averageAltitudeMeters === null && summary.earliestObservedAt === null, JSON.stringify(summary)))
  }

  // --- Mixed airborne/on-ground/stale counts are computed correctly ---
  {
    const features = [
      makeAircraft({ id: 'a', properties: { ...makeAircraft().properties, onGround: false } }),
      makeAircraft({ id: 'b', properties: { ...makeAircraft().properties, onGround: true }, altitude: 0 }),
      makeAircraft({ id: 'c', properties: { ...makeAircraft().properties, onGround: false }, timestamp: '2026-08-27T00:50:00.000Z' }),
    ]
    const summary = summarizeTerraAircraftFeatures(features, now)
    results.push(check('total_and_ground_air_split_is_correct', summary.totalCount === 3 && summary.airborneCount === 2 && summary.onGroundCount === 1, JSON.stringify(summary)))
    results.push(check('stale_count_reflects_old_last_contact', summary.staleCount === 1, JSON.stringify(summary)))
  }

  // --- Average altitude is computed only over airborne aircraft with a known altitude ---
  {
    const features = [
      makeAircraft({ id: 'a', altitude: 10000, properties: { ...makeAircraft().properties, onGround: false } }),
      makeAircraft({ id: 'b', altitude: 12000, properties: { ...makeAircraft().properties, onGround: false } }),
      makeAircraft({ id: 'c', altitude: 0, properties: { ...makeAircraft().properties, onGround: true } }),
      makeAircraft({ id: 'd', altitude: null, properties: { ...makeAircraft().properties, onGround: false } }),
    ]
    const summary = summarizeTerraAircraftFeatures(features, now)
    results.push(check('average_altitude_excludes_on_ground_and_unknown_altitude', summary.averageAltitudeMeters === 11000, JSON.stringify(summary)))
  }

  // --- Observed time range spans the earliest/latest real timestamps ---
  {
    const features = [
      makeAircraft({ id: 'a', timestamp: '2026-08-27T00:55:00.000Z' }),
      makeAircraft({ id: 'b', timestamp: '2026-08-27T00:59:59.000Z' }),
    ]
    const summary = summarizeTerraAircraftFeatures(features, now)
    results.push(check('time_range_spans_earliest_to_latest', summary.earliestObservedAt === '2026-08-27T00:55:00.000Z' && summary.latestObservedAt === '2026-08-27T00:59:59.000Z', JSON.stringify(summary)))
  }

  // --- Non-aircraft features mixed into the array are ignored, never miscounted ---
  {
    const features = [makeAircraft(), makeAircraft({ id: 'quake', kind: 'earthquake' })]
    const summary = summarizeTerraAircraftFeatures(features, now)
    results.push(check('non_aircraft_features_are_ignored', summary.totalCount === 1, JSON.stringify(summary)))
  }

  return results
}

export function runAircraftRegionalSummaryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAircraftRegionalSummaryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra aircraftRegionalSummary validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

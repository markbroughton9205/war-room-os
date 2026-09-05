/**
 * Deterministic regression suite for the vessel regional summary. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/vesselRegionalSummary.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature } from './types'
import { summarizeTerraVesselFeatures } from './vesselRegionalSummary'

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
    timestamp: '2026-08-27T00:59:55.000Z',
    title: 'FINNMAID',
    summary: null,
    properties: { mmsi: '230123456', speedKnots: 14.2, courseDeg: 271, headingDeg: 270, navStatCode: '0' },
    provenance: { provider: 'digitraffic_marine', sourceUrl: null, retrievedAt: '2026-08-27T01:00:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: '230123456', canonicalUrl: null },
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
    const summary = summarizeTerraVesselFeatures([], now)
    results.push(check('empty_set_is_honest_zeros', summary.totalCount === 0 && summary.averageSpeedKnots === null && summary.earliestObservedAt === null, JSON.stringify(summary)))
  }

  // --- Mixed moving/stationary/stale counts are computed correctly ---
  {
    const features = [
      makeVessel({ id: 'a', properties: { ...makeVessel().properties, speedKnots: 12.0 } }),
      makeVessel({ id: 'b', properties: { ...makeVessel().properties, speedKnots: 0.0 } }),
      makeVessel({ id: 'c', properties: { ...makeVessel().properties, speedKnots: 6.0 }, timestamp: '2026-08-27T00:40:00.000Z' }),
    ]
    const summary = summarizeTerraVesselFeatures(features, now)
    results.push(check('total_and_moving_stationary_split_is_correct', summary.totalCount === 3 && summary.movingCount === 2 && summary.stationaryCount === 1, JSON.stringify(summary)))
    results.push(check('stale_count_reflects_old_last_observed', summary.staleCount === 1, JSON.stringify(summary)))
  }

  // --- A vessel with no reported speed is neither moving nor stationary — never invented ---
  {
    const features = [
      makeVessel({ id: 'a', properties: { ...makeVessel().properties, speedKnots: 10.0 } }),
      makeVessel({ id: 'b', properties: { mmsi: '999', courseDeg: null, headingDeg: null, navStatCode: null } }),
    ]
    const summary = summarizeTerraVesselFeatures(features, now)
    results.push(check('unknown_speed_is_excluded_from_moving_and_stationary', summary.totalCount === 2 && summary.movingCount === 1 && summary.stationaryCount === 0, JSON.stringify(summary)))
  }

  // --- Average speed is computed only over vessels with a known real reported speed ---
  {
    const features = [
      makeVessel({ id: 'a', properties: { ...makeVessel().properties, speedKnots: 10.0 } }),
      makeVessel({ id: 'b', properties: { ...makeVessel().properties, speedKnots: 20.0 } }),
      makeVessel({ id: 'c', properties: { mmsi: '999' } }),
    ]
    const summary = summarizeTerraVesselFeatures(features, now)
    results.push(check('average_speed_excludes_unknown_speed_vessels', summary.averageSpeedKnots === 15.0, JSON.stringify(summary)))
  }

  // --- Observed time range spans the earliest/latest real timestamps ---
  {
    const features = [
      makeVessel({ id: 'a', timestamp: '2026-08-27T00:55:00.000Z' }),
      makeVessel({ id: 'b', timestamp: '2026-08-27T00:59:59.000Z' }),
    ]
    const summary = summarizeTerraVesselFeatures(features, now)
    results.push(check('time_range_spans_earliest_to_latest', summary.earliestObservedAt === '2026-08-27T00:55:00.000Z' && summary.latestObservedAt === '2026-08-27T00:59:59.000Z', JSON.stringify(summary)))
  }

  // --- Non-vessel features mixed into the array are ignored, never miscounted ---
  {
    const features = [makeVessel(), makeVessel({ id: 'aircraft', kind: 'aircraft_state' })]
    const summary = summarizeTerraVesselFeatures(features, now)
    results.push(check('non_vessel_features_are_ignored', summary.totalCount === 1, JSON.stringify(summary)))
  }

  return results
}

export function runVesselRegionalSummaryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runVesselRegionalSummaryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra vesselRegionalSummary validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

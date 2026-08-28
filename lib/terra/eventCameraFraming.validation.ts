/**
 * Deterministic regression suite for Terra event -> camera fly-to framing. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/eventCameraFraming.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature } from './types'
import { resolveTerraEventCameraFraming } from './eventCameraFraming'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeFeature(overrides: Partial<TerraGeoFeature> = {}): TerraGeoFeature {
  return {
    id: 'usgs_earthquake_feed:us7000abcd',
    eventId: 'usgs_earthquake_feed:us7000abcd',
    providerId: 'usgs_earthquake_feed',
    kind: 'earthquake',
    longitude: 166.1,
    latitude: -10.6,
    altitude: -35000,
    timestamp: '2026-08-26T10:00:00.000Z',
    title: 'M 4.9 - 35 km S of Lata, Solomon Islands',
    summary: null,
    properties: {},
    provenance: { provider: 'usgs_earthquake_feed', sourceUrl: null, retrievedAt: '2026-08-26T10:01:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: 'us7000abcd', canonicalUrl: null },
    coordinateOrigin: 'observed',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    pathCoordinates: null,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- Point event: uses the event's own exact coordinates, never a different position ---
  {
    const framing = resolveTerraEventCameraFraming(makeFeature())
    results.push(check('point_event_uses_exact_event_coordinates', framing.mode === 'point' && framing.longitude === 166.1 && framing.latitude === -10.6, JSON.stringify(framing)))
  }

  // --- Different kinds get different altitudes, not one fixed number for every event ---
  {
    const earthquake = resolveTerraEventCameraFraming(makeFeature({ kind: 'earthquake' }))
    const cyclone = resolveTerraEventCameraFraming(makeFeature({ kind: 'tropical_cyclone' }))
    const landmark = resolveTerraEventCameraFraming(makeFeature({ kind: 'landmark_poi' }))
    const allPoint = earthquake.mode === 'point' && cyclone.mode === 'point' && landmark.mode === 'point'
    const distinctAltitudes = allPoint && earthquake.altitudeMeters !== cyclone.altitudeMeters && cyclone.altitudeMeters > earthquake.altitudeMeters && earthquake.altitudeMeters > landmark.altitudeMeters
    results.push(check('event_kind_changes_altitude_cyclone_wider_than_earthquake_wider_than_landmark', distinctAltitudes, `${JSON.stringify(earthquake)} ${JSON.stringify(cyclone)} ${JSON.stringify(landmark)}`))
  }

  // --- Region geometry (a real polygon) is fit to its own bounding box, not a fixed altitude ---
  {
    const regionFeature = makeFeature({
      kind: 'severe_weather_alert',
      geometryKind: 'region',
      regionRings: [[[-101.93, 35.53], [-101.81, 35.62], [-101.62, 35.62], [-101.72, 35.37], [-101.93, 35.53]]],
      longitude: -101.77,
      latitude: 35.52,
    })
    const framing = resolveTerraEventCameraFraming(regionFeature)
    const fitsPolygon = framing.mode === 'rectangle' && framing.west <= -101.93 && framing.east >= -101.62 && framing.south <= 35.37 && framing.north >= 35.62
    results.push(check('region_geometry_fits_real_polygon_bounding_box', fitsPolygon, JSON.stringify(framing)))
  }

  // --- A tiny/degenerate polygon is still padded to a minimum usable span ---
  {
    const tinyRegionFeature = makeFeature({
      kind: 'severe_weather_alert',
      geometryKind: 'region',
      regionRings: [[[10.0001, 20.0001], [10.0002, 20.0001], [10.0002, 20.0002], [10.0001, 20.0002], [10.0001, 20.0001]]],
      longitude: 10.00015,
      latitude: 20.00015,
    })
    const framing = resolveTerraEventCameraFraming(tinyRegionFeature)
    const FLOAT_EPSILON = 1e-9
    const spanned = framing.mode === 'rectangle' && (framing.east - framing.west) >= 0.05 - FLOAT_EPSILON && (framing.north - framing.south) >= 0.05 - FLOAT_EPSILON
    results.push(check('degenerate_tiny_polygon_is_padded_to_minimum_span', spanned, JSON.stringify(framing)))
  }

  // --- Region kind with no rings (should not happen, but honestly falls back to point mode) ---
  {
    const framing = resolveTerraEventCameraFraming(makeFeature({ kind: 'severe_weather_alert', geometryKind: 'region', regionRings: null }))
    results.push(check('region_kind_with_no_rings_falls_back_to_point_mode', framing.mode === 'point', JSON.stringify(framing)))
  }

  return results
}

export function runTerraEventCameraFramingValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraEventCameraFramingValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra eventCameraFraming validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

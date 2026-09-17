/**
 * Deterministic nearby-camera ranking.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/nearbyCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { nearbyPublicCameras } from './nearbyCameras'
import type { NearbyCameraIndexFeature } from './nearbyCameras'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function camera(id: string, latitude: number, longitude: number): NearbyCameraIndexFeature {
  return {
    id,
    layerId: 'digitraffic_road_cameras',
    kind: 'traffic_camera',
    title: id,
    latitude,
    longitude,
    providerId: 'digitraffic_road_cameras',
    properties: { freshness: 'fresh', road: 'Road 1', direction: 'NORTH' },
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const ranked = nearbyPublicCameras({
    latitude: 60.1699,
    longitude: 24.9384,
    features: [
      camera('far', 61.5, 23.8),
      camera('near', 60.171, 24.94),
    ],
    maxKm: 40,
  })
  results.push(check('ranks_nearest_first', ranked[0]?.id === 'near', ranked[0]?.id ?? 'empty'))
  results.push(check('keeps_agency_and_feed_state', ranked[0]?.agency === 'Fintraffic / Digitraffic' && ranked[0]?.feedState === 'AVAILABLE', ranked[0]?.feedState ?? 'missing'))
  results.push(check('ignores_outside_radius', nearbyPublicCameras({
    latitude: 40.7,
    longitude: -74,
    features: [camera('helsinki', 60.17, 24.94)],
    maxKm: 40,
  }).length === 0, 'NY vs Helsinki'))
  results.push(check('rejects_non_finite_origin', nearbyPublicCameras({
    latitude: Number.NaN,
    longitude: 0,
    features: [camera('near', 60.17, 24.94)],
  }).length === 0, 'NaN origin'))
  return results
}

export function runNearbyCamerasValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNearbyCamerasValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Nearby cameras validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

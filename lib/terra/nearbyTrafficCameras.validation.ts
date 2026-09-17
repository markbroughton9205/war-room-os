/**
 * Local nearby-camera index — never leaks a user location to a provider.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/nearbyTrafficCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { findNearbyTrafficCameras, haversineDistanceKm, radiusToBoundingBox } from './nearbyTrafficCameras'
import type { TerraTrafficCameraRecord } from './trafficCameraRecord'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function camera(id: string, lat: number, lon: number): TerraTrafficCameraRecord {
  return {
    id, provider: 'ohgo', agency: 'ODOT', country: 'US', region: 'OH', road: 'I-71',
    locationName: id, lat, lon, direction: 'NB', bearing: 0, feedType: 'REFRESHED_IMAGE',
    imageUrl: null, streamUrl: null, viewerUrl: null, lastUpdated: null,
    freshnessState: 'UNAVAILABLE', coverageState: 'UNAVAILABLE', authState: 'PUBLIC_KEY_REQUIRED',
    license: null, attribution: 'ODOT / OHGO', sourceUrl: null,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const cincinnati = { lat: 39.1, lon: -84.5 }
  const near = camera('ohgo:near', 39.11, -84.51)
  const far = camera('ohgo:far', 41.5, -81.7)
  const hits = findNearbyTrafficCameras([near, far], cincinnati, 20)
  results.push(check('nearby_includes_close_camera', hits.some(hit => hit.id === 'ohgo:near'), `ids=${hits.map(h => h.id).join(',')}`))
  results.push(check('nearby_excludes_far_camera', !hits.some(hit => hit.id === 'ohgo:far'), 'cleveland excluded'))
  results.push(check('hits_are_sorted_by_distance', hits.length < 2 || hits[0].distanceKm <= hits[1].distanceKm, 'sorted'))
  results.push(check('zero_radius_returns_empty', findNearbyTrafficCameras([near], cincinnati, 0).length === 0, 'zero'))
  results.push(check('haversine_same_point_is_zero', haversineDistanceKm(39.1, -84.5, 39.1, -84.5) === 0, 'zero'))
  const box = radiusToBoundingBox(cincinnati, 10)
  results.push(check('radius_box_covers_origin', !!box && box.west < cincinnati.lon && box.east > cincinnati.lon && box.south < cincinnati.lat && box.north > cincinnati.lat, JSON.stringify(box)))
  return results
}

export function runNearbyTrafficCamerasValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNearbyTrafficCamerasValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra nearbyTrafficCameras validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

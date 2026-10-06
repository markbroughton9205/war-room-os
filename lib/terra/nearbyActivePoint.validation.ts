/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/nearbyActivePoint.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { resolveNearbyActivePoint } from './nearbyActivePoint'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const search = resolveNearbyActivePoint({
    activeLocation: { latitude: 41.1041339, longitude: -81.521585, label: 'Springdale Street', contextType: 'SEARCH', source: 'nominatim' },
    gps: { lat: 40.0, lon: -80.0, tracking: 'FOLLOWING' },
  })
  results.push(check(
    'accepted_search_drives_nearby',
    search?.source === 'SEARCH' && search.latitude === 41.1041339 && search.longitude === -81.521585,
    JSON.stringify(search),
  ))
  const gps = resolveNearbyActivePoint({
    activeLocation: { latitude: 41.08, longitude: -81.52, label: 'Commander GPS', contextType: 'GPS', source: 'coordinates' },
    gps: { lat: 41.08, lon: -81.52, tracking: 'FOLLOWING' },
  })
  results.push(check('gps_context_is_gps', gps?.source === 'GPS', gps?.source ?? 'null'))
  const click = resolveNearbyActivePoint({
    activeLocation: { latitude: 60.1699, longitude: 24.9384, label: 'Helsinki click', contextType: 'CLICK', source: 'coordinates' },
    gps: { lat: 40.0, lon: -80.0, tracking: 'OFF' },
  })
  results.push(check('map_click_is_click_not_viewport', click?.source === 'CLICK' && click.latitude === 60.1699, click?.source ?? 'null'))
  const camera = resolveNearbyActivePoint({
    activeLocation: { latitude: 22.3193, longitude: 114.1694, label: 'HK camera', contextType: 'CAMERA', source: 'coordinates' },
  })
  results.push(check('camera_inspect_is_camera', camera?.source === 'CAMERA', camera?.source ?? 'null'))
  const event = resolveNearbyActivePoint({
    activeLocation: { latitude: 1.3521, longitude: 103.8198, label: 'Singapore event', contextType: 'EVENT', source: 'coordinates' },
  })
  results.push(check('event_inspect_is_event', event?.source === 'EVENT', event?.source ?? 'null'))
  const handoff = resolveNearbyActivePoint({
    activeLocation: { latitude: 45.5017, longitude: -73.5673, label: 'Québec handoff', contextType: 'HANDOFF', source: 'nominatim' },
  })
  results.push(check('council_handoff_is_handoff', handoff?.source === 'HANDOFF', handoff?.source ?? 'null'))
  const viewport = resolveNearbyActivePoint({
    activeLocation: { latitude: 0, longitude: 0, label: 'Globe center', contextType: 'VIEWPORT', source: 'coordinates' },
    gps: null,
  })
  results.push(check('viewport_is_never_nearby_origin', viewport === null, JSON.stringify(viewport)))
  const none = resolveNearbyActivePoint({ activeLocation: null, gps: null })
  results.push(check('no_point_without_search_or_gps', none === null, String(none)))
  const gpsOnly = resolveNearbyActivePoint({
    activeLocation: null,
    gps: { lat: 41.08, lon: -81.52, tracking: 'FOLLOWING' },
  })
  results.push(check('gps_only_when_active', gpsOnly?.source === 'GPS', gpsOnly?.source ?? 'null'))
  const coords = resolveNearbyActivePoint({
    activeLocation: { latitude: 40.4168, longitude: -3.7038, label: '40.4168°, -3.7038°', contextType: 'COORDINATE', source: 'coordinates' },
  })
  results.push(check('typed_coordinates_are_coordinate', coords?.source === 'COORDINATE', coords?.source ?? 'null'))
  return results
}

export function runNearbyActivePointValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Nearby active point: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

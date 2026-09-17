/**
 * Deterministic suite for the federated traffic-camera schema. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/trafficCameraRecord.validation.ts
 */
import { pathToFileURL } from 'node:url'
import {
  bearingFromCameraDirection,
  normalizeCameraDirection,
  isValidWgs84Point,
  trafficCameraRecordToProperties,
  type TerraTrafficCameraRecord,
} from './trafficCameraRecord'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function sample(overrides: Partial<TerraTrafficCameraRecord> = {}): TerraTrafficCameraRecord {
  return {
    id: 'ohgo:123',
    provider: 'ohgo',
    agency: 'ODOT',
    country: 'US',
    region: 'OH',
    road: 'I-71',
    locationName: 'I-71 at 3rd Street',
    lat: 39.1,
    lon: -84.5,
    direction: 'NB',
    bearing: 0,
    feedType: 'REFRESHED_IMAGE',
    imageUrl: 'https://publicapi.ohgo.com/example.jpg',
    streamUrl: null,
    viewerUrl: null,
    lastUpdated: null,
    freshnessState: 'UNAVAILABLE',
    coverageState: 'UNAVAILABLE',
    authState: 'PUBLIC_KEY_REQUIRED',
    license: 'OHGO Public API',
    attribution: 'ODOT / OHGO',
    sourceUrl: 'https://publicapi.ohgo.com/api/v1/cameras',
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('northbound_bearing_is_0', bearingFromCameraDirection('NB') === 0, String(bearingFromCameraDirection('NB'))))
  results.push(check('ptz_bearing_is_null', bearingFromCameraDirection('PTZ') === null, 'PTZ'))
  results.push(check('unknown_direction_bearing_is_null', bearingFromCameraDirection('RANDOM') === null, 'unknown'))
  results.push(check('ptz_direction_normalizes_to_PTZ', normalizeCameraDirection('ptz') === 'PTZ', String(normalizeCameraDirection('ptz'))))
  results.push(check('valid_wgs84_accepted', isValidWgs84Point(39.1, -84.5), 'cincinnati'))
  results.push(check('out_of_range_rejected', !isValidWgs84Point(91, -84.5), 'lat 91'))

  const props = trafficCameraRecordToProperties(sample())
  results.push(check('live_refreshed_still_is_never_live_video', trafficCameraRecordToProperties(sample({ freshnessState: 'LIVE' })).freshness === 'still_image', String(trafficCameraRecordToProperties(sample({ freshnessState: 'LIVE' })).freshness)))
  results.push(check('stale_never_labeled_live', trafficCameraRecordToProperties(sample({ freshnessState: 'STALE' })).freshness === 'stale', 'stale'))
  results.push(check('schema_fields_round_trip', props.cameraId === 'ohgo:123' && props.agency === 'ODOT' && props.feedType === 'REFRESHED_IMAGE' && props.streamUrl === null, 'schema'))
  results.push(check('unavailable_freshness_is_unknown_legacy', props.freshness === 'unknown', String(props.freshness)))
  return results
}

export function runTrafficCameraRecordValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTrafficCameraRecordValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra trafficCameraRecord validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/coverageFederation.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { coverageProvidersForPoint, coverageQueryResult } from './coverageFederation'
import { PUBLIC_TERRA_LAYER_IDS } from './publicLayers'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const REGIONS: { name: string; lat: number; lon: number; expectCamera?: string }[] = [
  { name: 'Akron, Ohio', lat: 41.0814, lon: -81.519, expectCamera: 'ohgo' },
  { name: 'New York City', lat: 40.7128, lon: -74.006, expectCamera: '511ny' },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, expectCamera: 'caltrans_cctv' },
  { name: 'Florida', lat: 27.6648, lon: -81.5158 },
  { name: 'Ontario', lat: 43.6532, lon: -79.3832, expectCamera: 'ontario_511_cameras' },
  { name: 'Québec', lat: 45.5017, lon: -73.5673, expectCamera: 'quebec_511_cameras' },
  { name: 'Finland', lat: 60.1699, lon: 24.9384, expectCamera: 'digitraffic_road_cameras' },
  { name: 'Hong Kong', lat: 22.3193, lon: 114.1694, expectCamera: 'hong_kong_td_cameras' },
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
  { name: 'rural Maryland', lat: 39.0458, lon: -76.6413 },
  { name: 'rural Ohio', lat: 40.4173, lon: -82.9071, expectCamera: 'ohgo' },
]

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('public_weather_not_commander_gated', PUBLIC_TERRA_LAYER_IDS.has('met_no') && PUBLIC_TERRA_LAYER_IDS.has('open_meteo'), 'met_no+open_meteo public'))
  results.push(check('public_science_not_commander_gated', PUBLIC_TERRA_LAYER_IDS.has('gbif') && PUBLIC_TERRA_LAYER_IDS.has('obis'), 'gbif+obis public'))
  results.push(check('opensky_remains_protected', !PUBLIC_TERRA_LAYER_IDS.has('opensky'), 'opensky gated'))
  results.push(check('weather_is_global', coverageProvidersForPoint(41.08, -81.52, 'weather').some(row => row.id === 'met_no'), 'MET Norway global'))

  for (const region of REGIONS) {
    const cameras = coverageQueryResult({ latitude: region.lat, longitude: region.lon, category: 'cameras', liveCount: 0 })
    if (region.expectCamera) {
      const expected = region.expectCamera === '511ny' ? 'PARTIAL' : 'COVERED'
      results.push(check(
        `${region.name}_camera_not_global_no_coverage`,
        cameras.result === expected && cameras.providers.some(row => row.id === region.expectCamera),
        cameras.reason,
      ))
    } else {
      results.push(check(
        `${region.name}_camera_honest`,
        cameras.result === 'NO_COVERAGE' || cameras.result === 'PARTIAL',
        cameras.reason,
      ))
    }
    const weather = coverageProvidersForPoint(region.lat, region.lon, 'weather')
    results.push(check(`${region.name}_has_public_weather`, weather.some(row => row.id === 'met_no' || row.id === 'open_meteo'), weather.map(row => row.id).join(',')))
  }
  return results
}

export function runCoverageFederationValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Coverage federation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

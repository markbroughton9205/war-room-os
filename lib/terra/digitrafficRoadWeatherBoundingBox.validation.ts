/**
 * Deterministic regression suite for the Digitraffic road-weather bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/digitrafficRoadWeatherBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraRoadWeatherBoundingBoxQuery, terraCameraViewHasRoadWeatherCoverage, DIGITRAFFIC_ROAD_WEATHER_COVERAGE_BBOX } from './digitrafficRoadWeatherBoundingBox'
import { DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX } from './roadCameraBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const helsinki = { west: 24.5, south: 59.9, east: 25.3, north: 60.3 }

  results.push(check('helsinki_view_builds_a_snapped_query', buildTerraRoadWeatherBoundingBoxQuery(helsinki) === '59.9,24.5,60.3,25.3', JSON.stringify(buildTerraRoadWeatherBoundingBoxQuery(helsinki))))
  results.push(check('coverage_envelope_is_shared_with_road_cameras', DIGITRAFFIC_ROAD_WEATHER_COVERAGE_BBOX === DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX, 'same Fintraffic network, not a duplicate constant'))
  results.push(check('null_rectangle_is_no_query', buildTerraRoadWeatherBoundingBoxQuery(null) === null, 'null'))
  results.push(check('stockholm_is_outside_finland_coverage', buildTerraRoadWeatherBoundingBoxQuery({ west: 17.8, south: 59.2, east: 18.3, north: 59.5 }) === null, 'no intersect'))
  results.push(check('stockholm_has_no_coverage_flag', terraCameraViewHasRoadWeatherCoverage({ west: 17.8, south: 59.2, east: 18.3, north: 59.5 }) === false, 'false'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraRoadWeatherBoundingBoxQuery({ west: 25.3, south: 60.3, east: 24.5, north: 59.9 }) === null, 'inverted'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraRoadWeatherBoundingBoxQuery({ west: 10, south: 50, east: 60, north: 75 }) === null, 'span too large'))

  return results
}

export function runDigitrafficRoadWeatherBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runDigitrafficRoadWeatherBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra digitrafficRoadWeatherBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

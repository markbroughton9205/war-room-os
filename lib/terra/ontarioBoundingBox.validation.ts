/**
 * Deterministic regression suite for the Ontario 511 bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/ontarioBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraOntario511BoundingBoxQuery, terraCameraViewHasOntario511Coverage, ONTARIO_511_COVERAGE_BBOX } from './ontarioBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const toronto = { west: -79.6, south: 43.5, east: -79.1, north: 43.9 }

  results.push(check('toronto_view_builds_a_real_query', buildTerraOntario511BoundingBoxQuery(toronto) === '43.50,-79.60,43.90,-79.10', JSON.stringify(buildTerraOntario511BoundingBoxQuery(toronto))))
  results.push(check('null_rectangle_is_no_query', buildTerraOntario511BoundingBoxQuery(null) === null, 'null'))
  results.push(check('vancouver_is_outside_ontario_coverage', buildTerraOntario511BoundingBoxQuery({ west: -123.3, south: 49.0, east: -122.7, north: 49.4 }) === null, 'no intersect'))
  results.push(check('vancouver_has_no_coverage_flag', terraCameraViewHasOntario511Coverage({ west: -123.3, south: 49.0, east: -122.7, north: 49.4 }) === false, 'false'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraOntario511BoundingBoxQuery({ west: -79.1, south: 43.9, east: -79.6, north: 43.5 }) === null, 'inverted'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraOntario511BoundingBoxQuery({ west: -120, south: 30, east: -60, north: 60 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_ontario', ONTARIO_511_COVERAGE_BBOX.west <= -95 && ONTARIO_511_COVERAGE_BBOX.east >= -75 && ONTARIO_511_COVERAGE_BBOX.south <= 42, JSON.stringify(ONTARIO_511_COVERAGE_BBOX)))
  results.push(check('non_finite_values_are_rejected', terraCameraViewHasOntario511Coverage({ west: -79.6, south: 43.5, east: -79.1, north: NaN }) === false, 'NaN north'))

  return results
}

export function runOntarioBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runOntarioBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra ontarioBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

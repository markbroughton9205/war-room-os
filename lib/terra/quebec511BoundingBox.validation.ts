/**
 * Deterministic regression suite for the Québec 511 bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/quebec511BoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraQuebec511BoundingBoxQuery, terraCameraViewHasQuebec511Coverage, QUEBEC_511_COVERAGE_BBOX } from './quebec511BoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const montreal = { west: -74.2, south: 45.3, east: -73.3, north: 45.8 }

  results.push(check('montreal_view_builds_a_real_query', buildTerraQuebec511BoundingBoxQuery(montreal) === '45.30,-74.20,45.80,-73.30', JSON.stringify(buildTerraQuebec511BoundingBoxQuery(montreal))))
  results.push(check('null_rectangle_is_no_query', buildTerraQuebec511BoundingBoxQuery(null) === null, 'null'))
  results.push(check('ontario_toronto_is_outside_qc_coverage', buildTerraQuebec511BoundingBoxQuery({ west: -79.6, south: 43.5, east: -79.1, north: 43.9 }) === null, 'south of coverage'))
  results.push(check('toronto_has_no_coverage_flag', terraCameraViewHasQuebec511Coverage({ west: -79.6, south: 43.5, east: -79.1, north: 43.9 }) === false, 'false'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraQuebec511BoundingBoxQuery({ west: -73.3, south: 45.8, east: -74.2, north: 45.3 }) === null, 'inverted'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraQuebec511BoundingBoxQuery({ west: -100, south: 40, east: -50, north: 60 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_quebec', QUEBEC_511_COVERAGE_BBOX.west <= -79 && QUEBEC_511_COVERAGE_BBOX.east >= -58 && QUEBEC_511_COVERAGE_BBOX.north >= 62, JSON.stringify(QUEBEC_511_COVERAGE_BBOX)))
  results.push(check('non_finite_values_are_rejected', terraCameraViewHasQuebec511Coverage({ west: -74.2, south: Infinity, east: -73.3, north: 45.8 }) === false, 'Infinity south'))

  return results
}

export function runQuebec511BoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runQuebec511BoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra quebec511BoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

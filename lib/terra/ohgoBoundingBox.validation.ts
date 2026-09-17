/**
 * Deterministic regression suite for the OHGO bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/ohgoBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraOhgoBoundingBoxQuery, terraCameraViewHasOhgoCoverage, OHGO_COVERAGE_BBOX } from './ohgoBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const akron = { west: -81.70, south: 41.00, east: -81.30, north: 41.20 }

  results.push(check('akron_view_builds_a_real_query', buildTerraOhgoBoundingBoxQuery(akron) === '41.00,-81.70,41.20,-81.30', JSON.stringify(buildTerraOhgoBoundingBoxQuery(akron))))
  results.push(check('null_rectangle_is_no_query', buildTerraOhgoBoundingBoxQuery(null) === null, 'null'))
  results.push(check('london_is_outside_ohio_coverage', buildTerraOhgoBoundingBoxQuery({ west: -0.5, south: 51.3, east: 0.2, north: 51.7 }) === null, 'no intersect'))
  results.push(check('london_has_no_coverage_flag', terraCameraViewHasOhgoCoverage({ west: -0.5, south: 51.3, east: 0.2, north: 51.7 }) === false, 'false'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraOhgoBoundingBoxQuery({ west: -81.30, south: 41.20, east: -81.70, north: 41.00 }) === null, 'east<=west'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraOhgoBoundingBoxQuery({ west: -95, south: 30, east: -70, north: 50 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_ohio', OHGO_COVERAGE_BBOX.west <= -84.8 && OHGO_COVERAGE_BBOX.east >= -80.6 && OHGO_COVERAGE_BBOX.south <= 38.5 && OHGO_COVERAGE_BBOX.north >= 41.8, JSON.stringify(OHGO_COVERAGE_BBOX)))
  results.push(check('akron_point_is_inside_coverage', terraCameraViewHasOhgoCoverage(akron) === true, 'akron'))
  results.push(check('non_finite_values_are_rejected', buildTerraOhgoBoundingBoxQuery({ west: NaN, south: 41.00, east: -81.30, north: 41.20 }) === null, 'NaN west'))

  return results
}

export function runOhgoBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runOhgoBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra ohgoBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

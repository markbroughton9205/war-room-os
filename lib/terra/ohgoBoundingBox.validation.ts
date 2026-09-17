/**
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
  const cincinnati = { west: -84.6, south: 39.0, east: -84.3, north: 39.3 }
  results.push(check('cincinnati_view_builds_a_real_query', buildTerraOhgoBoundingBoxQuery(cincinnati) === '39.00,-84.60,39.30,-84.30', JSON.stringify(buildTerraOhgoBoundingBoxQuery(cincinnati))))
  results.push(check('null_rectangle_is_no_query', buildTerraOhgoBoundingBoxQuery(null) === null, 'null'))
  results.push(check('manhattan_is_outside_ohio_coverage', buildTerraOhgoBoundingBoxQuery({ west: -74.1, south: 40.6, east: -73.8, north: 40.9 }) === null, 'no intersect'))
  results.push(check('manhattan_has_no_coverage_flag', terraCameraViewHasOhgoCoverage({ west: -74.1, south: 40.6, east: -73.8, north: 40.9 }) === false, 'false'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraOhgoBoundingBoxQuery({ west: -90, south: 30, east: -70, north: 50 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_ohio', OHGO_COVERAGE_BBOX.west <= -84.5 && OHGO_COVERAGE_BBOX.east >= -81 && OHGO_COVERAGE_BBOX.south <= 39 && OHGO_COVERAGE_BBOX.north >= 41.5, JSON.stringify(OHGO_COVERAGE_BBOX)))
  results.push(check('non_finite_values_are_rejected', terraCameraViewHasOhgoCoverage({ west: -84.6, south: 39.0, east: -84.3, north: NaN }) === false, 'NaN north'))
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

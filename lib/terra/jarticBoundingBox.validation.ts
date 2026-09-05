/**
 * Deterministic regression suite for the JARTIC bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/jarticBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraJarticBoundingBoxQuery, terraCameraViewHasJarticCoverage, JARTIC_COVERAGE_BBOX } from './jarticBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const tokyo = { west: 139.0, south: 35.0, east: 140.0, north: 36.0 }

  results.push(check('tokyo_view_builds_a_real_query', buildTerraJarticBoundingBoxQuery(tokyo) === '35.00,139.00,36.00,140.00', JSON.stringify(buildTerraJarticBoundingBoxQuery(tokyo))))
  results.push(check('null_rectangle_is_no_query', buildTerraJarticBoundingBoxQuery(null) === null, 'null'))
  results.push(check('seoul_is_outside_japan_coverage', buildTerraJarticBoundingBoxQuery({ west: 126.7, south: 37.4, east: 127.3, north: 37.8 }) === null, 'no intersect'))
  results.push(check('seoul_has_no_coverage_flag', terraCameraViewHasJarticCoverage({ west: 126.7, south: 37.4, east: 127.3, north: 37.8 }) === false, 'false'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraJarticBoundingBoxQuery({ west: 140.0, south: 36.0, east: 139.0, north: 35.0 }) === null, 'inverted'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraJarticBoundingBoxQuery({ west: 120, south: 20, east: 150, north: 50 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_japan', JARTIC_COVERAGE_BBOX.west >= 122 && JARTIC_COVERAGE_BBOX.east <= 146.5 && JARTIC_COVERAGE_BBOX.north >= 45, JSON.stringify(JARTIC_COVERAGE_BBOX)))
  results.push(check('non_finite_values_are_rejected', buildTerraJarticBoundingBoxQuery({ west: 139.0, south: 35.0, east: NaN, north: 36.0 }) === null, 'NaN east'))

  return results
}

export function runJarticBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runJarticBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra jarticBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

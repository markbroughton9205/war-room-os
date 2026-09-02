/**
 * Deterministic regression suite for the Hong Kong TD bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/hongKongBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraHongKongTdBoundingBoxQuery, terraCameraViewHasHongKongTdCoverage, HONG_KONG_TD_COVERAGE_BBOX } from './hongKongBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const urbanHk = { west: 114.1, south: 22.25, east: 114.25, north: 22.35 }

  results.push(check('urban_hk_view_builds_a_real_query', buildTerraHongKongTdBoundingBoxQuery(urbanHk) === '22.25,114.10,22.35,114.25', JSON.stringify(buildTerraHongKongTdBoundingBoxQuery(urbanHk))))
  results.push(check('null_rectangle_is_no_query', buildTerraHongKongTdBoundingBoxQuery(null) === null, 'null'))
  results.push(check('london_is_outside_hk_coverage', buildTerraHongKongTdBoundingBoxQuery({ west: -0.5, south: 51.3, east: 0.2, north: 51.7 }) === null, 'no intersect'))
  results.push(check('london_has_no_coverage_flag', terraCameraViewHasHongKongTdCoverage({ west: -0.5, south: 51.3, east: 0.2, north: 51.7 }) === false, 'false'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraHongKongTdBoundingBoxQuery({ west: 114.25, south: 22.35, east: 114.1, north: 22.25 }) === null, 'east<=west'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraHongKongTdBoundingBoxQuery({ west: 100, south: 10, east: 120, north: 40 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_hk_sar', HONG_KONG_TD_COVERAGE_BBOX.west >= 113 && HONG_KONG_TD_COVERAGE_BBOX.east <= 115 && HONG_KONG_TD_COVERAGE_BBOX.south >= 22 && HONG_KONG_TD_COVERAGE_BBOX.north <= 23, JSON.stringify(HONG_KONG_TD_COVERAGE_BBOX)))
  results.push(check('non_finite_values_are_rejected', buildTerraHongKongTdBoundingBoxQuery({ west: NaN, south: 22.25, east: 114.25, north: 22.35 }) === null, 'NaN west'))

  return results
}

export function runHongKongBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runHongKongBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra hongKongBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

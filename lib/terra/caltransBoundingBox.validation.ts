/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/caltransBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraCaltransBoundingBoxQuery, terraCameraViewHasCaltransCoverage, caltransDistrictsIntersecting, CALTRANS_COVERAGE_BBOX } from './caltransBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const la = { west: -118.4, south: 33.9, east: -118.1, north: 34.2 }
  results.push(check('la_view_builds_a_real_query', buildTerraCaltransBoundingBoxQuery(la) === '33.90,-118.40,34.20,-118.10', JSON.stringify(buildTerraCaltransBoundingBoxQuery(la))))
  results.push(check('la_intersects_southern_districts', caltransDistrictsIntersecting(la).some(id => id === 'd7' || id === 'd12'), caltransDistrictsIntersecting(la).join(',')))
  results.push(check('ohio_is_outside_california', terraCameraViewHasCaltransCoverage({ west: -84.6, south: 39.0, east: -84.3, north: 39.3 }) === false, 'ohio'))
  results.push(check('ohio_intersects_no_districts', caltransDistrictsIntersecting({ west: -84.6, south: 39.0, east: -84.3, north: 39.3 }).length === 0, 'none'))
  results.push(check('null_rectangle_is_no_query', buildTerraCaltransBoundingBoxQuery(null) === null, 'null'))
  results.push(check('coverage_bbox_is_california', CALTRANS_COVERAGE_BBOX.west <= -124 && CALTRANS_COVERAGE_BBOX.east >= -115 && CALTRANS_COVERAGE_BBOX.south <= 33 && CALTRANS_COVERAGE_BBOX.north >= 41, JSON.stringify(CALTRANS_COVERAGE_BBOX)))
  return results
}

export function runCaltransBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCaltransBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra caltransBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

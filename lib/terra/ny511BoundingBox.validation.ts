/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/ny511BoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraNy511BoundingBoxQuery, terraCameraViewHasNy511Coverage, NY511_COVERAGE_BBOX } from './ny511BoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const manhattan = { west: -74.1, south: 40.6, east: -73.8, north: 40.9 }
  results.push(check('manhattan_view_builds_a_real_query', buildTerraNy511BoundingBoxQuery(manhattan) === '40.60,-74.10,40.90,-73.80', JSON.stringify(buildTerraNy511BoundingBoxQuery(manhattan))))
  results.push(check('cincinnati_is_outside_ny_coverage', terraCameraViewHasNy511Coverage({ west: -84.6, south: 39.0, east: -84.3, north: 39.3 }) === false, 'ohio'))
  results.push(check('null_rectangle_is_no_query', buildTerraNy511BoundingBoxQuery(null) === null, 'null'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraNy511BoundingBoxQuery({ west: -80, south: 40, east: -70, north: 45 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_new_york', NY511_COVERAGE_BBOX.west <= -79 && NY511_COVERAGE_BBOX.east >= -72 && NY511_COVERAGE_BBOX.south <= 41 && NY511_COVERAGE_BBOX.north >= 44, JSON.stringify(NY511_COVERAGE_BBOX)))
  return results
}

export function runNy511BoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNy511BoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra ny511BoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

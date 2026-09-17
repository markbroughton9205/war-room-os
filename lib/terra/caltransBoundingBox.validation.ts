/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/caltransBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import {
  buildTerraCaltransBoundingBoxQuery,
  caltransDistrictStatusUrl,
  caltransDistrictsForRectangle,
  terraCameraViewHasCaltransCoverage,
} from './caltransBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const sf = { west: -122.55, south: 37.70, east: -122.35, north: 37.85 }
  results.push(check('sf_view_builds_a_real_query', buildTerraCaltransBoundingBoxQuery(sf) === '37.70,-122.55,37.85,-122.35', JSON.stringify(buildTerraCaltransBoundingBoxQuery(sf))))
  results.push(check('sf_is_covered', terraCameraViewHasCaltransCoverage(sf) === true, 'sf'))
  results.push(check('london_is_outside', terraCameraViewHasCaltransCoverage({ west: -0.5, south: 51.3, east: 0.2, north: 51.7 }) === false, 'london'))
  results.push(check('null_rectangle_is_no_query', buildTerraCaltransBoundingBoxQuery(null) === null, 'null'))
  const districts = caltransDistrictsForRectangle(sf)
  results.push(check('sf_is_district_4', districts.some(row => row.id === '04'), districts.map(row => row.id).join(',')))
  results.push(check(
    'd4_status_url_uses_unpadded_folder',
    caltransDistrictStatusUrl('04') === 'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json',
    caltransDistrictStatusUrl('04'),
  ))
  results.push(check('akron_is_outside_california', terraCameraViewHasCaltransCoverage({ west: -81.70, south: 41.00, east: -81.30, north: 41.20 }) === false, 'ohio'))
  return results
}

export function runCaltransBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCaltransBoundingBoxValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Caltrans bbox: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

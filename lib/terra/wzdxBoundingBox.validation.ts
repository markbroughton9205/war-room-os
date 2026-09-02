/**
 * Deterministic regression suite for the WZDx bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/wzdxBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraWzdxBoundingBoxQuery, terraCameraViewHasWzdxCoverage, WZDX_COVERAGE_BBOXES } from './wzdxBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const seattle = { west: -122.6, south: 47.2, east: -121.9, north: 47.9 }
  const desMoines = { west: -93.9, south: 41.4, east: -93.4, north: 41.8 }
  const louisville = { west: -85.9, south: 38.0, east: -85.4, north: 38.4 }

  results.push(check('three_state_coverage_envelopes_exist', Object.keys(WZDX_COVERAGE_BBOXES).length === 3, Object.keys(WZDX_COVERAGE_BBOXES).join(',')))
  results.push(check('seattle_builds_a_wsdot_query', buildTerraWzdxBoundingBoxQuery(seattle, 'wzdx_wsdot') === '47.20,-122.60,47.90,-121.90', JSON.stringify(buildTerraWzdxBoundingBoxQuery(seattle, 'wzdx_wsdot'))))
  results.push(check('seattle_is_not_iowa_coverage', buildTerraWzdxBoundingBoxQuery(seattle, 'wzdx_iowa_dot') === null, 'wrong state'))
  results.push(check('des_moines_is_iowa_coverage', buildTerraWzdxBoundingBoxQuery(desMoines, 'wzdx_iowa_dot') !== null, 'iowa ok'))
  results.push(check('louisville_is_kytc_coverage', terraCameraViewHasWzdxCoverage(louisville, 'wzdx_kytc') === true, 'kytc ok'))
  results.push(check('louisville_is_not_wsdot_coverage', terraCameraViewHasWzdxCoverage(louisville, 'wzdx_wsdot') === false, 'wrong state'))
  results.push(check('unknown_provider_has_no_coverage', terraCameraViewHasWzdxCoverage(seattle, 'webtris') === false, 'non-wzdx id'))
  results.push(check('null_rectangle_is_no_query', buildTerraWzdxBoundingBoxQuery(null, 'wzdx_wsdot') === null, 'null'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraWzdxBoundingBoxQuery({ west: -121.9, south: 47.9, east: -122.6, north: 47.2 }, 'wzdx_wsdot') === null, 'inverted'))

  return results
}

export function runWzdxBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runWzdxBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra wzdxBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

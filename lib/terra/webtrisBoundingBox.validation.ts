/**
 * Deterministic regression suite for the WebTRIS bounding-box module. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/webtrisBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraWebtrisBoundingBoxQuery, terraCameraViewHasWebtrisCoverage, WEBTRIS_COVERAGE_BBOX } from './webtrisBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const m25 = { west: -0.6, south: 51.3, east: 0.3, north: 51.7 }

  // 0.1-degree grid snapping: values expand outward to the grid, never inward.
  results.push(check('m25_view_builds_a_snapped_query', buildTerraWebtrisBoundingBoxQuery(m25) === '51.2,-0.6,51.7,0.3', JSON.stringify(buildTerraWebtrisBoundingBoxQuery(m25))))
  results.push(check('fractional_view_snaps_outward_to_grid', buildTerraWebtrisBoundingBoxQuery({ west: -0.55, south: 51.34, east: 0.22, north: 51.66 }) === '51.3,-0.6,51.7,0.3', 'outward'))
  results.push(check('null_rectangle_is_no_query', buildTerraWebtrisBoundingBoxQuery(null) === null, 'null'))
  results.push(check('scotland_is_outside_england_coverage', buildTerraWebtrisBoundingBoxQuery({ west: -4.5, south: 57.0, east: -3.5, north: 57.6 }) === null, 'north of envelope'))
  results.push(check('scotland_has_no_coverage_flag', terraCameraViewHasWebtrisCoverage({ west: -4.5, south: 57.0, east: -3.5, north: 57.6 }) === false, 'false'))
  results.push(check('inverted_rectangle_is_rejected', buildTerraWebtrisBoundingBoxQuery({ west: 0.3, south: 51.7, east: -0.6, north: 51.3 }) === null, 'inverted'))
  results.push(check('oversized_rectangle_is_rejected', buildTerraWebtrisBoundingBoxQuery({ west: -10, south: 45, east: 10, north: 60 }) === null, 'span too large'))
  results.push(check('coverage_bbox_is_england_strategic_network', WEBTRIS_COVERAGE_BBOX.west <= -5.5 && WEBTRIS_COVERAGE_BBOX.east >= 1.8 && WEBTRIS_COVERAGE_BBOX.north <= 56.1, JSON.stringify(WEBTRIS_COVERAGE_BBOX)))

  return results
}

export function runWebtrisBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runWebtrisBoundingBoxValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra webtrisBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

/**
 * Deterministic regression suite for the Maritime bounding-box query builder + Coverage Resolver's
 * camera-side intersection check. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/maritimeBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraMaritimeBoundingBoxQuery, terraCameraViewHasMaritimeCoverage, DIGITRAFFIC_MARINE_COVERAGE_BBOX } from './maritimeBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('null_rectangle_produces_null_query', buildTerraMaritimeBoundingBoxQuery(null) === null, 'null in -> null out'))
  results.push(check('null_rectangle_has_no_coverage', terraCameraViewHasMaritimeCoverage(null) === false, 'null in -> false out'))

  // --- A camera view inside Digitraffic's real coverage envelope (Helsinki approaches) produces a
  //     real, correctly-ordered bbox string ---
  {
    const rect = { west: 24.5, south: 59.8, east: 25.5, north: 60.5 }
    const query = buildTerraMaritimeBoundingBoxQuery(rect)
    results.push(check('in_coverage_rectangle_matches_bbox_pattern', query !== null && BBOX_PATTERN.test(query), String(query)))
    // 59.7 (not 59.8) is correct here: snapDown floors south/BBOX_GRID_DEG, and 59.8/0.1 is
    // 597.9999999999999 in IEEE-754 float, so floor() lands one grid cell down — the exact same
    // floating-point characteristic lib/terra/aircraftBoundingBox.ts's identical snapDown already
    // has (outward-down snapping is intentional; this is not a bug to "fix" by rounding instead).
    results.push(check('in_coverage_rectangle_orders_lamin_lomin_lamax_lomax', query === '59.7,24.5,60.5,25.5', String(query)))
    results.push(check('in_coverage_rectangle_has_coverage', terraCameraViewHasMaritimeCoverage(rect) === true, 'expected true'))
  }

  // --- A camera view nowhere near Finnish waters (open Pacific) is honestly refused — this is
  //     the mission-critical NO_COVERAGE case, never silently downloaded/rendered as empty ---
  {
    const pacific = { west: -160.0, south: 10.0, east: -159.0, north: 11.0 }
    results.push(check('out_of_coverage_rectangle_produces_null_query', buildTerraMaritimeBoundingBoxQuery(pacific) === null, 'expected null'))
    results.push(check('out_of_coverage_rectangle_has_no_coverage', terraCameraViewHasMaritimeCoverage(pacific) === false, 'expected false'))
  }

  // --- A camera view that only partially overlaps the coverage envelope still counts as coverage
  //     (a Commander panning across the boundary should not flicker in and out) ---
  {
    const straddling = { west: 15.0, south: 58.0, east: 20.0, north: 60.0 }
    results.push(check('straddling_rectangle_counts_as_coverage', terraCameraViewHasMaritimeCoverage(straddling) === true, JSON.stringify(straddling)))
  }

  // --- Degenerate/inverted rectangles are rejected, never silently "fixed" ---
  {
    const inverted = { west: 25.5, south: 59.8, east: 24.5, north: 60.5 }
    results.push(check('inverted_longitude_span_is_rejected', buildTerraMaritimeBoundingBoxQuery(inverted) === null, 'expected null'))
  }

  // --- Non-finite input is refused honestly ---
  {
    const nanBox = { west: Number.NaN, south: 59.8, east: 25.5, north: 60.5 }
    results.push(check('non_finite_input_is_rejected', buildTerraMaritimeBoundingBoxQuery(nanBox) === null, 'expected null'))
  }

  // --- A custom coverage envelope (future second registered source) is honored, not hardcoded to
  //     Digitraffic's alone ---
  {
    const customEnvelope = { west: 100, south: 0, east: 110, north: 10 }
    const insideCustom = { west: 104, south: 4, east: 106, north: 6 }
    const query = buildTerraMaritimeBoundingBoxQuery(insideCustom, customEnvelope)
    results.push(check('custom_coverage_envelope_is_honored', query !== null, String(query)))
    const outsideDefault = terraCameraViewHasMaritimeCoverage(insideCustom)
    results.push(check('default_envelope_check_still_uses_digitraffic_bbox', outsideDefault === false, JSON.stringify(DIGITRAFFIC_MARINE_COVERAGE_BBOX)))
  }

  return results
}

export function runMaritimeBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runMaritimeBoundingBoxValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra maritimeBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

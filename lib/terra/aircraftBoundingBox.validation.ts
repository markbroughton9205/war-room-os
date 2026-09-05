/**
 * Deterministic regression suite for the aircraft bounding-box query builder. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aircraftBoundingBox.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { buildTerraAircraftBoundingBoxQuery } from './aircraftBoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('null_rectangle_produces_null_query', buildTerraAircraftBoundingBoxQuery(null) === null, 'null in -> null out'))

  // --- A normal regional-scale rectangle produces a real, correctly-ordered bbox string ---
  {
    const query = buildTerraAircraftBoundingBoxQuery({ west: -83.0, south: 41.0, east: -81.0, north: 42.0 })
    results.push(check('normal_rectangle_matches_opensky_bbox_pattern', query !== null && BBOX_PATTERN.test(query), String(query)))
    results.push(check('normal_rectangle_orders_lamin_lomin_lamax_lomax', query === '41.0,-83.0,42.0,-81.0', String(query)))
  }

  // --- Degenerate/inverted rectangles are rejected, never silently "fixed" into a fake box ---
  {
    const inverted = buildTerraAircraftBoundingBoxQuery({ west: -81.0, south: 41.0, east: -83.0, north: 42.0 })
    results.push(check('inverted_longitude_span_is_rejected', inverted === null, String(inverted)))
    const zeroSpan = buildTerraAircraftBoundingBoxQuery({ west: -81.0, south: 41.0, east: -81.0, north: 42.0 })
    results.push(check('zero_width_span_is_rejected', zeroSpan === null, String(zeroSpan)))
  }

  // --- A rectangle wide enough to be "most of the visible hemisphere" is honestly refused, not
  //     silently downloaded anyway ---
  {
    const tooWide = buildTerraAircraftBoundingBoxQuery({ west: -170, south: -60, east: 170, north: 60 })
    results.push(check('oversized_rectangle_is_rejected_not_downloaded_anyway', tooWide === null, String(tooWide)))
  }

  // --- Small camera nudges within the same rounding grid converge on the identical bbox string,
  //     so consecutive settles reuse the Research Engine's 60s cache instead of always missing it ---
  {
    const a = buildTerraAircraftBoundingBoxQuery({ west: -83.02, south: 41.01, east: -81.04, north: 42.03 })
    const b = buildTerraAircraftBoundingBoxQuery({ west: -83.04, south: 41.03, east: -81.02, north: 42.01 })
    results.push(check('small_camera_nudges_converge_on_the_same_cache_key', a !== null && a === b, `${a} vs ${b}`))
  }

  // --- Out-of-range coordinates (within a normal span) are clamped to valid geographic bounds,
  //     never passed through raw ---
  {
    const clamped = buildTerraAircraftBoundingBoxQuery({ west: -185, south: -95, east: -175, north: -85 })
    results.push(check('out_of_range_coordinates_are_clamped', clamped === '-90.0,-180.0,-85.0,-175.0', String(clamped)))
  }

  // --- Non-finite input is refused honestly, never coerced into a bogus box ---
  {
    const nanBox = buildTerraAircraftBoundingBoxQuery({ west: Number.NaN, south: 41, east: -81, north: 42 })
    results.push(check('non_finite_input_is_rejected', nanBox === null, String(nanBox)))
  }

  // --- A real, valid span smaller than one grid cell (e.g. the Commander zoomed in tight at
  //     building scale) must never collapse into a degenerate lamin===lamax box after snapping —
  //     confirmed live against a real bug this exact scenario produced during browser
  //     verification (a "51.5,-0.5,51.5,-0.4" query, which OpenSky accepted as well-formed but
  //     honestly returned zero aircraft for). ---
  {
    const tiny = buildTerraAircraftBoundingBoxQuery({ west: -0.44, south: 51.53, east: -0.42, north: 51.55 })
    const parts = tiny?.split(',').map(Number) ?? []
    const [lamin, lomin, lamax, lomax] = parts
    results.push(check('tiny_real_span_never_collapses_to_a_degenerate_box', tiny !== null && lamax > lamin && lomax > lomin, String(tiny)))
  }

  return results
}

export function runAircraftBoundingBoxValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAircraftBoundingBoxValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra aircraftBoundingBox validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

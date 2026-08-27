/**
 * Deterministic regression suite for the bounded session-only aircraft trail. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aircraftTrail.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { updateTerraAircraftTrail, type TerraAircraftTrailPoint } from './aircraftTrail'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function point(lon: number, lat: number, ms: number): TerraAircraftTrailPoint {
  return { longitude: lon, latitude: lat, observedAtMs: ms }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- A genuinely new observation appends a point ---
  {
    const trail = updateTerraAircraftTrail([point(-81.8, 41.2, 1000)], point(-81.7, 41.3, 2000))
    results.push(check('new_observation_appends', trail.length === 2, JSON.stringify(trail)))
  }

  // --- A re-render with the identical last observation does not grow the trail ---
  {
    const existing = [point(-81.8, 41.2, 1000)]
    const trail = updateTerraAircraftTrail(existing, point(-81.8, 41.2, 1000))
    results.push(check('duplicate_observation_does_not_grow_trail', trail.length === 1, JSON.stringify(trail)))
  }

  // --- Point count is capped, keeping only the most recent ---
  {
    let trail: TerraAircraftTrailPoint[] = []
    for (let i = 0; i < 10; i++) trail = updateTerraAircraftTrail(trail, point(i, i, i * 1000), 4)
    results.push(check('point_count_is_capped', trail.length === 4, JSON.stringify(trail)))
    results.push(check('cap_keeps_most_recent_points', trail[trail.length - 1].observedAtMs === 9000, JSON.stringify(trail)))
  }

  // --- Points older than maxAgeMs are dropped, never carried forever ---
  {
    const existing = [point(0, 0, 0), point(1, 1, 100_000)]
    const trail = updateTerraAircraftTrail(existing, point(2, 2, 700_000), 6, 600_000)
    const noAncientPoints = !trail.some(p => p.observedAtMs === 0)
    results.push(check('stale_points_beyond_max_age_are_dropped', noAncientPoints, JSON.stringify(trail)))
  }

  // --- Empty existing trail seeds correctly with one point ---
  {
    const trail = updateTerraAircraftTrail([], point(-81.8, 41.2, 1000))
    results.push(check('empty_trail_seeds_with_one_point', trail.length === 1, JSON.stringify(trail)))
  }

  return results
}

export function runAircraftTrailValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAircraftTrailValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra aircraftTrail validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

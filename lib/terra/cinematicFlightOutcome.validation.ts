/**
 * Deterministic cinematic arrival-truth tests. Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/cinematicFlightOutcome.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { planCinematicFlyTo } from './cinematicFlyTo'
import {
  cameraSettledAtDestination,
  formatCinematicFlightStatus,
  resolveCinematicFlightOutcome,
} from './cinematicFlightOutcome'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const tokyo = { longitude: 139.6917, latitude: 35.6895, heightMeters: 12_000 }
  const pacific = { longitude: 145.0296, latitude: 26.7635, heightMeters: 6_500_000 }
  const akron = { longitude: -81.519, latitude: 41.081, heightMeters: 12_000 }

  results.push(check(
    'flying_false_is_not_arrived',
    resolveCinematicFlightOutcome({
      generationMatches: true,
      completeFired: false,
      cancelled: true,
      interrupted: false,
      superseded: false,
      settled: false,
    }) !== 'ARRIVED',
    'cancel without complete must not arrive',
  ))

  results.push(check(
    'interrupt_is_interrupted_not_arrived',
    resolveCinematicFlightOutcome({
      generationMatches: true,
      completeFired: false,
      cancelled: true,
      interrupted: true,
      superseded: false,
      settled: true,
    }) === 'INTERRUPTED',
    'manual drag wins even if camera happens to be near dest',
  ))

  results.push(check(
    'supersede_blocks_stale_complete',
    resolveCinematicFlightOutcome({
      generationMatches: false,
      completeFired: true,
      cancelled: false,
      interrupted: false,
      superseded: true,
      settled: true,
    }) === 'SUPERSEDED',
    'Tokyo complete after Akron Go cannot arrive',
  ))

  results.push(check(
    'complete_and_settled_is_arrived',
    resolveCinematicFlightOutcome({
      generationMatches: true,
      completeFired: true,
      cancelled: false,
      interrupted: false,
      superseded: false,
      settled: true,
    }) === 'ARRIVED',
    'success path',
  ))

  results.push(check(
    'complete_without_settle_is_failed',
    resolveCinematicFlightOutcome({
      generationMatches: true,
      completeFired: true,
      cancelled: false,
      interrupted: false,
      superseded: false,
      settled: false,
    }) === 'FAILED',
    'Pacific complete must not be Arrived',
  ))

  const tokyoPlan = planCinematicFlyTo({
    from: { longitude: -74.006, latitude: 40.7128, heightMeters: 800 },
    to: tokyo,
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check(
    'tokyo_camera_settles',
    cameraSettledAtDestination(tokyo, tokyoPlan.destination),
    JSON.stringify(tokyoPlan.destination),
  ))
  results.push(check(
    'pacific_is_not_tokyo_arrival',
    !cameraSettledAtDestination(pacific, tokyoPlan.destination),
    `pacific vs ${JSON.stringify(tokyoPlan.destination)}`,
  ))

  const nearTokyo = { longitude: 139.75, latitude: 35.70, heightMeters: 14_000 }
  results.push(check(
    'bounded_city_tolerance_allows_nearby_tokyo',
    cameraSettledAtDestination(nearTokyo, tokyoPlan.destination),
    'Chiyoda-adjacent camera is still Tokyo',
  ))

  const cameraPlan = planCinematicFlyTo({
    from: akron,
    to: { longitude: -81.51, latitude: 41.08, altitudeMeters: 1_400, placeType: 'traffic_camera' },
    prefersReducedMotion: false,
    instantRequested: false,
  })
  const nearbyCamera = { longitude: -81.52, latitude: 41.085, heightMeters: 1_500 }
  const farCamera = { longitude: -81.7, latitude: 41.5, heightMeters: 1_500 }
  results.push(check(
    'ohgo_camera_nearby_settles',
    cameraSettledAtDestination(nearbyCamera, cameraPlan.destination),
    JSON.stringify(cameraPlan.destination),
  ))
  results.push(check(
    'ohgo_camera_far_does_not_settle',
    !cameraSettledAtDestination(farCamera, cameraPlan.destination),
    JSON.stringify(cameraPlan.destination),
  ))
  results.push(check(
    'planet_height_over_destination_is_not_street_arrival',
    !cameraSettledAtDestination(
      { longitude: -81.51, latitude: 41.08, heightMeters: 6_500_000 },
      cameraPlan.destination,
    ),
    'city/planet altitude must not count as camera inspect arrival',
  ))

  results.push(check(
    'status_arrived_uses_label',
    formatCinematicFlightStatus({ outcome: 'ARRIVED', label: '東京都 / Tokyo' }) === 'Arrived · 東京都 / Tokyo',
    formatCinematicFlightStatus({ outcome: 'ARRIVED', label: '東京都 / Tokyo' }),
  ))
  results.push(check(
    'status_interrupt_is_manual_control',
    formatCinematicFlightStatus({ outcome: 'INTERRUPTED', label: 'Tokyo' }) === 'Interrupted · MANUAL CONTROL',
    formatCinematicFlightStatus({ outcome: 'INTERRUPTED', label: 'Tokyo' }),
  ))

  return results
}

export function runTerraCinematicFlightOutcomeValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraCinematicFlightOutcomeValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra cinematicFlightOutcome validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

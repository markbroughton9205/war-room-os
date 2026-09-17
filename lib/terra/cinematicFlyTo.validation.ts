/**
 * Deterministic cinematic fly-to planner tests. Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/cinematicFlyTo.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { haversineKm, planCinematicFlyTo, settleAltitudeMeters } from './cinematicFlyTo'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const nyc = { longitude: -74.006, latitude: 40.7128, heightMeters: 800 }
  const tokyo = { longitude: 139.6917, latitude: 35.6895 }

  const reduced = planCinematicFlyTo({
    from: nyc,
    to: tokyo,
    prefersReducedMotion: true,
    instantRequested: false,
  })
  results.push(check('reduced_motion_is_instant_zero_duration', reduced.mode === 'instant' && reduced.durationSeconds === 0, JSON.stringify(reduced)))

  const jump = planCinematicFlyTo({
    from: nyc,
    to: tokyo,
    prefersReducedMotion: false,
    instantRequested: true,
  })
  results.push(check('explicit_instant_jump_skips_cinematic', jump.mode === 'instant' && jump.durationSeconds === 0, JSON.stringify(jump)))

  const nearby = { longitude: -74.01, latitude: 40.715 }
  const short = planCinematicFlyTo({
    from: nyc,
    to: nearby,
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check('extremely_short_hop_is_direct_not_globe_traversal', short.mode === 'direct' && short.flyOverLongitude === null && short.durationSeconds < 2, JSON.stringify(short)))

  const distant = planCinematicFlyTo({
    from: nyc,
    to: tokyo,
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check('distant_flight_is_cinematic', distant.mode === 'cinematic', distant.mode))
  results.push(check('distant_flight_sets_flyover_longitude', distant.flyOverLongitude === tokyo.longitude, String(distant.flyOverLongitude)))
  results.push(check('distant_flight_pulls_back_when_low', distant.maximumHeightMeters !== null && distant.maximumHeightMeters > 1_000_000, String(distant.maximumHeightMeters)))
  results.push(check('distant_flight_duration_is_bounded', distant.durationSeconds >= 2.2 && distant.durationSeconds <= 8, String(distant.durationSeconds)))

  const km = haversineKm(nyc, tokyo)
  results.push(check('nyc_tokyo_distance_is_real_not_guessed', km > 10_000 && km < 12_000, `km=${km}`))

  results.push(check('postcode_settle_altitude_is_city_scale', settleAltitudeMeters('place/postcode', false) === 8_000, String(settleAltitudeMeters('place/postcode', false))))
  results.push(check('building_settle_altitude_is_close', settleAltitudeMeters('building/yes', false) === 900, String(settleAltitudeMeters('building/yes', false))))
  results.push(check('traffic_camera_settle_is_inspect_not_city', settleAltitudeMeters('traffic_camera', false) === 1_800, String(settleAltitudeMeters('traffic_camera', false))))

  const zipRect = planCinematicFlyTo({
    from: { longitude: 0, latitude: 0, heightMeters: 20_000_000 },
    to: {
      longitude: -81.519, latitude: 41.081,
      boundingBox: { south: 41.0, north: 41.2, west: -81.7, east: -81.3 },
      placeType: 'place/postcode',
    },
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check('bbox_destination_uses_rectangle', zipRect.destination.kind === 'rectangle', JSON.stringify(zipRect.destination)))

  const tower = planCinematicFlyTo({
    from: { longitude: 0, latitude: 0, heightMeters: 20_000_000 },
    to: {
      longitude: -81.6937,
      latitude: 41.4986,
      boundingBox: { south: 41.39, north: 41.63, west: -81.88, east: -81.48 },
      placeType: 'building',
    },
    prefersReducedMotion: false,
    instantRequested: true,
  })
  results.push(check(
    'building_with_city_bbox_uses_street_point_not_city_rectangle',
    tower.destination.kind === 'point' && tower.destination.heightMeters === 900,
    JSON.stringify(tower.destination),
  ))

  const cameraView = planCinematicFlyTo({
    from: { longitude: -81.52, latitude: 41.08, heightMeters: 12_000 },
    to: { longitude: -81.63, latitude: 41.24, altitudeMeters: 1_800, placeType: 'traffic_camera' },
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check(
    'camera_view_uses_inspect_point_altitude',
    cameraView.destination.kind === 'point' && cameraView.destination.heightMeters === 1_800,
    JSON.stringify(cameraView.destination),
  ))

  const distantCamera = planCinematicFlyTo({
    from: { longitude: 139.6917, latitude: 35.6895, heightMeters: 12_000 },
    to: { longitude: -81.63, latitude: 41.24, altitudeMeters: 22_000, placeType: 'traffic_camera' },
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check(
    'camera_view_never_planet_pullback',
    distantCamera.maximumHeightMeters == null && distantCamera.flyOverLongitude == null && distantCamera.pitchAdjustHeightMeters == null,
    JSON.stringify({ maximumHeightMeters: distantCamera.maximumHeightMeters, flyOverLongitude: distantCamera.flyOverLongitude, pitchAdjustHeightMeters: distantCamera.pitchAdjustHeightMeters }),
  ))
  results.push(check(
    'camera_view_ignores_discovery_altitude_and_bbox',
    distantCamera.destination.kind === 'point'
      && distantCamera.destination.heightMeters === 1_800
      && distantCamera.destination.longitude === -81.63
      && distantCamera.destination.latitude === 41.24,
    JSON.stringify(distantCamera.destination),
  ))

  const bboxCamera = planCinematicFlyTo({
    from: { longitude: -81.52, latitude: 41.08, heightMeters: 12_000 },
    to: {
      longitude: -81.63,
      latitude: 41.24,
      altitudeMeters: 1_800,
      placeType: 'traffic_camera',
      boundingBox: { south: 38, north: 42, west: -85, east: -80 },
    },
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check(
    'camera_view_ignores_coverage_rectangle',
    bboxCamera.destination.kind === 'point' && bboxCamera.destination.longitude === -81.63 && bboxCamera.destination.latitude === 41.24,
    JSON.stringify(bboxCamera.destination),
  ))
  results.push(check(
    'camera_view_looks_down_without_fabricating_heading',
    bboxCamera.pitchDegrees != null && bboxCamera.pitchDegrees < 0 && bboxCamera.headingDegrees == null,
    `pitch=${bboxCamera.pitchDegrees} heading=${bboxCamera.headingDegrees}`,
  ))
  results.push(check(
    'camera_view_uses_sourced_heading_only',
    planCinematicFlyTo({
      from: { longitude: -81.52, latitude: 41.08, heightMeters: 12_000 },
      to: { longitude: -81.63, latitude: 41.24, placeType: 'traffic_camera', headingDegrees: 90 },
      prefersReducedMotion: false,
      instantRequested: false,
    }).headingDegrees === 90,
    'east bearing is used when the provider supplied it',
  ))

  const cluster = planCinematicFlyTo({
    from: { longitude: -81.52, latitude: 41.08, heightMeters: 1_200_000 },
    to: {
      longitude: -81.63,
      latitude: 41.24,
      altitudeMeters: 28_000,
      placeType: 'camera_cluster',
      boundingBox: { south: 41.1, north: 41.4, west: -81.8, east: -81.4 },
    },
    prefersReducedMotion: false,
    instantRequested: false,
  })
  results.push(check(
    'camera_cluster_is_not_individual_inspect',
    cluster.destination.kind !== 'point' || (cluster.destination.kind === 'point' && cluster.destination.heightMeters !== 1_800 && cluster.destination.heightMeters >= 20_000),
    JSON.stringify(cluster.destination),
  ))
  results.push(check(
    'camera_cluster_ignores_1800m_inspect_rule',
    cluster.pitchDegrees == null && (cluster.destination.kind === 'rectangle' || (cluster.destination.kind === 'point' && cluster.destination.heightMeters === 28_000)),
    JSON.stringify({ dest: cluster.destination, pitch: cluster.pitchDegrees }),
  ))
  results.push(check(
    'camera_cluster_settle_is_overview',
    settleAltitudeMeters('camera_cluster', true) === 28_000 && settleAltitudeMeters('traffic_camera', false) === 1_800,
    `cluster=${settleAltitudeMeters('camera_cluster', true)} camera=${settleAltitudeMeters('traffic_camera', false)}`,
  ))

  return results
}

export function runTerraCinematicFlyToValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraCinematicFlyToValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra cinematicFlyTo validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

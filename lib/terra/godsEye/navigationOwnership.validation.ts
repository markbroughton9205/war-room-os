/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/navigationOwnership.validation.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  actionSuspendsOrbit,
  CAMERA_CLUSTER_ALTITUDE_M,
  CAMERA_INSPECT_ALTITUDE_M,
  CAMERA_INSPECT_PITCH_DEG,
  isCameraClusterPlaceType,
  isCameraInspectPlaceType,
  nextTerraNavState,
  orbitMayAutoResume,
} from './navigationOwnership'

const CITY_SCALE_FLOOR_M = 20_000
const LOCAL_SCALE_FLOOR_M = 2_000

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check(
    'camera_inspect_altitude_is_building_or_street_not_city',
    CAMERA_INSPECT_ALTITUDE_M < LOCAL_SCALE_FLOOR_M && CAMERA_INSPECT_ALTITUDE_M < CITY_SCALE_FLOOR_M,
    `inspect=${CAMERA_INSPECT_ALTITUDE_M} localFloor=${LOCAL_SCALE_FLOOR_M} cityFloor=${CITY_SCALE_FLOOR_M}`,
  ))
  results.push(check(
    'camera_inspect_pitch_looks_down',
    CAMERA_INSPECT_PITCH_DEG < 0 && CAMERA_INSPECT_PITCH_DEG > -90,
    `pitch=${CAMERA_INSPECT_PITCH_DEG}`,
  ))
  results.push(check(
    'commander_inspect_blocks_orbit_auto_resume',
    orbitMayAutoResume('COMMANDER_INSPECT') === false && orbitMayAutoResume('CAMERA_FLY') === false && orbitMayAutoResume('MANUAL_GLOBE') === false,
    'inspect/camera/manual must not silently resume orbit',
  ))
  results.push(check(
    'idle_and_auto_orbit_may_resume',
    orbitMayAutoResume('IDLE') === true && orbitMayAutoResume('AUTO_ORBIT') === true,
    'idle live-earth resume remains available until Commander takes ownership',
  ))
  results.push(check(
    'camera_view_completes_into_commander_inspect',
    nextTerraNavState(nextTerraNavState('IDLE', 'CAMERA_VIEW'), 'FLIGHT_COMPLETE') === 'COMMANDER_INSPECT',
    nextTerraNavState(nextTerraNavState('IDLE', 'CAMERA_VIEW'), 'FLIGHT_COMPLETE'),
  ))
  results.push(check(
    'search_fly_completes_into_commander_inspect',
    nextTerraNavState(nextTerraNavState('IDLE', 'SEARCH_GO'), 'FLIGHT_COMPLETE') === 'COMMANDER_INSPECT',
    nextTerraNavState(nextTerraNavState('IDLE', 'SEARCH_GO'), 'FLIGHT_COMPLETE'),
  ))
  results.push(check(
    'manual_drag_cancels_into_manual_globe',
    nextTerraNavState('SEARCH_FLY', 'MANUAL_DRAG') === 'MANUAL_GLOBE' && nextTerraNavState('CAMERA_FLY', 'FLIGHT_CANCELLED') === 'MANUAL_GLOBE',
    'pending cinematic yields to manual control',
  ))
  results.push(check(
    'building_inspect_outranks_auto_orbit',
    nextTerraNavState('AUTO_ORBIT', 'BUILDING_INSPECT') === 'COMMANDER_INSPECT' && actionSuspendsOrbit('BUILDING_INSPECT'),
    'COMMANDER_INSPECT > AUTO_ORBIT',
  ))
  results.push(check(
    'resume_orbit_is_explicit',
    nextTerraNavState('COMMANDER_INSPECT', 'RESUME_ORBIT') === 'AUTO_ORBIT' && actionSuspendsOrbit('RESUME_ORBIT') === false,
    'orbit returns only through Resume / toggle',
  ))

  const shell = readFileSync(resolve('components/war-room/terra/TerraShell.tsx'), 'utf8')
  results.push(check(
    'shell_does_not_fly_to_camera_discovery_altitude',
    !shell.includes('CAMERA_DISCOVERY_ALTITUDE_M') && !shell.includes('flyToCameraDiscovery'),
    'Discover Cameras must not import or fly the 22 km discovery altitude',
  ))
  results.push(check(
    'shell_discover_does_not_pass_fly_true',
    !/handleDiscoverCameras[\s\S]{0,400}fly:\s*true/.test(shell),
    'handleDiscoverCameras must query without repositioning the globe',
  ))
  results.push(check(
    'cluster_is_not_individual_camera_inspect',
    isCameraInspectPlaceType('camera_cluster') === false
      && isCameraInspectPlaceType('traffic_camera') === true
      && isCameraClusterPlaceType('camera_cluster') === true
      && CAMERA_CLUSTER_ALTITUDE_M >= CITY_SCALE_FLOOR_M
      && CAMERA_CLUSTER_ALTITUDE_M !== CAMERA_INSPECT_ALTITUDE_M,
    `inspect=${CAMERA_INSPECT_ALTITUDE_M} cluster=${CAMERA_CLUSTER_ALTITUDE_M}`,
  ))
  results.push(check(
    'shell_cluster_click_does_not_use_traffic_camera_place_type',
    /placeType:\s*'camera_cluster'/.test(shell)
      && /handleClusterClick[\s\S]{0,800}placeType:\s*'camera_cluster'/.test(shell)
      && !/handleClusterClick[\s\S]{0,800}placeType:\s*'traffic_camera'/.test(shell),
    'cluster fly must not reuse individual camera inspect placeType',
  ))
  results.push(check(
    'shell_search_clears_camera_inspect',
    /handleResolvedLocation[\s\S]{0,400}clearCameraInspect\(\)/.test(shell)
      && shell.includes('cameraInspectSurvivesOriginChange')
      && shell.includes("commandNav(target.instantRequested ? 'JUMP' : 'SEARCH_GO')"),
    'explicit SEARCH/JUMP must close inspect without requiring out-of-radius',
  ))
  results.push(check(
    'manual_drag_during_camera_fly_is_manual_globe',
    nextTerraNavState('CAMERA_FLY', 'MANUAL_DRAG') === 'MANUAL_GLOBE'
      && nextTerraNavState('CAMERA_FLY', 'FLIGHT_COMPLETE') === 'COMMANDER_INSPECT',
    'interrupt is not arrival',
  ))
  return results
}

export function runTerraNavigationOwnershipValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Terra navigation ownership: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

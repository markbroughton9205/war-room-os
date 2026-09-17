/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/cameraInspectContext.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { planCameraDiscovery } from './cameraDiscovery'
import { cameraInspectSurvivesOriginChange, selectedCameraFitsActiveContext } from './cameraInspectContext'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const RICHFIELD_OHGO = { layerId: 'ohgo_cameras', latitude: 41.22939, longitude: -81.62685 }
const SF_CALTRANS = { layerId: 'caltrans_cctv', latitude: 37.7749, longitude: -122.4194 }
const RICHFIELD = { latitude: 41.2398, longitude: -81.6382 }
const CINCINNATI = { latitude: 39.1031, longitude: -84.512 }
const NYC = { latitude: 40.7128, longitude: -74.006 }
const LA = { latitude: 34.0522, longitude: -118.2437 }

function run(): CaseResult[] {
  const richfieldPlan = planCameraDiscovery(RICHFIELD.latitude, RICHFIELD.longitude)
  const nycPlan = planCameraDiscovery(NYC.latitude, NYC.longitude)
  const cincinnatiPlan = planCameraDiscovery(CINCINNATI.latitude, CINCINNATI.longitude)
  const laPlan = planCameraDiscovery(LA.latitude, LA.longitude)
  const sameOriginKeep = selectedCameraFitsActiveContext({ camera: RICHFIELD_OHGO, origin: RICHFIELD, plan: richfieldPlan })
  const nycDrop = selectedCameraFitsActiveContext({ camera: RICHFIELD_OHGO, origin: NYC, plan: nycPlan })
  const cincinnatiDrop = selectedCameraFitsActiveContext({ camera: RICHFIELD_OHGO, origin: CINCINNATI, plan: cincinnatiPlan })
  const laDrop = selectedCameraFitsActiveContext({ camera: SF_CALTRANS, origin: LA, plan: laPlan })
  const sameCameraZoom = selectedCameraFitsActiveContext({ camera: RICHFIELD_OHGO, origin: RICHFIELD, plan: richfieldPlan, radiusKm: 40 })
  return [
    check('richfield_ohgo_stays_in_richfield', sameOriginKeep === true, String(sameOriginKeep)),
    check('richfield_ohgo_clears_in_nyc_provider_auth', nycDrop === false && nycPlan.providerAuthRequired === true, `keep=${nycDrop} providerAuth=${nycPlan.providerAuthRequired}`),
    check('richfield_ohgo_clears_in_cincinnati_radius', cincinnatiDrop === false && cincinnatiPlan.cameraLayerIds.includes('ohgo_cameras'), `keep=${cincinnatiDrop}`),
    check('sf_caltrans_clears_in_la_radius', laDrop === false && laPlan.cameraLayerIds.includes('caltrans_cctv'), `keep=${laDrop}`),
    check('same_origin_zoom_does_not_clear', sameCameraZoom === true, String(sameCameraZoom)),
    check('search_context_does_not_keep_inspect', cameraInspectSurvivesOriginChange({ contextType: 'SEARCH', navState: 'COMMANDER_INSPECT' }) === false, 'SEARCH investigation replaces inspect ownership'),
    check('search_fly_does_not_keep_inspect', cameraInspectSurvivesOriginChange({ contextType: 'EVENT', navState: 'SEARCH_FLY' }) === false, 'SEARCH_FLY is a new investigation'),
    check('event_camera_inspect_survives_origin_move', cameraInspectSurvivesOriginChange({ contextType: 'EVENT', navState: 'COMMANDER_INSPECT' }) === true, 'explicit camera EVENT inspect is not a search'),
  ]
}

export function runCameraInspectContextValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  if (failed.length) process.exit(1)
}

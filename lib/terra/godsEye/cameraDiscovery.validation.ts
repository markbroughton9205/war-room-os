/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/cameraDiscovery.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { planCameraDiscovery } from './cameraDiscovery'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const cincinnati = planCameraDiscovery(39.1031, -84.512)
  const ontarioQueried = cincinnati.cameraLayerIds.includes('ontario_511_cameras')
  const quebecQueried = cincinnati.cameraLayerIds.includes('quebec_511_cameras')
  const hkQueried = cincinnati.cameraLayerIds.includes('hong_kong_td_cameras')
  const finlandQueried = cincinnati.cameraLayerIds.includes('digitraffic_road_cameras')
  return [
    check('cincinnati_selects_ohgo', cincinnati.cameraLayerIds.includes('ohgo_cameras') && cincinnati.coveringProviders.some(row => row.id === 'ohgo'), cincinnati.cameraLayerIds.join(',')),
    check('cincinnati_does_not_need_commander_session', cincinnati.requiresCommanderSession === false, String(cincinnati.requiresCommanderSession)),
    check('cincinnati_skips_ontario', !ontarioQueried && cincinnati.skippedLayerIds.includes('ontario_511_cameras'), cincinnati.skippedLayerIds.join(',')),
    check('cincinnati_skips_quebec', !quebecQueried && cincinnati.skippedLayerIds.includes('quebec_511_cameras'), cincinnati.skippedLayerIds.join(',')),
    check('cincinnati_skips_hong_kong', !hkQueried && cincinnati.skippedLayerIds.includes('hong_kong_td_cameras'), cincinnati.skippedLayerIds.join(',')),
    check('cincinnati_skips_finland', !finlandQueried && cincinnati.skippedLayerIds.includes('digitraffic_road_cameras'), cincinnati.skippedLayerIds.join(',')),
    check('cincinnati_does_not_query_ohgo_events', !cincinnati.cameraLayerIds.some(id => id.includes('events') || id.includes('weather')), cincinnati.cameraLayerIds.join(',')),
    check('toronto_selects_ontario', planCameraDiscovery(43.65, -79.38).cameraLayerIds.includes('ontario_511_cameras'), planCameraDiscovery(43.65, -79.38).cameraLayerIds.join(',')),
    check('london_has_no_api_cameras', !planCameraDiscovery(51.5074, -0.1278).hasApiCoverage, planCameraDiscovery(51.5074, -0.1278).coveringProviders.map(row => row.id).join(',') || 'none'),
    check('nyc_is_provider_auth_viewer', planCameraDiscovery(40.7128, -74.006).providerAuthRequired === true && planCameraDiscovery(40.7128, -74.006).requiresCommanderSession === false, `providerAuth=${planCameraDiscovery(40.7128, -74.006).providerAuthRequired}`),
    check('richfield_selects_ohgo', planCameraDiscovery(41.2397, -81.6382).cameraLayerIds.includes('ohgo_cameras') && planCameraDiscovery(41.2397, -81.6382).requiresCommanderSession === false, planCameraDiscovery(41.2397, -81.6382).cameraLayerIds.join(',')),
    check('sf_selects_caltrans_without_commander', planCameraDiscovery(37.7749, -122.4194).cameraLayerIds.includes('caltrans_cctv') && planCameraDiscovery(37.7749, -122.4194).requiresCommanderSession === false, planCameraDiscovery(37.7749, -122.4194).cameraLayerIds.join(',')),
  ]
}

export function runCameraDiscoveryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Camera discovery: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

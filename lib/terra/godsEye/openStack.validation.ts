/**
 * Deterministic checks for the God's Eye open-stack foundation.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/openStack.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GODS_EYE_LAYER_REGISTRY, GODS_EYE_REGISTRY_GROUPS } from './layerRegistry'
import {
  CONVERSATION_AUTO_EXPAND_STATUS,
  GODS_EYE_OPEN_STACK_CREATES_TERRA2,
  GODS_EYE_OPEN_STACK_ENGINE,
  GODS_EYE_OPEN_STACK_FOUNDATION,
  GODS_EYE_OPEN_STACK_REPLACES_TERRA,
  LIVE_SIGNAL_PHASE_STATUS,
  PANORAMAX_STATUS,
  RE_EARTH_BUILDINGS_STATUS,
  RE_EARTH_TERRAIN_STATUS,
  STREET_OBJECT_INTERFACE_STATUS,
  godsEyeOpenStackReport,
} from './openStack'
import { TERRA_DEFAULT_BUILDING_PROVIDER, TERRA_DEFAULT_TERRAIN_PROVIDER, reEarthEvaluationSnapshot } from './reEarth'
import { conversationMayAutoExpand, CONVERSATION_AUTO_EXPAND } from './conversationLock'
import { STREET_OBJECT_TRUTH, isVerifiedInfrastructure, streetObjectFromModel } from './streetObjects'
import { mapillaryVistasResearchLane } from './vistasResearch'
import { liveSignalPhaseSchema } from './liveTraffic'
import { sourcedHouseNumber } from './overtureIdentity'
import { modelObservationProvenance } from './provenance'
import { GODS_EYE_LAYER_TRUTH_STATES } from './coverageStates'
import { GODS_EYE_ZOOM_LADDER, godsEyeZoomRungForTerraScale, houseNumbersVisible, streetNamesVisible } from './zoomLadder'
import { GODS_EYE_OWNERSHIP_MATRIX, osmIsNotSimplyOwnable } from './ownership'
import { GODS_EYE_DETAIL_COVERAGE } from './detailCoverage'
import { GODS_EYE_RESEARCH_INCORPORATED, godsEyeResearchBuildReport } from './researchIncorporation'
import { panoramaxProviderState, PANORAMAX_GLOBAL_PARITY, PANORAMAX_REPLACES_CESIUM } from './panoramax'
import { streetImageryProviderStates } from './streetImagery'
import { inspectEnrichAppliesTo, inspectIdentityIsFabricated } from './inspectRace'
import { godsEyeLodDensity } from './lodRuntime'
import { trafficCameraProviderHealth, globalTrafficCameraCoverage, trafficCameraHasPrivateFeeds } from './cameraHealth'
import { nearbyPublicCameras } from './nearbyCameras'
import { sourcedCameraBearingDegrees } from './cameraBearing'
import { godsEyeHardeningRows, godsEyeHardeningForbidsProductionReadyWithoutAllGates } from './productionHardening'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const report = godsEyeOpenStackReport()
  results.push(check('foundation_active', report.foundation === GODS_EYE_OPEN_STACK_FOUNDATION, report.foundation))
  results.push(check('engine_is_cesium', GODS_EYE_OPEN_STACK_ENGINE === 'CESIUMJS', GODS_EYE_OPEN_STACK_ENGINE))
  results.push(check('does_not_replace_terra', GODS_EYE_OPEN_STACK_REPLACES_TERRA === false, 'additive'))
  results.push(check('does_not_create_terra2', GODS_EYE_OPEN_STACK_CREATES_TERRA2 === false, 'no terra2'))
  results.push(check('re_earth_buildings_evaluation', RE_EARTH_BUILDINGS_STATUS === 'EVALUATION_ACTIVE', RE_EARTH_BUILDINGS_STATUS))
  results.push(check('re_earth_terrain_evaluation', RE_EARTH_TERRAIN_STATUS === 'EVALUATION_ACTIVE', RE_EARTH_TERRAIN_STATUS))
  results.push(check('default_terrain_is_cesium_world', TERRA_DEFAULT_TERRAIN_PROVIDER === 'CESIUM_WORLD_TERRAIN', TERRA_DEFAULT_TERRAIN_PROVIDER))
  results.push(check('default_buildings_are_osm', TERRA_DEFAULT_BUILDING_PROVIDER === 'OSM_OVERPASS', TERRA_DEFAULT_BUILDING_PROVIDER))
  results.push(check('reearth_not_default', reEarthEvaluationSnapshot().buildings.defaultOn === false && reEarthEvaluationSnapshot().terrain.defaultOn === false, 'switches off'))
  results.push(check('live_signal_phase_no_coverage', LIVE_SIGNAL_PHASE_STATUS === 'NO_COVERAGE' && liveSignalPhaseSchema('n1', 'osm').phase === 'NO_COVERAGE', 'NO_COVERAGE'))
  results.push(check('conversation_auto_expand_disabled', CONVERSATION_AUTO_EXPAND === 'DISABLED' && CONVERSATION_AUTO_EXPAND_STATUS === 'DISABLED', CONVERSATION_AUTO_EXPAND))
  results.push(check('building_click_does_not_expand_chat', conversationMayAutoExpand('building_click') === false, 'locked'))
  results.push(check('live_intel_click_does_not_expand_chat', conversationMayAutoExpand('live_intel_click') === false, 'locked'))
  results.push(check('street_image_click_does_not_expand_chat', conversationMayAutoExpand('street_image_click') === false, 'locked'))
  results.push(check('street_object_interface_active', STREET_OBJECT_INTERFACE_STATUS === 'ACTIVE', STREET_OBJECT_INTERFACE_STATUS))
  const detection = streetObjectFromModel({
    class: 'traffic_light',
    confidence: 0.9,
    imageSource: 'research',
    model: 'vistas-eval',
    modelVersion: 'research',
    timestamp: '2026-09-16T00:00:00Z',
    provenance: modelObservationProvenance({ source: 'vistas', provider: 'research' }),
  })
  results.push(check('model_observation_is_not_infrastructure', detection.truth === STREET_OBJECT_TRUTH && isVerifiedInfrastructure(detection) === false, detection.truth))
  results.push(check('vistas_not_bundled', mapillaryVistasResearchLane().bundled === false && mapillaryVistasResearchLane().kind === 'RESEARCH_DATASET', 'research'))
  results.push(check('house_number_not_inferred_from_blank', sourcedHouseNumber('') === null && sourcedHouseNumber('  ') === null, 'blank rejected'))
  results.push(check('house_number_keeps_sourced_value', sourcedHouseNumber('12') === '12', '12'))
  results.push(check('registry_has_street_group', GODS_EYE_REGISTRY_GROUPS.includes('STREET') && GODS_EYE_LAYER_REGISTRY.some(layer => layer.group === 'STREET'), 'STREET'))
  results.push(check('every_registry_truth_is_honest', GODS_EYE_LAYER_REGISTRY.every(layer => (GODS_EYE_LAYER_TRUTH_STATES as readonly string[]).includes(layer.truthState)), 'truth states'))
  results.push(check('re_earth_buildings_not_default_on', GODS_EYE_LAYER_REGISTRY.find(layer => layer.id === 're_earth_buildings')?.defaultOn === false, 'eval switch'))
  results.push(check('live_signal_registry_no_coverage', GODS_EYE_LAYER_REGISTRY.find(layer => layer.id === 'live_signal_phase')?.truthState === 'NO_COVERAGE', 'NO_COVERAGE'))
  results.push(check('zoom_ladder_has_six_rungs', GODS_EYE_ZOOM_LADDER.join('>') === 'PLANET>COUNTRY>CITY>NEIGHBORHOOD>STREET>FEATURE', GODS_EYE_ZOOM_LADDER.join('>')))
  results.push(check('planet_hides_street_names', streetNamesVisible('PLANET') === 'hidden' && streetNamesVisible('CITY') === 'selective', 'lod names'))
  results.push(check('house_numbers_only_at_street', houseNumbersVisible('PLANET') === false && houseNumbersVisible('STREET') === true, 'lod houses'))
  results.push(check('global_camera_is_planet_rung', godsEyeZoomRungForTerraScale('global') === 'PLANET' && godsEyeZoomRungForTerraScale('building') === 'STREET', 'scale map'))
  results.push(check('ownership_keeps_vistas_research_only', GODS_EYE_OWNERSHIP_MATRIX.some(row => row.id === 'mapillary_vistas' && row.ownership === 'RESEARCH_ONLY'), 'vistas research'))
  results.push(check('ownership_keeps_ion_stream_only', GODS_EYE_OWNERSHIP_MATRIX.some(row => row.id === 'cesium_world_terrain' && row.ownership === 'STREAM_ONLY'), 'ion stream'))
  results.push(check('osm_is_self_hostable_odbl_not_simply_ownable', osmIsNotSimplyOwnable() && !GODS_EYE_OWNERSHIP_MATRIX.some(row => String(row.ownership) === 'OWNABLE'), 'SELF_HOSTABLE + ODbL'))
  results.push(check('commander_capture_is_owned', GODS_EYE_OWNERSHIP_MATRIX.some(row => row.id === 'war_room_own_imagery' && row.ownership === 'OWNED'), 'OWNED'))
  results.push(check('inspect_a_then_b_does_not_apply_a', inspectEnrichAppliesTo({ latitude: 40.7, longitude: -74.0 }, { latitude: 34.05, longitude: -118.25 }) === false, 'A vs B'))
  results.push(check('inspect_matching_coords_apply', inspectEnrichAppliesTo({ latitude: 40.7128, longitude: -74.006 }, { latitude: 40.7128, longitude: -74.006 }) === true, 'same point'))
  results.push(check('inspect_rejects_fabricated_id', inspectIdentityIsFabricated('inferred-id-12') === true && inspectIdentityIsFabricated('osm way 123') === false, 'no fabricated id'))
  results.push(check('planet_lod_does_not_fetch_urban', godsEyeLodDensity('PLANET').fetchUrban === false && godsEyeLodDensity('CITY').buildings === false && godsEyeLodDensity('STREET').houseNumbers === true, 'density policy'))
  const cameras = trafficCameraProviderHealth()
  results.push(check('global_cameras_are_regional', globalTrafficCameraCoverage() === 'REGIONAL' && trafficCameraHasPrivateFeeds(cameras) === false, 'REGIONAL / no private cameras'))
  results.push(check('camera_health_ids_unique', new Set(cameras.map(row => row.id)).size === cameras.length, cameras.map(row => row.id).join(',')))
  results.push(check('credentialed_cameras_are_provider_auth_required', cameras.some(row => row.health === 'PROVIDER_AUTH_REQUIRED') && cameras.some(row => row.id === 'caltrans_cctv' && row.health === 'UNAVAILABLE' && row.coverage === 'REGIONAL' && row.runtimeEvidence === false) && !cameras.some(row => row.health === 'LIVE') && !cameras.some(row => row.health === 'AUTH_REQUIRED'), 'configured-unprobed is UNAVAILABLE, credentialed is PROVIDER_AUTH_REQUIRED, never Commander AUTH_REQUIRED or seed LIVE'))
  const ohgoProbed = trafficCameraProviderHealth([{ providerId: 'ohgo_cameras', featureCount: 4, captureFreshness: 'UNKNOWN' }]).find(row => row.id === 'ohgo_cameras')
  results.push(check(
    'ohgo_catalog_live_is_not_unavailable',
    Boolean(ohgoProbed && ohgoProbed.catalogStatus === 'LIVE' && ohgoProbed.health !== 'UNAVAILABLE' && ohgoProbed.captureFreshness === 'UNKNOWN'),
    `${ohgoProbed?.catalogStatus}/${ohgoProbed?.health}/${ohgoProbed?.captureFreshness}`,
  ))
  results.push(check('sourced_camera_bearing_north', sourcedCameraBearingDegrees('NORTH') === 0 && sourcedCameraBearingDegrees('unknown-azimuth') === null, 'no fabricated heading'))
  results.push(check('nearby_cameras_rank_local_index', nearbyPublicCameras({
    latitude: 60.17,
    longitude: 24.94,
    features: [{
      id: 'cam-1',
      layerId: 'digitraffic_road_cameras',
      kind: 'traffic_camera',
      title: 'cam-1',
      latitude: 60.171,
      longitude: 24.941,
      properties: { freshness: 'still_image' },
    }],
  }).length === 1, 'Helsinki local index'))
  const hardening = godsEyeHardeningRows()
  results.push(check('hardening_has_no_false_production_ready', hardening.every(row => row.finalStatus !== 'PRODUCTION_READY' && godsEyeHardeningForbidsProductionReadyWithoutAllGates(row)), 'conservative'))
  results.push(check('live_signal_phase_hardening_is_no_coverage', hardening.find(row => row.feature === 'LIVE_SIGNAL_PHASE')?.finalStatus === 'NO_COVERAGE', 'NO_COVERAGE'))
  results.push(check('panoramax_hardening_is_interface_only', hardening.find(row => row.feature === 'PANORAMAX')?.finalStatus === 'INTERFACE_ONLY', 'INTERFACE_ONLY'))
  results.push(check('mapillary_hardening_is_evaluation', hardening.find(row => row.feature === 'MAPILLARYJS')?.finalStatus === 'EVALUATION_ACTIVE', 'EVALUATION_ACTIVE'))
  results.push(check('reearth_hardening_is_evaluation', hardening.find(row => row.feature === 'RE_EARTH_BUILDINGS')?.finalStatus === 'EVALUATION_ACTIVE' && hardening.find(row => row.feature === 'RE_EARTH_TERRAIN')?.finalStatus === 'EVALUATION_ACTIVE', 'EVALUATION_ACTIVE'))
  results.push(check('detail_coverage_does_not_claim_global_building_detail', GODS_EYE_DETAIL_COVERAGE.find(row => row.id === 'GLOBAL_BUILDING_COVERAGE')?.state === 'PARTIAL', 'partial buildings'))
  results.push(check('house_number_coverage_is_partial', GODS_EYE_DETAIL_COVERAGE.find(row => row.id === 'HOUSE_NUMBER_COVERAGE')?.state === 'PARTIAL', 'partial houses'))
  const research = godsEyeResearchBuildReport()
  results.push(check('research_incorporated', research.incorporated === GODS_EYE_RESEARCH_INCORPORATED, research.incorporated))
  results.push(check('research_panoramax_evaluation', research.PANORAMAX === 'EVALUATION_ACTIVE' && PANORAMAX_STATUS === 'EVALUATION_ACTIVE', research.PANORAMAX))
  results.push(check('research_live_signal_no_coverage', research.LIVE_SIGNAL_PHASE === 'NO_COVERAGE', research.LIVE_SIGNAL_PHASE))
  results.push(check('research_conversation_lock_implemented', research.CONVERSATION_COMPACT_LOCK === 'IMPLEMENTED', research.CONVERSATION_COMPACT_LOCK))
  const panoramax = panoramaxProviderState(null)
  results.push(check('panoramax_unconfigured_is_no_coverage', panoramax.coverageState === 'NO_COVERAGE' && panoramax.globalStreetViewParity === false && PANORAMAX_GLOBAL_PARITY === false && PANORAMAX_REPLACES_CESIUM === false, panoramax.coverageState))
  results.push(check('street_providers_include_panoramax', streetImageryProviderStates(null, null).some(provider => provider.id === 'PANORAMAX'), 'three providers'))

  const globe = readFileSync(resolve('components/war-room/terra/TerraGlobe.tsx'), 'utf8')
  results.push(check('globe_still_uses_cesium_world_terrain', globe.includes('createWorldTerrainAsync'), 'Cesium World Terrain boot path'))
  const osmBuildings = readFileSync(resolve('components/war-room/terra/TerraCesiumOsmBuildings.tsx'), 'utf8')
  results.push(check('globe_still_uses_osm_buildings', osmBuildings.includes('createOsmBuildingsAsync') && !globe.includes('createOsmBuildingsAsync'), 'OSM Buildings Commander opt-in'))
  results.push(check('globe_overrides_double_click', globe.includes('LEFT_DOUBLE_CLICK'), 'double-click spin'))
  const shell = readFileSync(resolve('components/war-room/terra/TerraShell.tsx'), 'utf8')
  results.push(check('shell_does_not_toggle_chat_on_selection', !shell.includes('onToggleChatExpanded') && !shell.includes('setChatExpanded'), 'no auto-expand'))
  results.push(check('terra_fetches_include_credentials', shell.includes("credentials: 'include'") && shell.includes('TerraNearbyCameras') && shell.includes('attachTerraLodSampler'), 'session cookies + nearby + lod'))
  results.push(check('my_location_and_follow_are_explicit', shell.includes('useCommanderLocation') && readFileSync(resolve('components/war-room/terra/TerraGpsControl.tsx'), 'utf8').includes('LOCATE ME') && readFileSync(resolve('components/war-room/terra/TerraGpsControl.tsx'), 'utf8').includes('FOLLOW ME') && shell.includes("contextType: 'GPS'"), 'explicit GPS'))
  results.push(check('electron_grants_geolocation_permission', readFileSync(resolve('desktop/src/main.cjs'), 'utf8').includes("permission === 'geolocation'") && readFileSync(resolve('desktop/src/main.cjs'), 'utf8').includes('setPermissionRequestHandler') && readFileSync(resolve('desktop/src/main.cjs'), 'utf8').includes('terra.nativeLocation.getFix'), 'electron geolocation handlers + GeoClue IPC'))
  results.push(check('middleware_canonicalizes_localhost', readFileSync(resolve('components/war-room/LoopbackCanonicalHost.tsx'), 'utf8').includes("next.hostname = '127.0.0.1'") && readFileSync(resolve('lib/sovereign-runtime/local-ownership/sessionCookie.ts'), 'utf8').includes('applyLocalSessionCookie'), '127.0.0.1 cookie host'))
  const chat = readFileSync(resolve('components/war-room/terra/GodsEyeCommandCenter.tsx'), 'utf8')
  results.push(check('expand_control_is_explicit', chat.includes('data-testid="gods-eye-expand"') && chat.includes('data-conversation-auto-expand="disabled"'), 'EXPAND only'))
  const streetPanel = readFileSync(resolve('components/war-room/terra/TerraStreetIntelligence.tsx'), 'utf8')
  results.push(check('street_panel_exposes_panoramax', streetPanel.includes('PANORAMAX') && streetPanel.includes('data-panoramax'), 'panoramax ui'))
  const coverageUi = readFileSync(resolve('components/war-room/terra/TerraGodsEyeCoverageMatrix.tsx'), 'utf8')
  results.push(check('coverage_ui_shows_zoom_ladder', coverageUi.includes('gods-eye-zoom-ladder') && coverageUi.includes('gods-eye-ownership-matrix') && coverageUi.includes('gods-eye-camera-health'), 'ladder+ownership+cameras'))
  return results
}

export function runGodsEyeOpenStackValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runGodsEyeOpenStackValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Gods Eye open stack validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

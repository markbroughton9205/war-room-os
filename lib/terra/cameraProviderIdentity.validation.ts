/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/cameraProviderIdentity.validation.ts
 */
import { pathToFileURL } from 'node:url'
import {
  cameraProviderIdentityIssues,
  canonicalCameraProviderId,
  cameraLayerIdsOnly,
} from './cameraProviderIdentity'
import { TERRA_COVERAGE_REGISTRY } from './coverageFederation'
import { DISCOVERY_CAMERA_LAYER_IDS } from './godsEye/cameraDiscovery'
import { TERRA_LAYER_SUMMARIES } from './layerCatalogSummary'
import { ROAD_TRAFFIC_SOURCE_REGISTRY, roadTrafficSourceRegistryDuplicateIds } from './roadTrafficSourceRegistry'
import { trafficCameraProviderHealth } from './godsEye/cameraHealth'
import { GODS_EYE_COVERAGE_MATRIX } from './godsEyeCoverageMatrix'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const issues = cameraProviderIdentityIssues()
  const trafficCameraIds = ROAD_TRAFFIC_SOURCE_REGISTRY.filter(row => row.capabilities.includes('camera')).map(row => row.id)
  const ontario = TERRA_COVERAGE_REGISTRY.find(row => row.id === 'ontario_511_cameras')
  return [
    check('511ny_alias_is_ny511_cameras', canonicalCameraProviderId('511ny') === 'ny511_cameras', canonicalCameraProviderId('511ny')),
    check('quebec_wfs_alias_is_quebec_511_cameras', canonicalCameraProviderId('quebec_511_wfs') === 'quebec_511_cameras', canonicalCameraProviderId('quebec_511_wfs')),
    check('hk_snapshots_alias_is_hong_kong_td_cameras', canonicalCameraProviderId('hong_kong_td_traffic_snapshots') === 'hong_kong_td_cameras', canonicalCameraProviderId('hong_kong_td_traffic_snapshots')),
    check('caltrans_not_duplicated', trafficCameraIds.filter(id => id === 'caltrans_cctv').length === 1, trafficCameraIds.filter(id => id === 'caltrans_cctv').join(',')),
    check('road_traffic_registry_ids_unique', roadTrafficSourceRegistryDuplicateIds().length === 0, roadTrafficSourceRegistryDuplicateIds().join(',') || 'unique'),
    check('camera_health_ids_unique', trafficCameraProviderHealth().length === new Set(trafficCameraProviderHealth().map(row => row.id)).size, trafficCameraProviderHealth().map(row => row.id).join(',')),
    check('coverage_matrix_ids_unique', GODS_EYE_COVERAGE_MATRIX.length === new Set(GODS_EYE_COVERAGE_MATRIX.map(row => row.id)).size, GODS_EYE_COVERAGE_MATRIX.map(row => row.id).join(',')),
    check('ontario_camera_layerids_exclude_events', (ontario?.layerIds ?? []).includes('ontario_511_cameras') && !(ontario?.layerIds ?? []).includes('ontario_511_events'), (ontario?.layerIds ?? []).join(',')),
    check('camera_layer_ids_only_strips_events', cameraLayerIdsOnly(['ontario_511_cameras', 'ontario_511_events']).join(',') === 'ontario_511_cameras', cameraLayerIdsOnly(['ontario_511_cameras', 'ontario_511_events']).join(',')),
    check('no_camera_identity_issues', issues.length === 0, issues.map(issue => `${issue.id}:${issue.detail}`).join(' | ') || 'none'),
    check(
      'discovery_layers_exist_in_catalog',
      DISCOVERY_CAMERA_LAYER_IDS.every(id => TERRA_LAYER_SUMMARIES.some(row => row.id === id && row.kind === 'traffic_camera')),
      DISCOVERY_CAMERA_LAYER_IDS.filter(id => !TERRA_LAYER_SUMMARIES.some(row => row.id === id)).join(',') || 'all present',
    ),
    check(
      'ohgo_runtime_catalog_is_not_unavailable',
      (() => {
        const probed = trafficCameraProviderHealth([{ providerId: 'ohgo_cameras', featureCount: 3, captureFreshness: 'UNKNOWN' }]).find(row => row.id === 'ohgo_cameras')
        return Boolean(probed && probed.catalogStatus === 'LIVE' && probed.health !== 'UNAVAILABLE' && probed.captureFreshness === 'UNKNOWN' && probed.configured)
      })(),
      'catalog LIVE · capture UNKNOWN',
    ),
    check(
      'unprobed_ohgo_catalog_is_unprobed',
      trafficCameraProviderHealth().find(row => row.id === 'ohgo_cameras')?.catalogStatus === 'UNPROBED'
        && trafficCameraProviderHealth().find(row => row.id === 'ohgo_cameras')?.health === 'UNAVAILABLE',
      'unprobed catalog is not LIVE',
    ),
  ]
}

export function runCameraProviderIdentityValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Camera identity: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

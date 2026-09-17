/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/cameraFederation.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { CANONICAL_CAMERA_PROVIDER_IDS } from '../cameraProviderIdentity'
import { TERRA_LAYER_SUMMARIES } from '../layerCatalogSummary'
import { DISCOVERY_CAMERA_LAYER_IDS, planCameraDiscovery } from './cameraDiscovery'
import {
  cameraCoverageEmptyCopy,
  cameraDirectoryRows,
  cameraFederationIssues,
  cameraPinStateFromImageFreshness,
  cameraProviderAdapterContracts,
  cameraProvidersForViewExtent,
  fetchableCameraLayerIds,
  godsEyeCameraLod,
  godsEyeCameraLodPolicy,
  nearbyCameraEnvelopesFromRegistry,
} from './cameraFederation'
import { nearbyCameraCoverageForPoint } from './nearbyCameraCoverage'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const OHIO = { west: -84.9, south: 38.4, east: -80.5, north: 42.0 }
const CALIFORNIA = { west: -124.5, south: 32.5, east: -114.1, north: 42.0 }
const TORONTO = { west: -79.6, south: 43.5, east: -79.2, north: 43.8 }
const HELSINKI = { west: 24.7, south: 60.1, east: 25.1, north: 60.3 }
const HONG_KONG = { west: 113.8, south: 22.1, east: 114.4, north: 22.6 }
const QUEBEC = { west: -72.6, south: 45.3, east: -71.1, north: 47.1 }
const NYC = { west: -74.1, south: 40.6, east: -73.8, north: 40.9 }
const LONDON = { west: -0.3, south: 51.4, east: 0.05, north: 51.6 }
const PLANET = { west: -180, south: -85, east: 180, north: 85 }

function run(): CaseResult[] {
  const trafficCameraIds = TERRA_LAYER_SUMMARIES.filter(row => row.kind === 'traffic_camera').map(row => row.id)
  const issues = cameraFederationIssues({ trafficCameraLayerIds: trafficCameraIds })
  const contracts = cameraProviderAdapterContracts()
  const byId = Object.fromEntries(contracts.map(row => [row.id, row]))
  const london = nearbyCameraCoverageForPoint({ latitude: 51.5074, longitude: -0.1278, nearbyCount: 0 })
  const tokyo = nearbyCameraCoverageForPoint({ latitude: 35.676, longitude: 139.65, nearbyCount: 0 })
  const capeTown = nearbyCameraCoverageForPoint({ latitude: -33.9249, longitude: 18.4241, nearbyCount: 0 })
  const empty = cameraCoverageEmptyCopy()
  const planetProviders = cameraProvidersForViewExtent(PLANET)
  const londonProviders = cameraProvidersForViewExtent(LONDON)
  const ohioProviders = cameraProvidersForViewExtent(OHIO)
  const directory = cameraDirectoryRows({
    features: [{
      id: 'cam-1',
      layerId: 'ohgo_cameras',
      kind: 'traffic_camera',
      title: 'I-77 @ SR-18',
      latitude: 41.24,
      longitude: -81.64,
      properties: { agency: 'OHGO / ODOT', road: 'I-77', freshnessState: 'UNKNOWN' },
    }],
    origin: { latitude: 41.24, longitude: -81.63 },
    query: 'i-77',
    providerFilter: 'ohgo_cameras',
    statusFilter: 'UNKNOWN',
    distanceFilter: 'NEAREST',
  })
  return [
    check('no_federation_issues', issues.length === 0, issues.map(issue => `${issue.id}:${issue.detail}`).join(' | ') || 'none'),
    check('fetchable_matches_discovery', fetchableCameraLayerIds().join(',') === DISCOVERY_CAMERA_LAYER_IDS.join(','), fetchableCameraLayerIds().join(',')),
    check('ohgo_live_catalog', byId.ohgo?.catalogLabel === 'LIVE CATALOG' && byId.ohgo.fetchableLayerIds.includes('ohgo_cameras'), byId.ohgo?.catalogLabel ?? 'missing'),
    check('caltrans_live_catalog', byId.caltrans_cctv?.catalogLabel === 'LIVE CATALOG', byId.caltrans_cctv?.catalogLabel ?? 'missing'),
    check('ontario_live', byId.ontario_511_cameras?.catalogLabel === 'LIVE', byId.ontario_511_cameras?.catalogLabel ?? 'missing'),
    check('quebec_catalog_viewer_only', byId.quebec_511_cameras?.catalogLabel === 'CATALOG / VIEWER ONLY' && byId.quebec_511_cameras.stillPolicy === 'html_viewer', `${byId.quebec_511_cameras?.catalogLabel}/${byId.quebec_511_cameras?.stillPolicy}`),
    check('fintraffic_live', byId.digitraffic_road_cameras?.catalogLabel === 'LIVE', byId.digitraffic_road_cameras?.catalogLabel ?? 'missing'),
    check('hong_kong_live', byId.hong_kong_td_cameras?.catalogLabel === 'LIVE', byId.hong_kong_td_cameras?.catalogLabel ?? 'missing'),
    check('511ny_partial_auth', byId['511ny']?.catalogLabel === 'PROVIDER AUTH REQUIRED / PARTIAL' && byId['511ny'].fetchableLayerIds.length === 0, byId['511ny']?.catalogLabel ?? 'missing'),
    check('canonical_includes_ny511', CANONICAL_CAMERA_PROVIDER_IDS.includes('ny511_cameras'), CANONICAL_CAMERA_PROVIDER_IDS.join(',')),
    check('nearby_envelopes_auto_from_registry', nearbyCameraEnvelopesFromRegistry().some(row => row.id === 'ohgo_cameras') && nearbyCameraEnvelopesFromRegistry().some(row => row.id === '511ny'), nearbyCameraEnvelopesFromRegistry().map(row => row.id).join(',')),
    check('planet_lod_no_catalog_fetch', godsEyeCameraLodPolicy('PLANET').fetchCatalog === false && godsEyeCameraLodPolicy('PLANET').showCoverageEnvelopes === true, JSON.stringify(godsEyeCameraLodPolicy('PLANET'))),
    check('country_lod_clusters', godsEyeCameraLodPolicy('COUNTRY').fetchCatalog && godsEyeCameraLodPolicy('COUNTRY').clusterPins, JSON.stringify(godsEyeCameraLodPolicy('COUNTRY'))),
    check('region_lod_clusters', godsEyeCameraLodPolicy('REGION').clusterPins && !godsEyeCameraLodPolicy('REGION').showCoverageEnvelopes, JSON.stringify(godsEyeCameraLodPolicy('REGION'))),
    check('city_lod_clustered_pins', godsEyeCameraLodPolicy('CITY').showIndividualPins && godsEyeCameraLodPolicy('CITY').clusterPins, JSON.stringify(godsEyeCameraLodPolicy('CITY'))),
    check('street_lod_individual_pins', godsEyeCameraLodPolicy('STREET').showIndividualPins && !godsEyeCameraLodPolicy('STREET').clusterPins, JSON.stringify(godsEyeCameraLodPolicy('STREET'))),
    check('regional_wide_is_country', godsEyeCameraLod('regional', { west: -125, south: 24, east: -66, north: 50 }) === 'COUNTRY', godsEyeCameraLod('regional', { west: -125, south: 24, east: -66, north: 50 })),
    check('regional_tight_is_region', godsEyeCameraLod('regional', { west: -83, south: 40.8, east: -81, north: 41.5 }) === 'REGION', godsEyeCameraLod('regional', { west: -83, south: 40.8, east: -81, north: 41.5 })),
    check('planet_lists_all_providers', planetProviders.length === contracts.length, `${planetProviders.length}/${contracts.length}`),
    check('ohio_selects_ohgo', ohioProviders.some(row => row.id === 'ohgo'), ohioProviders.map(row => row.id).join(',')),
    check('california_selects_caltrans', cameraProvidersForViewExtent(CALIFORNIA).some(row => row.id === 'caltrans_cctv'), cameraProvidersForViewExtent(CALIFORNIA).map(row => row.id).join(',')),
    check('toronto_selects_ontario', cameraProvidersForViewExtent(TORONTO).some(row => row.id === 'ontario_511_cameras'), cameraProvidersForViewExtent(TORONTO).map(row => row.id).join(',')),
    check('helsinki_selects_fintraffic', cameraProvidersForViewExtent(HELSINKI).some(row => row.id === 'digitraffic_road_cameras'), cameraProvidersForViewExtent(HELSINKI).map(row => row.id).join(',')),
    check('hong_kong_selects_td', cameraProvidersForViewExtent(HONG_KONG).some(row => row.id === 'hong_kong_td_cameras'), cameraProvidersForViewExtent(HONG_KONG).map(row => row.id).join(',')),
    check('quebec_selects_mtmd', cameraProvidersForViewExtent(QUEBEC).some(row => row.id === 'quebec_511_cameras'), cameraProvidersForViewExtent(QUEBEC).map(row => row.id).join(',')),
    check('nyc_selects_511ny_only_partial', cameraProvidersForViewExtent(NYC).some(row => row.id === '511ny') && planCameraDiscovery(40.7128, -74.006).providerAuthRequired, cameraProvidersForViewExtent(NYC).map(row => row.id).join(',')),
    check('london_no_verified_provider', londonProviders.length === 0 && london.locationState === 'NO_COVERAGE', londonProviders.map(row => row.id).join(',') || london.locationState),
    check('tokyo_no_verified_provider', tokyo.locationState === 'NO_COVERAGE', tokyo.locationState),
    check('cape_town_no_verified_provider', capeTown.locationState === 'NO_COVERAGE', capeTown.locationState),
    check('no_coverage_copy_is_not_error', empty.title === 'CAMERA COVERAGE' && empty.body === 'NO VERIFIED PROVIDER', `${empty.title} ${empty.body}`),
    check('unknown_image_is_not_live_pin', cameraPinStateFromImageFreshness('UNKNOWN') === 'UNKNOWN' && cameraPinStateFromImageFreshness('LIVE') === 'AVAILABLE', cameraPinStateFromImageFreshness('UNKNOWN')),
    check('directory_search_filters', directory.length === 1 && directory[0]?.title.includes('I-77'), directory.map(row => row.title).join(',') || 'empty'),
    check('public_cameras_not_commander_gated', contracts.filter(row => row.fetchableLayerIds.length > 0).every(row => row.authState !== 'COMMANDER_PRIVATE'), contracts.map(row => `${row.id}:${row.authState}`).join(',')),
    check('kytc_is_not_a_camera_provider', !contracts.some(row => row.id.includes('kytc')), contracts.map(row => row.id).join(',')),
  ]
}

export function runCameraFederationValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Camera federation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

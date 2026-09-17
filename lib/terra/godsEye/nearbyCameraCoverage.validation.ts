/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/nearbyCameraCoverage.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { nearbyCameraCoverageForPoint, nearbyCameraProvidersCoveringPoint } from './nearbyCameraCoverage'
import { cameraInspectFreshness } from './cameraInspectFreshness'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const helsinki = nearbyCameraCoverageForPoint({ latitude: 60.1699, longitude: 24.9384, nearbyCount: 3, indexLoaded: true })
  results.push(check('helsinki_is_covered', helsinki.locationState === 'COVERED' && helsinki.coveringProviders.some(row => row.id === 'digitraffic_road_cameras'), helsinki.locationState))
  const akron = nearbyCameraCoverageForPoint({ latitude: 41.0814, longitude: -81.519, nearbyCount: 0, indexLoaded: true })
  results.push(check('akron_is_covered_by_ohgo', akron.locationState === 'NONE_WITHIN_RADIUS' && akron.coveringProviders.some(row => row.id === 'ohgo_cameras'), akron.reason))
  const sf = nearbyCameraCoverageForPoint({ latitude: 37.7749, longitude: -122.4194, nearbyCount: 0, indexLoaded: true })
  results.push(check('sf_is_covered_by_caltrans', sf.locationState === 'NONE_WITHIN_RADIUS' && sf.coveringProviders.some(row => row.id === 'caltrans_cctv'), sf.reason))
  const nyc = nearbyCameraCoverageForPoint({ latitude: 40.7128, longitude: -74.006, nearbyCount: 0 })
  results.push(check('nyc_is_provider_auth_required_viewer', nyc.locationState === 'PROVIDER_AUTH_REQUIRED' && nyc.coveringProviders.some(row => row.id === '511ny'), nyc.reason))
  const nycNoSession = nearbyCameraCoverageForPoint({ latitude: 40.7128, longitude: -74.006, nearbyCount: 0, authRequired: true })
  results.push(check('nyc_missing_session_is_not_commander_auth', nycNoSession.locationState === 'PROVIDER_AUTH_REQUIRED', nycNoSession.reason))
  const losAngeles = nearbyCameraCoverageForPoint({ latitude: 34.0522, longitude: -118.2437, nearbyCount: 0, indexLoaded: true })
  results.push(check('la_is_covered_by_caltrans', losAngeles.locationState === 'NONE_WITHIN_RADIUS' && losAngeles.coveringProviders.some(row => row.id === 'caltrans_cctv'), losAngeles.reason))
  const london = nearbyCameraCoverageForPoint({ latitude: 51.5074, longitude: -0.1278, nearbyCount: 0 })
  results.push(check('london_is_no_coverage', london.locationState === 'NO_COVERAGE', london.locationState))
  const tokyo = nearbyCameraCoverageForPoint({ latitude: 35.676, longitude: 139.65, nearbyCount: 0 })
  results.push(check('tokyo_is_no_coverage', tokyo.locationState === 'NO_COVERAGE', tokyo.locationState))
  const capeTown = nearbyCameraCoverageForPoint({ latitude: -33.9249, longitude: 18.4241, nearbyCount: 0 })
  results.push(check('cape_town_is_no_coverage', capeTown.locationState === 'NO_COVERAGE', capeTown.locationState))
  const auth = nearbyCameraCoverageForPoint({ latitude: 60.17, longitude: 24.94, nearbyCount: 0, authRequired: true, indexLoaded: true })
  results.push(check('helsinki_public_cameras_ignore_commander_session', auth.locationState === 'NONE_WITHIN_RADIUS', auth.locationState))
  const cincinnatiAuth = nearbyCameraCoverageForPoint({ latitude: 39.1031, longitude: -84.512, nearbyCount: 0, authRequired: true, indexLoaded: false })
  results.push(check('cincinnati_ohgo_is_not_commander_auth_required', cincinnatiAuth.locationState !== 'AUTH_REQUIRED' && cincinnatiAuth.locationState !== 'UNAVAILABLE' && cincinnatiAuth.coveringProviders.some(row => row.id === 'ohgo_cameras'), cincinnatiAuth.locationState))
  const cincinnatiEmpty = nearbyCameraCoverageForPoint({ latitude: 39.1031, longitude: -84.512, nearbyCount: 0, authRequired: true, indexLoaded: true })
  results.push(check('cincinnati_empty_is_none_within_radius', cincinnatiEmpty.locationState === 'NONE_WITHIN_RADIUS' && cincinnatiEmpty.reason.includes('NONE WITHIN'), cincinnatiEmpty.reason))
  const richfield = nearbyCameraCoverageForPoint({ latitude: 41.2397, longitude: -81.6382, nearbyCount: 0, authRequired: true, indexLoaded: true })
  results.push(check('richfield_ohgo_is_not_commander_auth', richfield.locationState === 'NONE_WITHIN_RADIUS' && richfield.coveringProviders.some(row => row.id === 'ohgo_cameras'), richfield.locationState))
  const zoomOutCached = nearbyCameraCoverageForPoint({ latitude: 41.0814, longitude: -81.519, nearbyCount: 4, authRequired: true, indexLoaded: true })
  results.push(check('akron_zoom_out_with_catalog_stays_covered', zoomOutCached.locationState === 'COVERED' && zoomOutCached.locationState !== 'AUTH_REQUIRED', zoomOutCached.locationState))
  const zoomOutNoCatalog = nearbyCameraCoverageForPoint({ latitude: 41.0814, longitude: -81.519, nearbyCount: 0, authRequired: true, indexLoaded: false })
  results.push(check('akron_zoom_out_without_markers_is_not_auth', zoomOutNoCatalog.locationState !== 'AUTH_REQUIRED' && zoomOutNoCatalog.reason.includes('not AUTH_REQUIRED'), zoomOutNoCatalog.locationState))
  const failed = nearbyCameraCoverageForPoint({ latitude: 41.0814, longitude: -81.519, nearbyCount: 0, retrievalFailed: true })
  results.push(check('akron_retrieval_failed_is_unavailable', failed.locationState === 'UNAVAILABLE', failed.locationState))
  const ontario = nearbyCameraProvidersCoveringPoint(43.65, -79.38)
  results.push(check('toronto_has_ontario_envelope', ontario.some(row => row.id === 'ontario_511_cameras') && !ontario.some(row => row.id === '511ny'), ontario.map(row => row.id).join(',')))
  const ohgoInspect = cameraInspectFreshness({
    provenance: { fromCache: false, retrievedAt: '2026-09-16T12:00:00Z' },
    properties: { freshnessState: 'UNAVAILABLE' },
  })
  results.push(check(
    'ohgo_catalog_live_image_unknown',
    ohgoInspect.catalogStatus === 'LIVE' && ohgoInspect.imageFreshness === 'UNKNOWN' && ohgoInspect.imageNote.toLowerCase().includes('capture time'),
    `${ohgoInspect.catalogStatus}/${ohgoInspect.imageFreshness}`,
  ))
  return results
}

export function runNearbyCameraCoverageValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Nearby camera coverage: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

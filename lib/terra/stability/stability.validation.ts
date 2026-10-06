/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/stability/stability.validation.ts
 */
import assert from 'node:assert/strict'
import {
  applyTerraGlobeMovementLod,
  TERRA_GLOBE_SSE_MOVING,
  TERRA_GLOBE_SSE_SETTLED,
} from './cameraMovementLod'
import {
  adminOpacityConverged,
  canReuseVehicleEntities,
  staleEntityIds,
  terraLiveFeatureIds,
} from './featureEntityReuse'
import {
  registerTerraViewer,
  snapshotTerraDiagnostics,
  terraViewerCount,
  unregisterTerraViewer,
} from './diagnostics'
import {
  applyTerraHiddenRenderLoop,
  applyTerraWebGlContextLostRecovery,
  applyTerraWebGlContextRestored,
  terraCameraHasActiveFlight,
} from './renderLoopGuard'
import type { TerraGeoFeature } from '@/lib/terra/types'

function vehicle(id: string): TerraGeoFeature {
  return {
    id,
    eventId: id,
    providerId: 'opensky',
    kind: 'aircraft_state',
    longitude: 0,
    latitude: 0,
    altitude: 1000,
    timestamp: null,
    title: id,
    summary: null,
    properties: {},
    provenance: {
      provider: 'opensky',
      sourceUrl: null,
      retrievedAt: new Date(0).toISOString(),
      fromCache: false,
      isHistorical: false,
    },
    rawReference: { documentId: null, providerRecordId: id, canonicalUrl: null },
    coordinateOrigin: 'observed',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    pathCoordinates: null,
  }
}

const results: Array<{ name: string; pass: boolean; detail: string }> = []
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

const a = vehicle('a')
const b = vehicle('b')
check('vehicle_reuse_unclustered', canReuseVehicleEntities([a, b]), 'unclustered aircraft may upsert')
check(
  'vehicle_reuse_rejects_clusters',
  !canReuseVehicleEntities([{ ...a, properties: { _terraWorkerClusterCount: 4 } }]),
  'clustered output must rebuild',
)
check('live_ids', terraLiveFeatureIds([a, b]).size === 2, 'id set size')

const prefix = 'terra:opensky:'
const stale = staleEntityIds(
  [`${prefix}a`, `${prefix}gone`, `${prefix}trail:x`, 'other:layer:1'],
  new Set(['a']),
  prefix,
)
check('stale_ids_drop_missing_and_trails', stale.includes(`${prefix}gone`) && stale.includes(`${prefix}trail:x`) && !stale.includes(`${prefix}a`) && !stale.includes('other:layer:1'), stale.join(','))

const globe = { scene: { globe: { maximumScreenSpaceError: 2, tileCacheSize: 100, preloadSiblings: true } } }
applyTerraGlobeMovementLod(globe, true)
check('sse_moving', globe.scene.globe.maximumScreenSpaceError === TERRA_GLOBE_SSE_MOVING, String(globe.scene.globe.maximumScreenSpaceError))
check('tile_cache_moving', globe.scene.globe.tileCacheSize === 64 && globe.scene.globe.preloadSiblings === false, String(globe.scene.globe.tileCacheSize))
applyTerraGlobeMovementLod(globe, false)
check('sse_settled', globe.scene.globe.maximumScreenSpaceError === TERRA_GLOBE_SSE_SETTLED, String(globe.scene.globe.maximumScreenSpaceError))
check('tile_cache_settled', globe.scene.globe.tileCacheSize === 100 && globe.scene.globe.preloadSiblings === true, String(globe.scene.globe.tileCacheSize))

const cur = { country: 0.48, state: 0, county: 0, countryLabel: 0.92, stateLabel: 0, cityLabel: 0, flag: 0.12 }
check(
  'opacity_converged_skips_prerender_work',
  adminOpacityConverged(cur, {
    countryBorderOpacity: 0.48,
    stateBorderOpacity: 0,
    countyBorderOpacity: 0,
    countryLabelOpacity: 0.92,
    stateLabelOpacity: 0,
    cityLabelOpacity: 0,
    countryFlagOpacity: 0.12,
    stateFlagOpacity: 0,
  }),
  'settled opacities',
)
check(
  'opacity_not_converged_when_lerping',
  !adminOpacityConverged(cur, {
    countryBorderOpacity: 0.08,
    stateBorderOpacity: 0,
    countyBorderOpacity: 0,
    countryLabelOpacity: 0,
    stateLabelOpacity: 0,
    cityLabelOpacity: 0,
    countryFlagOpacity: 0,
    stateFlagOpacity: 0,
  }),
  'band change still lerps',
)

const v1 = { id: 'viewer-1' }
const v2 = { id: 'viewer-2' }
registerTerraViewer(v1)
check('single_viewer', terraViewerCount() === 1 && !snapshotTerraDiagnostics().duplicateViewer, String(terraViewerCount()))
registerTerraViewer(v2)
check('duplicate_viewer_detected', terraViewerCount() === 2 && snapshotTerraDiagnostics().duplicateViewer, String(terraViewerCount()))
unregisterTerraViewer(v2)
unregisterTerraViewer(v1)
check('viewer_cleanup', terraViewerCount() === 0, String(terraViewerCount()))

check('active_flight_detected', terraCameraHasActiveFlight({ _currentFlight: {} }), 'currentFlight set')
check('idle_camera_not_flying', !terraCameraHasActiveFlight({}), 'no currentFlight')

const loop = {
  useDefaultRenderLoop: true,
  scene: { highDynamicRange: true, requestRenderCalls: 0, requestRender() { this.requestRenderCalls += 1 } },
}
applyTerraHiddenRenderLoop(loop, true)
check('hidden_pauses_render_loop', loop.useDefaultRenderLoop === false, String(loop.useDefaultRenderLoop))
applyTerraHiddenRenderLoop(loop, false)
check('visible_resumes_render_loop', loop.useDefaultRenderLoop === true && loop.scene.requestRenderCalls === 1, String(loop.scene.requestRenderCalls))

applyTerraWebGlContextLostRecovery(loop)
check('context_lost_disables_hdr', loop.scene.highDynamicRange === false && loop.useDefaultRenderLoop === false, `hdr=${loop.scene.highDynamicRange}`)
applyTerraWebGlContextRestored(loop, false)
check('context_restore_reenables_hdr', loop.scene.highDynamicRange === true && loop.useDefaultRenderLoop === true, `hdr=${loop.scene.highDynamicRange}`)

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`)
}
if (failed.length) {
  console.error(`Terra stability validation failed: ${failed.length}/${results.length}`)
  process.exit(1)
}
console.log(`Terra stability validation: ${results.length}/${results.length} PASS`)

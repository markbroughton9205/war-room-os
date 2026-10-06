import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function check(name: string, ok: boolean, detail: string): void {
  if (!ok) {
    console.error(`FAIL ${name}: ${detail}`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${name}: ${detail}`)
}

const lifecycle = read('components/war-room/terra/cesiumImageryLifecycle.ts')
const cloud = read('components/war-room/terra/TerraCloudImagery.tsx')
const radar = read('components/war-room/terra/TerraRadarImagery.tsx')
const earth = read('components/war-room/terra/TerraEarthImagery.tsx')
const night = read('components/war-room/terra/TerraNightLights.tsx')
const features = read('components/war-room/terra/TerraFeatureLayer.tsx')
const shell = read('components/war-room/terra/TerraShell.tsx')
const scale = read('components/war-room/terra/useTerraCameraScale.ts')
const admin = read('components/war-room/terra/TerraAdminIdentityLayer.tsx')
const primitiveLifecycle = read('components/war-room/terra/cesiumPrimitiveLifecycle.ts')

check(
  'deferred_destroy_helper',
  lifecycle.includes('postRender') && lifecycle.includes('remove(layer, true)') && lifecycle.includes('layer.show = false'),
  'hide then postRender destroy',
)
check(
  'cloud_uses_deferred_destroy',
  cloud.includes('releaseImageryLayerAfterRender') && !cloud.includes('imageryLayers.remove(slot.layer, true)'),
  'cloud dropSlot',
)
check(
  'radar_uses_deferred_destroy',
  radar.includes('releaseImageryLayerAfterRender') && !radar.includes('imageryLayers.remove(slot.layer, true)'),
  'radar dropSlot',
)
check(
  'earth_night_deferred_destroy',
  earth.includes('releaseImageryLayerAfterRender') && night.includes('releaseImageryLayerAfterRender'),
  'base/night cleanup',
)
check(
  'cloud_radar_freeze_on_move',
  cloud.includes('attachCameraMovementGate') && radar.includes('attachCameraMovementGate') && cloud.includes('movingRef.current'),
  'frame swap frozen during camera movement',
)
check(
  'feature_prepare_then_swap',
  /smoothMode\) return[\s\S]*entities\.removeAll\(\)/.test(features) && features.includes('dataSource!.entities.removeAll()'),
  'entities survive cancelled zoom prepares',
)
check(
  'generation_bumps_on_move_end',
  /moveStart[\s\S]*setSmoothMode\(true\)[\s\S]*moveEnd[\s\S]*nextGeneration\(\)/.test(shell)
    && !/moveStart[\s\S]*nextGeneration\(\)[\s\S]*setSmoothMode\(true\)/.test(shell),
  'no entity wipe at zoom start',
)
check(
  'scale_settles_on_move_end',
  scale.includes('camera.moveEnd.addEventListener') && !scale.includes('camera.changed.addEventListener'),
  'governor bands wait for settle',
)
check(
  'admin_rebuild_on_move_end',
  admin.includes('camera.moveEnd.addEventListener(scheduleRebuild)') && !admin.includes('camera.changed.addEventListener(scheduleRebuild)'),
  'flag ImageMaterial not rebuilt mid-zoom',
)
check(
  'admin_label_atlas_deferred_release',
  primitiveLifecycle.includes('postRender') && primitiveLifecycle.includes('primitive.show = false') && admin.includes('releaseScenePrimitiveAfterRender') && !admin.includes('labels.destroy()'),
  'admin glyph atlas is not destroyed in the queued frame',
)
check(
  'admin_label_collection_stable_across_view',
  /\[viewer, enabled\]/.test(admin) && !/\[viewer, enabled, presentation\.countryLod/.test(admin),
  'location and lod rebuild labels in place',
)

if (process.exitCode) process.exit(process.exitCode)
console.log('terra imagery lifecycle validation passed')

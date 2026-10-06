'use client'

import { useEffect } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { atmosphereDepthForBand } from '@/lib/terra/realisticEarth/atmosphereDepth'
import type { TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'

/**
 * Bounded atmospheric depth presentation. Uses Cesium skyAtmosphere only.
 * Does not add imagery layers, procedural cloud noise, or storm relocation.
 */
export function TerraAtmosphereDepth({
  viewer,
  viewBand,
  enabled,
}: {
  viewer: CesiumViewer | null
  viewBand: TerraViewBand
  enabled: boolean
}) {
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const sky = viewer.scene.skyAtmosphere
    if (!sky) return
    const depth = atmosphereDepthForBand(viewBand)
    sky.show = true
    if ('atmosphereLightIntensity' in sky) {
      sky.atmosphereLightIntensity = enabled ? 10 + depth.limb * 8 : 10
    }
  }, [viewer, viewBand, enabled])

  return null
}

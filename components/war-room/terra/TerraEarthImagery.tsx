'use client'

import { useEffect } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { buildGibsTileUrlTemplate } from '@/lib/earth-intelligence/gibsTileUrl'

const CROSSFADE_MS = 900

/** GIBS' curated Terra layers are daily products. Step on UTC observation days and request the
 * previous completed day so "live" never implies a fabricated continuously-updating texture. */
function completedObservationDay(selectedTime: string): string {
  const parsed = new Date(selectedTime)
  const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  return new Date(Date.UTC(safe.getUTCFullYear(), safe.getUTCMonth(), safe.getUTCDate()) - 86_400_000)
    .toISOString()
    .slice(0, 10)
}

export function TerraEarthImagery({ viewer, selectedTime }: { viewer: CesiumViewer | null; selectedTime: string }) {
  const observationDay = completedObservationDay(selectedTime)

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    let cancelled = false
    let animationFrame: number | null = null
    let trueColorLayer: import('cesium').ImageryLayer | null = null

    void import('cesium').then(Cesium => {
      if (cancelled || viewer.isDestroyed()) return

      // True Color is a real daily photograph (VIIRS/NOAA-20 corrected reflectance) — clouds are
      // already visible in it exactly as a camera in orbit would see them. GIBS' other daily
      // products (cloud-top-height, aerosol optical depth, flood, NDVI, snow) are false-color
      // science layers keyed to a legend, not photographic — alpha-blending one of those over this
      // base to simulate "clouds" paints the globe in scientifically-meaningless colors instead of
      // real cloud white/grey, which is why no second layer is added here.
      const trueColor = new Cesium.UrlTemplateImageryProvider({
        url: buildGibsTileUrlTemplate('true-color', observationDay),
        maximumLevel: 9,
        credit: new Cesium.Credit('NASA GIBS · VIIRS NOAA-20 True Color'),
      })

      trueColorLayer = viewer.imageryLayers.addImageryProvider(trueColor)
      trueColorLayer.alpha = 0

      const startedAt = performance.now()
      const fade = (now: number) => {
        if (cancelled || !trueColorLayer) return
        const progress = Math.min(1, (now - startedAt) / CROSSFADE_MS)
        trueColorLayer.alpha = progress
        if (progress < 1) animationFrame = requestAnimationFrame(fade)
      }
      animationFrame = requestAnimationFrame(fade)
    })

    return () => {
      cancelled = true
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      if (!viewer.isDestroyed() && trueColorLayer) viewer.imageryLayers.remove(trueColorLayer, true)
    }
  }, [viewer, observationDay])

  return null
}

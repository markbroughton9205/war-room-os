'use client'

import { useEffect } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { buildGibsTileUrlTemplate } from '@/lib/earth-intelligence/gibsTileUrl'
import { TERRA_SCALE_THRESHOLDS_M } from './useTerraCameraScale'

const CROSSFADE_MS = 900

// God's Eye multi-scale phase, mission section 3: photographic Earth must remain at high
// altitude, but transition toward local map detail as the camera approaches the surface. GIBS
// True Color is capped at native zoom level 9 (see maximumLevel below) — well short of city/
// street detail — so simply leaving it at alpha 1 always would just show an increasingly blurry
// upsampled photograph as the Commander zooms in, never revealing the OSM base layer's much
// higher-resolution street/building/park raster tiles already sitting beneath it (TerraGlobe.tsx's
// `baseLayer`). Reusing the exact REGIONAL/CITY bands useTerraCameraScale.ts already defines (not
// a second set of thresholds) keeps this crossfade and the discrete scale-level badge in
// agreement about where "regional" ends and "city" begins.
const IMAGERY_FADE_FULL_ABOVE_M = TERRA_SCALE_THRESHOLDS_M.regional
const IMAGERY_FADE_ZERO_AT_M = TERRA_SCALE_THRESHOLDS_M.city

function heightBasedAlpha(heightMeters: number): number {
  if (heightMeters >= IMAGERY_FADE_FULL_ABOVE_M) return 1
  if (heightMeters <= IMAGERY_FADE_ZERO_AT_M) return 0
  return (heightMeters - IMAGERY_FADE_ZERO_AT_M) / (IMAGERY_FADE_FULL_ABOVE_M - IMAGERY_FADE_ZERO_AT_M)
}

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
    // Aliased once, synchronously, before any async gap. Every one of the several async
    // resumption points below (the dynamic import, and — critically — every later
    // requestAnimationFrame tick and camera.changed firing) is a real opportunity for a sibling
    // TerraGlobe remount to destroy this exact viewer first; each one re-checks isDestroyed()
    // immediately before touching it, not just the first resumption point.
    const targetViewer = viewer
    let cancelled = false
    let animationFrame: number | null = null
    let trueColorLayer: import('cesium').ImageryLayer | null = null
    let removeCameraChanged: (() => void) | null = null
    // Mutated by both the one-shot fade-in rAF loop and the persistent camera listener below;
    // read imperatively by both — never routed through React state, matching Phase 6's "no
    // setState per Cesium frame/camera event" performance mandate.
    let fadeInProgress = 0

    void import('cesium').then(Cesium => {
      if (cancelled || targetViewer.isDestroyed()) return

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

      trueColorLayer = targetViewer.imageryLayers.addImageryProvider(trueColor)
      trueColorLayer.alpha = 0

      const applyAlpha = () => {
        if (!trueColorLayer || targetViewer.isDestroyed()) return
        const height = targetViewer.camera.positionCartographic.height
        trueColorLayer.alpha = fadeInProgress * heightBasedAlpha(height)
      }

      const startedAt = performance.now()
      const fade = (now: number) => {
        if (cancelled || !trueColorLayer || targetViewer.isDestroyed()) return
        fadeInProgress = Math.min(1, (now - startedAt) / CROSSFADE_MS)
        applyAlpha()
        if (fadeInProgress < 1) animationFrame = requestAnimationFrame(fade)
      }
      animationFrame = requestAnimationFrame(fade)

      // Cesium's own `percentageChanged`-gated event — bounded, not per-frame — keeps the
      // photographic-vs-local crossfade following the camera after the initial fade-in completes.
      targetViewer.camera.changed.addEventListener(applyAlpha)
      removeCameraChanged = () => {
        if (!targetViewer.isDestroyed()) targetViewer.camera.changed.removeEventListener(applyAlpha)
      }
    })

    return () => {
      cancelled = true
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      removeCameraChanged?.()
      if (!targetViewer.isDestroyed() && trueColorLayer) targetViewer.imageryLayers.remove(trueColorLayer, true)
    }
  }, [viewer, observationDay])

  return null
}

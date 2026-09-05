'use client'

import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { buildGibsTileUrlTemplate } from '@/lib/earth-intelligence/gibsTileUrl'
import { TERRA_SCALE_THRESHOLDS_M } from './useTerraCameraScale'

const CROSSFADE_MS = 900

// God's Eye multi-scale phase, mission section 3: photographic Earth must remain at high
// altitude, but transition toward closer-range aerial detail as the camera approaches the
// surface. GIBS True Color is capped at native zoom level 9 (see maximumLevel below) — well short
// of city/street detail. Reusing the exact REGIONAL/CITY bands useTerraCameraScale.ts already
// defines (not a second set of thresholds) keeps this crossfade and the discrete scale-level badge
// in agreement about where "regional" ends and "city" begins.
const IMAGERY_FADE_FULL_ABOVE_M = TERRA_SCALE_THRESHOLDS_M.regional
const IMAGERY_FADE_ZERO_AT_M = TERRA_SCALE_THRESHOLDS_M.city

function heightBasedAlpha(heightMeters: number): number {
  if (heightMeters >= IMAGERY_FADE_FULL_ABOVE_M) return 1
  if (heightMeters <= IMAGERY_FADE_ZERO_AT_M) return 0
  return (heightMeters - IMAGERY_FADE_ZERO_AT_M) / (IMAGERY_FADE_FULL_ABOVE_M - IMAGERY_FADE_ZERO_AT_M)
}

/** Inverse of heightBasedAlpha — 0 above regional (GIBS still fully covers), rising to 1 by city
 * scale, staying 1 through local/building. Only meaningful once a real ion World Imagery asset has
 * loaded (see `aerialAvailable` below); this is deliberately the complement of the same band, not
 * an independently-tuned one, so the handoff has no gap or double-exposure seam. */
function inverseHeightBasedAlpha(heightMeters: number): number {
  return 1 - heightBasedAlpha(heightMeters)
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

export type TerraEarthImageryProps = {
  viewer: CesiumViewer | null
  selectedTime: string
  /** The same `NEXT_PUBLIC_CESIUM_ION_TOKEN` boundary TerraGlobe.tsx already gates World Terrain
   * and OSM Buildings on. Presence alone does not guarantee the asset actually loads (ion
   * account/entitlement issues are real, same rule as OSM Buildings) — `onAerialImageryAvailabilityChange`
   * reports the real detected outcome, never bare token presence. */
  hasIonToken: boolean
  /** Commander-toggled escape hatch: shows the OSM raster base (roads/labels/boundaries/POIs) on
   * top of the photographic imagery instead of leaving it as an automatic close-range takeover. */
  mapDetailMode: boolean
  /** Fires once the real availability of ion World Imagery (Bing Maps Aerial) is known — `false`
   * immediately when no token is configured, or after a real failed asset request. */
  onAerialImageryAvailabilityChange?: (available: boolean) => void
}

export function TerraEarthImagery({ viewer, selectedTime, hasIonToken, mapDetailMode, onAerialImageryAvailabilityChange }: TerraEarthImageryProps) {
  const observationDay = completedObservationDay(selectedTime)

  // Read imperatively inside the Cesium camera listener below, which must not itself be recreated
  // on every mapDetailMode toggle (that would mean tearing down and re-adding the GIBS/World
  // Imagery layers just to flip a boolean) — same ref-for-imperative-reads idiom TerraGlobe.tsx
  // already uses for its click callbacks.
  const mapDetailModeRef = useRef(mapDetailMode)
  // Set by the boot effect below once the layers exist; lets the mapDetailMode effect force an
  // immediate re-apply even when the camera is sitting idle (no camera.changed to piggyback on).
  const applyAlphaRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    mapDetailModeRef.current = mapDetailMode
    applyAlphaRef.current?.()
  }, [mapDetailMode])

  const onAerialImageryAvailabilityChangeRef = useRef(onAerialImageryAvailabilityChange)
  useEffect(() => {
    onAerialImageryAvailabilityChangeRef.current = onAerialImageryAvailabilityChange
  }, [onAerialImageryAvailabilityChange])

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
    let worldImageryLayer: import('cesium').ImageryLayer | null = null
    let osmBaseLayer: import('cesium').ImageryLayer | null = null
    let removeCameraChanged: (() => void) | null = null
    // Mutated by both the one-shot fade-in rAF loop and the persistent camera listener below;
    // read imperatively by both — never routed through React state, matching Phase 6's "no
    // setState per Cesium frame/camera event" performance mandate.
    let fadeInProgress = 0

    void loadCesium().then(async Cesium => {
      if (cancelled || targetViewer.isDestroyed()) return

      // The Viewer's baseLayer (TerraGlobe.tsx) — controlled here so it only surfaces via the
      // explicit "map detail" toggle instead of bleeding through whenever the photographic layers
      // above it fade during the crossfade band.
      osmBaseLayer = targetViewer.imageryLayers.get(0) ?? null
      if (osmBaseLayer) osmBaseLayer.alpha = mapDetailModeRef.current ? 1 : 0

      // Real satellite/aerial photography (Cesium ion's World Imagery, Bing Maps Aerial) — the
      // same lawfully-configured ion boundary as World Terrain/OSM Buildings, reused rather than
      // adding a new provider or secret. Added BEFORE the GIBS layer so it sits above the OSM base
      // but below GIBS in the stack; a real failed request (no entitlement, network) degrades to
      // `null` here exactly like OSM Buildings does in TerraGlobe.tsx — never assumed from token
      // presence alone.
      if (hasIonToken) {
        try {
          const worldImagery = await Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL })
          if (cancelled || targetViewer.isDestroyed()) return
          worldImageryLayer = targetViewer.imageryLayers.addImageryProvider(worldImagery)
          worldImageryLayer.alpha = 0
        } catch {
          worldImageryLayer = null
        }
      }
      onAerialImageryAvailabilityChangeRef.current?.(worldImageryLayer !== null)

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

      const aerialAvailable = worldImageryLayer !== null

      const applyAlpha = () => {
        if (!trueColorLayer || targetViewer.isDestroyed()) return
        const height = targetViewer.camera.positionCartographic.height
        // Without a real aerial asset there is nothing to hand off to at close range — hold GIBS
        // at full opacity instead of fading it toward the OSM base, so the Commander always sees a
        // real (if low-resolution close up) photograph rather than a silently-substituted map.
        trueColorLayer.alpha = fadeInProgress * (aerialAvailable ? heightBasedAlpha(height) : 1)
        if (worldImageryLayer) worldImageryLayer.alpha = fadeInProgress * inverseHeightBasedAlpha(height)
        if (osmBaseLayer) osmBaseLayer.alpha = mapDetailModeRef.current ? 1 : 0
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
      applyAlphaRef.current = applyAlpha
    })

    return () => {
      cancelled = true
      applyAlphaRef.current = null
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      removeCameraChanged?.()
      if (!targetViewer.isDestroyed()) {
        if (trueColorLayer) targetViewer.imageryLayers.remove(trueColorLayer, true)
        if (worldImageryLayer) targetViewer.imageryLayers.remove(worldImageryLayer, true)
      }
    }
  }, [viewer, observationDay, hasIonToken])

  return null
}

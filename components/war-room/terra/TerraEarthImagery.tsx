'use client'

import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { buildGibsTileUrlTemplate } from '@/lib/earth-intelligence/gibsTileUrl'
import { resolveTerraImageryAlphas, TERRA_IMAGERY_PROVIDER_FAIL_STREAK } from '@/lib/terra/aerialImagery'

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

export type TerraEarthImageryProps = {
  viewer: CesiumViewer | null
  selectedTime: string
  /** The same `NEXT_PUBLIC_CESIUM_ION_TOKEN` boundary TerraGlobe.tsx already gates World Terrain
   * and OSM Buildings on. Presence alone does not guarantee the asset actually loads (ion
   * account/entitlement issues are real, same rule as OSM Buildings) — `onAerialImageryAvailabilityChange`
   * reports the real detected outcome, never bare token presence. */
  hasIonToken: boolean
  /** Commander overlay: force the OSM raster base on top of photographs. Close-range OSM is
   * already the automatic fallback when high-res aerial is unavailable — this toggle is not the
   * only way to keep the globe readable. */
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

      // The Viewer's baseLayer (TerraGlobe.tsx) — OSM raster. Hidden while photographs cover the
      // view; automatically raised at city+ when high-res aerial is missing (and whenever GIBS
      // tiles fail). The Commander map-detail toggle still forces it at any altitude.
      osmBaseLayer = targetViewer.imageryLayers.get(0) ?? null
      if (osmBaseLayer) osmBaseLayer.alpha = 0

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

      let aerialAvailable = worldImageryLayer !== null
      let photographicFailed = false
      let worldFailStreak = 0
      let gibsFailStreak = 0

      const applyAlpha = () => {
        if (!trueColorLayer || targetViewer.isDestroyed()) return
        const height = targetViewer.camera.positionCartographic.height
        const alphas = resolveTerraImageryAlphas({
          aerialAvailable,
          photographicFailed,
          mapDetailMode: mapDetailModeRef.current,
          heightMeters: height,
          fade: fadeInProgress,
        })
        if (osmBaseLayer) osmBaseLayer.alpha = alphas.osm
        trueColorLayer.alpha = alphas.gibs
        if (worldImageryLayer) worldImageryLayer.alpha = alphas.world
      }

      const markWorldImageryFailed = () => {
        if (!aerialAvailable) return
        aerialAvailable = false
        onAerialImageryAvailabilityChangeRef.current?.(false)
        applyAlpha()
      }

      const worldProvider = worldImageryLayer?.imageryProvider
      if (worldProvider && typeof worldProvider.errorEvent?.addEventListener === 'function') {
        worldProvider.errorEvent.addEventListener(() => {
          if (cancelled) return
          worldFailStreak += 1
          if (worldFailStreak >= TERRA_IMAGERY_PROVIDER_FAIL_STREAK) markWorldImageryFailed()
        })
      }

      trueColor.errorEvent.addEventListener(() => {
        if (cancelled || photographicFailed) return
        gibsFailStreak += 1
        if (gibsFailStreak >= TERRA_IMAGERY_PROVIDER_FAIL_STREAK) {
          photographicFailed = true
          applyAlpha()
        }
      })

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
